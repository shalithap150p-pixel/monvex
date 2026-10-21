import { HandCoins, Handshake, Plus, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../app/AppContext'
import { useLookups } from '../app/FinanceCards'
import { DebtForm, DebtRepaymentForm, LoanForm, LoanRepaymentForm } from '../forms/LendingForms'
import type { DebtRec, LoanRec } from '../data/records'
import { debtOutstanding, receivableOutstanding } from '../domain/ledger'
import { diffDays } from '../domain/dates'
import { formatMoney, sum } from '../domain/money'
import type { LoanReceivable, PersonalDebt } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { CurrencyAmount, InlineNote, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

function dueBadge(due: string | null | undefined, today: string, open: boolean) {
  if (!due || !open) return null
  const left = diffDays(due, today)
  if (left < 0) return <StatusBadge tone="negative" label={`Overdue by ${-left} days`} />
  if (left <= 7) return <StatusBadge tone="warning" label={left === 0 ? 'Due today' : `Due in ${left} days`} />
  return <StatusBadge tone="neutral" label={`Due ${due}`} />
}

export default function Debts() {
  const { data, db, today, currency, save, remove } = useApp()
  const { accountName } = useLookups()
  const { ask, dialog } = useConfirm()

  const [loanForm, setLoanForm] = useState<{ open: boolean; initial?: LoanRec }>({ open: false })
  const [debtForm, setDebtForm] = useState<{ open: boolean; initial?: DebtRec }>({ open: false })
  const [loanRepay, setLoanRepay] = useState<LoanRec | null>(null)
  const [debtRepay, setDebtRepay] = useState<DebtRec | null>(null)

  const { loans, debts } = data.ledger
  const owedToMe = sum(loans.map(receivableOutstanding))
  const iOwe = sum(debts.map(debtOutstanding))

  const loanRec = async (l: LoanReceivable) => (await db.loans.get(l.id)) as LoanRec
  const debtRec = async (d: PersonalDebt) => (await db.debts.get(d.id)) as DebtRec

  const delLoan = (l: LoanReceivable) =>
    ask({
      title: `Delete loan to ${l.borrower}?`,
      message: 'The loan and its repayments will be removed and account balances recalculated.',
      success: 'Loan deleted.',
      run: async () => {
        for (const r of await db.loanRepayments.where('loanId').equals(l.id).toArray()) if (!r.deletedAt) await remove('loanRepayments', r.id)
        await remove('loans', l.id)
      },
    })
  const delDebt = (d: PersonalDebt) =>
    ask({
      title: `Delete debt to ${d.creditor}?`,
      message: 'The debt and its repayments will be removed and account balances recalculated.',
      success: 'Debt deleted.',
      run: async () => {
        for (const r of await db.debtRepayments.where('debtId').equals(d.id).toArray()) if (!r.deletedAt) await remove('debtRepayments', r.id)
        await remove('debts', d.id)
      },
    })
  const writeOff = (l: LoanReceivable) =>
    ask({
      title: 'Write off the remaining balance?',
      message: `${formatMoney(receivableOutstanding(l), l.currency)} that ${l.borrower} still owes will be marked as unrecoverable. It stops being counted as money owed to you. This does not create an expense and can be undone by editing the loan.`,
      confirmLabel: 'Write off',
      success: 'Marked as written off.',
      run: async () => {
        const rec = await loanRec(l)
        await save('loans', { ...rec, writtenOff: rec.writtenOff + receivableOutstanding(l) })
      },
    })

  return (
    <>
      <PageHeader
        title="Loans & Debts"
        description="Money you lent to others and money you owe. Principal is never treated as income or expense; only interest and fees on debts count as expenses."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDebtForm({ open: true })}>
              <Plus className="size-4" aria-hidden /> Add debt
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setLoanForm({ open: true })}>
              <Plus className="size-4" aria-hidden /> Record money lent
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <section className="card" aria-label="Owed to you">
          <h2 className="t-label">Owed to you</h2>
          <div className="t-value mt-1"><CurrencyAmount value={owedToMe} currency={currency} tone="neutral" /></div>
          <p className="t-helper mt-1">Not part of your available money until repaid.</p>
        </section>
        <section className="card" aria-label="You owe">
          <h2 className="t-label">You owe</h2>
          <div className="t-value mt-1"><CurrencyAmount value={iOwe} currency={currency} tone="neutral" /></div>
          <p className="t-helper mt-1">Principal still to repay.</p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="loans-title">
          <h2 id="loans-title" className="t-section mb-3">Money you lent</h2>
          {loans.length === 0 ? (
            <div className="card"><EmptyState icon={<HandCoins className="size-6" />} title="No loans recorded" description="Record money you lent to a friend or customer so you can track what comes back." /></div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {loans.map((l) => {
                const out = receivableOutstanding(l)
                const repaid = sum(l.repayments.map((r) => r.amount))
                return (
                  <li key={l.id} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="t-section">{l.borrower}</h3>
                        <p className="t-helper">Lent {l.lentDate} from {accountName(l.accountId)}</p>
                      </div>
                      {out === 0 ? <StatusBadge tone="positive" label={l.writtenOff > 0 ? 'Closed (written off)' : 'Repaid in full'} /> : dueBadge(l.dueDate, today, true)}
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="t-label">Lent</dt><dd className="m-0"><CurrencyAmount value={l.principal} currency={l.currency} tone="neutral" /></dd></div>
                      <div><dt className="t-label">Repaid</dt><dd className="m-0"><CurrencyAmount value={repaid} currency={l.currency} tone="neutral" /></dd></div>
                      <div><dt className="t-label">Still owed</dt><dd className="m-0 font-semibold"><CurrencyAmount value={out} currency={l.currency} tone="neutral" /></dd></div>
                    </dl>
                    {l.repayments.length > 0 && (
                      <ul className="m-0 mt-3 list-none divide-y divide-border/60 p-0 text-sm" aria-label="Repayments">
                        {l.repayments.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                            <span>Repaid {r.date} → {accountName(r.accountId)}</span>
                            <span className="flex items-center gap-1">
                              <CurrencyAmount value={r.amount} currency={l.currency} tone="neutral" />
                              <DeleteButton label={`Delete repayment of ${formatMoney(r.amount, l.currency)}`} onClick={() => ask({ title: 'Delete this repayment?', message: 'The amount will be owed again.', success: 'Repayment deleted.', run: () => remove('loanRepayments', r.id) })} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {out > 0 && (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={async () => setLoanRepay(await loanRec(l))}>
                            <Undo2 className="size-4" aria-hidden /> Record repayment
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => writeOff(l)}>Write off</button>
                        </>
                      )}
                      <span className="ml-auto flex gap-1">
                        <EditButton label={`Edit loan to ${l.borrower}`} onClick={async () => setLoanForm({ open: true, initial: await loanRec(l) })} />
                        <DeleteButton label={`Delete loan to ${l.borrower}`} onClick={() => delLoan(l)} />
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="debts-title">
          <h2 id="debts-title" className="t-section mb-3">Money you owe</h2>
          {debts.length === 0 ? (
            <div className="card"><EmptyState icon={<Handshake className="size-6" />} title="No debts recorded" description="Record money you borrowed from a person or lender, then log each repayment." /></div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {debts.map((dbt) => {
                const out = debtOutstanding(dbt)
                const paid = sum(dbt.repayments.map((r) => r.principalPart))
                const interest = sum(dbt.repayments.map((r) => r.interestPart))
                return (
                  <li key={dbt.id} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="t-section">{dbt.creditor}</h3>
                        <p className="t-helper">Borrowed {dbt.borrowedDate} into {accountName(dbt.accountId)}</p>
                      </div>
                      {out === 0 ? <StatusBadge tone="positive" label="Paid off" /> : dueBadge(dbt.dueDate, today, true)}
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="t-label">Borrowed</dt><dd className="m-0"><CurrencyAmount value={dbt.principal} currency={dbt.currency} tone="neutral" /></dd></div>
                      <div><dt className="t-label">Principal repaid</dt><dd className="m-0"><CurrencyAmount value={paid} currency={dbt.currency} tone="neutral" /></dd></div>
                      <div><dt className="t-label">Still owed</dt><dd className="m-0 font-semibold"><CurrencyAmount value={out} currency={dbt.currency} tone="neutral" /></dd></div>
                    </dl>
                    {interest > 0 && <p className="t-helper mt-2">Interest / fees paid so far: {formatMoney(interest, dbt.currency)} (counted as an expense).</p>}
                    {dbt.repayments.length > 0 && (
                      <ul className="m-0 mt-3 list-none divide-y divide-border/60 p-0 text-sm" aria-label="Repayments">
                        {dbt.repayments.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                            <span>Paid {r.date} from {accountName(r.accountId)}</span>
                            <span className="flex items-center gap-1">
                              <CurrencyAmount value={r.principalPart + r.interestPart} currency={dbt.currency} tone="neutral" />
                              <DeleteButton label="Delete repayment" onClick={() => ask({ title: 'Delete this repayment?', message: 'The principal will be owed again and your account balance restored.', success: 'Repayment deleted.', run: () => remove('debtRepayments', r.id) })} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {out > 0 && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={async () => setDebtRepay(await debtRec(dbt))}>
                          <Undo2 className="size-4" aria-hidden /> Record repayment
                        </button>
                      )}
                      <span className="ml-auto flex gap-1">
                        <EditButton label={`Edit debt to ${dbt.creditor}`} onClick={async () => setDebtForm({ open: true, initial: await debtRec(dbt) })} />
                        <DeleteButton label={`Delete debt to ${dbt.creditor}`} onClick={() => delDebt(dbt)} />
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      <div className="mt-4"><InlineNote>Repayments you receive or make are cash movements between you and other people — they never change your income or expense totals, except interest and fees you pay on debts.</InlineNote></div>

      <LoanForm open={loanForm.open} onClose={() => setLoanForm({ open: false })} initial={loanForm.initial} />
      <DebtForm open={debtForm.open} onClose={() => setDebtForm({ open: false })} initial={debtForm.initial} />
      <LoanRepaymentForm open={Boolean(loanRepay)} onClose={() => setLoanRepay(null)} loan={loanRepay} />
      <DebtRepaymentForm open={Boolean(debtRepay)} onClose={() => setDebtRepay(null)} debt={debtRepay} />
      {dialog}
    </>
  )
}
