import { Search, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { Account } from '../domain/types'

export function SearchAndFilterBar({
  query,
  onQuery,
  placeholder = 'Search…',
  children,
  onClear,
  hasFilters,
}: {
  query: string
  onQuery: (q: string) => void
  placeholder?: string
  children?: ReactNode
  onClear?: () => void
  hasFilters?: boolean
}) {
  const id = useId()
  return (
    <div role="search" className="mb-4 flex flex-wrap items-end gap-3">
      <div className="relative min-w-[12rem] flex-1">
        <label htmlFor={id} className="sr-only">
          Search
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          id={id}
          type="search"
          className="input pl-9"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {children}
      {hasFilters && onClear && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          <X className="size-4" aria-hidden /> Clear filters
        </button>
      )}
    </div>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex min-w-[8.5rem] flex-col gap-1">
      <label htmlFor={id} className="t-label">
        {label}
      </label>
      <select id={id} className="input !min-h-10" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  )
}

export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
}) {
  const a = useId()
  const b = useId()
  return (
    <div className="flex gap-2" role="group" aria-label="Date range">
      <div className="flex flex-col gap-1">
        <label htmlFor={a} className="t-label">
          From
        </label>
        <input id={a} type="date" className="input !min-h-10" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={b} className="t-label">
          To
        </label>
        <input id={b} type="date" className="input !min-h-10" value={to} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
      </div>
    </div>
  )
}

export function AccountSelector({
  label = 'Account',
  value,
  onChange,
  accounts,
  error,
  allowEmpty,
  emptyLabel = 'Choose an account',
  exclude,
}: {
  label?: string
  value: string
  onChange: (id: string) => void
  accounts: Account[]
  error?: string
  allowEmpty?: boolean
  emptyLabel?: string
  exclude?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className="input" value={value} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)}>
        {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
        {accounts
          .filter((a) => !a.archived && a.id !== exclude)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.type})
            </option>
          ))}
      </select>
      {error && (
        <p className="text-sm text-negative" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
