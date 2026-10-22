import type { ReactNode } from 'react'
import css from './DataTable.module.css'
import type { Translate } from '../locales/index.ts'
import { Pagination, usePaginatedData, PAGE_SIZE } from './Pagination.tsx'

export interface Column<T> {
  key: string
  title: ReactNode
  width?: string
  render: (row: T, index: number) => ReactNode
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>
  data: ReadonlyArray<T>
  rowKey: (row: T) => string
  emptyText?: ReactNode
  t: Translate
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyText,
  t,
}: DataTableProps<T>): ReactNode {
  const { items, page, setPage, total } = usePaginatedData(data)
  return (
    <div className={css.wrapper}>
      <table className={css.table}>
        <thead>
          <tr>
            {columns.map(column => (
              <th
                key={column.key}
                style={{ width: column.width }}
                className={css.th}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {total === 0 ? (
            <tr>
              <td colSpan={columns.length} className={css.emptyCell}>
                {emptyText ?? '—'}
              </td>
            </tr>
          ) : (
            items.map((row, index) => (
              <tr key={rowKey(row)} className={css.tr}>
                {columns.map(column => (
                  <td key={column.key} className={css.td}>
                    {column.render(row, (page - 1) * PAGE_SIZE + index)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={page} total={total} onPageChange={setPage} t={t} />
    </div>
  )
}
