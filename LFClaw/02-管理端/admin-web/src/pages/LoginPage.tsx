import { useCallback, useState, type ReactNode, type FormEvent } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../locales/index.ts'
import css from './LoginPage.module.css'

export interface LoginPageProps {
  t: Translate
  onLogin: (username: string, password: string) => Promise<boolean | string>
}

export function LoginPage({ t, onLogin }: LoginPageProps): ReactNode {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { const result = await onLogin(username.trim(), password); setError(result === true ? '' : typeof result === 'string' ? result : t('loginFailed')) }
    finally { setBusy(false) }
  }, [username, password, onLogin, busy, t])

  return (
    <div className={css.page}>
      <form className={css.card} onSubmit={handleSubmit}>
        <img src="./lfclaw-logo-transparent.png" width={64} height={64} alt="" />
        <h1 className={css.title}>{t('loginPage.title')}</h1>
        <p className={css.subtitle}>{t('loginPage.subtitle')}</p>

        <label className={css.field}>
          <span>{t('username')}</span>
          <Input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('loginPage.usernamePlaceholder')}
            autoFocus
          />
        </label>

        <label className={css.field}>
          <span>{t('password')}</span>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('loginPage.passwordPlaceholder')}
          />
        </label>

        {error && <span className={css.error}>{error}</span>}

        <Button type="submit" disabled={busy} variant="primary" className={css.submit}>
          {t('loginPage.button')}
        </Button>
      </form>
    </div>
  )
}
