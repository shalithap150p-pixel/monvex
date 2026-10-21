import { useState } from 'react'
import { useApp } from '../app/AppContext'
import type { PassThroughRec, TransferRec } from '../data/records'
import { passThroughUnresolved } from '../domain/ledger'
import { formatMoney, toDecimalString } from '../domain/money'
import { isValidDate } from '../domain/dates'
import { validateTransferInput } from '../domain/validation'
import { AccountSelector } from '../ui/Inputs'
import { AmountField, InlineNote, SelectField, TextAreaField, TextField } from '../ui/Primitives'
import { FormModal, NeedAccountNote, activeAccounts, currencyOf, parseField, useFormSubmit } from './shared'

/* ------------------------------------------------------------ internal transfer */

interface TransferProps {
  open: boolean
  onClose: () => void
  initial?: TransferRec
}

export function TransferForm(props: TransferProps) {
  if (!props.open) return null
  return <TransferInner {...props} />
}

function TransferInner({ onClose, initial }: TransferProps) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const active = activeAccounts(accounts)
  const [source, setSource] = useState(initial?.sourceAccountId ?? (active[0]?.id ?? ''))
  const [dest, setDest] = useState(initial?.destinationAccountId ?? '')
  const cur = currencyOf(accounts, source, currency)
  const [amount, setAmount] = useState(initial ? toDecimalString(initial.amount, cur) : '')
  const [fee, setFee] = useState(initial && initial.fee > 0 ? toDecimalString(initial.fee, cur) : '')
  const [date, setDate] = useState(initial?.date ?? today)
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const amountMinor = parseField(amount, cur)
    const feeMinor = fee.trim() ? parseField(fee, cur) : 0
    const e = validateTransferInput({ amount: amountMinor, fee: feeMinor ?? -1, date, sourceAccountId: source, destinationAccountId: dest })
    if (feeMinor === null) e.fee = 'Enter a valid fee or leave it empty.'
    if (source && dest && currencyOf(accounts, dest, currency) !== cur) e.destinationAccountId = 'Transfers between different currencies are not supported yet.'
    setErrors(e)
    if (Object.keys(e).length || amountMinor === null || feeMinor === null) return
    void run(
      () =>
        save('transfers', {
          id: initial?.id ?? id,
          sourceAccountId: source,
          destinationAccountId: dest,
          amount: amountMinor,
          fee: feeMinor,
          currency: cur,
          date,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }).then(() => undefined),
      'Transfer saved. It is not counted as income or expense.',
      onClose,
    )
  }

  return (
    <FormModal title={initial ? 'Edit transfer' : 'Transfer money'} description="Move money between your own accounts." onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <NeedAccountNote />
      <AccountSelector label="From account" value={source} onChange={setSource} accounts={accounts} error={errors.sourceAccountId} />
      <AccountSelector label="To account" value={dest} onChange={setDest} accounts={accounts} error={errors.destinationAccountId} exclude={source} />
      <AmountField label="Amount" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
      <AmountField label="Transfer fee (optional)" value={fee} onChange={setFee} currency={cur} error={errors.fee} helper="Charged to the source account and recorded as an expense." />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormModal>
  )
}

/* ------------------------------------------------------------ pass-through (money for others) */

interface PassProps {
  open: boolean
  onClose: () => void
  initial?: PassThroughRec
}

export function PassThroughForm(props: PassProps) {
  if (!props.open) return null
  return <PassInner {...props} />
}

