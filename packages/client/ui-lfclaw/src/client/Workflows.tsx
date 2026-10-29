import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
/** 员工工作流列表、需求确认和逐步交接。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Workflows.module.css'

type EmployeeId = Branded<'LfclawWorkflowEmployeeId'>
type WorkflowId = Branded<'LfclawWorkflowId'>
interface Person { id: EmployeeId; name: string; department: string }
interface Entry {
  requirement?: string
  deadline?: string
  actor: EmployeeId
  action: string
  time: string
  original: string
  summary: string
  artifacts: { name: string
    url: string }[]
}
interface Work {
  id: WorkflowId
  title: string
  creator: EmployeeId
  assignee: EmployeeId
  reviewer: EmployeeId
  status: 'processing' | 'review' | 'supplement' | 'confirmation' | 'completed' | 'cancelled'
  revision: number
  deadline: string
  requirement?: string
  history: Entry[]
  resultOnly: boolean
}
interface Catalog { maxRequestBytes: number; employeeId: EmployeeId; employees: Person[]; items: Work[] }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
class WorkflowRequestError extends Error { constructor(readonly status: number) { super('WORKFLOW_REQUEST_FAILED') } }
async function request(path: string, body?: object, maxBytes?: number): Promise<unknown> {
  if (body && maxBytes !== undefined && new TextEncoder().encode(JSON.stringify(body)).length > maxBytes) throw new Error('WORKFLOW_TOO_LARGE')
  const response = await fetch(`/api/lfclaw/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  if (!response.ok) throw new WorkflowRequestError(response.status)
  return response.json()
}
function catalog(value: unknown): Catalog {
  if (!record(value) || !Number.isSafeInteger(value.maxRequestBytes) || Number(value.maxRequestBytes) < 1024 || typeof value.employeeId !== 'string' || !Array.isArray(value.employees) || !Array.isArray(value.items)
    || value.employees.some(e => !record(e) || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.department !== 'string')
    || value.items.some(w => !record(w) || !['id', 'title', 'creator', 'assignee', 'reviewer', 'deadline'].every(k => typeof w[k] === 'string')
      || !['processing', 'review', 'supplement', 'confirmation', 'completed', 'cancelled'].includes(String(w.status)) || !Number.isSafeInteger(w.revision)
      || typeof w.resultOnly !== 'boolean' || w.requirement !== undefined && typeof w.requirement !== 'string' || !Array.isArray(w.history)
      || w.history.some(e => !record(e) || !['actor', 'action', 'time', 'original', 'summary'].every(k => typeof e[k] === 'string') || !Array.isArray(e.artifacts)
        || e.requirement !== undefined && typeof e.requirement !== 'string' || e.deadline !== undefined && typeof e.deadline !== 'string'
        || e.artifacts.some(a => !record(a) || typeof a.name !== 'string' || typeof a.url !== 'string' || !(/^(https?:\/\/|data:application\/octet-stream;base64,)/).test(a.url))))) throw new Error('WORKFLOW_INVALID_RESPONSE')
  return { maxRequestBytes: Number(value.maxRequestBytes), employeeId: value.employeeId as EmployeeId,
    employees: value.employees as Person[], items: value.items as Work[] }
}
/** 展示当前员工有权查看的工作；所有操作以服务器状态为准。
 * @param props - 翻译、刷新周期和应用级反馈。
 * @returns 工作流页面。
 */
