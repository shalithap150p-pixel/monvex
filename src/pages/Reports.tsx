import { Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { useLookups } from '../app/FinanceCards'
import { occurrenceStatus, remainingAmount } from '../domain/bills'
import { addDays, addMonths, diffDays, monthEnd, monthKey, monthStart } from '../domain/dates'
import { advanceOutstanding, debtOutstanding, monthTotals, receivableOutstanding } from '../domain/ledger'
import { formatMoney, sum } from '../domain/money'
import { CategoryBreakdownChart } from '../ui/Charts'
import { SelectField } from '../ui/Primitives'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge, type Tone } from '../ui/Primitives'

type Grain = 'daily' | 'weekly' | 'monthly'

const weekStart = (d: string) => {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
  return addDays(d, -((dow + 6) % 7))
}

interface Insight {
  id: string
  tone: Tone
  title: string
  why: string
  link?: { to: string; label: string }
}

export default function Reports() {
  const { data, today, currency } = useApp()
  const d = useDerived()
  const { accountName, categoryName } = useLookups()
  const [month, setMonth] = useState(monthKey(today))
  const [grain, setGrain] = useState<Grain>('monthly')

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => monthKey(addMonths(monthStart(monthKey(today)), -i))), [today])
  const prevMonth = monthKey(addMonths(monthStart(month), -1))

  const cur = monthTotals(d.movements, month)
  const prev = monthTotals(d.movements, prevMonth)

  /* cash flow buckets */
  const flow = useMemo(() => {
    const keyOf = (date: string) => (grain === 'daily' ? date : grain === 'weekly' ? weekStart(date) : monthKey(date))
    const limit = grain === 'daily' ? addDays(today, -29) : grain === 'weekly' ? addDays(weekStart(today), -7 * 11) : monthStart(monthKey(addMonths(today, -11)))
    const m = new Map<string, { income: number; expense: number }>()
    for (const mv of d.movements) {
      if (mv.date > today || mv.date < limit) continue
      if (mv.recognizedIncome === 0 && mv.recognizedExpense === 0) continue
      const k = keyOf(mv.date)
      const e = m.get(k) ?? { income: 0, expense: 0 }
      e.income += mv.recognizedIncome
      e.expense += mv.recognizedExpense
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, v]) => ({ key: k, ...v, net: v.income - v.expense }))
  }, [d.movements, grain, today])

  /* category spending for the month */
  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.ledger.transactions) {
      if (t.type !== 'expense' || t.status !== 'posted' || monthKey(t.date) !== month) continue
      const name = categoryName(t.categoryId)
      m.set(name, (m.get(name) ?? 0) + t.amount)
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [data.ledger.transactions, month, categoryName])
  const prevCategories = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.ledger.transactions) {
      if (t.type !== 'expense' || t.status !== 'posted' || monthKey(t.date) !== prevMonth) continue
      const name = categoryName(t.categoryId)
      m.set(name, (m.get(name) ?? 0) + t.amount)
    }
    return m
  }, [data.ledger.transactions, prevMonth, categoryName])

  const budgetRows = data.budgets.map((b) => {
    const spent = sum(data.ledger.transactions.filter((t) => t.type === 'expense' && t.status === 'posted' && t.categoryId === b.categoryId && monthKey(t.date) === month).map((t) => t.amount))
    return { b, spent }
  })

  const monthOccs = data.occurrences.filter((o) => monthKey(o.dueDate) === month)
  const obName = (id: string) => data.obligations.find((o) => o.id === id)?.name ?? 'Bill'

  /* rule-based insights, each with its reasoning */
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = []
    const thisM = monthTotals(d.movements, monthKey(today))
    const lastM = monthTotals(d.movements, monthKey(addMonths(today, -1)))
    if (lastM.expense > 0 && thisM.expense > lastM.expense * 1.2 && today.slice(8) >= '20') {
      out.push({ id: 'spend-up', tone: 'warning', title: 'Spending is higher than last month', why: `Expenses so far this month are ${formatMoney(thisM.expense, currency)} versus ${formatMoney(lastM.expense, currency)} for the whole of last month (more than 20% higher).` })
    }
    if (d.savings.projectedNetSavings < 0) {
      out.push({ id: 'neg-savings', tone: 'negative', title: 'You are on track to spend more than you earn this month', why: `Projected net savings for ${monthKey(today)} are ${formatMoney(d.savings.projectedNetSavings, currency, { signed: true })} (actual so far plus scheduled items).`, link: { to: '/forecast', label: 'See the forecast' } })
    }
    for (const { b, spent } of budgetRows) {
      if (month === monthKey(today) && spent > b.limit) out.push({ id: `bud-${b.id}`, tone: 'negative', title: `${categoryName(b.categoryId)} budget exceeded`, why: `You have spent ${formatMoney(spent, currency)} against a limit of ${formatMoney(b.limit, currency)}.`, link: { to: '/budgets', label: 'Open budgets' } })
    }
    const overdue = data.occurrences.filter((o) => remainingAmount(o) > 0 && o.dueDate < today)
    if (overdue.length > 0) out.push({ id: 'overdue', tone: 'negative', title: `${overdue.length} overdue ${overdue.length === 1 ? 'bill' : 'bills'}`, why: `Total outstanding ${formatMoney(sum(overdue.map(remainingAmount)), currency)}. The oldest was due ${overdue.map((o) => o.dueDate).sort()[0]}.`, link: { to: '/bills', label: 'Open bills' } })
    const f = d.forecast(30)
    if (f.shortfalls[0]) out.push({ id: 'shortfall', tone: 'negative', title: 'A cash shortfall is projected', why: `On ${f.shortfalls[0].date} the balance in ${f.shortfalls[0].accountName} may fall ${formatMoney(f.shortfalls[0].shortBy, currency)} below zero.`, link: { to: '/forecast', label: 'See why' } })
    const lateLoans = data.ledger.loans.filter((l) => receivableOutstanding(l) > 0 && l.dueDate && l.dueDate < today)
    if (lateLoans.length > 0) out.push({ id: 'late-loans', tone: 'warning', title: `${lateLoans.length} overdue ${lateLoans.length === 1 ? 'repayment' : 'repayments'} owed to you`, why: lateLoans.map((l) => `${l.borrower}: ${formatMoney(receivableOutstanding(l), currency)} (due ${l.dueDate})`).join('; '), link: { to: '/debts', label: 'Open loans' } })
    if (d.money.heldForOthers > 0) out.push({ id: 'held', tone: 'info', title: 'Part of your balance belongs to other people', why: `${formatMoney(d.money.heldForOthers, currency)} is held for others and is excluded from Safe-to-Spend.`, link: { to: '/transfers', label: 'Open transfers' } })
    for (const a of data.ledger.accounts.filter((x) => !x.archived)) {
      if (a.lastReconciledAt && diffDays(today, a.lastReconciledAt) > 60) out.push({ id: `rec-${a.id}`, tone: 'neutral', title: `${a.name} hasn’t been reconciled for a while`, why: `Last checked ${a.lastReconciledAt}. Comparing with your bank statement catches missing transactions.`, link: { to: '/accounts', label: 'Reconcile' } })
    }
    return out
  }, [d, data, today, currency, budgetRows, month, categoryName])

  const diffRow = (label: string, a: number, b: number, goodWhenUp: boolean) => {
    const delta = a - b
    const tone: Tone = delta === 0 ? 'neutral' : (delta > 0) === goodWhenUp ? 'positive' : 'warning'
    return (
      <tr key={label} className="border-b border-border/60 last:border-0">
        <th scope="row" className="px-3 py-2.5 text-left font-medium">{label}</th>
        <td className="px-3 py-2.5 text-right"><CurrencyAmount value={a} currency={currency} tone="neutral" /></td>
        <td className="px-3 py-2.5 text-right"><CurrencyAmount value={b} currency={currency} tone="neutral" /></td>
        <td className="px-3 py-2.5 text-right"><span className="inline-flex items-center gap-2"><CurrencyAmount value={delta} currency={currency} signed /><StatusBadge tone={tone} label={delta === 0 ? 'Same' : delta > 0 ? 'Up' : 'Down'} /></span></td>
      </tr>
    )
  }

  return (
    <>
      <PageHeader title="Reports" description="Understand where your money goes. Income and expenses exclude transfers, loans, advances, opening balances and money held for others." />

      <div className="mb-4 max-w-xs">
        <SelectField label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (<option key={m} value={m}>{m}</option>))}
        </SelectField>
      </div>

      <section className="card mb-4" aria-labelledby="ins-title">
        <h2 id="ins-title" className="t-section mb-3 flex items-center gap-2"><Lightbulb className="size-5" aria-hidden /> Insights</h2>
        {insights.length === 0 ? (
          <p className="t-helper">Nothing needs attention right now. Insights appear when your records show something worth a look.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {insights.map((i) => (
              <li key={i.id}>
                <InlineNote tone={i.tone}>
                  <p className="m-0 font-semibold text-text">{i.title}</p>
                  <p className="m-0 mt-0.5"><span className="font-medium">Why: </span>{i.why}{i.link && <> <Link to={i.link.to} className="link">{i.link.label}</Link></>}</p>
                </InlineNote>
              </li>
            ))}
          </ul>
        )}
        <p className="t-helper mt-3">Insights are simple rules applied to your own records — they are not financial advice.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card" aria-labelledby="cmp-title">
          <h2 id="cmp-title" className="t-section mb-2">{month} vs {prevMonth}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Month comparison</caption>
              <thead><tr className="border-b border-border"><th scope="col" className="px-3 py-2 text-left t-label"><span className="sr-only">Measure</span></th><th scope="col" className="px-3 py-2 text-right t-label">{month}</th><th scope="col" className="px-3 py-2 text-right t-label">{prevMonth}</th><th scope="col" className="px-3 py-2 text-right t-label">Change</th></tr></thead>
              <tbody>
                {diffRow('Income', cur.income, prev.income, true)}
                {diffRow('Expenses', cur.expense, prev.expense, false)}
                {diffRow('Net savings', cur.net, prev.net, true)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="cat-title">
          <h2 id="cat-title" className="t-section mb-3">Spending by category — {month}</h2>
          <CategoryBreakdownChart items={categories} currency={currency} />
          {categories.some((c) => prevCategories.has(c.label)) && (
            <p className="t-helper mt-3">
              Compared with {prevMonth}: {categories.slice(0, 3).map((c) => { const p = prevCategories.get(c.label) ?? 0; return `${c.label} ${p === 0 ? 'new' : `${c.value >= p ? '+' : '−'}${Math.abs(Math.round(((c.value - p) / p) * 100))}%`}` }).join(' · ')}
            </p>
          )}
        </section>

        <section className="card xl:col-span-2" aria-labelledby="flow-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 id="flow-title" className="t-section">Cash flow (income vs expenses)</h2>
            <div role="group" aria-label="Group by" className="flex gap-1">
              {(['daily', 'weekly', 'monthly'] as const).map((g) => (
                <button key={g} type="button" className={`btn btn-sm capitalize ${grain === g ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={grain === g} onClick={() => setGrain(g)}>{g}</button>
              ))}
            </div>
          </div>
          {flow.length === 0 ? <p className="t-helper">No income or expenses recorded in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Cash flow by {grain} period</caption>
                <thead><tr className="border-b border-border"><th scope="col" className="px-3 py-2 text-left t-label">{grain === 'weekly' ? 'Week starting' : 'Period'}</th><th scope="col" className="px-3 py-2 text-right t-label">Income</th><th scope="col" className="px-3 py-2 text-right t-label">Expenses</th><th scope="col" className="px-3 py-2 text-right t-label">Net</th></tr></thead>
                <tbody>
                  {flow.map((r) => (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">{r.key}</th>
                      <td className="px-3 py-2 text-right"><CurrencyAmount value={r.income} currency={currency} tone="neutral" /></td>
                      <td className="px-3 py-2 text-right"><CurrencyAmount value={r.expense} currency={currency} tone="neutral" /></td>
                      <td className="px-3 py-2 text-right"><CurrencyAmount value={r.net} currency={currency} signed withIcon /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="bp-title">
          <h2 id="bp-title" className="t-section mb-2">Budget performance — {month}</h2>
          {budgetRows.length === 0 ? <p className="t-helper">No budgets set.</p> : (
            <ul className="m-0 list-none divide-y divide-border/60 p-0 text-sm">
              {budgetRows.map(({ b, spent }) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{categoryName(b.categoryId)}</span>
                  <span className="flex items-center gap-2">
                    <span className="amount text-muted">{formatMoney(spent, currency)} / {formatMoney(b.limit, currency)}</span>
                    <StatusBadge tone={spent > b.limit ? 'negative' : 'positive'} label={spent > b.limit ? 'Over' : 'Within'} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="ob-title">
          <h2 id="ob-title" className="t-section mb-2">Bills due in {month}</h2>
          {monthOccs.length === 0 ? <p className="t-helper">No bills fall in this month.</p> : (
            <ul className="m-0 list-none divide-y divide-border/60 p-0 text-sm">
              {monthOccs.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)).map((o) => {
                const ob = data.obligations.find((x) => x.id === o.obligationId)
                const st = occurrenceStatus(o, today, ob?.reminderDays ?? 3)
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{obName(o.obligationId)} <span className="t-helper">· {o.dueDate}</span></span>
                    <span className="flex items-center gap-2"><CurrencyAmount value={o.expectedAmount} currency={currency} tone="neutral" /><StatusBadge tone={st === 'paid' ? 'positive' : st === 'overdue' ? 'negative' : 'neutral'} label={st.replace('_', ' ')} /></span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="t-helper mt-2">{formatMoney(sum(monthOccs.map((o) => Math.min(o.paidAmount, o.expectedAmount))), currency)} paid of {formatMoney(sum(monthOccs.map((o) => o.expectedAmount)), currency)} due.</p>
        </section>

        <section className="card" aria-labelledby="rd-title">
          <h2 id="rd-title" className="t-section mb-2">Receivables, debts & advances</h2>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt>Owed to you ({data.ledger.loans.filter((l) => receivableOutstanding(l) > 0).length})</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={sum(data.ledger.loans.map(receivableOutstanding))} currency={currency} tone="neutral" /></dd>
            <dt>You owe ({data.ledger.debts.filter((x) => debtOutstanding(x) > 0).length})</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={sum(data.ledger.debts.map(debtOutstanding))} currency={currency} tone="neutral" /></dd>
            <dt>Advances to recover from payroll</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={sum(data.ledger.advances.map((a) => advanceOutstanding(a, data.ledger.transactions)))} currency={currency} tone="neutral" /></dd>
            <dt>Held for other people</dt>
            <dd className="m-0 text-right"><CurrencyAmount value={d.money.heldForOthers} currency={currency} tone="neutral" /></dd>
          </dl>
        </section>

        <section className="card" aria-labelledby="rc-title">
          <h2 id="rc-title" className="t-section mb-2">Reconciliation differences</h2>
          {data.reconciliations.length === 0 ? <p className="t-helper">No reconciliations yet. Reconcile an account from the Accounts page.</p> : (
            <ul className="m-0 list-none divide-y divide-border/60 p-0 text-sm">
              {[...data.reconciliations].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10).map((r) => {
                const diff = r.statementBalance - r.appBalance
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{accountName(r.accountId)} <span className="t-helper">· {r.date}</span></span>
                    {diff === 0 ? <StatusBadge tone="positive" label="Matched" /> : <CurrencyAmount value={diff} currency={r.currency} signed withIcon />}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <p className="t-helper mt-4">Period shown: {monthStart(month)} to {monthEnd(month)}. Forecast-accuracy tracking needs saved forecast snapshots, which are not available in this version.</p>
    </>
  )
}