function PassInner({ onClose, initial }: PassProps) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const active = activeAccounts(accounts)
  const [accountId, setAccountId] = useState(initial?.accountId ?? active[0]?.id ?? '')
  const cur = currencyOf(accounts, accountId, currency)
  const [sender, setSender] = useState(initial?.sender ?? '')
  const [recipient, setRecipient] = useState(initial?.recipient ?? '')
  const [destination, setDestination] = useState(initial?.destination ?? '')
  const [amount, setAmount] = useState(initial ? toDecimalString(initial.amount, cur) : '')
  const [receivedDate, setReceivedDate] = useState(initial?.receivedDate ?? today)
  const [status, setStatus] = useState<PassThroughRec['status']>(initial?.status ?? 'received')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const amountMinor = parseField(amount, cur)
    const e: Record<string, string> = {}
    if (amountMinor === null || amountMinor <= 0) e.amount = 'Enter an amount greater than zero.'
    if (!sender.trim()) e.sender = 'Who gave you this money?'
    if (!recipient.trim()) e.recipient = 'Who is it meant for?'
    if (!accountId) e.accountId = 'Choose where the money is held.'
    if (!isValidDate(receivedDate)) e.receivedDate = 'Enter a valid date.'
    setErrors(e)
    if (Object.keys(e).length || amountMinor === null) return
    void run(
      () =>
        save('passThroughs', {
          id: initial?.id ?? id,
          accountId,
          sender: sender.trim(),
          recipient: recipient.trim(),
          destination: destination.trim() || null,
          amount: amountMinor,
          currency: cur,
          receivedDate,
          status,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }).then(() => undefined),
      'Saved. This money is tracked separately and is not counted as your income.',
      onClose,
    )
  }

  return (
    <FormModal title={initial ? 'Edit money held for someone' : 'Money received for someone else'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <NeedAccountNote />
      <TextField label="Received from (sender)" value={sender} onChange={(e) => setSender(e.target.value)} error={errors.sender} />
      <TextField label="Intended recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} error={errors.recipient} />
      <TextField label="Intended destination (optional)" value={destination} onChange={(e) => setDestination(e.target.value)} helper="For example a bank account or branch." />
      <AccountSelector label="Where is the money held?" value={accountId} onChange={setAccountId} accounts={accounts} error={errors.accountId} />
      <AmountField label="Amount" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
      <TextField label="Date received" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} error={errors.receivedDate} />
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as PassThroughRec['status'])} helper="'Pending' means you do not hold the money yet, so balances are unchanged.">
        <option value="received">Received</option>
        <option value="pending">Pending (not received yet)</option>
        <option value="partially_transferred">Partially transferred</option>
        <option value="transferred">Transferred</option>
        <option value="confirmed">Confirmed by recipient</option>
        <option value="cancelled">Cancelled</option>
      </SelectField>
      <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormModal>
  )
}

/** Record forwarding some or all of the money. */
export function PassThroughLegForm({ open, onClose, pass }: { open: boolean; onClose: () => void; pass: PassThroughRec | null }) {
  if (!open || !pass) return null
  return <LegInner onClose={onClose} pass={pass} />
}

function LegInner({ onClose, pass }: { onClose: () => void; pass: PassThroughRec }) {
  const { data, today, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const full = data.ledger.passThroughs.find((p) => p.id === pass.id)
  const unresolved = full ? passThroughUnresolved(full) : 0
  const cur = pass.currency
  const [amount, setAmount] = useState(toDecimalString(unresolved, cur))
  const [fee, setFee] = useState('')
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const a = parseField(amount, cur)
    const f = fee.trim() ? parseField(fee, cur) : 0
    const e: Record<string, string> = {}
    if (a === null || a <= 0) e.amount = 'Enter an amount greater than zero.'
    else if (a > unresolved) e.amount = `Only ${formatMoney(unresolved, cur)} is left to transfer.`
    if (f === null || f < 0) e.fee = 'Enter a valid fee or leave it empty.'
    if (!isValidDate(date)) e.date = 'Enter a valid date.'
    setErrors(e)
    if (Object.keys(e).length || a === null || f === null) return
    void run(
      async () => {
        await save('passThroughLegs', { id, passThroughId: pass.id, amount: a, fee: f, currency: cur, date, reference: reference.trim() || null })
        const done = a >= unresolved
        await save('passThroughs', { ...pass, status: done ? 'transferred' : 'partially_transferred' })
      },
      'Transfer recorded.',
      onClose,
    )
  }

  return (
    <FormModal title={`Forward money to ${pass.recipient}`} description={`Still to transfer: ${formatMoney(unresolved, cur)}`} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel="Record transfer">
      <AmountField label="Amount sent now" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
      <AmountField label="Your transfer fee (optional)" value={fee} onChange={setFee} currency={cur} error={errors.fee} helper="Your own fee is an expense; the forwarded amount is not." />
      <TextField label="Transfer date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
      <InlineNote>Sending this money out does not count as your expense, and receiving it did not count as your income.</InlineNote>
    </FormModal>
  )
}
