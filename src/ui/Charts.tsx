import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DayPoint } from '../domain/forecast'
import { formatMoney } from '../domain/money'

const compact = (minor: number) => {
  const v = minor / 100
  const abs = Math.abs(v)
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${Math.round(abs / 1_000)}K` : String(Math.round(abs))
  return v < 0 ? `−${s}` : s
}

const shortDate = (d: string) => {
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}

/** Projected combined balance over time, with a labelled zero line and an accessible text summary. */
export function ForecastChart({
  series,
  currency,
  summary,
  height = 260,
}: {
  series: DayPoint[]
  currency: string
  summary: string
  height?: number
}) {
  const data = series.map((p) => ({ date: p.date, total: p.total }))
  const min = Math.min(0, ...data.map((d) => d.total))
  const max = Math.max(0, ...data.map((d) => d.total))
  const crossesZero = min < 0
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--text-subtle)" tick={{ fontSize: 12 }} minTickGap={32} />
            <YAxis tickFormatter={compact} stroke="var(--text-subtle)" tick={{ fontSize: 12 }} width={48} domain={[min * 1.1, max * 1.1 || 1]} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
              labelFormatter={(d) => String(d)}
              formatter={(v) => [formatMoney(Number(v), currency), 'Projected balance']}
            />
            <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="4 4" label={{ value: 'Zero balance', fill: 'var(--negative)', fontSize: 11, position: 'insideBottomRight' }} />
            <Area type="monotone" dataKey="total" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#fc)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="t-helper mt-2">
        {summary}
        {crossesZero ? ' The balance goes below zero in this period.' : ''}
      </figcaption>
    </figure>
  )
}

export interface BreakdownItem {
  label: string
  value: number
}

/** Text-first horizontal bars: values and percentages are always written out. */
export function CategoryBreakdownChart({ items, currency }: { items: BreakdownItem[]; currency: string }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return <p className="t-helper">No spending recorded for this period.</p>
  const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Spending by category">
      {items.map((item, i) => {
        const pct = (item.value / total) * 100
        return (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{item.label}</span>
              <span className="amount text-muted">
                {formatMoney(item.value, currency)} · {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: palette[i % palette.length] }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Daily spending for the last days: everyday spending and bill payments, with today's allowance as a reference line. */
export function DailySpendingChart({
  days,
  currency,
  allowance,
  summary,
  height = 220,
}: {
  days: { date: string; everyday: number; bills: number }[]
  currency: string
  /** Today's recommended allowance (drawn as a reference line when above zero). */
  allowance: number
  summary: string
  height?: number
}) {
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--text-subtle)" tick={{ fontSize: 12 }} minTickGap={20} />
            <YAxis tickFormatter={compact} stroke="var(--text-subtle)" tick={{ fontSize: 12 }} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
              labelFormatter={(d) => String(d)}
              formatter={(v, name) => [formatMoney(Number(v), currency), name === 'everyday' ? 'Everyday spending' : 'Bill payments']}
            />
            {allowance > 0 && (
              <ReferenceLine y={allowance} stroke="var(--positive)" strokeDasharray="4 4" label={{ value: "Today's allowance", fill: 'var(--positive)', fontSize: 11, position: 'insideTopLeft' }} />
            )}
            <Bar dataKey="everyday" stackId="s" fill="var(--chart-1)" isAnimationActive={false} />
            <Bar dataKey="bills" stackId="s" fill="var(--chart-6)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="t-helper mt-2">
        {summary}
        <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--chart-1)' }} aria-hidden /> Everyday</span>
        <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: 'var(--chart-6)' }} aria-hidden /> Bills</span>
      </figcaption>
    </figure>
  )
}
