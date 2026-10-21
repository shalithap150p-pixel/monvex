import { Banknote, Plus, Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { useLookups } from '../app/FinanceCards'
import { AdvanceForm } from '../forms/PlanningForms'
import type { AdvanceRec } from '../data/records'
import { advanceOutstanding } from '../domain/ledger'
import { formatMoney, sum } from '../domain/money'
import type { SalaryAdvance } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

export default function Advances() {
  const { data, db, currency, remove } = useApp()
  const d = useDerived()
  const { accountName } = useLookups()
  const { ask, dialog } = useConfirm()
  const [form, setForm] = useState<{ open: boolean; initial?: AdvanceRec }>({ open: false })

  const advances = data.ledger.advances
  const outstanding = sum(advances.map((a) => advanceOutstanding(a, data.ledger.transactions)))
  const pp = d.paydayProjection

  const openForm = async (a?: SalaryAdvance) => setForm({ open: true, initial: a ? await db.advances.get(a.id) : undefined })
  const del = (a: SalaryAdvance) =>
    ask({
      title: `Delete advance from ${a.employer}?`,
      message: 'The advance will be removed and your account balance recalculated. Payroll deductions already linked to salary transactions stay on those transactions.',
      success: 'Advance deleted.',
      run: () => remove('advances', a.id),
    })

  return (
    <>
      <PageHeader
        title="Salary Advances"
        description="Early salary or employer loans. They are not income, and the part recovered from your payslip is not counted twice."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => void openForm()}>
            <Plus className="size-4" aria-hidden /> Record advance
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="pp-title">
          <div className="flex items-start justify-between gap-2">
            <h2 id="pp-title" className="t-section">Next payday plan</h2>
            <Link to="/settings#salary" className="btn btn-ghost btn-sm"><SettingsIcon className="size-4" aria-hidden /> Set up</Link>
          </div>
          {!d.payday || !data.prefs.expectedSalary ? (
            <p className="t-helper mt-2">Set your payday date and expected salary in Settings to see what you can expect after advance deductions.</p>
          ) : pp ? (
            <>
              <p className="t-helper mt-1">Payday {d.payday} · payroll month {pp.month}</p>
              <dl className="m-0 mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt>Expected salary</dt>
                <dd className="m-0 text-right"><CurrencyAmount value={pp.expectedSalary} currency={currency} tone="neutral" /></dd>
                {pp.deductions.map((x) => (
                  <div key={x.advanceId} className="contents">
                    <dt className="text-muted">− Advance from {x.employer}</dt>
                    <dd className="m-0 text-right text-muted"><CurrencyAmount value={x.amount} currency={currency} tone="neutral" /></dd>
                  </div>
                ))}
                <dt className="border-t border-border pt-1 font-semibold">Expected to receive</dt>
                <dd className="m-0 border-t border-border pt-1 text-right font-semibold"><CurrencyAmount value={pp.expectedRemainder} currency={currency} tone="neutral" /></dd>
              </dl>
              {pp.warnings.map((w) => (<div key={w} className="mt-3"><InlineNote tone="warning">{w}</InlineNote></div>))}
              <p className="t-helper mt-3">Only the deductions in your own schedule are subtracted. Expected salary is a forecast — it is not counted until it is received.</p>
            </>
          ) : null}
        </section>

        <section className="card" aria-label="Outstanding advances">
          <h2 className="t-label">Still to recover from payroll</h2>
          <div className="t-value mt-1"><CurrencyAmount value={outstanding} currency={currency} tone="neutral" /></div>
          <p className="t-helper mt-1">Advances reduce future pay; they were never income when received.</p>
        </section>
      </div>

      <section className="mt-4" aria-labelledby="adv-title">
        <h2 id="adv-title" className="t-section mb-3">Advances & employer loans</h2>
        {advances.length === 0 ? (
          <div className="card"><EmptyState icon={<Banknote className="size-6" />} title="No advances recorded" description="If your employer paid you part of your salary early or lent you money, record it here with a deduction schedule." action={<button type="button" className="btn btn-primary" onClick={() => void openForm()}>Record advance</button>} /></div>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
            {advances.map((a) => {
              const out = advanceOutstanding(a, data.ledger.transactions)
              return (
                <li key={a.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="t-section">{a.employer}</h3>
                      <p className="t-helper">{a.kind === 'advance' ? 'Salary advance' : 'Employer loan'} · {a.date} · {accountName(a.accountId)}</p>
                    </div>
                    {a.status === 'received' ? (out === 0 ? <StatusBadge tone="positive" label="Fully recovered" /> : <StatusBadge tone="warning" label="Being recovered" />) : <StatusBadge tone="neutral" label={a.status === 'pending' ? 'Not received yet' : 'Cancelled'} />}
                  </div>
                  <dl className="m-0 mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="t-label">Amount</dt><dd className="m-0"><CurrencyAmount value={a.amount} currency={a.currency} tone="neutral" /></dd></div>
                    <div><dt className="t-label">Still to recover</dt><dd className="m-0 font-semibold"><CurrencyAmount value={out} currency={a.currency} tone="neutral" /></dd></div>
                  </dl>
                  {a.schedule.length > 0 ? (
                    <p className="t-helper mt-2">Schedule: {a.schedule.map((s) => `${s.month} (${formatMoney(s.amount, a.currency)})`).join(', ')}</p>
                  ) : (
                    <p className="t-helper mt-2">No deduction schedule yet — add one so your payday plan is accurate.</p>
                  )}
                  <div className="mt-3 flex justify-end gap-1">
                    <EditButton label={`Edit advance from ${a.employer}`} onClick={() => void openForm(a)} />
                    <DeleteButton label={`Delete advance from ${a.employer}`} onClick={() => del(a)} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <AdvanceForm open={form.open} onClose={() => setForm({ open: false })} initial={form.initial} />
      {dialog}
    </>
  )
}
