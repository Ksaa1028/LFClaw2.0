/**
 * LFClaw 管理端全局数据存储
 * 通过后端 API 读写，数据保存在服务端配置的数据目录中
 * 刷新页面、重启浏览器数据不丢失
 */
import { createContext, useContext } from 'react'
import type {
  Department, Employee, Model, Skill, Connector, Expert,
  BackupRecord, VersionPackage, EmployeeVersionReport,
  OperationLog, DashboardActivity, UsagePoint, Notification,
  SystemMetric, SystemError,
} from './mock/data.ts'

export interface AppState {
  monthlyCost: { status: 'unavailable' | 'partial' | 'multiple' | 'calculated'; amount?: number; currency?: string }
  departments: Department[]
  employees: Employee[]
  models: Model[]
  skills: Skill[]
  connectors: Connector[]
  experts: Expert[]
  backups: BackupRecord[]
  versionPackages: VersionPackage[]
  employeeVersionReports: EmployeeVersionReport[]
  operationLogs: OperationLog[]
  recentActivities: DashboardActivity[]
  dashboardTrend: UsagePoint[]
  notifications: Notification[]
  systemMetric: SystemMetric
  systemErrors: SystemError[]
}

export type AppAction =
  | { type: 'HYDRATE'; payload: AppState }
  | { type: 'SET_DEPARTMENTS'; payload: Department[] }
  | { type: 'ADD_DEPARTMENT'; payload: Department }
  | { type: 'UPDATE_DEPARTMENT'; payload: Department }
  | { type: 'DELETE_DEPARTMENT'; payload: string }
  | { type: 'SET_EMPLOYEES'; payload: Employee[] }
  | { type: 'ADD_EMPLOYEE'; payload: Employee }
  | { type: 'UPDATE_EMPLOYEE'; payload: Employee }
  | { type: 'DELETE_EMPLOYEE'; payload: string }
  | { type: 'SET_MODELS'; payload: Model[] }
  | { type: 'ADD_MODEL'; payload: Model }
  | { type: 'UPDATE_MODEL'; payload: Model }
  | { type: 'DELETE_MODEL'; payload: string }
  | { type: 'SET_SKILLS'; payload: Skill[] }
  | { type: 'ADD_SKILL'; payload: Skill }
  | { type: 'UPDATE_SKILL'; payload: Skill }
  | { type: 'DELETE_SKILL'; payload: string }
  | { type: 'SET_CONNECTORS'; payload: Connector[] }
  | { type: 'ADD_CONNECTOR'; payload: Connector }
  | { type: 'UPDATE_CONNECTOR'; payload: Connector }
  | { type: 'DELETE_CONNECTOR'; payload: string }
  | { type: 'SET_EXPERTS'; payload: Expert[] }
  | { type: 'ADD_EXPERT'; payload: Expert }
  | { type: 'UPDATE_EXPERT'; payload: Expert }
  | { type: 'DELETE_EXPERT'; payload: string }
  | { type: 'ADD_BACKUP'; payload: BackupRecord }
  | { type: 'ADD_VERSION'; payload: VersionPackage }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'REVOKE_NOTIFICATION'; payload: Notification }
  | { type: 'DELETE_NOTIFICATION'; payload: string }
  | { type: 'ADD_ACTIVITY'; payload: DashboardActivity }
  | { type: 'ADD_OPERATION_LOG'; payload: OperationLog }

export const initialState: AppState = {
  monthlyCost: { status: 'unavailable' },
  departments: [], employees: [], models: [], skills: [], connectors: [], experts: [],
  backups: [], versionPackages: [], employeeVersionReports: [], operationLogs: [],
  recentActivities: [], dashboardTrend: [], notifications: [],
  systemMetric: { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, gatewayStatus: 'offline' },
  systemErrors: [],
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE': return action.payload
    case 'SET_DEPARTMENTS': return { ...state, departments: action.payload }
    case 'ADD_DEPARTMENT': return { ...state, departments: [...state.departments, action.payload] }
    case 'UPDATE_DEPARTMENT': return { ...state, departments: state.departments.map(d => d.id === action.payload.id ? action.payload : d) }
    case 'DELETE_DEPARTMENT': return { ...state, departments: state.departments.filter(d => d.id !== action.payload) }
    case 'SET_EMPLOYEES': return { ...state, employees: action.payload }
    case 'ADD_EMPLOYEE': return { ...state, employees: [...state.employees, action.payload] }
    case 'UPDATE_EMPLOYEE': return { ...state, employees: state.employees.map(e => e.id === action.payload.id ? action.payload : e) }
    case 'DELETE_EMPLOYEE': return { ...state, employees: state.employees.filter(e => e.id !== action.payload) }
    case 'SET_MODELS': return { ...state, models: action.payload }
    case 'ADD_MODEL': return { ...state, models: [...state.models.map(model => action.payload.isDefault ? { ...model, isDefault: false } : model), action.payload] }
    case 'UPDATE_MODEL': return { ...state, models: state.models.map(model => model.id === action.payload.id
      ? action.payload : action.payload.isDefault ? { ...model, isDefault: false } : model) }
    case 'DELETE_MODEL': return { ...state, models: state.models.filter(m => m.id !== action.payload) }
    case 'SET_SKILLS': return { ...state, skills: action.payload }
    case 'ADD_SKILL': return { ...state, skills: [...state.skills, action.payload] }
    case 'UPDATE_SKILL': return { ...state, skills: state.skills.map(s => s.id === action.payload.id ? action.payload : s) }
    case 'DELETE_SKILL': return { ...state, skills: state.skills.filter(s => s.id !== action.payload) }
    case 'SET_CONNECTORS': return { ...state, connectors: action.payload }
    case 'ADD_CONNECTOR': return { ...state, connectors: [...state.connectors, action.payload] }
    case 'UPDATE_CONNECTOR': return { ...state, connectors: state.connectors.map(c => c.id === action.payload.id ? action.payload : c) }
    case 'DELETE_CONNECTOR': return { ...state, connectors: state.connectors.filter(c => c.id !== action.payload) }
    case 'SET_EXPERTS': return { ...state, experts: action.payload }
    case 'ADD_EXPERT': return { ...state, experts: [...state.experts, action.payload] }
    case 'UPDATE_EXPERT': return { ...state, experts: state.experts.map(x => x.id === action.payload.id ? action.payload : x) }
    case 'DELETE_EXPERT': return { ...state, experts: state.experts.filter(x => x.id !== action.payload) }
    case 'ADD_BACKUP': return { ...state, backups: [action.payload, ...state.backups] }
    case 'ADD_VERSION': return { ...state, versionPackages: [...state.versionPackages, action.payload] }
    case 'ADD_NOTIFICATION': return { ...state, notifications: [action.payload, ...state.notifications] }
    case 'REVOKE_NOTIFICATION': return { ...state, notifications: state.notifications.map(item =>
      item.id === action.payload.id ? action.payload : item) }
    case 'DELETE_NOTIFICATION': return { ...state, notifications: state.notifications.filter(item => item.id !== action.payload) }
    case 'ADD_ACTIVITY': return { ...state, recentActivities: [action.payload, ...state.recentActivities] }
    case 'ADD_OPERATION_LOG': return { ...state, operationLogs: [action.payload, ...state.operationLogs] }
    default: return state
  }
}

export const AppContext = createContext<{ state: AppState; dispatch: (action: AppAction) => Promise<boolean> } | null>(null)
export function useAppState() { const ctx = useContext(AppContext); if (!ctx) throw new Error('useAppState must be used within AppProvider'); return ctx }
