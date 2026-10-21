import { ArrowLeftRight, Forward, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useLookups } from '../app/FinanceCards'
import { PassThroughForm, PassThroughLegForm, TransferForm } from '../forms/TransferForms'
import type { PassThroughRec, TransferRec } from '../data/records'
import { passThroughUnresolved } from '../domain/ledger'
import { formatMoney, sum } from '../domain/money'
import type { InternalTransfer, PassThroughStatus, PassThroughTransfer } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { DataTable, type Column } from '../ui/DataTable'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge, type Tone } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

const PT_STATUS: Record<PassThroughStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending — not received yet', tone: 'neutral' },
  received: { label: 'Received — not forwarded', tone: 'warning' },
  partially_transferred: { label: 'Partly forwarded', tone: 'warning' },
  transferred: { label: 'Forwarded', tone: 'info' },
  confirmed: { label: 'Confirmed by recipient', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export default function Transfers() {
  const { data, db, save, remove, currency } = useApp()
  const { accountName } = useLookups()
  const { ask, dialog } = useConfirm()
  const [tab, setTab] = useState<'internal' | 'pass'>('internal')

  const [tForm, setTForm] = useState<{ open: boolean; initial?: TransferRec }>({ open: false })
  const [pForm, setPForm] = useState<{ open: boolean; initial?: PassThroughRec }>({ open: false })
  const [legFor, setLegFor] = useState<PassThroughRec | null>(null)

  const transfers = useMemo(
    () => [...data.ledger.transfers].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [data.ledger.transfers],
  )
  const passes = useMemo(
    () => [...data.ledger.passThroughs].sort((a, b) => (a.receivedDate < b.receivedDate ? 1 : -1)),
    [data.ledger.passThroughs],
  )
  const held = sum(passes.map(passThroughUnresolved))

  const openTransfer = async (t?: InternalTransfer) => setTForm({ open: true, initial: t ? await db.transfers.get(t.id) : undefined })
  const openPass = async (p?: PassThroughTransfer) => setPForm({ open: true, initial: p ? await db.passThroughs.get(p.id) : undefined })
  const openLeg = async (p: PassThroughTransfer) => setLegFor((await db.passThroughs.get(p.id)) ?? null)

  const setStatus = async (p: PassThroughTransfer, status: PassThroughStatus) => {
    const rec = await db.passThroughs.get(p.id)
    if (rec) await save('passThroughs', { ...rec, status })
  }

  const delTransfer = (t: InternalTransfer) =>
    ask({
      title: 'Delete this transfer?',
      message: `The ${formatMoney(t.amount, currency)} transfer from ${accountName(t.sourceAccountId)} to ${accountName(t.destinationAccountId)} will be removed and both balances recalculated.`,
      success: 'Transfer deleted.',
      run: () => remove('transfers', t.id),
    })

  const delPass = (p: PassThroughTransfer) =>
    ask({
      title: 'Delete this pass-through record?',
      message: `The money received from ${p.sender} and all its forwarding records will be removed from your balances.`,
      success: 'Record deleted.',
      run: async () => {
        const legs = await db.passThroughLegs.where('passThroughId').equals(p.id).toArray()
        for (const l of legs) if (!l.deletedAt) await remove('passThroughLegs', l.id)
        await remove('passThroughs', p.id)
      },
    })

  const columns: Column<InternalTransfer>[] = [
    { key: 'date', header: 'Date', render: (t) => t.date },
    { key: 'route', header: 'From → To', primary: true, render: (t) => `${accountName(t.sourceAccountId)} → ${accountName(t.destinationAccountId)}` },
    { key: 'fee', header: 'Fee', align: 'right', render: (t) => (t.fee > 0 ? <CurrencyAmount value={t.fee} currency={currency} tone="neutral" /> : '—') },
    { key: 'amount', header: 'Amount', align: 'right', render: (t) => <CurrencyAmount value={t.amount} currency={currency} tone="neutral" /> },
  ]

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Moving your own money between accounts, and money you receive on behalf of someone else. Neither counts as income or expense."
        actions={
          tab === 'internal' ? (
            <button type="button" className="btn btn-primary" onClick={() => void openTransfer()}>
              <Plus className="size-4" aria-hidden /> New transfer
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void openPass()}>
              <Plus className="size-4" aria-hidden /> Money received for someone
            </button>
          )
        }
      />

      <div role="tablist" aria-label="Transfer type" className="mb-4 flex gap-1">
        {(
          [
            ['internal', 'Between my accounts'],
            ['pass', `Held for others${held > 0 ? ` (${formatMoney(held, currency)})` : ''}`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" type="button" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'internal' ? (
        <div id="panel-internal" role="tabpanel" aria-labelledby="tab-internal" className="card">
          {transfers.length === 0 ? (
            <EmptyState icon={<ArrowLeftRight className="size-6" />} title="No transfers yet" description="Record money you move between your own accounts, for example bank to wallet. Any transfer fee is counted as an expense; the transferred amount is not." />
          ) : (
            <DataTable
              caption="Internal transfers"
              columns={columns}
              rows={transfers}
              rowKey={(t) => t.id}
              onRowClick={(t) => void openTransfer(t)}
              rowActions={(t) => (
                <>
                  <EditButton label="Edit transfer" onClick={() => void openTransfer(t)} />
                  <DeleteButton label="Delete transfer" onClick={() => delTransfer(t)} />
                </>
              )}
            />
          )}
        </div>
      ) : (
        <div id="panel-pass" role="tabpanel" aria-labelledby="tab-pass" className="flex flex-col gap-4">
          {held > 0 && (
            <InlineNote tone="warning">
              <strong>{formatMoney(held, currency)}</strong> currently in your accounts belongs to other people. It is subtracted from your available money and Safe-to-Spend.
            </InlineNote>
          )}
          {passes.length === 0 ? (
            <div className="card">
              <EmptyState title="Nothing held for others" description="When someone sends you money to pass on to a third person, record it here so it isn’t mistaken for your income." />
            </div>
          ) : (
            passes.map((p) => {
              const st = PT_STATUS[p.status]
              const unresolved = passThroughUnresolved(p)
              const forwarded = sum(p.legs.map((l) => l.amount))
              return (
                <article key={p.id} className="card" aria-label={`From ${p.sender} to ${p.recipient}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="t-section">{p.sender} → {p.recipient}</h3>
                      <p className="t-helper">Received {p.receivedDate} into {accountName(p.accountId)}{p.destination ? ` · destination: ${p.destination}` : ''}</p>
                    </div>
                    <StatusBadge tone={st.tone} label={st.label} />
                  </div>
                  <dl className="m-0 mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="t-label">Received</dt><dd className="m-0"><CurrencyAmount value={p.amount} currency={p.currency} tone="neutral" /></dd></div>
                    <div><dt className="t-label">Forwarded</dt><dd className="m-0"><CurrencyAmount value={forwarded} currency={p.currency} tone="neutral" /></dd></div>
                    <div><dt className="t-label">Still held</dt><dd className="m-0 font-semibold"><CurrencyAmount value={unresolved} currency={p.currency} tone="neutral" /></dd></div>
                  </dl>
                  {p.legs.length > 0 && (
                    <ul className="m-0 mt-3 list-none divide-y divide-border/60 p-0 text-sm" aria-label="Forwarding history">
                      {p.legs.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                          <span>Forwarded {l.date}{l.fee > 0 ? <span className="t-helper"> · your fee {formatMoney(l.fee, p.currency)}</span> : null}</span>
                          <CurrencyAmount value={l.amount} currency={p.currency} tone="neutral" />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {unresolved > 0 && p.status !== 'cancelled' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void openLeg(p)}>
                        <Forward className="size-4" aria-hidden /> Record forwarding
                      </button>
                    )}
                    {unresolved === 0 && p.status === 'transferred' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void setStatus(p, 'confirmed')}>Mark confirmed by recipient</button>
                    )}
                    <span className="ml-auto flex gap-1">
                      <EditButton label="Edit record" onClick={() => void openPass(p)} />
                      <DeleteButton label="Delete record" onClick={() => delPass(p)} />
                    </span>
                  </div>
                </article>
              )
            })
          )}
        </div>
      )}

      <TransferForm open={tForm.open} onClose={() => setTForm({ open: false })} initial={tForm.initial} />
      <PassThroughForm open={pForm.open} onClose={() => setPForm({ open: false })} initial={pForm.initial} />
      <PassThroughLegForm open={Boolean(legFor)} onClose={() => setLegFor(null)} pass={legFor} />
      {dialog}
    </>
  )
}
