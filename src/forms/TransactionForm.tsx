import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import type { TransactionRec } from '../data/records'
import { remainingAmount } from '../domain/bills'
import { advanceOutstanding } from '../domain/ledger'
import { formatMoney, toDecimalString } from '../domain/money'
import type { PaymentOccurrence, TransactionType } from '../domain/types'
import { validateTransactionInput } from '../domain/validation'
import { AccountSelector } from '../ui/Inputs'
import { AmountField, InlineNote, SelectField, TextAreaField, TextField } from '../ui/Primitives'
import { FormModal, NeedAccountNote, activeAccounts, currencyOf, parseField, useFormSubmit } from './shared'

interface Props {
  open: boolean
  onClose: () => void
  initial?: TransactionRec
  defaultType?: TransactionType
  /** Paying a bill occurrence pre-fills the form and links the payment. */
  occurrence?: PaymentOccurrence
  occurrenceName?: string
  defaultAccountId?: string | null
  /** Category pre-selected when paying a bill (the bill's own category). */
  defaultCategoryId?: string | null
}

export function TransactionForm(props: Props) {
  if (!props.open) return null
  return <Inner {...props} />
}

function Inner({ onClose, initial, defaultType = 'expense', occurrence, occurrenceName, defaultAccountId, defaultCategoryId }: Props) {
  const { data, today, currency, save, remove, db } = useApp()
  const { busy, error, run, id: newId } = useFormSubmit()
  const accounts = data.ledger.accounts
  const editing = Boolean(initial)
  const recordId = initial?.id ?? newId

  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType)
  const [accountId, setAccountId] = useState(initial?.accountId ?? defaultAccountId ?? (activeAccounts(accounts).length === 1 ? activeAccounts(accounts)[0].id : ''))
  const cur = currencyOf(accounts, accountId, currency)
  const [amount, setAmount] = useState(
    initial ? toDecimalString(initial.amount, initial.currency) : occurrence ? toDecimalString(remainingAmount(occurrence), cur) : '',
  )
  const [date, setDate] = useState(initial?.date ?? today)
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaultCategoryId ?? '')
  const [description, setDescription] = useState(initial?.description ?? occurrenceName ?? '')
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [pending, setPending] = useState(initial?.status === 'pending')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Salary deductions: only offered for income when advances are still outstanding.
  const outstandingAdvances = useMemo(
    () => data.ledger.advances.filter((a) => advanceOutstanding(a, data.ledger.transactions.filter((t) => t.id !== recordId)) > 0),
    [data.ledger.advances, data.ledger.transactions, recordId],
  )
  const [deductions, setDeductions] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    const existing = data.ledger.transactions.find((t) => t.id === initial?.id)
    for (const d of existing?.payrollDeductions ?? []) out[d.advanceId] = toDecimalString(d.amount, cur)
    return out
  })

  const categories = data.categories.filter((c) => c.type === type)

  const submit = () => {
    const amountMinor = parseField(amount, cur)
    const e = validateTransactionInput({ amount: amountMinor, date, accountId, description })
    const parsedDeductions: { advanceId: string; amount: number }[] = []
    if (type === 'income') {
      for (const a of outstandingAdvances) {
        const raw = deductions[a.id]
        if (!raw?.trim()) continue
        const v = parseField(raw, cur)
        const outstanding = advanceOutstanding(a, data.ledger.transactions.filter((t) => t.id !== recordId))
        if (v === null || v <= 0) e[`ded-${a.id}`] = 'Enter a valid deduction amount.'
        else if (v > outstanding) e[`ded-${a.id}`] = `Cannot exceed the outstanding ${formatMoney(outstanding, cur)}.`
        else parsedDeductions.push({ advanceId: a.id, amount: v })
      }
    }
    if (occurrence && amountMinor !== null) {
      const alreadyByThis = initial ? initial.amount : 0
      const remaining = remainingAmount(occurrence) + alreadyByThis
      if (amountMinor > remaining) e.amount = `This bill only has ${formatMoney(remaining, cur)} left to pay.`
    }
    setErrors(e)
    if (Object.keys(e).length > 0 || amountMinor === null) return

    void run(
      async () => {
        await save('transactions', {
          id: recordId,
          type,
          accountId,
          amount: amountMinor,
          currency: cur,
          date,
          categoryId: categoryId || null,
          description: description.trim(),
          counterparty: counterparty.trim() || null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          status: pending ? 'pending' : 'posted',
          occurrenceId: occurrence?.id ?? initial?.occurrenceId ?? null,
        })
        // Replace payroll deductions for this transaction.
        const old = await db.payrollDeductions.where('transactionId').equals(recordId).toArray()
        for (const o of old) if (!o.deletedAt) await remove('payrollDeductions', o.id)
        if (type === 'income') {
          for (const d of parsedDeductions) {
            await save('payrollDeductions', { id: crypto.randomUUID(), transactionId: recordId, advanceId: d.advanceId, amount: d.amount, currency: cur })
          }
        }
      },
      editing ? 'Transaction updated. Balances were recalculated.' : 'Transaction saved.',
      onClose,
    )
  }

  const title = occurrence ? `Pay bill: ${occurrenceName ?? ''}` : editing ? 'Edit transaction' : type === 'income' ? 'Add income' : 'Add expense'

  return (
    <FormModal title={title} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <NeedAccountNote />
      {!occurrence && (
        <fieldset className="m-0 flex gap-2 border-0 p-0">
          <legend className="mb-1.5 text-sm font-medium">Type</legend>
          {(['expense', 'income'] as const).map((t) => (
            <label
              key={t}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-[10px] border text-sm font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text ${editing && initial?.type !== t ? 'hidden' : ''} border-border-strong`}
              style={{ borderColor: 'var(--border-strong)' }}
            >
              <input
                type="radio"
                name="type"
                value={t}
                className="sr-only"
                checked={type === t}
                onChange={() => {
                  setType(t)
                  setCategoryId('')
                }}
                disabled={editing}
              />
              {t === 'expense' ? 'Expense' : 'Income'}
            </label>
          ))}
        </fieldset>
      )}
      <AmountField label="Amount" value={amount} onChange={setAmount} currency={cur} error={errors.amount} autoFocus />
      <AccountSelector value={accountId} onChange={setAccountId} accounts={accounts} error={errors.accountId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} maxLength={140} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={type === 'income' ? 'Payer (optional)' : 'Payee (optional)'} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        <TextField label="Reference code (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={pending} onChange={(e) => setPending(e.target.checked)} />
        <span>
          Not yet completed (pending)
          <span className="t-helper block">Pending records do not change account balances.</span>
        </span>
      </label>

      {type === 'income' && outstandingAdvances.length > 0 && (
        <fieldset className="m-0 rounded-[10px] border border-border p-3">
          <legend className="px-1 text-sm font-medium">Salary advance deductions (optional)</legend>
          <p className="t-helper mb-3">
            If part of this salary was withheld to recover an earlier advance, enter it here. The earned salary is counted as income once; the advance is not counted again.
          </p>
          <div className="flex flex-col gap-3">
            {outstandingAdvances.map((a) => (
              <AmountField
                key={a.id}
                label={`${a.employer} — outstanding ${formatMoney(advanceOutstanding(a, data.ledger.transactions.filter((t) => t.id !== recordId)), cur)}`}
                value={deductions[a.id] ?? ''}
                onChange={(v) => setDeductions((d) => ({ ...d, [a.id]: v }))}
                currency={cur}
                error={errors[`ded-${a.id}`]}
              />
            ))}
          </div>
        </fieldset>
      )}
      {occurrence && <InlineNote>This payment will be linked to the bill so it is no longer counted as unpaid in forecasts.</InlineNote>}
    </FormModal>
  )
}