export function Workflows({ t, refreshIntervalMs, notify }: { t: TranslateNS<'lfclawWorkflow'>; refreshIntervalMs: number; notify: (message: string) => void }): ReactNode {
  const [data, setData] = useState<Catalog | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null), [creating, setCreating] = useState(false), [tab, setTab] = useState('todo')
  const [title, setTitle] = useState(''), [original, setOriginal] = useState(''), [summary, setSummary] = useState(''), [requirement, setRequirement] = useState('')
  const [assignee, setAssignee] = useState(''), [reviewer, setReviewer] = useState(''), [deadline, setDeadline] = useState(''), [cc, setCc] = useState<string[]>([])
  const [files, setFiles] = useState<{ name: string; url: string }[]>([])
  const [links, setLinks] = useState(''), [target, setTarget] = useState('')
  const [ccQuery, setCcQuery] = useState(''), [ccDepartment, setCcDepartment] = useState('')
  const [message, setMessage] = useState(''), [conversation, setConversation] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [hasDraft, setHasDraft] = useState(false), [manual, setManual] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const restoreDraft = useRef<(() => void) | null>(null)
  const operation = useRef(randomUUID()), expectedRevision = useRef(0), generation = useRef(0)
  async function refresh() {
    const current = ++generation.current
    try { const next = catalog(await request('workflows')); if (current === generation.current) { setData(next); setError(false) } }
    catch (error) {
      if (current === generation.current) {
        setError(true)
        if (error instanceof WorkflowRequestError && error.status === 401) setData(null)
      }
    }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh() }, refreshIntervalMs)
    return () => { generation.current++; clearInterval(timer) }
  }, [refreshIntervalMs])
  const work = data?.items.find(w => w.id === selected)
  const person = (id: string) => data?.employees.find(e => e.id === id)?.name ?? id
  const reset = () => { setOriginal(''); setSummary(''); setLinks(''); setFiles([]); setTarget(''); operation.current = randomUUID() }
  const back = () => {
    if (creating) restoreDraft.current = () => {
      setTitle(title); setOriginal(original); setSummary(summary); setRequirement(requirement); setAssignee(assignee)
      setReviewer(reviewer); setDeadline(deadline); setCc(cc); setFiles(files); setLinks(links)
    }
    setCreating(false); setSelected(null); if (body.current) body.current.scrollTop = 0
  }
  async function prepare() {
    if (busy || !message.trim()) return
    const next = [...conversation, { role: 'user' as const, text: message.trim() }]
    const input = JSON.stringify({ conversation: next, draft: { title, original, summary, requirement, assignee, reviewer, deadline, cc } })
    if (input.length > 16000) { notify(t('conversationLong')); return }
    setBusy(true)
    try {
      const result = await request('workflow-summary', { mode: 'draft', original: input })
      if (!record(result) || !['reply', 'title', 'summary', 'requirement', 'assignee', 'reviewer', 'deadline']
        .every(key => typeof result[key] === 'string') || !Array.isArray(result.cc)
        || result.cc.some(id => typeof id !== 'string' || !data?.employees.some(e => e.id === id))) throw new Error('INVALID_DRAFT')
      const proposedDeadline = String(result.deadline)
      if (proposedDeadline && !Number.isFinite(Date.parse(proposedDeadline))) throw new Error('INVALID_DATE')
      for (const key of ['assignee', 'reviewer']) {
        if (result[key] && !data?.employees.some(e => e.id === result[key])) throw new Error('INVALID_PERSON')
      }
      setTitle(String(result.title)); setSummary(String(result.summary)); setRequirement(String(result.requirement))
      setAssignee(String(result.assignee)); setReviewer(String(result.reviewer)); setCc(result.cc as string[])
      setDeadline(proposedDeadline ? new Date(Date.parse(proposedDeadline)
        - new Date(proposedDeadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
      setOriginal([original, message.trim()].filter(Boolean).join('\n\n'))
      setConversation([...next, { role: 'assistant', text: String(result.reply) }]); setMessage('')
    } catch (_error) { notify(t('summaryFailed')) } finally { setBusy(false) }
  }
  async function summarize() {
    setBusy(true)
    try { const result = await request('workflow-summary', { original: [work?.requirement, original].filter(Boolean).join('\n\n') })
      if (!record(result) || typeof result.summary !== 'string') throw new Error('INVALID_SUMMARY')
      setSummary(result.summary)
    } catch (_error) { notify(t('summaryFailed')) } finally { setBusy(false) }
  }
  async function act(action: string) {
    if (busy) return
    if (action === 'create' && !summary.trim()) { notify(t('summaryRequired')); return }
    if (!original.trim()) { notify(t('reason')); return }
    if (action === 'create' && (!title.trim() || !requirement.trim() || !assignee || !reviewer || !deadline)) { notify(t('required')); return }
    setBusy(true)
    try {
      let handoff = summary
      if (!handoff.trim()) {
        const generated = await request('workflow-summary', { original: [work?.requirement, original].filter(Boolean).join('\n\n') })
        if (!record(generated) || typeof generated.summary !== 'string' || !generated.summary.trim()) throw new Error('INVALID_SUMMARY')
        handoff = generated.summary; setSummary(handoff)
      }
      const artifacts = [...files, ...links.split('\n').map(s => s.trim()).filter(Boolean).map(url => ({ name: url, url }))]
      const result = await request('workflows', { action, operationId: operation.current, original, summary: handoff, artifacts,
        ...(action === 'create' ? { title, requirement, assignee, reviewer, deadline: new Date(deadline).toISOString(), cc }
          : { id: work?.id, revision: expectedRevision.current, target,
            ...(action === 'change' ? { requirement, deadline: new Date(deadline).toISOString() } : {}) }) }, data?.maxRequestBytes)
      if (!record(result) || typeof result.id !== 'string') throw new Error('INVALID_RESULT')
      if (typeof result.revision === 'number') expectedRevision.current = result.revision
      if (action === 'create') {
        setTab('mine'); back(); setHasDraft(false); setConversation([]); setMessage('')
        notify(t('created'))
      } else { setSelected(result.id); setCreating(false); notify(t('saved')) }
      reset(); await refresh()
    } catch (error) {
      const key = error instanceof Error && error.message === 'WORKFLOW_TOO_LARGE' ? 'tooLarge'
        : error instanceof WorkflowRequestError && error.status === 409 ? 'conflict' : 'failed'
      notify(t(key))
    } finally { setBusy(false) }
  }
  const employeeSelect = (label: string, value: string, change: (value: string) => void) => <label>{label}
    <select value={value} onChange={(e) =>{  change(e.target.value) }}>
      <option value="">{t('choose')}</option>{data?.employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.department}</option>)}</select></label>
  async function attach(selected: FileList | null) {
    if (!selected) return
    if (data && Array.from(selected).reduce((sum, file) => sum + Math.ceil(file.size / 3) * 4, 0) > data.maxRequestBytes) { notify(t('tooLarge')); return }
    setBusy(true)
    try {
      const attached = await Promise.all(Array.from(selected, file => new Promise<{ name: string; url: string }>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () =>{  reject(new Error('FILE_READ_FAILED')) }
        reader.onload = () => {
          if (typeof reader.result !== 'string') { reject(new Error('FILE_READ_FAILED')); return }
          resolve({ name: file.name, url: 'data:application/octet-stream;base64,' + reader.result.slice(reader.result.indexOf(',') + 1) })
        }
        reader.readAsDataURL(file)
      })))
      setFiles(attached)
    } catch (_error) { notify(t('failed')) } finally { setBusy(false) }
  }
  const notes = <><label>{t('original')}<textarea maxLength={16000} value={original} onChange={(e) =>{  setOriginal(e.target.value) }} /></label>
    <Button disabled={busy || !original.trim()} onClick={() => { void summarize() }}>{t('ai')}</Button>
    <label>{t('summary')}<textarea maxLength={16000} value={summary} onChange={(e) =>{  setSummary(e.target.value) }} /></label>
    <label>{t('files')}<input type="file" multiple onChange={(e) => { void attach(e.target.files) }} /></label>{files.map((f, i) => <span key={i}>{f.name}</span>)}<label>{t('artifact')}<textarea value={links} onChange={(e) =>{  setLinks(e.target.value) }} /></label></>
  const open = (w: Work) => { expectedRevision.current = w.revision; setSelected(w.id); setCreating(false); reset(); setRequirement(w.requirement ?? ''); setDeadline(new Date(Date.parse(w.deadline) - new Date(w.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }
  return <section className={css.page}><header className={css.header}><div><h1>{t('panel')}</h1><p>{t('description')}</p></div>
    {(creating || work) && <Button disabled={busy} onClick={back}>{t('back')}</Button>}
    <Button disabled={busy} onClick={() => { void refresh() }}>{t('refresh')}</Button></header>
  {error && <p role="alert">{t('failed')}</p>}{!data && !error && <p>{t('loading')}</p>}
  {data && <div className={css.body} ref={body}>{!creating && !work ? <>
    <div className={css.actions}>{(['todo', 'mine', 'all', 'copied'] as const).map(key => <Button key={key} onClick={() =>{  setTab(key) }} aria-pressed={tab === key}>{t(key)}</Button>)}
      <Button onClick={() => {
        setCreating(true)
        if (!hasDraft) {
          reset(); setTitle(''); setRequirement(''); setDeadline(''); setAssignee(''); setReviewer(data.employeeId); setCc([])
          setConversation([]); setMessage(''); setManual(false); setCcQuery(''); setCcDepartment(''); setHasDraft(true)
        } else restoreDraft.current?.()
      }}>{t(hasDraft ? 'resume' : 'create')}</Button></div>
    {data.items.filter(w => tab === 'todo' ? w.assignee === data.employeeId && !['completed', 'cancelled'].includes(w.status)
      : tab === 'mine' ? w.creator === data.employeeId : tab === 'copied' ? w.resultOnly : !w.resultOnly).map(w => <button className={css.card} key={w.id} onClick={() =>{  open(w) }}>
      <strong>{w.title}</strong><span>{t(w.status === 'supplement' ? 'awaitingSupplement' : w.status)} · {person(w.assignee)} · {new Date(w.deadline).toLocaleString()}
        {!['completed', 'cancelled'].includes(w.status) && Date.parse(w.deadline) < Date.now() && ` · ${t('overdue')}`}</span></button>)}
    {data.items.length === 0 && <p>{t('empty')}</p>}</> : <>
    {creating ? <fieldset disabled={busy} className={css.form}>
      <p>{t('conversationHint')}</p>
      <div className={css.conversation} role="log" aria-label={t('conversation')}>
        {conversation.map((m, i) => <article key={i} className={css.card}><strong>{t(m.role === 'user' ? 'you' : 'assistant')}</strong>
          <p className={css.content}>{m.text}</p></article>)}
      </div>
      <label>{t('message')}<textarea value={message} placeholder={t('messagePlaceholder')}
        onChange={(e) => { setMessage(e.target.value) }} maxLength={12000} /></label>
      <Button disabled={busy || !message.trim()} onClick={() => { void prepare() }}>{t(busy ? 'preparing' : 'send')}</Button>
      {(title || requirement) && <article className={css.card} aria-label={t('preview')}>
        <strong>{title || t('untitled')}</strong><p className={css.content}>{requirement || summary}</p>
        <span>{t('assignee')}：{assignee ? person(assignee) : t('missing')} · {t('reviewer')}：{reviewer ? person(reviewer) : t('missing')}</span>
        <span>{t('deadline')}：{deadline ? new Date(deadline).toLocaleString() : t('missing')}</span>
        <span>{t('cc')}：{cc.length ? cc.map(person).join('、') : t('none')}</span>
      </article>}
      <Button aria-expanded={manual} onClick={() => { setManual(!manual) }}>{t(manual ? 'hideFields' : 'editFields')}</Button>
      <div hidden={!manual} className={css.form}>
        <label>{t('title')}<Input value={title} onChange={(e) =>{  setTitle(e.target.value) }} maxLength={160} /></label>{notes}
        <label>{t('requirement')}<textarea value={requirement} onChange={(e) =>{  setRequirement(e.target.value) }} /></label>
        {employeeSelect(t('assignee'), assignee, setAssignee)}{employeeSelect(t('reviewer'), reviewer, setReviewer)}
        <label>{t('deadline')}<input type="datetime-local" value={deadline} onChange={(e) =>{  setDeadline(e.target.value) }} /></label>
        <fieldset className={css.picker}><legend>{t('cc')}</legend>
          <label>{t('searchPeople')}<Input value={ccQuery} onChange={(e) => { setCcQuery(e.target.value) }} /></label>
          <label>{t('department')}<select value={ccDepartment} onChange={(e) => { setCcDepartment(e.target.value) }}>
            <option value="">{t('allDepartments')}</option>{[...new Set(data.employees.map(e => e.department))].map(d => <option key={d} value={d}>{d}</option>)}
          </select></label>
          <div className={css.actions}>{cc.map(id => <Button key={id}
            onClick={() => { setCc(cc.filter(selectedId => selectedId !== id)) }}>
            {t('remove')} {person(id)}</Button>)}</div>
          <div className={css.people}>{data.employees.filter(e => (!ccDepartment || e.department === ccDepartment)
          && `${e.name} ${e.department}`.toLocaleLowerCase().includes(ccQuery.trim().toLocaleLowerCase())).map(e =>
            <label className={css.person} key={e.id}><input type="checkbox" checked={cc.includes(e.id)}
              onChange={(event) => { setCc(event.target.checked ? [...cc, e.id] : cc.filter(id => id !== e.id)) }} />
            {e.name} · {e.department}</label>)}
          </div>
        </fieldset>
      </div>
      <p>{t('confirmHint')}</p>
      <div className={css.actions}><Button disabled={busy || !!message.trim()} onClick={() => { void act('create') }}>{t('confirm')}</Button>
        <Button onClick={back}>{t('back')}</Button></div>
    </fieldset> : work && <><h2>{work.title}</h2><p>{t(work.status === 'supplement' ? 'awaitingSupplement' : work.status)} · {person(work.assignee)} · {new Date(work.deadline).toLocaleString()}</p>
      {work.resultOnly ? <p>{t('resultOnly')}</p> : <p className={css.content}>{work.requirement}</p>}
      <h3>{t('history')}</h3>{work.history.map((entry, i) => <article className={css.card} key={i}><strong>{person(entry.actor)} · {new Date(entry.time).toLocaleString()}</strong>
        {entry.requirement && <><span>{t('requirement')}</span><p className={css.content}>{entry.requirement}</p><span>{entry.deadline && new Date(entry.deadline).toLocaleString()}</span></>}<span>{t('original')}</span><p className={css.content}>{entry.original}</p><span>{t('summary')}</span><p className={css.content}>{entry.summary}</p>
        {entry.artifacts.map((a, j) => <a key={j} href={a.url} target="_blank" rel="noreferrer" download={a.url.startsWith('data:') ? a.name : undefined}>{a.name}</a>)}</article>)}
      {!work.resultOnly && !['completed', 'cancelled'].includes(work.status) && (work.creator === data.employeeId || work.assignee === data.employeeId) && <fieldset disabled={busy} className={css.form}>{notes}
        {work.assignee === data.employeeId && <div className={css.actions}>
          {work.status === 'processing' && <>{employeeSelect(t('target'), target, setTarget)}<Button disabled={!target} onClick={() => { void act('transfer') }}>{t('transfer')}</Button>
            <Button onClick={() => { void act('ask') }}>{t('ask')}</Button><Button onClick={() => { void act('submit') }}>{t('submit')}</Button></>}
          {work.status === 'review' && <><Button onClick={() => { void act('return') }}>{t('return')}</Button><Button onClick={() => { void act('approve') }}>{t('approve')}</Button></>}
          {work.status === 'supplement' && <Button onClick={() => { void act('supplement') }}>{t('supplement')}</Button>}
          {work.status === 'confirmation' && <Button onClick={() => { void act('accept') }}>{t('accept')}</Button>}
        </div>}
        {work.creator === data.employeeId && <>
          {work.status === 'processing' && <><label>{t('requirement')}<textarea value={requirement} onChange={(e) =>{  setRequirement(e.target.value) }} /></label>
            <label>{t('deadline')}<input type="datetime-local" value={deadline} onChange={(e) =>{  setDeadline(e.target.value) }} /></label><Button onClick={() => { void act('change') }}>{t('change')}</Button></>}
          <Button onClick={() => { void act('cancel') }}>{t('cancel')}</Button></>}
      </fieldset>}
    </>}
  </>}</div>}
  </section>
}
