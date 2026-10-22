import { useCallback, useMemo, useState } from 'react'
import {
  DEFAULT_LOCALE,
  formatLocale,
  locales,
  type AdminLocaleKey,
  type Locale,
  type Translate,
} from '../locales/index.ts'

const STORAGE_KEY = 'lfclaw-admin-locale'

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') {
      return stored
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_LOCALE
}

function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // ignore storage errors
  }
}

export interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

export function useLocale(): LocaleContextValue {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    writeStoredLocale(next)
  }, [])

  const dictionary = useMemo(() => locales[locale], [locale])

  const t = useCallback<Translate>(
    (key: AdminLocaleKey, values?: Record<string, string | number>): string => {
      const template = getByPath(dictionary as Record<string, unknown>, key)
      return formatLocale(template ?? key, values)
    },
    [dictionary],
  )

  return useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  )
}

function getByPath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}
