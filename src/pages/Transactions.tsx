import { Plus, Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useLookups } from '../app/FinanceCards'
import { TransactionForm } from '../forms/TransactionForm'
import type { TransactionRec } from '../data/records'
import type { Transaction, TransactionType } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { DataTable, PaginationControls, type Column, type SortState } from '../ui/DataTable'
import { DateRangePicker, FilterSelect, SearchAndFilterBar } from '../ui/Inputs'
import { CurrencyAmount, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

const PAGE_SIZE = 20

export default function Transactions() {
  const { data, db, remove } = useApp()
  const { accountName, categoryName } = useLookups()
  const { ask, dialog } = useConfirm()

  const [q, setQ] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [type, setType] = useState<'' | TransactionType>('')
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionRec | undefined>()
  const [defaultType, setDefaultType] = useState<TransactionType>('expense')

  const hasFilters = Boolean(q || range.from || range.to || accountId || categoryId || type)
  const clear = () => {
    setQ('')
    setRange({ from: '', to: '' })
    setAccountId('')
    setCategoryId('')
    setType('')
    setPage(1)
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = data.ledger.transactions.filter((t) => {
      if (type && t.type !== type) return false
      if (accountId && t.accountId !== accountId) return false
      if (categoryId && t.categoryId !== categoryId) return false
      if (range.from && t.date < range.from) return false
      if (range.to && t.date > range.to) return false
      if (needle) {
        const hay = `${t.description} ${t.counterparty ?? ''} ${t.reference ?? ''} ${t.notes ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (t: Transaction): string | number => {
      switch (sort.key) {
        case 'amount':
          return t.type === 'income' ? t.amount : -t.amount
        case 'description':
          return t.description.toLowerCase()
        case 'account':
          return accountName(t.accountId).toLowerCase()
        case 'category':
          return categoryName(t.categoryId).toLowerCase()
        default:
          return t.date + (t.time ?? '')
      }
    }
    return [...filtered].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return x < y ? -dir : x > y ? dir : 0
    })
  }, [data.ledger.transactions, q, type, accountId, categoryId, range, sort, accountName, categoryName])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const open = async (t: Transaction | null, kind: TransactionType = 'expense') => {
    setEditing(t ? await db.transactions.get(t.id) : undefined)
    setDefaultType(kind)
    setFormOpen(true)
  }

  const del = (t: Transaction) =>
    ask({
      title: 'Delete this transaction?',
      message: (
        <>
          “{t.description}” on {t.date} will be removed and balances recalculated.
          {t.occurrenceId ? ' It is linked to a bill payment, which will become unpaid again.' : ''}
        </>
      ),
      success: 'Transaction deleted.',
      run: async () => {
        const deductions = await db.payrollDeductions.where('transactionId').equals(t.id).toArray()
        for (const d of deductions) if (!d.deletedAt) await remove('payrollDeductions', d.id)
        await remove('transactions', t.id)
      },
    })

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Date', sortable: true, render: (t) => t.date, hideOnMobile: false },
    {
      key: 'description',
      header: 'Description',
      sortable: true,
      primary: true,
      render: (t) => (
        <span>
          {t.description}
          {t.status === 'pending' && <span className="ml-2"><StatusBadge tone="warning" label="Pending" /></span>}
          {t.occurrenceId && <span className="ml-2"><StatusBadge tone="info" label="Bill payment" /></span>}
        </span>
      ),
    },
    { key: 'category', header: 'Category', sortable: true, render: (t) => categoryName(t.categoryId) },
    { key: 'account', header: 'Account', sortable: true, render: (t) => accountName(t.accountId) },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (t) => <CurrencyAmount value={t.type === 'income' ? t.amount : -t.amount} currency={t.currency} signed withIcon />,
    },
  ]

  const noAccounts = data.ledger.accounts.filter((a) => !a.archived).length === 0

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Income and expenses. Transfers, loans, advances and money held for others are tracked on their own pages and are not counted here."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void open(null, 'income')}>
              <Plus className="size-4" aria-hidden /> Add income
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void open(null, 'expense')}>
              <Plus className="size-4" aria-hidden /> Add expense
            </button>
          </>
        }
      />

      <div className="card">
        <SearchAndFilterBar query={q} onQuery={(v) => { setQ(v); setPage(1) }} placeholder="Search description, person or reference" hasFilters={hasFilters} onClear={clear}>
          <DateRangePicker from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1) }} />
          <FilterSelect label="Type" value={type} onChange={(v) => { setType(v as '' | TransactionType); setPage(1) }}>
            <option value="">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </FilterSelect>
          <FilterSelect label="Account" value={accountId} onChange={(v) => { setAccountId(v); setPage(1) }}>
            <option value="">All accounts</option>
            {data.ledger.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Category" value={categoryId} onChange={(v) => { setCategoryId(v); setPage(1) }}>
            <option value="">All categories</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </FilterSelect>
        </SearchAndFilterBar>

        {rows.length === 0 ? (
          hasFilters ? (
            <EmptyState title="No matching transactions" description="Try changing or clearing the filters." action={<button type="button" className="btn btn-secondary" onClick={clear}>Clear filters</button>} />
          ) : (
            <EmptyState
              icon={<Receipt className="size-6" />}
              title="No transactions yet"
              description={noAccounts ? 'Create an account first, then record your income and expenses.' : 'Record your first income or expense.'}
              action={!noAccounts ? <button type="button" className="btn btn-primary" onClick={() => void open(null, 'expense')}>Add expense</button> : undefined}
            />
          )
        ) : (
          <>
            <DataTable
              caption="Transactions"
              columns={columns}
              rows={visible}
              rowKey={(t) => t.id}
              sort={sort}
              onSort={(s) => { setSort(s); setPage(1) }}
              onRowClick={(t) => void open(t)}
              rowActions={(t) => (
                <>
                  <EditButton label={`Edit ${t.description}`} onClick={() => void open(t)} />
                  <DeleteButton label={`Delete ${t.description}`} onClick={() => del(t)} />
                </>
              )}
            />
            <PaginationControls page={current} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </>
        )}
      </div>

      <TransactionForm open={formOpen} onClose={() => setFormOpen(false)} initial={editing} defaultType={defaultType} />
      {dialog}
    </>
  )
}
