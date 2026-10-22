import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DataTable } from '../src/components/DataTable.tsx'

afterEach(() => cleanup())

it('pages table rows and moves back to a valid page when rows are removed', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1) }))
  const props = { columns: [{ key: 'id', title: 'ID', render: (row: { id: string }) => row.id }],
    rowKey: (row: { id: string }) => row.id, t: (key: string) => key }
  const { rerender } = render(<DataTable {...props} data={rows} />)
  expect(screen.getAllByRole('row')).toHaveLength(11)
  expect(screen.queryByText('11')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
  expect(screen.getAllByRole('row')).toHaveLength(3)
  expect(screen.getByText('11')).toBeTruthy()

  rerender(<DataTable {...props} data={rows.slice(0, 8)} />)
  expect(screen.getAllByRole('row')).toHaveLength(9)
  expect(screen.queryByText('11')).toBeNull()
  expect(screen.getByRole('button', { name: 'pagination.previous' }).hasAttribute('disabled')).toBe(true)
})
