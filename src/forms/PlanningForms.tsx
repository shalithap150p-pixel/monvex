import { useState } from 'react'
import { useApp } from '../app/AppContext'
import type { AccountRec, AdvanceRec, BudgetRec, GoalRec, ObligationRec } from '../data/records'
import { isValidDate, monthKey } from '../domain/dates'
import { formatMoney, toDecimalString } from '../domain/money'
import type { AccountType, AdvanceKind, Frequency, GoalPriority } from '../domain/types'
import { AccountSelector } from '../ui/Inputs'
import { AmountField, CheckboxField, InlineNote, SelectField, TextAreaField, TextField } from '../ui/Primitives'
import { FormModal, NeedAccountNote, activeAccounts, currencyOf, parseField, useFormSubmit } from './shared'

/* ------------------------------------------------------------ account */

export function AccountForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: AccountRec }) {
  if (!open) return null
  return <AccountInner onClose={onClose} initial={initial} />
}

function AccountInner({ onClose, initial }: { onClose: () => void; initial?: AccountRec }) {
  const { currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<AccountType>(initial?.type ?? 'bank')
  const [cur, setCur] = useState(initial?.currency ?? currency)
  const [opening, setOpening] = useState(initial ? toDecimalString(initial.openingBalance, initial.currency) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    const o = opening.trim() ? parseField(opening, cur) : 0
    if (!name.trim()) e.name = 'Give the account a name.'
    if (o === null) e.opening = 'Enter a valid amount or leave it empty.'
    if (!/^[A-Za-z]{3}$/.test(cur)) e.currency = 'Use a 3-letter currency code such as LKR.'
    setErrors(e)
    if (Object.keys(e).length || o === null) return
    void run(
      () =>
        save('accounts', {
          id: initial?.id ?? id,
          name: name.trim(),
          type,
          currency: cur.toUpperCase(),
          openingBalance: o,
          confirmedBalance: initial?.confirmedBalance ?? null,
          lastReconciledAt: initial?.lastReconciledAt ?? null,
          archived: initial?.archived ?? false,
        }).then(() => undefined),
      initial ? 'Account updated. Balances were recalculated.' : 'Account created.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit account' : 'New account'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <TextField label="Account name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. Cash on hand" />
      <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
        <option value="cash">Cash</option>
        <option value="bank">Bank account</option>
        <option value="wallet">E-wallet</option>
        <option value="other">Other</option>
      </SelectField>
      <TextField label="Currency" value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} error={errors.currency} disabled={Boolean(initial)} helper={initial ? 'Currency cannot change after creation.' : undefined} />
      <AmountField label="Opening balance" value={opening} onChange={setOpening} currency={cur} error={errors.opening} helper="The balance when you start tracking. It is a starting value, not income." />
    </FormModal>
  )
}

export function ReconcileForm({ open, onClose, account, calculated }: { open: boolean; onClose: () => void; account: AccountRec | null; calculated: number }) {
  if (!open || !account) return null
  return <ReconcileInner onClose={onClose} account={account} calculated={calculated} />
}

function ReconcileInner({ onClose, account, calculated }: { onClose: () => void; account: AccountRec; calculated: number }) {
  const { today, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const cur = account.currency
  const [statement, setStatement] = useState(toDecimalString(account.confirmedBalance ?? calculated, cur))
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const parsed = parseField(statement, cur)
  const diff = parsed === null ? null : parsed - calculated

  const submit = () => {
    if (parsed === null) return setErr('Enter the balance shown by your bank or wallet.')
    if (!isValidDate(date)) return setErr('Enter a valid date.')
    setErr('')
    void run(
      async () => {
        await save('reconciliations', { id, accountId: account.id, statementBalance: parsed, appBalance: calculated, currency: cur, date, notes: notes.trim() || null })
        await save('accounts', { ...account, confirmedBalance: parsed, lastReconciledAt: date })
      },
      parsed === calculated ? 'Balance confirmed — it matches.' : 'Reconciliation saved with the difference recorded.',
      onClose,
    )
  }
  return (
    <FormModal title={`Reconcile ${account.name}`} description="Compare MONVEX's calculated balance with the real balance." onClose={onClose} onSubmit={submit} busy={busy} error={error} submitLabel="Save reconciliation">
      <div className="card !p-3 text-sm">
        Calculated balance: <strong className="amount">{formatMoney(calculated, cur)}</strong>
      </div>
      <AmountField label="Balance shown by the bank / wallet" value={statement} onChange={setStatement} currency={cur} error={err} />
      {diff !== null && (
        <InlineNote tone={diff === 0 ? 'positive' : 'warning'}>
          {diff === 0 ? 'No difference — the balances match.' : `Difference: ${formatMoney(diff, cur, { signed: true })}. Check for missing or duplicate transactions.`}
        </InlineNote>
      )}
      <TextField label="Statement date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormModal>
  )
}

/* ------------------------------------------------------------ bill / subscription */

export function BillForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: ObligationRec }) {
  if (!open) return null
  return <BillInner onClose={onClose} initial={initial} />
}

