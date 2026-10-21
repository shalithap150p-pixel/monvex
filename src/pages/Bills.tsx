import { CalendarClock, Pause, Play, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useLookups } from '../app/FinanceCards'
import { BillForm } from '../forms/PlanningForms'
import { TransactionForm } from '../forms/TransactionForm'
import type { ObligationRec } from '../data/records'
import { occurrenceStatus, remainingAmount } from '../domain/bills'
import { diffDays } from '../domain/dates'
import type { OccurrenceStatus, PaymentObligation, PaymentOccurrence } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { CurrencyAmount, PageHeader, StatusBadge, type Tone } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

const OCC_STATUS: Record<OccurrenceStatus, { label: string; tone: Tone }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  unpaid: { label: 'Due soon', tone: 'info' },
  due: { label: 'Due today', tone: 'warning' },
  partially_paid: { label: 'Partly paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'negative' },
  paid: { label: 'Paid', tone: 'positive' },
}

export default function Bills() {
  const { data, db, today, save, remove } = useApp()
  const { accountName } = useLookups()
  const { ask, dialog } = useConfirm()
  const [form, setForm] = useState<{ open: boolean; initial?: ObligationRec }>({ open: false })
  const [paying, setPaying] = useState<{ occ: PaymentOccurrence; ob: PaymentObligation } | null>(null)
  const [showPaid, setShowPaid] = useState(false)

  const byId = useMemo(() => new Map(data.obligations.map((o) => [o.id, o])), [data.obligations])

  const open = useMemo(
    () =>
      data.occurrences
        .filter((o) => remainingAmount(o) > 0 && byId.get(o.obligationId)?.active !== false)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1)),
    [data.occurrences, byId],
  )
  const paid = useMemo(
    () => data.occurrences.filter((o) => remainingAmount(o) === 0).sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)).slice(0, 30),
    [data.occurrences],
  )

  const openEdit = async (o?: PaymentObligation) => setForm({ open: true, initial: o ? await db.obligations.get(o.id) : undefined })
  const toggleActive = async (o: PaymentObligation) => {
    const rec = await db.obligations.get(o.id)
    if (rec) await save('obligations', { ...rec, active: !rec.active })
  }
  const del = (o: PaymentObligation) =>
    ask({
      title: `Delete “${o.name}”?`,
      message: 'The bill and its future occurrences will be removed. Payments you already recorded stay in your transactions.',
      success: 'Bill deleted.',
      run: async () => {
        const occs = await db.occurrences.where('obligationId').equals(o.id).toArray()
        for (const x of occs) if (!x.deletedAt) await remove('occurrences', x.id)
        await remove('obligations', o.id)
      },
    })

  const row = (occ: PaymentOccurrence) => {
    const ob = byId.get(occ.obligationId)
    if (!ob) return null
    const st = OCC_STATUS[occurrenceStatus(occ, today, ob.reminderDays)]
    const left = diffDays(occ.dueDate, today)
    const rest = remainingAmount(occ)
    return (
      <li key={occ.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="font-medium">{ob.name}{ob.isEstimate && <span className="t-helper"> (estimate)</span>}</p>
          <p className="t-helper">
            Due {occ.dueDate}
            {rest > 0 && (left < 0 ? ` · ${-left} days overdue` : left === 0 ? ' · today' : ` · in ${left} days`)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <CurrencyAmount value={rest > 0 ? rest : occ.paidAmount} currency={ob.currency} tone="neutral" />
            {occ.paidAmount > 0 && rest > 0 && <p className="t-helper">of <CurrencyAmount value={occ.expectedAmount} currency={ob.currency} tone="neutral" /></p>}
          </div>
          <StatusBadge tone={st.tone} label={st.label} />
          {rest > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying({ occ, ob })}>
              Record payment
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <>
      <PageHeader
        title="Bills & Subscriptions"
        description="Recurring and one-off payments. MONVEX never pays anything for you — recording a payment links it to the bill and removes it from your forecast."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => void openEdit()}>
            <Plus className="size-4" aria-hidden /> Add bill
          </button>
        }
      />

      {data.obligations.length === 0 ? (
        <div className="card">
          <EmptyState icon={<CalendarClock className="size-6" />} title="No bills yet" description="Add rent, utilities, subscriptions or any payment you expect, so they are reserved in Safe-to-Spend and included in forecasts." action={<button type="button" className="btn btn-primary" onClick={() => void openEdit()}>Add a bill</button>} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          <section className="card xl:col-span-3" aria-labelledby="occ-title">
            <h2 id="occ-title" className="t-section mb-1">To pay</h2>
            {open.length === 0 ? <p className="t-helper py-4">Nothing left to pay. Upcoming occurrences appear here automatically.</p> : <ul className="m-0 list-none divide-y divide-border/60 p-0">{open.map(row)}</ul>}
            <button type="button" className="btn btn-ghost btn-sm mt-3" aria-expanded={showPaid} onClick={() => setShowPaid((s) => !s)}>
              {showPaid ? 'Hide' : 'Show'} paid history ({paid.length})
            </button>
            {showPaid && (paid.length === 0 ? <p className="t-helper">No paid bills yet.</p> : <ul className="m-0 list-none divide-y divide-border/60 p-0">{paid.map(row)}</ul>)}
          </section>

          <section className="card xl:col-span-2" aria-labelledby="ob-title">
            <h2 id="ob-title" className="t-section mb-1">Your bills</h2>
            <ul className="m-0 list-none divide-y divide-border/60 p-0">
              {data.obligations.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{o.name} {!o.active && <StatusBadge tone="neutral" label="Paused" />}</p>
                      <p className="t-helper capitalize">
                        {o.frequency === 'once' ? 'One-off' : o.frequency} · {o.frequency === 'once' ? 'due' : 'from'} {o.dueDate}
                        {o.accountId ? ` · ${accountName(o.accountId)}` : ''}
                        {o.essential ? ' · essential' : ''}
                      </p>
                    </div>
                    <CurrencyAmount value={o.amount} currency={o.currency} tone="neutral" />
                  </div>
                  <div className="mt-1 flex justify-end gap-1">
                    <button type="button" className="btn btn-ghost btn-icon" aria-label={o.active ? `Pause ${o.name}` : `Resume ${o.name}`} title={o.active ? 'Pause' : 'Resume'} onClick={() => void toggleActive(o)}>
                      {o.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                    </button>
                    <EditButton label={`Edit ${o.name}`} onClick={() => void openEdit(o)} />
                    <DeleteButton label={`Delete ${o.name}`} onClick={() => del(o)} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <BillForm open={form.open} onClose={() => setForm({ open: false })} initial={form.initial} />
      <TransactionForm open={Boolean(paying)} onClose={() => setPaying(null)} defaultType="expense" occurrence={paying?.occ} occurrenceName={paying?.ob.name} defaultAccountId={paying?.ob.accountId} />
      {dialog}
    </>
  )
}
