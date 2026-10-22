import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { AdminLayout, type AdminPage } from './components/AdminLayout.tsx'
import { PasswordDialog } from './components/PasswordDialog.tsx'
import { useLocale } from './hooks/useLocale.ts'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { UsagePage } from './pages/UsagePage.tsx'
import { DepartmentsPage } from './pages/DepartmentsPage.tsx'
import { EmployeesPage } from './pages/EmployeesPage.tsx'
import { ModelsPage } from './pages/ModelsPage.tsx'
import { SkillsPage } from './pages/SkillsPage.tsx'
import { ConnectorsPage } from './pages/ConnectorsPage.tsx'
import { ExpertsPage } from './pages/ExpertsPage.tsx'
import { NotificationsPage } from './pages/NotificationsPage.tsx'
import { BackupPage } from './pages/BackupPage.tsx'
import { VersionsPage } from './pages/VersionsPage.tsx'
import { SystemStatusPage } from './pages/SystemStatusPage.tsx'
import { ApiError, changeAdminPassword, clearSession, hasSession, loadData, login, logout, saveAction } from './api.ts'
import { AppContext, appReducer, type AppState } from './store.ts'
import css from './App.module.css'

const emptyState: AppState = {
  monthlyCost: { status: 'unavailable' },
  departments: [], employees: [], models: [], skills: [], connectors: [], experts: [],
  backups: [], versionPackages: [], employeeVersionReports: [], operationLogs: [],
  recentActivities: [], dashboardTrend: [], notifications: [],
  systemMetric: { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, gatewayStatus: 'offline' },
  systemErrors: [],
}

export function App(): ReactNode {
  const { locale, setLocale, t } = useLocale()
  const [state, dispatch] = useReducer(appReducer, emptyState)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState<boolean>(hasSession)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [page, setPage] = useState<AdminPage>('dashboard')
  const [toast, setToast] = useState<{ text: string; tone?: 'success' | undefined } | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [dataRevision, setDataRevision] = useState(0)
  const refreshData = useCallback(() => setDataRevision(value => value + 1), [])
  const changePage = useCallback((next: AdminPage) => {
    setPage(next)
    if (next === 'dashboard') refreshData()
  }, [refreshData])

  useEffect(() => {
    if (!authenticated) { setLoading(false); return }
    const controller = new AbortController()
    setLoading(true)
    void loadData(controller.signal).then(data => {
      if (controller.signal.aborted) return
      dispatch({ type: 'HYDRATE', payload: data }); setLoadError(null)
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false)
      else setLoadError(error instanceof Error ? error.message : t('dashboard.loadFailed'))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [authenticated, dataRevision, t])

  const showToast = useCallback((text: string, tone?: 'success' | undefined) => { setToast({ text, tone }) }, [])

  const handleLogin = useCallback(async (username: string, password: string): Promise<boolean | string> => {
    try {
      await login(username, password)
      setAuthenticated(true)
      showToast(t('welcomeBack', { name: '超级管理员' }), 'success')
      return true
    } catch (error) {
      return error instanceof ApiError && error.status === 401 ? false : '无法连接企业服务，请确认服务已启动后重试'
    }
  }, [t, showToast])

  const handleLogout = useCallback(() => {
    void logout().catch(() => clearSession())
    setAuthenticated(false)
    setPage('dashboard')
  }, [])

  const save = useCallback(async (action: Parameters<typeof saveAction>[0]): Promise<boolean> => {
    try {
      dispatch(await saveAction(action))
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false)
      showToast(error instanceof Error ? error.message : '保存失败')
      return false
    }
  }, [showToast])

  const handleChangePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    try {
      await changeAdminPassword(current, next)
      showToast(t('passwordChange.success'), 'success')
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('loginFailed'))
      return false
    }
  }, [showToast, t])

  const pageNode = useMemo<ReactNode>(() => {
    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t('loading')}</div>
    if (loadError) return <div role="alert" style={{ padding: 40 }}><p>{t('dashboard.loadFailed')}</p><p>{loadError}</p><Button onClick={refreshData}>{t('dashboard.refresh')}</Button></div>
    switch (page) {
      case 'dashboard': return <DashboardPage t={t} onRefresh={refreshData} />
      case 'usage': return <UsagePage t={t} />
      case 'departments': return <DepartmentsPage t={t} showToast={showToast} />
      case 'employees': return <EmployeesPage t={t} showToast={showToast} />
      case 'models': return <ModelsPage t={t} showToast={showToast} />
      case 'skills': return <SkillsPage t={t} showToast={showToast} />
      case 'connectors': return <ConnectorsPage t={t} showToast={showToast} />
      case 'experts': return <ExpertsPage t={t} showToast={showToast} />
      case 'notifications': return <NotificationsPage t={t} showToast={showToast} />
      case 'backup': return <BackupPage t={t} showToast={showToast} />
      case 'versions': return <VersionsPage t={t} showToast={showToast} />
      case 'system': return <SystemStatusPage t={t} showToast={showToast} />
      default: return <DashboardPage t={t} onRefresh={refreshData} />
    }
  }, [page, t, showToast, loading, loadError, refreshData])

  if (!authenticated) return <LoginPage t={t} onLogin={handleLogin} />

  return (
    <AppContext.Provider value={{ state, dispatch: save }}>
      <div className={css.app}>
        <AdminLayout page={page} onChangePage={changePage} locale={locale} onChangeLocale={setLocale} adminName="超级管理员" onLogout={handleLogout} onChangePassword={() => setPasswordOpen(true)} t={t}>
          {pageNode}
        </AdminLayout>
        <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} onSubmit={handleChangePassword} t={t} />
        {toast != null && (<Toast key={toast.text} text={toast.text} {...(toast.tone != null ? { tone: toast.tone } : {})} onDone={() => setToast(null)} />)}
      </div>
    </AppContext.Provider>
  )
}