function BillInner({ onClose, initial }: { onClose: () => void; initial?: ObligationRec }) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const [name, setName] = useState(initial?.name ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? activeAccounts(accounts)[0]?.id ?? '')
  const cur = currencyOf(accounts, accountId, currency)
  const [amount, setAmount] = useState(initial ? toDecimalString(initial.amount, cur) : '')
  const [estimate, setEstimate] = useState(initial?.isEstimate ?? false)
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? today)
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [reminder, setReminder] = useState(String(initial?.reminderDays ?? 3))
  const [essential, setEssential] = useState(initial?.essential ?? true)
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const expenseCategories = data.categories.filter((c) => c.type === 'expense')

  const submit = () => {
    const a = parseField(amount, cur)
    const r = Number(reminder)
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name this bill.'
    if (a === null || a <= 0) e.amount = 'Enter an amount greater than zero.'
    if (!isValidDate(dueDate)) e.dueDate = 'Enter a valid due date.'
    if (endDate && (!isValidDate(endDate) || endDate < dueDate)) e.endDate = 'The end date must be on or after the first due date.'
    if (!Number.isInteger(r) || r < 0 || r > 90) e.reminder = 'Use a whole number of days between 0 and 90.'
    setErrors(e)
    if (Object.keys(e).length || a === null) return
    void run(
      () =>
        save('obligations', {
          id: initial?.id ?? id,
          name: name.trim(),
          amount: a,
          isEstimate: estimate,
          currency: cur,
          frequency,
          dueDate,
          endDate: endDate || null,
          accountId: accountId || null,
          categoryId: categoryId || null,
          reminderDays: r,
          essential,
          active: initial?.active ?? true,
          notes: notes.trim() || null,
        }).then(() => undefined),
      initial ? 'Bill updated. Past paid periods were not changed.' : 'Bill added.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit bill' : 'Add bill or subscription'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. House rent" />
      <AmountField label="Amount" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
      <CheckboxField label="This amount is an estimate" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} helper="Forecasts will label it as expected rather than confirmed." />
      <SelectField label="Repeats" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
        <option value="once">One time</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Every 3 months</option>
        <option value="yearly">Yearly</option>
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        <TextField label="Ends on (optional)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} disabled={frequency === 'once'} />
      </div>
      <AccountSelector label="Pay from (optional)" value={accountId} onChange={setAccountId} accounts={accounts} allowEmpty emptyLabel="Not decided" />
      <SelectField label="Category (optional)" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} helper="If this category has a monthly budget, the bill counts inside that budget, so the same money is never reserved twice.">
        <option value="">No category</option>
        {expenseCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextField label="Remind me (days before)" type="number" min={0} max={90} value={reminder} onChange={(e) => setReminder(e.target.value)} error={errors.reminder} />
      <CheckboxField label="Essential" checked={essential} onChange={(e) => setEssential(e.target.checked)} helper="Essential bills are listed first in Safe-to-Spend." />
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <InlineNote>MONVEX never pays a bill or cancels a subscription for you. It only tracks it.</InlineNote>
    </FormModal>
  )
}

