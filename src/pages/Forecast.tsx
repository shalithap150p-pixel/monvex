import { LineChart as LineIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { useLookups } from '../app/FinanceCards'
import type { Scenario } from '../domain/forecast'
import { formatMoney } from '../domain/money'
import { ForecastChart } from '../ui/Charts'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge, SummaryMetricCard, type Tone } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

const CERTAINTY: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'positive' },
  expected: { label: 'Expected', tone: 'info' },
  uncertain: { label: 'Uncertain', tone: 'warning' },
}

export default function Forecast() {
  const { currency, today, data } = useApp()
  const d = useDerived()
  const { accountName } = useLookups()
  const [days, setDays] = useState<30 | 60 | 90>(30)
  const [scenario, setScenario] = useState<Scenario>('expected')

  const result = useMemo(() => d.forecast(days, scenario), [d, days, scenario])
  const hasAccounts = data.ledger.accounts.some((a) => !a.archived)
  const upcoming = useMemo(
    () => [...result.eventsUsed].filter((e) => e.date <= result.series[result.series.length - 1].date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [result],
  )

  if (!hasAccounts) {
    return (
      <>
        <PageHeader title="Forecasts" />
        <div className="card"><EmptyState icon={<LineIcon className="size-6" />} title="Add an account to see forecasts" description="Forecasts start from your account balances and add the bills, income and repayments you have scheduled." /></div>
      </>
    )
  }

  const start = result.series[0].total
  const end = result.series[result.series.length - 1].date

  return (
    <>
      <PageHeader title="Forecasts" description="Projected balances from your current records and scheduled items. Estimates only — real life can differ." />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div role="group" aria-label="Forecast period" className="flex gap-1">
          {([30, 60, 90] as const).map((n) => (
            <button key={n} type="button" className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>
          ))}
        </div>
        <div role="group" aria-label="Scenario" className="flex gap-1">
          <button type="button" className={`btn btn-sm ${scenario === 'expected' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={scenario === 'expected'} onClick={() => setScenario('expected')}>Expected</button>
          <button type="button" className={`btn btn-sm ${scenario === 'conservative' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={scenario === 'conservative'} onClick={() => setScenario('conservative')}>Conservative</button>
        </div>
        <p className="t-helper max-w-md">
          {scenario === 'expected' ? 'Includes confirmed and expected income, and all scheduled payments.' : 'Counts all scheduled payments but only income that is already confirmed.'}
        </p>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <SummaryMetricCard label="Balance today" value={<CurrencyAmount value={start} currency={currency} tone="neutral" />} helper="Combined, active accounts" />
        <SummaryMetricCard label={`Projected on ${end}`} value={<CurrencyAmount value={result.closingBalance} currency={currency} tone="neutral" />} helper={<>Change <CurrencyAmount value={result.closingBalance - start} currency={currency} signed /></>} />
        <SummaryMetricCard
          label="Lowest point"
          value={<CurrencyAmount value={result.lowestPoint.total} currency={currency} tone="neutral" />}
          helper={`on ${result.lowestPoint.date}`}
          badge={result.lowestPoint.total < 0 ? <StatusBadge tone="negative" label="Below zero" /> : <StatusBadge tone="positive" label="Stays positive" />}
        />
      </div>

      <section className="card mb-4" aria-label="Projected balance chart">
        <ForecastChart
          series={result.series}
          currency={currency}
          summary={`Combined balance goes from ${formatMoney(start, currency)} on ${today} to ${formatMoney(result.closingBalance, currency)} on ${end}, with a lowest point of ${formatMoney(result.lowestPoint.total, currency)} on ${result.lowestPoint.date}.`}
        />
      </section>

      <section className="card mb-4" aria-labelledby="sf-title">
        <h2 id="sf-title" className="t-section mb-3">Possible shortfalls</h2>
        {result.shortfalls.length === 0 ? (
          <InlineNote tone="positive">No shortfall expected in the next {days} days under the {scenario} scenario.</InlineNote>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {result.shortfalls.map((s) => (
              <li key={`${s.date}-${s.accountId}`} className="rounded-[10px] border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{s.date} · {s.accountName}</h3>
                  <StatusBadge tone="negative" label={`Short by ${formatMoney(s.shortBy, currency)}`} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  Projected balance <strong className="amount">{formatMoney(s.balance, currency)}</strong>
                  {s.cause ? <> after “{s.cause.label}” ({formatMoney(Math.abs(s.cause.amount), currency)})</> : null}.
                  {s.confirmedOnly ? ' This uses only confirmed income.' : ''}
                </p>
                {s.contributing.length > 0 && (
                  <>
                    <h4 className="t-label mt-3">What contributes</h4>
                    <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                      {s.contributing.map((e) => (<li key={e.id}>{e.label}: {formatMoney(e.amount, currency, { signed: true })}</li>))}
                    </ul>
                  </>
                )}
                {s.actions.length > 0 && (
                  <>
                    <h4 className="t-label mt-3">Things you could do</h4>
                    <ul className="mt-1 list-disc pl-5 text-sm text-muted">{s.actions.map((a) => (<li key={a}>{a}</li>))}</ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="ev-title">
          <h2 id="ev-title" className="t-section mb-2">Scheduled items in this period</h2>
          {upcoming.length === 0 ? (
            <p className="t-helper py-3">Nothing scheduled. Add bills, a payday or expected repayments to improve the forecast.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border/60 p-0">
              {upcoming.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.label}</p>
                    <p className="t-helper">{e.date} · {accountName(e.accountId)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <CurrencyAmount value={e.amount} currency={currency} signed withIcon />
                    <StatusBadge tone={CERTAINTY[e.certainty].tone} label={CERTAINTY[e.certainty].label} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="as-title">
          <h2 id="as-title" className="t-section mb-2">Assumptions & data warnings</h2>
          <ul className="m-0 list-disc pl-5 text-sm text-muted">
            {result.assumptions.map((a) => (<li key={a}>{a}</li>))}
          </ul>
          {result.warnings.length > 0 && (
            <div className="mt-3"><InlineNote tone="warning"><ul className="m-0 list-disc pl-4">{result.warnings.map((w) => (<li key={w}>{w}</li>))}</ul></InlineNote></div>
          )}
          <p className="t-helper mt-3">Paid bills are removed from the forecast, and the same scheduled item is never counted twice.</p>
        </section>
      </div>
    </>
  )
}
