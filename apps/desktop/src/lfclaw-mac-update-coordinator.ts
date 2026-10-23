/** Signed LFClaw macOS update checks and user-authorized DMG downloads. */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { gt, valid } from 'semver'
import type { DesktopUpdateState } from './ipc.ts'
import { verifyLFClawUpdate } from './lfclaw-update-signature.ts'

interface MacFeed {
  version: string
  files: [{ url: string; sha512: string; size: number }]
}

/** A Mac test release opens its verified DMG for manual installation. */
export class LFClawMacUpdateCoordinator {
  private current: DesktopUpdateState = { phase: 'idle' }
  private candidate: MacFeed | undefined
  private downloaded: string | undefined
  private pendingCheck: Promise<DesktopUpdateState> | undefined
  private pendingDownload: Promise<DesktopUpdateState> | undefined
  private disposed = false

  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly confirmOpen: () => Promise<boolean>,
    private readonly baseUrl: string,
    private readonly publicKey: string,
    private readonly currentVersion: () => string = () => app.getVersion(),
  ) {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith('/lfclaw-updates/mac-arm64/')) throw new Error('Invalid LFClaw macOS update URL')
  }

  get state(): DesktopUpdateState { return this.current }

  async check(manual = false): Promise<DesktopUpdateState> {
    if (this.disposed) throw new Error('desktop update: coordinator is disposed')
    if (this.pendingDownload !== undefined || this.downloaded !== undefined) return this.current
    this.pendingCheck ??= this.checkFeed().finally(() => { this.pendingCheck = undefined })
    const result = await this.pendingCheck
    if (manual && result.phase === 'error') this.setState(result)
    return result
  }

  private async checkFeed(): Promise<DesktopUpdateState> {
    try {
      const response = await fetch(new URL('nightly.yml', this.baseUrl), { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`LFClaw macOS update feed returned ${response.status}`)
      const info: unknown = await response.json()
      verifyLFClawUpdate(info, this.publicKey, 'mac-arm64')
      const feed = info as MacFeed
      if (valid(feed.version) === null) throw new Error('desktop update: feed version is invalid')
      this.candidate = gt(feed.version, this.currentVersion()) ? feed : undefined
      return this.setState(this.candidate === undefined ? { phase: 'idle' } : { phase: 'available', version: feed.version })
    } catch (error) {
      this.candidate = undefined
      return this.failure(error, 'check')
    }
  }

  async download(version: string): Promise<DesktopUpdateState> {
    if (this.disposed) throw new Error('desktop update: coordinator is disposed')
    this.pendingDownload ??= this.downloadFeed(version).finally(() => { this.pendingDownload = undefined })
    return this.pendingDownload
  }

  private async downloadFeed(version: string): Promise<DesktopUpdateState> {
    await this.pendingCheck
    const feed = this.candidate
    if (feed === undefined || feed.version !== version) throw new Error('desktop update: download confirmation is stale')
    const file = feed.files[0]
    const directory = join(app.getPath('userData'), 'lfclaw-mac-updates')
    const destination = join(directory, file.url)
    const partial = `${destination}.partial`
    try {
      await mkdir(directory, { recursive: true })
      this.setState({ phase: 'downloading', version, percent: 0 })
      const response = await fetch(new URL(file.url, this.baseUrl), { redirect: 'error', signal: AbortSignal.timeout(900_000) })
      if (!response.ok || response.body === null) throw new Error(`LFClaw macOS download returned ${response.status}`)
      const output = await open(partial, 'w')
      const hash = createHash('sha512')
      let size = 0
      try {
        for await (const chunk of response.body) {
          let offset = 0
          while (offset < chunk.length) offset += (await output.write(chunk, offset)).bytesWritten
          hash.update(chunk)
          size += chunk.length
          if (size > file.size) throw new Error('LFClaw macOS installer exceeds signed size')
          this.setState({ phase: 'downloading', version, percent: Math.floor(size / file.size * 100) })
        }
      } finally { await output.close() }
      this.setState({ phase: 'verifying', version })
      if (size !== file.size || hash.digest('base64') !== file.sha512) throw new Error('LFClaw macOS installer checksum mismatch')
      await rename(partial, destination)
      this.downloaded = destination
      return this.setState({ phase: 'ready', version })
    } catch (error) {
      await rm(partial, { force: true })
      return this.failure(error, 'download')
    }
  }

  async install(version: string): Promise<DesktopUpdateState> {
    if (this.disposed || this.downloaded === undefined || this.candidate?.version !== version) {
      throw new Error('desktop update: confirmed target is not ready')
    }
    try {
      if (!await this.confirmOpen()) return this.current
      if (!existsSync(this.downloaded)) throw new Error('LFClaw macOS installer is missing')
      const file = this.candidate.files[0]
      const hash = createHash('sha512')
      for await (const chunk of createReadStream(this.downloaded)) hash.update(Buffer.from(chunk))
      if (hash.digest('base64') !== file.sha512) throw new Error('LFClaw macOS installer checksum mismatch')
      const error = await shell.openPath(this.downloaded)
      if (error !== '') throw new Error(error)
      return this.current
    } catch (error) { return this.failure(error, 'install') }
  }

  dispose(): void { this.disposed = true }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    if (!this.disposed) { this.current = state; this.publish(state) }
    return state
  }

  private failure(error: unknown, failedOperation: 'check' | 'download' | 'install'): DesktopUpdateState {
    return { phase: 'error', failedOperation, ...(this.candidate === undefined ? {} : { version: this.candidate.version }),
      message: error instanceof Error ? error.message : String(error) }
  }
}
