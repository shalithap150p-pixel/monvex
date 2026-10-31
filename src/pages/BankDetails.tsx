import { ChevronDown, ClipboardCopy, Copy, Eye, EyeOff, IdCard, Plus, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useDerived } from '../app/derived'
import { BankDetailsForm } from '../forms/BankDetailsForm'
import type { BankDetailsRec } from '../data/records'
import { ACCOUNT_TYPE_LABEL, detailsAsText, maskAccountNumber } from '../domain/bankDetails'
import type { BankDetails } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { SearchAndFilterBar } from '../ui/Inputs'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'
import { useToast } from '../ui/Toast'

/** Numbers stay hidden unless the user asks; they hide again by themselves. */
const REVEAL_MS = 30_000

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function BankDetailsPage() {
  const { data, db, remove } = useApp()
  const d = useDerived()
  const toast = useToast()
  const { ask, dialog } = useConfirm()
  const [form, setForm] = useState<{ open: boolean; initial?: BankDetailsRec }>({ open: false })
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

  // Hide revealed numbers again after a short time.
  useEffect(() => {
    const ids = Object.keys(revealed)
    if (ids.length === 0) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setRevealed((r) => Object.fromEntries(Object.entries(r).filter(([, at]) => now - at < REVEAL_MS)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [revealed])

  const accountName = useMemo(() => new Map(data.ledger.accounts.map((a) => [a.id, a.name])), [data.ledger.accounts])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...data.bankDetails]
      .filter((b) => !q || [b.label, b.bankName, b.branchName, b.accountHolder, b.accountType].some((x) => (x ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [data.bankDetails, query])

  const doCopy = async (what: string, value: string) => {
    const ok = await copyText(value)
    toast(ok ? `${what} copied.` : 'Could not copy. Select the text and copy it manually.', ok ? 'success' : 'error')
  }

  const openEdit = async (b: BankDetails) => setForm({ open: true, initial: (await db.bankDetails.get(b.id)) as BankDetailsRec })

  const rows = (b: BankDetails, show: boolean): { label: string; value: string | null | undefined; secret?: boolean }[] => [
    { label: 'Account holder', value: b.accountHolder },
    { label: 'Account number', value: b.accountNumber, secret: true },
    { label: 'Account type', value: ACCOUNT_TYPE_LABEL[b.accountType] },
    { label: 'Currency', value: b.currency },
    { label: 'Bank', value: b.bankName },
    { label: 'Bank code', value: b.bankCode },
    { label: 'Branch', value: b.branchName },
    { label: 'Branch code', value: b.branchCode },
    { label: 'IBAN', value: b.iban, secret: true },
    { label: 'SWIFT / BIC', value: b.swiftBic },
    { label: 'Card (last 4 digits)', value: b.cardLast4 ? `•••• ${b.cardLast4}` : null },
    { label: 'Opened on', value: b.openedOn },
    { label: 'Bank phone', value: b.contactPhone },
    { label: 'Linked MONVEX account', value: b.linkedAccountId ? accountName.get(b.linkedAccountId) ?? 'Account removed' : null },
    { label: 'Notes', value: b.notes },
  ].map((r) => ({ ...r, value: r.secret && r.value && !show ? maskAccountNumber(r.value) : r.value }))

  const card = (b: BankDetails) => {
    const show = b.id in revealed
    const open = expanded === b.id
    const balance = b.linkedAccountId ? d.balances.get(b.linkedAccountId) : undefined
    return (
      <li key={b.id} className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="t-section truncate">{b.label}</h3>
            <p className="t-helper truncate">
              {b.bankName}
              {b.branchName ? ` · ${b.branchName}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge tone="info" label={ACCOUNT_TYPE_LABEL[b.accountType]} />
            <StatusBadge tone="neutral" label={b.currency} />
          </div>
        </div>

        <p className="t-label mt-4">Account number</p>
        <p className="amount mt-0.5 break-all text-xl font-semibold tracking-wide" aria-live="polite">
          {show ? b.accountNumber : maskAccountNumber(b.accountNumber)}
        </p>
        {b.accountHolder && <p className="t-helper mt-0.5">{b.accountHolder}</p>}
        {balance !== undefined && (
          <p className="t-helper mt-1">
            Balance in MONVEX ({accountName.get(b.linkedAccountId ?? '')}): <CurrencyAmount value={balance} currency={b.currency} tone="neutral" />
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-pressed={show}
            onClick={() => setRevealed((r) => (show ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== b.id)) : { ...r, [b.id]: Date.now() }))}
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />} {show ? 'Hide number' : 'Show number'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void doCopy('Account number', b.accountNumber)}>
            <Copy className="size-4" aria-hidden /> Copy number
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void doCopy('Bank details', detailsAsText(b))}>
            <ClipboardCopy className="size-4" aria-hidden /> Copy all details
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={`bd-${b.id}`} onClick={() => setExpanded(open ? null : b.id)}>
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> {open ? 'Hide details' : 'All details'}
          </button>
          <span className="ml-auto flex gap-1">
            <EditButton label={`Edit ${b.label}`} onClick={() => void openEdit(b)} />
            <DeleteButton
              label={`Delete ${b.label}`}
              onClick={() => ask({ title: `Delete “${b.label}”?`, message: 'These bank details are removed from MONVEX. Your bank account and your MONVEX balances are not affected.', success: 'Bank details deleted.', run: () => remove('bankDetails', b.id) })}
            />
          </span>
        </div>

        {open && (
          <dl id={`bd-${b.id}`} className="m-0 mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
            {rows(b, show)
              .filter((r) => r.value)
              .map((r) => (
                <div key={r.label} className="min-w-0">
                  <dt className="t-label">{r.label}</dt>
                  <dd className="m-0 mt-0.5 flex items-start gap-1">
                    <span className="min-w-0 flex-1 break-words">{r.value}</span>
                    {r.label !== 'Notes' && r.label !== 'Linked MONVEX account' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon !size-7 shrink-0"
                        aria-label={`Copy ${r.label}`}
                        title={`Copy ${r.label}`}
                        onClick={() => {
                          const raw = r.label === 'Account number' ? b.accountNumber : r.label === 'IBAN' ? b.iban ?? '' : r.label === 'Card (last 4 digits)' ? b.cardLast4 ?? '' : String(r.value)
                          void doCopy(r.label, raw)
                        }}
                      >
                        <Copy className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </li>
    )
  }

  return (
    <>
      <PageHeader
        title="Bank Details"
        description="Keep your bank account details in one place, so you can find or share them quickly."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true })}>
            <Plus className="size-4" aria-hidden /> Add bank details
          </button>
        }
      />

      <InlineNote tone="info">
        <span className="inline-flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Account numbers are hidden until you tap “Show number”, and hide again after 30 seconds. Never save online-banking passwords, PINs, OTPs, CVV codes or full card numbers here — MONVEX does not store them.
          </span>
        </span>
      </InlineNote>

      <div className="mt-4">
        {data.bankDetails.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IdCard className="size-6" />}
              title="No bank details yet"
              description="Add the bank, branch, account number and other details of your accounts. You can link each one to an account you already track in MONVEX."
              action={
                <button type="button" className="btn btn-primary" onClick={() => setForm({ open: true })}>
                  Add bank details
                </button>
              }
            />
          </div>
        ) : (
          <>
            {data.bankDetails.length > 2 && <SearchAndFilterBar query={query} onQuery={setQuery} placeholder="Search by name, bank or holder…" />}
            {items.length === 0 ? <p className="t-helper py-6 text-center">Nothing matches “{query}”.</p> : <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">{items.map(card)}</ul>}
          </>
        )}
      </div>

      <BankDetailsForm open={form.open} onClose={() => setForm({ open: false })} initial={form.initial} />
      {dialog}
    </>
  )
}
