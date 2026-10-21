import { Archive, ArchiveRestore, ChevronDown, Landmark, Plus, Scale } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { AccountForm, ReconcileForm } from '../forms/PlanningForms'
import type { AccountRec } from '../data/records'
import { formatMoney } from '../domain/money'
import type { Account } from '../domain/types'
import type { MovementKind } from '../domain/ledger'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

const KIND_LABEL: Record<MovementKind, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  transfer_fee: 'Transfer fee',
  pass_through_in: 'Received for someone else',
  pass_through_out: 'Forwarded for someone else',
  pass_through_fee: 'Forwarding fee',
  loan_disbursed: 'Money lent',
  loan_repayment_in: 'Loan repayment received',
  debt_received: 'Borrowed money received',
  debt_principal_out: 'Debt repayment',
  debt_interest_out: 'Debt interest / fees',
  advance_received: 'Salary advance received',
}

export default function Accounts() {
  const { data, db, save, remove, today } = useApp()
  const d = useDerived()
  const { ask, dialog } = useConfirm()
  const [form, setForm] = useState<{ open: boolean; initial?: AccountRec }>({ open: false })
  const [recon, setRecon] = useState<AccountRec | null>(null)
  const [reconCalc, setReconCalc] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const accounts = data.ledger.accounts
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)

  const rec = async (a: Account) => (await db.accounts.get(a.id)) as AccountRec

  const openEdit = async (a: Account) => setForm({ open: true, initial: await rec(a) })
  const openRecon = async (a: Account) => {
    setReconCalc(d.balances.get(a.id) ?? 0)
    setRecon(await rec(a))
  }
  const setArchived = async (a: Account, archive: boolean) => {
    await save('accounts', { ...(await rec(a)), archived: archive })
  }
  const usedBy = (a: Account) =>
    d.movements.some((m) => m.accountId === a.id) ||
    data.obligations.some((o) => o.accountId === a.id) ||
    data.ledger.advances.some((x) => x.accountId === a.id)

  const del = (a: Account) => {
    if (usedBy(a)) {
      ask({
        title: 'This account has activity',
        message: 'Accounts with transactions can’t be deleted because that would change your history. Archive it instead — it disappears from lists and totals but its records stay intact.',
        confirmLabel: 'Archive account',
        danger: false,
        success: 'Account archived.',
        run: () => setArchived(a, true),
      })
      return
    }
    ask({ title: `Delete ${a.name}?`, message: 'This account has no activity and will be removed.', success: 'Account deleted.', run: () => remove('accounts', a.id) })
  }

  const card = (a: Account) => {
    const bal = d.balances.get(a.id) ?? 0
    const history = d.movements
      .filter((m) => m.accountId === a.id)
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    const open = expanded === a.id
    const diff = a.confirmedBalance != null ? a.confirmedBalance - bal : null
    return (
      <li key={a.id} className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="t-section truncate">{a.name}</h3>
            <p className="t-helper capitalize">{a.type} · {a.currency}</p>
          </div>
          <div className="text-right">
            <div className="t-value"><CurrencyAmount value={bal} currency={a.currency} tone="neutral" /></div>
            <p className="t-helper">Calculated balance</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {a.lastReconciledAt ? (
            diff === 0 ? (
              <StatusBadge tone="positive" label={`Confirmed ${a.lastReconciledAt}`} />
            ) : (
              <StatusBadge tone="warning" label={`Reconciled ${a.lastReconciledAt} · differs now`} />
            )
          ) : (
            <StatusBadge tone="neutral" label="Never reconciled" />
          )}
          <span className="t-helper">Opening balance {formatMoney(a.openingBalance, a.currency)} (not income)</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openRecon(a)}>
            <Scale className="size-4" aria-hidden /> Reconcile
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={`hist-${a.id}`} onClick={() => setExpanded(open ? null : a.id)}>
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> History ({history.length})
          </button>
          <span className="ml-auto flex gap-1">
            <EditButton label={`Edit ${a.name}`} onClick={() => void openEdit(a)} />
            <button type="button" className="btn btn-ghost btn-icon" aria-label={a.archived ? `Restore ${a.name}` : `Archive ${a.name}`} title={a.archived ? 'Restore' : 'Archive'} onClick={() => void setArchived(a, !a.archived)}>
              {a.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            </button>
            <DeleteButton label={`Delete ${a.name}`} onClick={() => del(a)} />
          </span>
        </div>
        {open && (
          <div id={`hist-${a.id}`} className="mt-3 border-t border-border pt-3">
            {history.length === 0 ? (
              <p className="t-helper">No activity yet.</p>
            ) : (
              <ul className="m-0 max-h-72 list-none divide-y divide-border/60 overflow-y-auto p-0 text-sm">
                {history.slice(0, 50).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {KIND_LABEL[m.kind]} <span className="t-helper">· {m.date}{m.date > today ? ' (scheduled)' : ''}</span>
                    </span>
                    <CurrencyAmount value={m.cash} currency={a.currency} signed />
                  </li>
                ))}
              </ul>
            )}
            {history.length > 50 && <p className="t-helper mt-2">Showing the latest 50 of {history.length}.</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Cash, bank accounts and wallets. Balances are calculated from your records, never typed in directly."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true })}>
            <Plus className="size-4" aria-hidden /> Add account
          </button>
        }
      />
      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Landmark className="size-6" />}
            title="No accounts yet"
            description="Add each place you keep money, with its balance today as the opening balance."
            action={<button type="button" className="btn btn-primary" onClick={() => setForm({ open: true })}>Create an account</button>}
          />
        </div>
      ) : (
        <>
          <InlineNote>
            Total across accounts: <strong>{formatMoney(d.money.physical, data.prefs.currency)}</strong>
            {d.money.heldForOthers > 0 && <> · {formatMoney(d.money.heldForOthers, data.prefs.currency)} of it is held for other people.</>}
          </InlineNote>
          <ul className="m-0 mt-4 grid list-none gap-4 p-0 lg:grid-cols-2">{active.map(card)}</ul>
        </>
      )}
      {archived.length > 0 && (
        <section className="mt-8" aria-labelledby="arch-title">
          <h2 id="arch-title" className="t-section mb-3">Archived accounts</h2>
          <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">{archived.map(card)}</ul>
        </section>
      )}
      <AccountForm open={form.open} onClose={() => setForm({ open: false })} initial={form.initial} />
      <ReconcileForm open={Boolean(recon)} onClose={() => setRecon(null)} account={recon} calculated={reconCalc} />
      {dialog}
    </>
  )
}
