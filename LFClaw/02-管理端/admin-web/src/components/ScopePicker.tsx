import type { ReactNode } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Department, Employee } from '../mock/data.ts'
import type { Translate } from '../locales/index.ts'
import css from './ScopePicker.module.css'

export type ResourceScope = 'all' | 'department' | 'employee' | 'none'

export interface ScopePickerProps {
  scope: ResourceScope
  targets: string[]
  departments: Department[]
  employees: Employee[]
  disabled?: boolean
  onChange: (scope: ResourceScope, targets: string[]) => void
  t: Translate
}

export function ScopePicker({ scope, targets, departments, employees, disabled = false, onChange, t }: ScopePickerProps): ReactNode {
  const candidates = scope === 'department' ? departments : employees
  const toggle = (id: string, checked: boolean) => onChange(scope,
    checked ? [...targets, id] : targets.filter(target => target !== id))
  return <div className={css.field}>
    <label htmlFor="resource-scope">{t('models.scope')}</label>
    <select id="resource-scope" value={scope} disabled={disabled}
      onChange={event => onChange(event.target.value as ResourceScope, [])}>
      <option value="none">{t('distribution.none')}</option>
      <option value="all">{t('distribution.all')}</option>
      <option value="department">{t('distribution.departments')}</option>
      <option value="employee">{t('distribution.employees')}</option>
    </select>
    {(scope === 'department' || scope === 'employee') && <div className={css.targets}>
      {candidates.length === 0
        ? <span className={css.empty}>{scope === 'department' ? t('distribution.noDepartments') : t('distribution.noEmployees')}</span>
        : candidates.map(item => <Checkbox key={item.id} checked={targets.includes(item.id)} disabled={disabled}
          onChange={checked => toggle(item.id, checked)} label={item.name} />)}
    </div>}
  </div>
}
