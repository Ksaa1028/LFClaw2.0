import type { ReactNode } from 'react'
import {
  Button,
  IconArchiveOutlineRegular,
  IconCloseOutlineRegular,
  IconDatabaseOutlineRegular,
  IconDataOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGaugeOutlineRegular,
  IconGlobeOutlineRegular,
  IconInfoOutlineRegular,
  IconPanelLeftOutlineRegular,
  IconPlanOutlineRegular,
  IconShieldOutlineRegular,
  IconSkillOutlineRegular,
  IconUsersOutlineRegular,
  SegmentedTabs,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { LOCALE_LABELS, type Locale } from '../locales/index.ts'
import type { Translate } from '../locales/index.ts'
import css from './AdminLayout.module.css'

export type AdminPage =
  | 'dashboard'
  | 'usage'
  | 'departments'
  | 'employees'
  | 'models'
  | 'skills'
  | 'connectors'
  | 'experts'
  | 'notifications'
  | 'backup'
  | 'versions'
  | 'system'

export interface AdminLayoutProps {
  page: AdminPage
  onChangePage: (page: AdminPage) => void
  locale: Locale
  onChangeLocale: (locale: Locale) => void
  adminName: string
  onLogout: () => void
  onChangePassword: () => void
  children: ReactNode
  t: Translate
}

interface NavItem {
  page: AdminPage
  icon: typeof IconGaugeOutlineRegular
  labelKey: `nav.${AdminPage}`
}

const NAV_ITEMS: NavItem[] = [
  { page: 'dashboard', icon: IconGaugeOutlineRegular, labelKey: 'nav.dashboard' },
  { page: 'usage', icon: IconPlanOutlineRegular, labelKey: 'nav.usage' },
  { page: 'departments', icon: IconFolderOpenOutlineRegular, labelKey: 'nav.departments' },
  { page: 'employees', icon: IconUsersOutlineRegular, labelKey: 'nav.employees' },
  { page: 'models', icon: IconGlobeOutlineRegular, labelKey: 'nav.models' },
  { page: 'skills', icon: IconSkillOutlineRegular, labelKey: 'nav.skills' },
  { page: 'connectors', icon: IconDatabaseOutlineRegular, labelKey: 'nav.connectors' },
  { page: 'experts', icon: IconShieldOutlineRegular, labelKey: 'nav.experts' },
  { page: 'notifications', icon: IconInfoOutlineRegular, labelKey: 'nav.notifications' },
  { page: 'backup', icon: IconArchiveOutlineRegular, labelKey: 'nav.backup' },
  { page: 'versions', icon: IconPlanOutlineRegular, labelKey: 'nav.versions' },
  { page: 'system', icon: IconDataOutlineRegular, labelKey: 'nav.system' },
]

const LOCALE_ITEMS = [
  { id: 'locale-zh', value: 'zh' as const, label: LOCALE_LABELS.zh, panelId: 'locale-panel-zh' },
  { id: 'locale-en', value: 'en' as const, label: LOCALE_LABELS.en, panelId: 'locale-panel-en' },
] as const

export function AdminLayout({
  page,
  onChangePage,
  locale,
  onChangeLocale,
  adminName,
  onLogout,
  onChangePassword,
  children,
  t,
}: AdminLayoutProps): ReactNode {
  return (
    <div className={css.layout}>
      <aside className={css.sidebar}>
        <div className={css.sidebarHeader}>
          <span className={css.logo}>
            <img data-lfclaw-logo="inverse" src="./lfclaw-logo-transparent.png" width={36} height={36} alt="" />
          </span>
          <div>
            <strong className={css.brand}>LFClaw</strong>
            <span className={css.brandSub}>{t('appSubtitle')}</span>
          </div>
        </div>

        <nav className={css.nav} aria-label={t('mainNavigation')}>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const active = page === item.page
            return (
              <button
                key={item.page}
                type="button"
                className={css.navItem}
                data-active={active}
                onClick={() => onChangePage(item.page)}
              >
                <Icon size={18} />
                <span>{t(item.labelKey)}</span>
              </button>
            )
          })}
        </nav>

        <div className={css.sidebarFooter}>
          <SegmentedTabs
            items={LOCALE_ITEMS}
            value={locale}
            onChange={next => onChangeLocale(next)}
            label={t('language')}
          />
        </div>
      </aside>

      <div className={css.mainWrapper}>
        <header className={css.topbar}>
          <button
            type="button"
            className={css.menuToggle}
            onClick={() => {}}
            aria-label={t('toggleNavigation')}
          >
            <IconPanelLeftOutlineRegular size={18} />
          </button>
          <div className={css.topbarMeta}>
            <span className={css.adminName}>{t('welcomeBack', { name: adminName })}</span>
            <Button variant="ghost" onClick={onChangePassword}>{t('passwordChange.title')}</Button>
            <Button variant="ghost" onClick={onLogout} icon={<IconCloseOutlineRegular size={16} />}>
              {t('logout')}
            </Button>
          </div>
        </header>

        <main className={css.content}>{children}</main>
      </div>
    </div>
  )
}
