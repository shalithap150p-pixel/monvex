import { Info, Lightbulb, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { BudgetStatus } from '../domain/budgets'
import type { DailySafeToSpend, DailyStatus } from '../domain/dailySafeToSpend'
import { formatMoney } from '../domain/money'
import type { ReservedItem } from '../domain/safeToSpend'
import type { Insight } from '../domain/spendingInsights'
import type { SmartFinance } from '../domain/smartFinance'
import type { SavingsGoal } from '../domain/types'
import { DailySpendingChart } from '../ui/Charts'
import { Meter, type MeterTone } from '../ui/Meter'
import { CurrencyAmount, InlineNote, StatusBadge, type Tone } from '../ui/Primitives'

const STATUS: Record<DailyStatus, { tone: Tone; label: string; meter: MeterTone }> = {
  healthy: { tone: 'positive', label: 'On track', meter: 'ok' },
  warning: { tone: 'warning', label: 'Nearly used up', meter: 'warn' },
  overspent: { tone: 'negative', label: 'Over today\'s allowance', meter: 'over' },
  shortfall: { tone: 'negative', label: 'Not enough flexible money', meter: 'over' },
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

function Tile({ label, children, helper }: { label: string; children: React.ReactNode; helper?: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface-2/60 p-3">
      <p className="t-label">{label}</p>
      <p className="mt-0.5 text-lg font-semibold amount">{children}</p>
      {helper && <p className="t-helper mt-0.5">{helper}</p>}
    </div>
  )
}

/* ------------------------------------------------------------ main card */

export function DailySafeToSpendCard({ daily, currency }: { daily: DailySafeToSpend; currency: string }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[daily.status]
  const short = daily.status === 'shortfall'
  const usedPct = daily.allowanceToday > 0 ? (daily.spentToday / daily.allowanceToday) * 100 : daily.spentToday > 0 ? 100 : 0
  const money = (m: number) => formatMoney(m, currency)

  return (
    <section className="card" aria-labelledby="dsts-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="dsts-title" className="t-label">
          Today's Safe-to-Spend
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone={st.tone} label={st.label} />
          {daily.now.confidence === 'low' && <StatusBadge tone="warning" label="Incomplete data" />}
        </div>
      </div>

      <div className="t-value mt-1" aria-live="polite">
        {short ? (
          <span className="text-negative">
            <ShieldAlert className="mr-1.5 inline size-6 align-[-3px]" aria-hidden />
            Short by {money(-daily.pool)}
          </span>
        ) : (
          money(daily.allowanceToday)
        )}
      </div>
      <p className="t-helper mt-1">
        {short
          ? `After bills, budgets and approved savings, there is not enough left for everyday spending before ${daily.now.periodEnd}.`
          : 'A recommendation for today, not a limit. Spend more if you need to — it only changes the days ahead.'}
      </p>

      {!short && (
        <div className="mt-3">
          <Meter pct={usedPct} tone={st.meter} label="Share of today's allowance used" />
          <p className="t-helper mt-1">
            {money(daily.spentToday)} of {money(daily.allowanceToday)} used ({Math.round(usedPct)}%)
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Spent today" helper={daily.totalSpentToday > daily.spentToday ? `${money(daily.totalSpentToday)} in total` : undefined}>
          {money(daily.spentToday)}
        </Tile>
        <Tile label={daily.remainingToday < 0 ? 'Over today by' : 'Remaining today'}>
          <span className={daily.remainingToday < 0 || short ? 'text-negative' : ''}>{money(short ? 0 : Math.abs(daily.remainingToday))}</span>
        </Tile>
        <Tile label="Flexible pool">
          <span className={daily.pool < 0 ? 'text-negative' : ''}>{money(daily.pool)}</span>
        </Tile>
        <Tile label="Days left" helper={`until ${daily.now.periodEnd}`}>
          {days(daily.daysRemaining)}
        </Tile>
      </div>

      {daily.status === 'overspent' && daily.tomorrowAllowance !== null && daily.tomorrowIfOnPlan !== null && (
        <div className="mt-3">
          <InlineNote tone="warning">
            You are {money(daily.overspentToday)} over today's allowance. Tomorrow's allowance becomes{' '}
            <strong>{money(daily.tomorrowAllowance)}</strong> instead of {money(daily.tomorrowIfOnPlan)}. Your budgets and savings goals were not changed.
          </InlineNote>
        </div>
      )}
      {daily.status !== 'overspent' && !short && daily.tomorrowAllowance !== null && (
        <p className="t-helper mt-3">Unspent money stays in your pool. If nothing else changes, tomorrow's allowance will be about {money(daily.tomorrowAllowance)}.</p>
      )}

      <button type="button" className="btn btn-ghost btn-sm mt-2 -ml-2" aria-expanded={open} aria-controls="dsts-detail" onClick={() => setOpen((o) => !o)}>
        <Info className="size-4" aria-hidden /> {open ? 'Hide' : 'How is this calculated?'}
      </button>
      {open && <Details daily={daily} currency={currency} />}
    </section>
  )
}

function Details({ daily, currency }: { daily: DailySafeToSpend; currency: string }) {
  const money = (m: number) => formatMoney(m, currency)
  const { now } = daily
  return (
    <div id="dsts-detail" className="mt-2 text-sm">
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt>Available funds</dt>
        <dd className="m-0 text-right"><CurrencyAmount value={now.availableFunds} currency={currency} tone="neutral" /></dd>
        {daily.reserved.map((r: ReservedItem) => (
          <div key={r.id} className="contents">
            <dt className="text-muted">
              − {r.label}
              {r.dueDate ? <span className="t-helper"> · due {r.dueDate}</span> : null}
            </dt>
            <dd className="m-0 text-right amount text-muted">{money(r.amount)}</dd>
          </div>
        ))}
        <dt className="border-t border-border pt-1 font-semibold">Flexible pool</dt>
        <dd className="m-0 border-t border-border pt-1 text-right font-semibold amount">{money(daily.pool)}</dd>
        <dt className="text-muted">÷ days left</dt>
        <dd className="m-0 text-right amount text-muted">{daily.daysRemaining}</dd>
        <dt className="font-semibold">Today's allowance</dt>
        <dd className="m-0 text-right font-semibold amount">{money(daily.allowanceToday)}</dd>
      </dl>

      <h4 className="t-label mt-3 uppercase">Today</h4>
      <dl className="m-0 mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="text-muted">Everything spent today</dt>
        <dd className="m-0 text-right amount">{money(daily.totalSpentToday)}</dd>
        {daily.billsPaidToday > 0 && (
          <>
            <dt className="text-muted">of which bill payments (already reserved)</dt>
            <dd className="m-0 text-right amount text-muted">{money(daily.billsPaidToday)}</dd>
          </>
        )}
        {daily.coveredByBudgetsToday > 0 && (
          <>
            <dt className="text-muted">covered by category budgets</dt>
            <dd className="m-0 text-right amount text-muted">{money(daily.coveredByBudgetsToday)}</dd>
          </>
        )}
        {daily.coveredByEssentialsToday > 0 && (
          <>
            <dt className="text-muted">covered by daily essentials</dt>
            <dd className="m-0 text-right amount text-muted">{money(daily.coveredByEssentialsToday)}</dd>
          </>
        )}
        <dt className="font-semibold">Charged to today's allowance</dt>
        <dd className="m-0 text-right font-semibold amount">{money(daily.spentToday)}</dd>
      </dl>

      <ul className="mt-3 list-disc pl-5 text-muted">
        {daily.explanation.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      {now.assumptions.length > 0 && (
        <>
          <h4 className="t-label mt-3 uppercase">Assumptions</h4>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {now.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {now.warnings.length > 0 && (
        <>
          <h4 className="t-label mt-3 uppercase">Data warnings</h4>
          <ul className="mt-1 list-disc pl-5 text-warning">
            {now.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <p className="t-helper mt-3">This is an estimate based on your records, not a guarantee or financial advice.</p>
    </div>
  )
}

/* ------------------------------------------------------------ where the money is */

const GROUPS: { id: string; label: string; kinds: ReservedItem['kind'][]; color: string }[] = [
  { id: 'bills', label: 'Bills & debt payments', kinds: ['bill', 'debt'], color: 'var(--chart-1)' },
  { id: 'budgets', label: 'Category budgets (left to spend)', kinds: ['budget'], color: 'var(--chart-3)' },
  { id: 'essentials', label: 'Essentials, pending & buffer', kinds: ['essentials', 'pending', 'buffer'], color: 'var(--chart-6)' },
  { id: 'goals', label: 'Savings goals', kinds: ['goal', 'contribution'], color: 'var(--chart-2)' },
]

/** The five kinds of money: available · spent · reserved · goals · free to spend. */
export function MoneyBreakdownCard({ daily, spentThisMonth, currency }: { daily: DailySafeToSpend; spentThisMonth: number; currency: string }) {
  const money = (m: number) => formatMoney(m, currency)
  const rows = GROUPS.map((g) => ({ ...g, amount: daily.reserved.filter((r) => g.kinds.includes(r.kind)).reduce((s, r) => s + r.amount, 0) }))
  const free = Math.max(0, daily.pool)
  const funds = daily.now.availableFunds
  const total = Math.max(1, rows.reduce((s, r) => s + r.amount, 0) + free)
  const segments = [...rows.map((r) => ({ id: r.id, amount: r.amount, color: r.color })), { id: 'free', amount: free, color: 'var(--positive)' }].filter((s) => s.amount > 0)

  return (
    <section className="card" aria-labelledby="mb-title">
      <h2 id="mb-title" className="t-section">
        Where your money is
      </h2>
      <p className="t-helper mt-0.5">Available now: {money(funds)}</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Of ${money(funds)} available, ${money(free)} is free to spend and the rest is set aside.`}>
        {segments.map((s) => (
          <div key={s.id} style={{ width: `${(s.amount / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: r.color }} aria-hidden />
              {r.label}
            </span>
            <span className="amount">{money(r.amount)}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 border-t border-border pt-1.5 font-semibold">
          <span className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--positive)' }} aria-hidden />
            Free to spend
          </span>
          <span className={`amount ${daily.pool < 0 ? 'text-negative' : ''}`}>{money(daily.pool)}</span>
        </li>
      </ul>
      <p className="t-helper mt-3">Already spent this month: {money(spentThisMonth)} (not part of the figures above — it has already left your accounts).</p>
    </section>
  )
}

/* ------------------------------------------------------------ budgets */

const HEALTH: Record<BudgetStatus['health'], { tone: Tone; label: string; meter: MeterTone }> = {
  healthy: { tone: 'positive', label: 'Healthy', meter: 'ok' },
  warning: { tone: 'warning', label: 'Close to limit', meter: 'warn' },
  over: { tone: 'negative', label: 'Over budget', meter: 'over' },
}

export function BudgetUtilizationCard({ budgets, currency }: { budgets: BudgetStatus[]; currency: string }) {
  const money = (m: number) => formatMoney(m, currency)
  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0)
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0)
  return (
    <section className="card" aria-labelledby="bu-title">
      <div className="flex items-start justify-between gap-2">
        <h2 id="bu-title" className="t-section">
          Monthly budgets
        </h2>
        <Link to="/budgets" className="link text-sm">
          Manage
        </Link>
      </div>
      {budgets.length === 0 ? (
        <p className="t-helper py-4">No budgets yet. A monthly limit per category shows here and keeps that money out of your free-to-spend amount.</p>
      ) : (
        <>
          <p className="t-helper mt-0.5">
            {money(totalSpent)} of {money(totalLimit)} used
          </p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-4 p-0">
            {budgets.slice(0, 5).map((b) => {
              const h = HEALTH[b.health]
              return (
                <li key={b.budget.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{b.categoryName}</span>
                    <StatusBadge tone={h.tone} label={h.label} />
                  </div>
                  <Meter pct={b.usedPct} tone={h.meter} label={`${b.categoryName} budget used`} />
                  <p className="t-helper mt-1">
                    {money(b.spent)} of {money(b.limit)} ({Math.round(b.usedPct)}%) · {b.overBy > 0 ? `${money(b.overBy)} over` : `${money(b.remaining)} left`}
                  </p>
                </li>
              )
            })}
          </ul>
          {budgets.length > 5 && <p className="t-helper mt-2">+ {budgets.length - 5} more on the Budgets page</p>}
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ goals */

export function GoalProgressCard({ smart, goals, currency }: { smart: SmartFinance; goals: readonly SavingsGoal[]; currency: string }) {
  const money = (m: number) => formatMoney(m, currency)
  const plan = smart.plan
  const lineOf = new Map(plan.lines.map((l) => [l.goalId, l]))
  const live = goals.filter((g) => !g.deletedAt)
  return (
    <section className="card" aria-labelledby="gp-title">
      <div className="flex items-start justify-between gap-2">
        <h2 id="gp-title" className="t-section">
          Savings goals
        </h2>
        <Link to="/budgets" className="link text-sm">
          Manage
        </Link>
      </div>
      {live.length === 0 ? (
        <p className="t-helper py-4">No goals yet. Add one to get a monthly savings suggestion.</p>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-4 p-0">
          {live.slice(0, 4).map((g) => {
            const pct = g.target > 0 ? (g.allocated / g.target) * 100 : 0
            const line = lineOf.get(g.id)
            const done = g.allocated >= g.target
            return (
              <li key={g.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{g.name}</span>
                  {done ? (
                    <StatusBadge tone="positive" label="Reached" />
                  ) : line && (g.monthlyContribution ?? 0) > 0 ? (
                    <StatusBadge tone={(g.monthlyContribution ?? 0) >= line.idealMonthly ? 'positive' : 'warning'} label={(g.monthlyContribution ?? 0) >= line.idealMonthly ? 'On plan' : 'Behind plan'} />
                  ) : (
                    <StatusBadge tone="neutral" label="No monthly plan" />
                  )}
                </div>
                <Meter pct={pct} label={`${g.name} progress`} />
                <p className="t-helper mt-1">
                  {money(g.allocated)} of {money(g.target)} ({Math.round(pct)}%)
                  {(g.monthlyContribution ?? 0) > 0 ? ` · ${money(g.monthlyContribution ?? 0)}/month approved` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {plan.lines.length > 0 && plan.totalApproved === 0 && plan.totalRecommended > 0 && (
        <div className="mt-3">
          <InlineNote>
            A suggestion of {money(plan.totalRecommended)} per month is ready.{' '}
            <Link to="/budgets" className="link">
              Review and approve
            </Link>
          </InlineNote>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ trends & history */

const pctText = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${Math.round(p)}%`)

export function SpendingTrendCard({ smart, currency }: { smart: SmartFinance; currency: string }) {
  const money = (m: number) => formatMoney(m, currency)
  const { history, trend, daily } = smart
  const total = history.reduce((s, d) => s + d.total, 0)
  const summary = `Spending over the last ${history.length} days totals ${money(total)}.`
  return (
    <section className="card" aria-labelledby="st-title">
      <h2 id="st-title" className="t-section">
        Daily spending
      </h2>
      <p className="t-helper mt-0.5">Last {history.length} days · posted expenses only</p>
      <div className="mt-3">
        {total === 0 ? (
          <p className="t-helper py-8 text-center">No spending recorded in the last {history.length} days.</p>
        ) : (
          <DailySpendingChart days={history} currency={currency} allowance={daily.allowanceToday} summary={summary} />
        )}
      </div>
      <dl className="m-0 mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="t-label">Everyday spending, last 7 days</dt>
          <dd className="m-0 mt-0.5">
            <span className="amount font-semibold">{money(trend.last7)}</span>{' '}
            <span className="t-helper">vs {money(trend.previous7)} the week before ({pctText(trend.weekChangePct)})</span>
          </dd>
        </div>
        <div>
          <dt className="t-label">This month so far</dt>
          <dd className="m-0 mt-0.5">
            <span className="amount font-semibold">{money(trend.monthToDate)}</span>{' '}
            <span className="t-helper">
              {trend.hasLastMonthData ? `vs ${money(trend.lastMonthSamePoint)} at this point last month (${pctText(trend.monthChangePct)})` : 'no earlier month to compare yet'}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  )
}

/* ------------------------------------------------------------ insights */

const INSIGHT_TONE: Record<Insight['tone'], Tone> = { positive: 'positive', neutral: 'info', warning: 'warning', negative: 'negative' }
const KIND_LABEL: Partial<Record<Insight['kind'], string>> = { projection: 'Projection', suggestion: 'Suggestion' }

export function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <section className="card" aria-labelledby="in-title">
      <h2 id="in-title" className="t-section flex items-center gap-2">
        <Lightbulb className="size-4" aria-hidden /> Insights
      </h2>
      <p className="t-helper mt-0.5">Based only on your own records. Projections and suggestions are labelled — they are not facts.</p>
      {insights.length === 0 ? (
        <p className="t-helper py-4">Add accounts and transactions to see insights.</p>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {insights.map((i) => (
            <li key={i.id} className="flex items-start gap-2 text-sm">
              <StatusBadge tone={INSIGHT_TONE[i.tone]} label={KIND_LABEL[i.kind] ?? (i.tone === 'positive' ? 'Good' : i.tone === 'neutral' ? 'Note' : i.tone === 'warning' ? 'Watch' : 'Alert')} />
              <span className="min-w-0 flex-1">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
