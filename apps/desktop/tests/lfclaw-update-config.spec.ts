import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

describe('LFClaw update packaging', () => {
  it('ships only the LFClaw feed and public key without the original mandatory policy', () => {
    const url = 'http://8.216.38.213:39811/lfclaw-updates/win-x64/'
    const config = createElectronBuilderConfig(
      { DSH_DESKTOP_UNSIGNED: '1', DSH_DESKTOP_APP_ID: 'com.deepseek.harness', LFCLAW_DESKTOP_UPDATE_URL: url },
      'win32',
      'x64',
    )
    expect(config.publish).toEqual([{ provider: 'generic', url, channel: 'nightly' }])
    expect(config.extraMetadata).toMatchObject({ lfclawUpdatePublicKey: expect.stringContaining('BEGIN PUBLIC KEY') })
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
  })
  it('rejects a feed URL outside the LFClaw download route', () => {
    expect(() =>
      createElectronBuilderConfig(
        {
          DSH_DESKTOP_UNSIGNED: '1',
          DSH_DESKTOP_APP_ID: 'com.deepseek.harness',
          LFCLAW_DESKTOP_UPDATE_URL: 'https://download.deepseek.com/',
        },
        'win32',
        'x64',
      ),
    ).toThrow('Invalid LFClaw update URL')
  })
})
