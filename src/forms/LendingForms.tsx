import { useState } from 'react'
import { useApp } from '../app/AppContext'
import type { DebtRec, LoanRec } from '../data/records'
import { debtOutstanding, receivableOutstanding } from '../domain/ledger'
import { formatMoney, toDecimalString } from '../domain/money'
import { isValidDate } from '../domain/dates'
import { AccountSelector } from '../ui/Inputs'
import { AmountField, InlineNote, TextAreaField, TextField } from '../ui/Primitives'
import { FormModal, NeedAccountNote, activeAccounts, currencyOf, parseField, useFormSubmit } from './shared'

/* ------------------------------------------------------------ money lent */

export function LoanForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: LoanRec }) {
  if (!open) return null
  return <LoanInner onClose={onClose} initial={initial} />
}

function LoanInner({ onClose, initial }: { onClose: () => void; initial?: LoanRec }) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const [borrower, setBorrower] = useState(initial?.borrower ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? activeAccounts(accounts)[0]?.id ?? '')
  const cur = currencyOf(accounts, accountId, currency)
  const [principal, setPrincipal] = useState(initial ? toDecimalString(initial.principal, cur) : '')
  const [lentDate, setLentDate] = useState(initial?.lentDate ?? today)
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const p = parseField(principal, cur)
    const e: Record<string, string> = {}
    if (!borrower.trim()) e.borrower = 'Who did you lend to?'
    if (p === null || p <= 0) e.principal = 'Enter an amount greater than zero.'
    if (!accountId) e.accountId = 'Choose the account the money came from.'
    if (!isValidDate(lentDate)) e.lentDate = 'Enter a valid date.'
    if (dueDate && !isValidDate(dueDate)) e.dueDate = 'Enter a valid date or leave it empty.'
    if (dueDate && lentDate && dueDate < lentDate) e.dueDate = 'The due date cannot be before the date lent.'
    setErrors(e)
    if (Object.keys(e).length || p === null) return
    void run(
      () =>
        save('loans', {
          id: initial?.id ?? id,
          borrower: borrower.trim(),
          accountId,
          principal: p,
          currency: cur,
          lentDate,
          dueDate: dueDate || null,
          writtenOff: initial?.writtenOff ?? 0,
          notes: notes.trim() || null,
        }).then(() => undefined),
      'Saved. The amount lent is tracked as a receivable, not as an expense.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit loan' : 'Record money lent'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <NeedAccountNote />
      <TextField label="Borrower" value={borrower} onChange={(e) => setBorrower(e.target.value)} error={errors.borrower} />
      <AccountSelector label="Paid from account" value={accountId} onChange={setAccountId} accounts={accounts} error={errors.accountId} />
      <AmountField label="Amount lent" value={principal} onChange={setPrincipal} currency={cur} error={errors.principal} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date lent" type="date" value={lentDate} onChange={(e) => setLentDate(e.target.value)} error={errors.lentDate} />
        <TextField label="Expected repayment date (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
      </div>
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <InlineNote>Money you lend leaves your account now, but it is not available cash again until it is repaid.</InlineNote>
    </FormModal>
  )
}

export function LoanRepaymentForm({ open, onClose, loan }: { open: boolean; onClose: () => void; loan: LoanRec | null }) {
  if (!open || !loan) return null
  return <LoanRepayInner onClose={onClose} loan={loan} />
}

function LoanRepayInner({ onClose, loan }: { onClose: () => void; loan: LoanRec }) {
  const { data, today, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const full = data.ledger.loans.find((l) => l.id === loan.id)
  const outstanding = full ? receivableOutstanding(full) : 0
  const cur = loan.currency
  const [amount, setAmount] = useState(toDecimalString(outstanding, cur))
  const [accountId, setAccountId] = useState(loan.accountId)
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const a = parseField(amount, cur)
    const e: Record<string, string> = {}
    if (a === null || a <= 0) e.amount = 'Enter an amount greater than zero.'
    else if (a > outstanding) e.amount = `Only ${formatMoney(outstanding, cur)} is still outstanding.`
    if (!accountId) e.accountId = 'Choose the account that received the money.'
    if (!isValidDate(date)) e.date = 'Enter a valid date.'
    setErrors(e)
    if (Object.keys(e).length || a === null) return
    void run(
      () => save('loanRepayments', { id, loanId: loan.id, accountId, amount: a, currency: cur, date, reference: reference.trim() || null }).then(() => undefined),
      'Repayment recorded. It is not counted as income.',
      onClose,
    )
  }
  return (
    <FormModal title={`Repayment from ${loan.borrower}`} description={`Outstanding: ${formatMoney(outstanding, cur)}`} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel="Record repayment">
      <AmountField label="Amount received" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
      <AccountSelector label="Received into" value={accountId} onChange={setAccountId} accounts={data.ledger.accounts} error={errors.accountId} />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
    </FormModal>
  )
}

