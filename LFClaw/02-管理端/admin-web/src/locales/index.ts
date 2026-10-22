import { zh } from './zh.ts'
import { en } from './en.ts'

export type Locale = 'zh' | 'en'

type Join<K extends string | number, P extends string | number> = `${K}${'' extends P ? '' : '.'}${P}`

type Paths<T> = T extends object
  ? { [K in keyof T]-?: K extends string | number
      ? `${K}` | Join<K, Paths<T[K]>>
      : never
    }[keyof T]
  : never

export type AdminLocaleKey = Paths<typeof zh>

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: zh.zh,
  en: en.en,
}

export const DEFAULT_LOCALE: Locale = 'zh'

export const locales: Record<Locale, typeof zh | typeof en> = {
  zh,
  en,
}

/** Simple interpolation helper: replaces {key} with provided values. */
export function formatLocale(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

export type Translate = (
  key: AdminLocaleKey,
  values?: Record<string, string | number>,
) => string
