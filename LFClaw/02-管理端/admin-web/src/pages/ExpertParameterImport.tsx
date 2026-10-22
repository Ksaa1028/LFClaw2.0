import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Expert } from '../mock/data.ts'
import type { Translate } from '../locales/index.ts'
import css from './ExpertsPage.module.css'
export interface ExpertImportPreview { expert: Expert; members: Expert[]; migration?: { source: string; skills: string[]; assets: number } }
export interface ExpertParameterImportProps {
  value: string; preview: ExpertImportPreview | null; busy: boolean; t: Translate
  onChange: (value: string) => void; onValidate: () => void; onError: (message: string) => void
}
/** 原创专家以 JSON 参数导入，校验后的内容只读预览。 */
export function ExpertParameterImport({ value, preview, busy, t, onChange, onValidate, onError }: ExpertParameterImportProps): ReactNode {
  const readGeneration = useRef(0)
  useEffect(() => () => { readGeneration.current++ }, [])
  const change = (text: string) => { readGeneration.current++; onChange(text) }
  const member = (id: string) => ({ id, name: id, description: '', instructions: t('experts.exampleMemberInstructions'), tags: [], skillIds: [], connectorIds: [] })
  const example = { ...member(t('experts.exampleExpert')), kind: 'expert' }
  return <section className={css.form}>
    <p className={css.hint}>{t('experts.importHint')}</p>
    <label className={css.field}><span>{t('experts.importFile')}</span><input type="file" accept=".json,application/json" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        if (file.size > 1024 * 1024) { onError(t('experts.importTooLarge')); return }
        const generation = ++readGeneration.current
        void file.text().then(text => { if (generation === readGeneration.current) onChange(text) })
          .catch(() => { if (generation === readGeneration.current) onError(t('experts.importReadFailed')) })
      }} /></label>
    <label className={css.field}><span>{t('experts.importParameters')}</span>
      <textarea className={css.textarea} rows={10} value={value} disabled={busy} onChange={event => change(event.target.value)} /></label>
    <Button variant="ghost" disabled={busy || !!value.trim()} onClick={() => change(JSON.stringify(example, null, 2))}>{t('experts.importExample')}</Button>
    <Button variant="outline" disabled={busy || !value.trim()} onClick={onValidate}>{t('experts.validateImport')}</Button>
    {preview && <section className={css.memberSection}>
      <h3>{preview.expert.name}</h3><p>{preview.expert.description}</p>
      {preview.migration && <p className={css.hint}>{t('experts.importMigration', { source: preview.migration.source })}
        {(preview.migration.skills.length > 0 || preview.migration.assets > 0) && <><br />{t('experts.importMigrationAssets', {
          skills: preview.migration.skills.join(', ') || '0', assets: preview.migration.assets,
        })}</>}</p>}
      <pre className={css.importInstructions}>{preview.expert.instructions}</pre>
    </section>}
  </section>
}