/* ------------------------------------------------------------ money owed */

export function DebtForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: DebtRec }) {
  if (!open) return null
  return <DebtInner onClose={onClose} initial={initial} />
}

function DebtInner({ onClose, initial }: { onClose: () => void; initial?: DebtRec }) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const [creditor, setCreditor] = useState(initial?.creditor ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? activeAccounts(accounts)[0]?.id ?? '')
  const cur = currencyOf(accounts, accountId, currency)
  const [principal, setPrincipal] = useState(initial ? toDecimalString(initial.principal, cur) : '')
  const [borrowedDate, setBorrowedDate] = useState(initial?.borrowedDate ?? today)
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const p = parseField(principal, cur)
    const e: Record<string, string> = {}
    if (!creditor.trim()) e.creditor = 'Who did you borrow from?'
    if (p === null || p <= 0) e.principal = 'Enter an amount greater than zero.'
    if (!accountId) e.accountId = 'Choose the account that received the money.'
    if (!isValidDate(borrowedDate)) e.borrowedDate = 'Enter a valid date.'
    if (dueDate && !isValidDate(dueDate)) e.dueDate = 'Enter a valid date or leave it empty.'
    setErrors(e)
    if (Object.keys(e).length || p === null) return
    void run(
      () =>
        save('debts', {
          id: initial?.id ?? id,
          creditor: creditor.trim(),
          accountId,
          principal: p,
          currency: cur,
          borrowedDate,
          dueDate: dueDate || null,
          notes: notes.trim() || null,
        }).then(() => undefined),
      'Saved. Borrowed money is a debt, not income.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit debt' : 'Record money borrowed'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <NeedAccountNote />
      <TextField label="Lender / creditor" value={creditor} onChange={(e) => setCreditor(e.target.value)} error={errors.creditor} />
      <AccountSelector label="Received into" value={accountId} onChange={setAccountId} accounts={accounts} error={errors.accountId} />
      <AmountField label="Amount borrowed" value={principal} onChange={setPrincipal} currency={cur} error={errors.principal} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Date borrowed" type="date" value={borrowedDate} onChange={(e) => setBorrowedDate(e.target.value)} error={errors.borrowedDate} />
        <TextField label="Due date (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
      </div>
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormModal>
  )
}

export function DebtRepaymentForm({ open, onClose, debt }: { open: boolean; onClose: () => void; debt: DebtRec | null }) {
  if (!open || !debt) return null
  return <DebtRepayInner onClose={onClose} debt={debt} />
}

function DebtRepayInner({ onClose, debt }: { onClose: () => void; debt: DebtRec }) {
  const { data, today, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const full = data.ledger.debts.find((d) => d.id === debt.id)
  const outstanding = full ? debtOutstanding(full) : 0
  const cur = debt.currency
  const [principal, setPrincipal] = useState(toDecimalString(outstanding, cur))
  const [interest, setInterest] = useState('')
  const [accountId, setAccountId] = useState(debt.accountId)
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const p = principal.trim() ? parseField(principal, cur) : 0
    const i = interest.trim() ? parseField(interest, cur) : 0
    const e: Record<string, string> = {}
    if (p === null || p < 0) e.principal = 'Enter a valid amount.'
    else if (p > outstanding) e.principal = `Only ${formatMoney(outstanding, cur)} of principal is outstanding.`
    if (i === null || i < 0) e.interest = 'Enter a valid amount or leave it empty.'
    if (p !== null && i !== null && p + i <= 0) e.principal = 'Enter a principal or interest amount.'
    if (!accountId) e.accountId = 'Choose the account you paid from.'
    if (!isValidDate(date)) e.date = 'Enter a valid date.'
    setErrors(e)
    if (Object.keys(e).length || p === null || i === null) return
    void run(
      () =>
        save('debtRepayments', { id, debtId: debt.id, accountId, principalPart: p, interestPart: i, currency: cur, date, reference: reference.trim() || null }).then(() => undefined),
      'Repayment recorded. Only interest and fees count as an expense.',
      onClose,
    )
  }
  return (
    <FormModal title={`Repay ${debt.creditor}`} description={`Principal outstanding: ${formatMoney(outstanding, cur)}`} onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel="Record repayment">
      <AmountField label="Principal repaid" value={principal} onChange={setPrincipal} currency={cur} error={errors.principal} />
      <AmountField label="Interest / fees paid (optional)" value={interest} onChange={setInterest} currency={cur} error={errors.interest} helper="Recorded as an expense. Principal is not." />
      <AccountSelector label="Paid from" value={accountId} onChange={setAccountId} accounts={data.ledger.accounts} error={errors.accountId} />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
    </FormModal>
  )
}
