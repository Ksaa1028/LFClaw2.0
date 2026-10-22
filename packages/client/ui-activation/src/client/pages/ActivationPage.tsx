import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { employeeProfile, type EmployeeProfile } from '../employee.ts'
import css from './ActivationPage.module.css'
/** 企业激活页的本地化参数。 */
export interface ActivationPageProps {
  t: TranslateNS<'activation'>
  onEmployee?: (employee: EmployeeProfile | null) => void
}
/** 校验企业凭据。 @param props - 本地化文案。 @returns 激活遮罩。 */
export function ActivationPage({ t, onEmployee }: ActivationPageProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const [code, setCode] = useState('')
  const [activated, setActivated] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    void fetch('/api/lfclaw/status', { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json()
        if (!controller.signal.aborted) {
          setActivated(response.ok && employeeProfile(value) !== null)
          onEmployee?.(response.ok ? employeeProfile(value) : null)
          setError(!response.ok)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => {
      controller.abort()
    }
  }, [attempt])
  if (activated) return null
  return (
    <dialog
      ref={dialog}
      className={css.container}
      aria-labelledby="activation-title"
      onCancel={(event) => {
        event.preventDefault()
      }}
    >
      <div className={css.wordmark}>{t('activationTitle')}</div>
      <div className={css.card}>
        <div className={css.mark} aria-hidden="true">
          <img src="./assets/lfclaw-logo.svg" width={104} height={104} alt="" />
        </div>
        <div className={css.header}>
          <h1 id="activation-title">{t('welcomeTitle')}</h1>
          <p>{t('activationSubtitle')}</p>
        </div>
        <form
          className={css.form}
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy || !code.trim()) return
            setBusy(true)
            setError(false)
            try {
              const response = await fetch('/api/lfclaw/activate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code.trim() }),
              })
              const value = await response.json()
              if (response.ok && employeeProfile(value)) {
                setCode('')
                setActivated(true)
                onEmployee?.(employeeProfile(value))
              } else setError(true)
            } catch (error) {
              setError(true)
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className={css.field}>
            <label htmlFor="activation-code">{t('activationCode')}</label>
            <input
              id="activation-code"
              type="password"
              value={code}
              maxLength={128}
              disabled={busy}
              onChange={(event) => {
                setCode(event.target.value)
              }}
              placeholder={t('activationCodeExample')}
              autoComplete="off"
            />
          </div>
          {error && (
            <p className={css.error} role="alert">
              {t('activationError')}
            </p>
          )}
          <Button className={css.submit} variant="primary" type="submit" disabled={busy || !code.trim()}>
            {t(busy ? 'checking' : 'activate')}
          </Button>
          {error && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setAttempt(value => value + 1)
              }}
            >
              {t('retry')}
            </Button>
          )}
        </form>
        <p className={css.hint}>{t('activationHint')}</p>
      </div>
      <footer className={css.footer}>{t('footer')}</footer>
    </dialog>
  )
}