/* ------------------------------------------------------------ salary advance */

export function AdvanceForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: AdvanceRec }) {
  if (!open) return null
  return <AdvanceInner onClose={onClose} initial={initial} />
}

function AdvanceInner({ onClose, initial }: { onClose: () => void; initial?: AdvanceRec }) {
  const { data, today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const accounts = data.ledger.accounts
  const [employer, setEmployer] = useState(initial?.employer ?? '')
  const [kind, setKind] = useState<AdvanceKind>(initial?.kind ?? 'advance')
  const [accountId, setAccountId] = useState(initial?.accountId ?? activeAccounts(accounts)[0]?.id ?? '')
  const cur = currencyOf(accounts, accountId, currency)
  const [amount, setAmount] = useState(initial ? toDecimalString(initial.amount, cur) : '')
  const [date, setDate] = useState(initial?.date ?? today)
  const [status, setStatus] = useState<AdvanceRec['status']>(initial?.status ?? 'received')
  const [rows, setRows] = useState<{ month: string; amount: string }[]>(
    initial?.schedule.map((s) => ({ month: s.month, amount: toDecimalString(s.amount, cur) })) ?? [],
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const a = parseField(amount, cur)
    const e: Record<string, string> = {}
    if (!employer.trim()) e.employer = 'Enter your employer.'
    if (a === null || a <= 0) e.amount = 'Enter an amount greater than zero.'
    if (!accountId) e.accountId = 'Choose the receiving account.'
    if (!isValidDate(date)) e.date = 'Enter a valid date.'
    const schedule: { month: string; amount: number }[] = []
    let scheduled = 0
    rows.forEach((r, i) => {
      if (!r.month && !r.amount) return
      const v = parseField(r.amount, cur)
      if (!/^\d{4}-\d{2}$/.test(r.month)) e[`m${i}`] = 'Choose a month.'
      else if (v === null || v <= 0) e[`m${i}`] = 'Enter a valid deduction.'
      else {
        schedule.push({ month: r.month, amount: v })
        scheduled += v
      }
    })
    if (a !== null && scheduled > a) e.schedule = 'Scheduled deductions are more than the advance.'
    if (new Set(schedule.map((s) => s.month)).size !== schedule.length) e.schedule = 'Each month can appear only once.'
    setErrors(e)
    if (Object.keys(e).length || a === null) return
    void run(
      () =>
        save('advances', {
          id: initial?.id ?? id,
          employer: employer.trim(),
          kind,
          accountId,
          amount: a,
          currency: cur,
          date,
          status,
          schedule: schedule.sort((x, y) => x.month.localeCompare(y.month)),
          payrollMonth: schedule[0]?.month ?? initial?.payrollMonth ?? null,
          notes: notes.trim() || null,
        }).then(() => undefined),
      status === 'received' ? 'Advance saved. It is not counted as new income.' : 'Advance saved as pending. Balances are unchanged until it is received.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit salary advance' : 'Record salary advance'} onClose={onClose} onSubmit={submit} busy={busy} error={error} size="lg">
      <NeedAccountNote />
      <TextField label="Employer" value={employer} onChange={(e) => setEmployer(e.target.value)} error={errors.employer} />
      <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as AdvanceKind)} helper={kind === 'advance' ? 'An early part of an upcoming salary.' : 'A separate loan from your employer, repaid over several months.'}>
        <option value="advance">Advance against upcoming salary</option>
        <option value="employer_loan">Employer loan (repaid over months)</option>
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField label="Amount" value={amount} onChange={setAmount} currency={cur} error={errors.amount} />
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
      </div>
      <AccountSelector label="Receiving account" value={accountId} onChange={setAccountId} accounts={accounts} error={errors.accountId} />
      <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as AdvanceRec['status'])} helper="A pending advance does not change your balances.">
        <option value="received">Received</option>
        <option value="pending">Pending (requested)</option>
        <option value="cancelled">Cancelled</option>
      </SelectField>
      <fieldset className="m-0 rounded-[10px] border border-border p-3">
        <legend className="px-1 text-sm font-medium">Payroll deduction schedule</legend>
        <p className="t-helper mb-3">Choose which payroll months the deductions apply to. Nothing is assumed.</p>
        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <TextField label={`Month ${i + 1}`} type="month" value={r.month} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} error={errors[`m${i}`]} />
              <AmountField label="Deduction" value={r.amount} currency={cur} onChange={(v) => setRows((l) => l.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              <button type="button" className="btn btn-ghost btn-sm mb-1" onClick={() => setRows((l) => l.filter((_, j) => j !== i))} aria-label={`Remove deduction month ${i + 1}`}>
                Remove
              </button>
            </div>
          ))}
        </div>
        {errors.schedule && <p className="mt-2 text-sm text-negative" role="alert">{errors.schedule}</p>}
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setRows((l) => [...l, { month: monthKey(today), amount: '' }])}>
          Add deduction month
        </button>
      </fieldset>
      <TextAreaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
    </FormModal>
  )
}

