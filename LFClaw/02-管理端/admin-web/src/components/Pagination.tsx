import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../locales/index.ts'
import css from './Pagination.module.css'

export const PAGE_SIZE = 10

/** Keep each list's page independent and clamp it when its data shrinks. */
export function usePaginatedData<T>(data: ReadonlyArray<T>, resetKey?: string) {
  const [requestedPage, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey])
  const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE))
  useEffect(() => { setPage(current => Math.min(current, pageCount)) }, [pageCount])
  const page = Math.min(requestedPage, pageCount)
  return { items: data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, setPage, total: data.length }
}

interface PaginationProps {
  page: number
  total: number
  onPageChange: (page: number) => void
  t: Translate
}

/** Navigation for a paged admin list. */
export function Pagination({ page, total, onPageChange, t }: PaginationProps) {
  if (total === 0) return null
  const pageCount = Math.ceil(total / PAGE_SIZE)
  return <nav className={css.pagination} aria-label={t('pagination.navigation')}>
    <span>{t('pagination.range', { start: (page - 1) * PAGE_SIZE + 1, end: Math.min(page * PAGE_SIZE, total), total })}</span>
    <div className={css.controls}>
      <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => onPageChange(page - 1)}>{t('pagination.previous')}</Button>
      <span aria-live="polite">{t('pagination.page', { page, pages: pageCount })}</span>
      <Button size="sm" variant="ghost" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>{t('pagination.next')}</Button>
    </div>
  </nav>
}
