import { ChevronDown, Info, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { formatMoney } from '../domain/money'
import type { SafeToSpendResult } from '../domain/safeToSpend'
import type { Account, Transaction } from '../domain/types'
import { CurrencyAmount, StatusBadge } from '../ui/Primitives'
import { useApp } from './AppContext'

export function useLookups() {
  const { data } = useApp()
  const accounts = new Map(data.ledger.accounts.map((a) => [a.id, a]))
  const categories = new Map(data.categories.map((c) => [c.id, c]))
  return {
    accountName: (id?: string | null) => (id ? accounts.get(id)?.name ?? 'Unknown account' : '—'),
    categoryName: (id?: string | null) => (id ? categories.get(id)?.name ?? 'Uncategorised' : 'Uncategorised'),
  }
}

/** Per-account balances; comparable values are right aligned. */
export function AccountBalanceCard({
  total,
  heldForOthers,
  perAccount,
  currency,
}: {
  total: number
  heldForOthers: number
  perAccount: { account: Account; balance: number }[]
  currency: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card" aria-labelledby="avail-title">
      <h3 id="avail-title" className="t-label">
        Total available money
      </h3>
      <div className="t-value mt-1">
        <CurrencyAmount value={total} currency={currency} tone="neutral" />
      </div>
      <p className="t-helper mt-1">
        Cash, bank and wallet accounts
        {heldForOthers > 0 ? `, minus ${formatMoney(heldForOthers, currency)} held for other people` : ''}. Excludes receivables and expected salary.
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm mt-3 -ml-2"
        aria-expanded={open}
        aria-controls="acct-breakdown"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        {open ? 'Hide' : 'Show'} balance by account
      </button>
      {open && (
        <ul id="acct-breakdown" className="m-0 mt-2 list-none divide-y divide-border/60 p-0 text-sm">
          {perAccount.length === 0 && <li className="py-2 text-muted">No active accounts.</li>}
          {perAccount.map(({ account, balance }) => (
            <li key={account.id} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate">
                {account.name} <span className="t-helper">({account.type})</span>
              </span>
              <CurrencyAmount value={balance} currency={account.currency} signed={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function SafeToSpendCard({ result, currency }: { result: SafeToSpendResult; currency: string }) {
  const [open, setOpen] = useState(false)
  const negative = result.safeToSpend < 0
  return (
    <section className="card" aria-labelledby="sts-title">
      <div className="flex items-start justify-between gap-2">
        <h3 id="sts-title" className="t-label">
          Safe-to-Spend
        </h3>
        {result.confidence === 'low' ? <StatusBadge tone="warning" label="Estimate — incomplete data" /> : <StatusBadge tone="info" label="Estimate" />}
      </div>
      <div className="t-value mt-1">
        {negative ? (
          <span className="text-negative">
            <ShieldAlert className="mr-1.5 inline size-6 align-[-3px]" aria-hidden />
            Short by {formatMoney(result.shortfall, currency)}
          </span>
        ) : (
          formatMoney(result.safeToSpend, currency)
        )}
      </div>
      <p className="t-helper mt-1">
        {negative ? 'You may not have enough to cover reserved obligations ' : 'Spendable money '}
        from {result.periodStart} to {result.periodEnd} ({result.daysRemaining} {result.daysRemaining === 1 ? 'day' : 'days'}).
        {!negative && result.dailyAllowance > 0 && <> About {formatMoney(result.dailyAllowance, currency)} per day.</>}
      </p>
      <button type="button" className="btn btn-ghost btn-sm mt-3 -ml-2" aria-expanded={open} aria-controls="sts-detail" onClick={() => setOpen((o) => !o)}>
        <Info className="size-4" aria-hidden /> {open ? 'Hide' : 'How is this calculated?'}
      </button>
      {open && (
        <div id="sts-detail" className="mt-2 text-sm">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>Available funds</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={result.availableFunds} currency={currency} tone="neutral" /></dd>
            {result.reserved.map((r) => (
              <div key={r.id} className="contents">
                <dt className="text-muted">
                  − {r.label}
                  {r.dueDate ? <span className="t-helper"> · due {r.dueDate}</span> : null}
                </dt>
                <dd className="m-0 text-right amount text-muted">{formatMoney(r.amount, currency)}</dd>
              </div>
            ))}
            <dt className="border-t border-border pt-1 font-semibold">Safe-to-Spend</dt>
            <dd className="m-0 border-t border-border pt-1 text-right font-semibold amount">{formatMoney(result.safeToSpend, currency)}</dd>
          </dl>
          {result.assumptions.length > 0 && (
            <>
              <h4 className="t-label mt-3 uppercase">Assumptions</h4>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {result.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}
          {result.warnings.length > 0 && (
            <>
              <h4 className="t-label mt-3 uppercase">Data warnings</h4>
              <ul className="mt-1 list-disc pl-5 text-warning">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <p className="t-helper mt-3">This is an estimate based on your records, not a guarantee or financial advice.</p>
        </div>
      )}
    </section>
  )
}

export function TransactionList({
  items,
  currency,
  onSelect,
}: {
  items: Transaction[]
  currency: string
  onSelect?: (t: Transaction) => void
}) {
  const { accountName, categoryName } = useLookups()
  return (
    <ul className="m-0 list-none divide-y divide-border/60 p-0">
      {items.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-surface-2/50"
            onClick={() => onSelect?.(t)}
            aria-label={`${t.description}, ${t.type === 'income' ? 'income' : 'expense'} ${formatMoney(t.amount, currency)}, ${t.date}. Open to edit.`}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{t.description}</span>
              <span className="t-helper block truncate">
                {t.date} · {categoryName(t.categoryId)} · {accountName(t.accountId)}
                {t.status === 'pending' ? ' · pending' : ''}
              </span>
            </span>
            <CurrencyAmount value={t.type === 'income' ? t.amount : -t.amount} currency={t.currency} signed withIcon />
          </button>
        </li>
      ))}
    </ul>
  )
}