/* ------------------------------------------------------------ budget & goals */

export function BudgetForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: BudgetRec }) {
  if (!open) return null
  return <BudgetInner onClose={onClose} initial={initial} />
}

function BudgetInner({ onClose, initial }: { onClose: () => void; initial?: BudgetRec }) {
  const { data, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const used = new Set(data.budgets.filter((b) => b.id !== initial?.id).map((b) => b.categoryId))
  const options = data.categories.filter((c) => c.type === 'expense' && !used.has(c.id))
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? options[0]?.id ?? '')
  const [limit, setLimit] = useState(initial ? toDecimalString(initial.limit, currency) : '')
  const [threshold, setThreshold] = useState(String(initial?.alertThresholdPct ?? 80))
  const [essential, setEssential] = useState(initial?.essential ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const l = parseField(limit, currency)
    const t = Number(threshold)
    const e: Record<string, string> = {}
    if (!categoryId) e.category = 'Choose a category.'
    if (l === null || l <= 0) e.limit = 'Enter a limit greater than zero.'
    if (!Number.isInteger(t) || t < 1 || t > 100) e.threshold = 'Use a whole number from 1 to 100.'
    setErrors(e)
    if (Object.keys(e).length || l === null) return
    void run(
      () => save('budgets', { id: initial?.id ?? id, categoryId, period: 'monthly', limit: l, currency, alertThresholdPct: t, essential }).then(() => undefined),
      'Budget saved.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit budget' : 'New monthly budget'} onClose={onClose} onSubmit={submit} busy={busy} error={error} size="sm">
      <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} error={errors.category} disabled={Boolean(initial)}>
        {initial && !options.some((o) => o.id === initial.categoryId) && <option value={initial.categoryId}>{data.categories.find((c) => c.id === initial.categoryId)?.name}</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <AmountField label="Monthly limit" value={limit} onChange={setLimit} currency={currency} error={errors.limit} />
      <TextField label="Alert at (% of limit)" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} error={errors.threshold} />
      <CheckboxField label="Essential spending" checked={essential} onChange={(e) => setEssential(e.target.checked)} helper="Food, transport and similar. An essential budget covers part of your daily essentials amount, so it is not reserved twice." />
    </FormModal>
  )
}

export function GoalForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: GoalRec }) {
  if (!open) return null
  return <GoalInner onClose={onClose} initial={initial} />
}

