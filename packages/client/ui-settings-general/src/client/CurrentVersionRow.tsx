/** Client build version in the settings navigation footer. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState } from 'react'
import css from './CurrentVersionRow.module.css'

/**
 * Render the installed Desktop version, or browser build metadata outside Desktop.
 * @param props - localized copy.
 * @returns the current release label, or nothing when build metadata is absent.
 */
export function CurrentVersionRow({ t }: PropsLocale<'settings'>) {
  const desktop = (
    globalThis as typeof globalThis & {
      dshDesktop?: { protocolVersion: number; installedVersion?: () => Promise<string> }
    }
  ).dshDesktop
  const readVersion = desktop?.protocolVersion === 1 ? desktop.installedVersion : undefined
  const [version, setVersion] = useState<string | undefined>(readVersion ? undefined : process.env.DSH_CLIENT_VERSION)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!readVersion) return
    let active = true
    void readVersion()
      .then((value) => {
        if (active) setVersion(value)
      })
      .catch((error: unknown) => {
        console.error('Cannot read installed Desktop version', error)
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [readVersion])
  if (failed)
    return (
      <div className={css.row} role="status">
        {t('general.currentVersionFailed')}
      </div>
    )
  if (version === undefined) return null
  return (
    <div className={css.row} data-client-version={version}>
      {t('general.currentVersion', { version })}
    </div>
  )
}
