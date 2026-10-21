import { ArrowRight, Landmark } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { AccountBalanceCard, SafeToSpendCard, TransactionList } from '../app/FinanceCards'
import { QUICK, useQuickActions } from '../app/QuickActions'
import { occurrenceStatus, remainingAmount } from '../domain/bills'
import { diffDays } from '../domain/dates'
import { formatMoney } from '../domain/money'
import type { Transaction } from '../domain/types'
import { TransactionForm } from '../forms/TransactionForm'
import type { TransactionRec } from '../data/records'
import { ForecastChart } from '../ui/Charts'
import { EmptyState } from '../ui/States'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge, SummaryMetricCard, type Tone } from '../ui/Primitives'

const STATUS_TONE: Record<string, { label: string; tone: Tone }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  unpaid: { label: 'Unpaid', tone: 'info' },
  due: { label: 'Due today', tone: 'warning' },
  partially_paid: { label: 'Partly paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'negative' },
  paid: { label: 'Paid', tone: 'positive' },
}

export default function Dashboard() {
  const { data, today, currency, db } = useApp()
  const d = useDerived()
  const { open } = useQuickActions()
  const [days, setDays] = useState<30 | 60 | 90>(30)
  const [editing, setEditing] = useState<TransactionRec | null>(null)

  const forecast = useMemo(() => d.forecast(days), [d, days])
  const accounts = data.ledger.accounts.filter((a) => !a.archived)

  const recent = useMemo(
    () =>
      [...data.ledger.transactions]
        .sort((a, b) => (a.date === b.date ? (b.createdAt > a.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
        .slice(0, 6),
    [data.ledger.transactions],
  )

  const upcoming = useMemo(() => {
    const names = new Map(data.obligations.map((o) => [o.id, o]))
    return data.occurrences
      .filter((o) => remainingAmount(o) > 0 && diffDays(o.dueDate, today) <= 45)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .slice(0, 5)
      .map((o) => ({ occ: o, ob: names.get(o.obligationId)! }))
  }, [data.obligations, data.occurrences, today])

  const firstShortfall = forecast.shortfalls[0]
  const openEdit = async (t: Transaction) => setEditing((await db.transactions.get(t.id)) ?? null)

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Welcome to MONVEX. Let's set up your first account." />
        <div className="card">
          <EmptyState
            icon={<Landmark className="size-6" />}
            title="Add your first account"
            description="Add the cash, bank or wallet accounts you use, with their current balances. MONVEX calculates everything from there."
            action={
              <Link to="/accounts" className="btn btn-primary">
                Create an account
              </Link>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Where your money stands today." />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AccountBalanceCard total={d.money.available} heldForOthers={d.money.heldForOthers} perAccount={d.money.perAccount} currency={currency} />
        <SafeToSpendCard result={d.safe} currency={currency} />
        <div className="lg:col-span-2 xl:col-span-1">
          <SummaryMetricCard
            label={`This month — net savings`}
            value={<CurrencyAmount value={d.savings.actual.net} currency={currency} signed withIcon />}
            helper={
              <>
                Income <CurrencyAmount value={d.savings.actual.income} currency={currency} tone="neutral" /> − expenses{' '}
                <CurrencyAmount value={d.savings.actual.expense} currency={currency} tone="neutral" />. Transfers, loans, advances and money held for others are excluded.
              </>
            }
            badge={<StatusBadge tone="neutral" label="Actual" />}
          />
        </div>
      </div>

      <section aria-labelledby="qa-title" className="card">
        <h2 id="qa-title" className="t-section mb-3">
          Quick actions
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {QUICK.map((q) => (
            <li key={q.kind}>
              <button type="button" className="btn btn-secondary h-full min-h-[3.25rem] w-full flex-col !gap-1 !px-2 text-center !text-xs" onClick={() => open(q.kind)}>
                <q.icon className="size-5" aria-hidden />
                {q.label}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card lg:col-span-3" aria-labelledby="fc-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="fc-title" className="t-section">
              Cash-flow forecast
            </h2>
            <div className="flex gap-1" role="group" aria-label="Forecast period">
              {([30, 60, 90] as const).map((n) => (
                <button key={n} type="button" className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={days === n} onClick={() => setDays(n)}>
                  {n} days
                </button>
              ))}
            </div>
          </div>
          {d.events.length === 0 ? (
            <InlineNote>Add bills or set your payday to see a forecast. Right now it only reflects today's balances.</InlineNote>
          ) : (
            <>
              <ForecastChart
                series={forecast.series}
                currency={currency}
                summary={`Projected combined balance moves from ${formatMoney(forecast.series[0].total, currency)} today to ${formatMoney(forecast.closingBalance, currency)} in ${days} days.`}
                height={220}
              />
              {firstShortfall ? (
                <div className="mt-3">
                  <InlineNote tone="negative">
                    <strong>Possible shortfall on {firstShortfall.date}</strong> in {firstShortfall.accountName}: short by {formatMoney(firstShortfall.shortBy, currency)}
                    {firstShortfall.cause ? ` after "${firstShortfall.cause.label}"` : ''}.{' '}
                    <Link to="/forecast" className="link">
                      See details
                    </Link>
                  </InlineNote>
                </div>
              ) : (
                <p className="t-helper mt-3">No shortfall expected in the next {days} days based on your recorded bills and income. This is an estimate.</p>
              )}
            </>
          )}
        </section>

        <section className="card lg:col-span-2" aria-labelledby="up-title">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="up-title" className="t-section">
              Upcoming payments
            </h2>
            <Link to="/bills" className="link text-sm">
              All bills
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="t-helper py-4">No unpaid bills in the next 45 days.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border/60 p-0">
              {upcoming.map(({ occ, ob }) => {
                const st = STATUS_TONE[occurrenceStatus(occ, today, ob.reminderDays)]
                const left = diffDays(occ.dueDate, today)
                return (
                  <li key={occ.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{ob.name}</p>
                      <p className="t-helper">
                        {occ.dueDate} · {left < 0 ? `${-left}d overdue` : left === 0 ? 'today' : `in ${left}d`}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <CurrencyAmount value={remainingAmount(occ)} currency={ob.currency} tone="neutral" />
                      <StatusBadge tone={st.tone} label={st.label} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card lg:col-span-3" aria-labelledby="ra-title">
          <div className="mb-1 flex items-center justify-between">
            <h2 id="ra-title" className="t-section">
              Recent activity
            </h2>
            <Link to="/transactions" className="link inline-flex items-center gap-1 text-sm">
              View all <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState title="No transactions yet" description="Record your first income or expense to get started." action={<button type="button" className="btn btn-primary" onClick={() => open('expense')}>Add expense</button>} />
          ) : (
            <TransactionList items={recent} currency={currency} onSelect={openEdit} />
          )}
        </section>

        <section className="card lg:col-span-2" aria-labelledby="ms-title">
          <div className="flex items-start justify-between gap-2">
            <h2 id="ms-title" className="t-section">
              Month-end savings forecast
            </h2>
            <StatusBadge tone="info" label="Projected" />
          </div>
          <div className="t-value mt-2">
            <CurrencyAmount value={d.savings.projectedNetSavings} currency={currency} signed withIcon />
          </div>
          <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Actual so far</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={d.savings.actual.net} currency={currency} signed /></dd>
            <dt className="text-muted">Still expected (income)</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={d.savings.projected.income} currency={currency} tone="neutral" /></dd>
            <dt className="text-muted">Still expected (expenses)</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={-d.savings.projected.expense} currency={currency} /></dd>
            <dt className="border-t border-border pt-1 text-muted">Projected closing balance</dt>
            <dd className="m-0 border-t border-border pt-1 text-right"><CurrencyAmount value={d.closing.projectedClosingBalance} currency={currency} tone="neutral" /></dd>
          </dl>
          <p className="t-helper mt-3">Net savings and closing balance are different: the closing balance includes money you already had at the start of the month.</p>
        </section>
      </div>

      <TransactionForm open={Boolean(editing)} onClose={() => setEditing(null)} initial={editing ?? undefined} />
    </>
  )
}