function GoalInner({ onClose, initial }: { onClose: () => void; initial?: GoalRec }) {
  const { data, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const [name, setName] = useState(initial?.name ?? '')
  const [target, setTarget] = useState(initial ? toDecimalString(initial.target, currency) : '')
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? '')
  const [reserve, setReserve] = useState(initial?.reserveInSafeToSpend ?? false)
  const [priority, setPriority] = useState<GoalPriority>(initial?.priority ?? 'medium')
  const [monthly, setMonthly] = useState(initial?.monthlyContribution ? toDecimalString(initial.monthlyContribution, currency) : '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const t = parseField(target, currency)
    const m = monthly.trim() ? parseField(monthly, currency) : 0
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name this goal.'
    if (t === null || t <= 0) e.target = 'Enter a target greater than zero.'
    if (targetDate && !isValidDate(targetDate)) e.targetDate = 'Enter a valid date.'
    if (m === null || m < 0) e.monthly = 'Enter a valid amount or leave it empty.'
    setErrors(e)
    if (Object.keys(e).length || t === null || m === null) return
    void run(
      () =>
        save('goals', {
          id: initial?.id ?? id,
          name: name.trim(),
          target: t,
          currency,
          targetDate: targetDate || null,
          accountId: accountId || null,
          // An approved monthly amount only makes sense as a reserved amount.
          reserveInSafeToSpend: reserve || m > 0,
          priority,
          monthlyContribution: m,
        }).then(() => undefined),
      'Goal saved.',
      onClose,
    )
  }
  return (
    <FormModal title={initial ? 'Edit savings goal' : 'New savings goal'} onClose={onClose} onSubmit={submit} busy={busy} error={error}>
      <TextField label="Goal name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <AmountField label="Target amount" value={target} onChange={setTarget} currency={currency} error={errors.target} />
      <TextField label="Target date (optional)" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} error={errors.targetDate} />
      <SelectField label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)} helper="Higher priority goals get a larger share of the suggested monthly savings.">
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </SelectField>
      <AmountField label="Approved monthly savings (optional)" value={monthly} onChange={setMonthly} currency={currency} error={errors.monthly} helper="Set aside in Safe-to-Spend every month. MONVEX never moves money. Leave empty to use the suggestion on the Budgets page." />
      <AccountSelector label="Held in account (optional)" value={accountId} onChange={setAccountId} accounts={data.ledger.accounts} allowEmpty emptyLabel="Not assigned" />
      <CheckboxField label="Reserve this goal in Safe-to-Spend" checked={reserve} onChange={(e) => setReserve(e.target.checked)} helper="When on, the allocated amount is set aside and not offered as spendable money." />
    </FormModal>
  )
}

export function AllocationForm({ open, onClose, goal, defaultAmount }: { open: boolean; onClose: () => void; goal: GoalRec | null; defaultAmount?: number }) {
  if (!open || !goal) return null
  return <AllocInner onClose={onClose} goal={goal} defaultAmount={defaultAmount} />
}

function AllocInner({ onClose, goal, defaultAmount }: { onClose: () => void; goal: GoalRec; defaultAmount?: number }) {
  const { today, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const [amount, setAmount] = useState(defaultAmount ? toDecimalString(defaultAmount, currency) : '')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    const a = parseField(amount, currency)
    if (a === null || a === 0) return setErr('Enter an amount. Use a negative amount to withdraw.')
    setErr('')
    void run(
      () => save('allocations', { id, goalId: goal.id, accountId: goal.accountId ?? null, amount: a, currency, date, note: note.trim() || null }).then(() => undefined),
      'Allocation saved. It does not change any account balance.',
      onClose,
    )
  }
  return (
    <FormModal title={`Allocate to ${goal.name}`} onClose={onClose} onSubmit={submit} busy={busy} error={error} size="sm">
      <AmountField label="Amount" value={amount} onChange={setAmount} currency={currency} error={err} helper="Allocations track progress only. They are not expenses." />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </FormModal>
  )
}
