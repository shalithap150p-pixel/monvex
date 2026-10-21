import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { useId, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'right'
  /** Shown as the card title on mobile. */
  primary?: boolean
  sortable?: boolean
  /** Hide this column in the stacked mobile card. */
  hideOnMobile?: boolean
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

/** Table on wide screens; stacked, readable cards on phones. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSort,
  onRowClick,
  rowActions,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  sort?: SortState
  onSort?: (next: SortState) => void
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => ReactNode
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile)

  const toggle = (key: string) => {
    if (!onSort) return
    onSort({ key, dir: sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc' })
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`px-3 py-2.5 t-label font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    {c.sortable && onSort ? (
                      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={() => toggle(c.key)}>
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
              {rowActions && (
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-border/60 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-3 align-middle ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.render(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">{rowActions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border/60 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="py-3">
            <div
              className={onRowClick ? 'cursor-pointer' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
            >
              <div className="font-medium">{primary.render(row)}</div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {rest.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-subtle">{c.header}</dt>
                    <dd className="text-right">{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {rowActions && <div className="mt-2 flex justify-end gap-1">{rowActions(row)}</div>}
          </li>
        ))}
      </ul>
    </>
  )
}

export function PaginationControls({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const statusId = useId()
  if (total <= pageSize) return <p className="t-helper pt-3">{total} {total === 1 ? 'record' : 'records'}</p>
  return (
    <nav className="flex items-center justify-between gap-3 pt-3" aria-label="Pagination">
      <p id={statusId} className="t-helper" aria-live="polite">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden /> Prev
        </button>
        <span className="px-2 text-sm text-muted" aria-describedby={statusId}>
          {page} / {pages}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  )
}
