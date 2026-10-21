import { inMonth, type ISODate } from './dates'
import { sum, type Minor } from './money'
import type {
  Account,
  LedgerData,
  LoanReceivable,
  PassThroughTransfer,
  PersonalDebt,
  SalaryAdvance,
} from './types'

/**
 * Every source record is translated into explicit cash movements. A movement
 * says how much cash moved in which account on which date and — separately —
 * whether it is recognised as personal income or expense. That separation is
 * what keeps transfers, pass-through funds, loans and advances from being
 * double counted.
 */
export type MovementKind =
  | 'income'
  | 'expense'
  | 'transfer_out'
  | 'transfer_in'
  | 'transfer_fee'
  | 'pass_through_in'
  | 'pass_through_out'
  | 'pass_through_fee'
  | 'loan_disbursed'
  | 'loan_repayment_in'
  | 'debt_received'
  | 'debt_principal_out'
  | 'debt_interest_out'
  | 'advance_received'

export interface Movement {
  id: string
  sourceId: string
  accountId: string
  date: ISODate
  /** Signed cash change for the account (inflow > 0, outflow < 0). */
  cash: Minor
  kind: MovementKind
  /** Recognised personal income / expense for this movement (positive). */
  recognizedIncome: Minor
  recognizedExpense: Minor
}

const live = <T extends { deletedAt?: string | null }>(r: T) => !r.deletedAt

export function buildMovements(data: LedgerData): Movement[] {
  const out: Movement[] = []
  const push = (m: Omit<Movement, 'recognizedIncome' | 'recognizedExpense'> & Partial<Movement>) =>
    out.push({ recognizedIncome: 0, recognizedExpense: 0, ...m })

  for (const t of data.transactions.filter(live)) {
    if (t.status !== 'posted') continue
    if (t.type === 'income') {
      const deductions = (t.payrollDeductions ?? []).reduce((s, d) => s + d.amount, 0)
      push({
        id: `${t.id}:txn`,
        sourceId: t.id,
        accountId: t.accountId,
        date: t.date,
        cash: t.amount,
        kind: 'income',
        // Earned salary = cash received + amounts withheld to recover advances.
        recognizedIncome: t.amount + deductions,
      })
    } else {
      push({
        id: `${t.id}:txn`,
        sourceId: t.id,
        accountId: t.accountId,
        date: t.date,
        cash: -t.amount,
        kind: 'expense',
        recognizedExpense: t.amount,
      })
    }
  }

  for (const tr of data.transfers.filter(live)) {
    push({ id: `${tr.id}:out`, sourceId: tr.id, accountId: tr.sourceAccountId, date: tr.date, cash: -tr.amount, kind: 'transfer_out' })
    push({ id: `${tr.id}:in`, sourceId: tr.id, accountId: tr.destinationAccountId, date: tr.date, cash: tr.amount, kind: 'transfer_in' })
    if (tr.fee > 0) {
      push({
        id: `${tr.id}:fee`,
        sourceId: tr.id,
        accountId: tr.sourceAccountId,
        date: tr.date,
        cash: -tr.fee,
        kind: 'transfer_fee',
        recognizedExpense: tr.fee,
      })
    }
  }

  for (const p of data.passThroughs.filter(live)) {
    if (p.status === 'pending') continue // not yet in our hands
    push({ id: `${p.id}:in`, sourceId: p.id, accountId: p.accountId, date: p.receivedDate, cash: p.amount, kind: 'pass_through_in' })
    for (const leg of p.legs) {
      push({ id: `${p.id}:${leg.id}:out`, sourceId: p.id, accountId: p.accountId, date: leg.date, cash: -leg.amount, kind: 'pass_through_out' })
      if (leg.fee > 0) {
        push({
          id: `${p.id}:${leg.id}:fee`,
          sourceId: p.id,
          accountId: p.accountId,
          date: leg.date,
          cash: -leg.fee,
          kind: 'pass_through_fee',
          recognizedExpense: leg.fee,
        })
      }
    }
  }

  for (const l of data.loans.filter(live)) {
    push({ id: `${l.id}:lend`, sourceId: l.id, accountId: l.accountId, date: l.lentDate, cash: -l.principal, kind: 'loan_disbursed' })
    for (const r of l.repayments) {
      push({ id: `${l.id}:${r.id}`, sourceId: l.id, accountId: r.accountId, date: r.date, cash: r.amount, kind: 'loan_repayment_in' })
    }
  }

  for (const d of data.debts.filter(live)) {
    push({ id: `${d.id}:borrow`, sourceId: d.id, accountId: d.accountId, date: d.borrowedDate, cash: d.principal, kind: 'debt_received' })
    for (const r of d.repayments) {
      if (r.principalPart > 0) {
        push({ id: `${d.id}:${r.id}:p`, sourceId: d.id, accountId: r.accountId, date: r.date, cash: -r.principalPart, kind: 'debt_principal_out' })
      }
      if (r.interestPart > 0) {
        push({
          id: `${d.id}:${r.id}:i`,
          sourceId: d.id,
          accountId: r.accountId,
          date: r.date,
          cash: -r.interestPart,
          kind: 'debt_interest_out',
          recognizedExpense: r.interestPart,
        })
      }
    }
  }

  for (const a of data.advances.filter(live)) {
    if (a.status !== 'received') continue
    push({ id: `${a.id}:adv`, sourceId: a.id, accountId: a.accountId, date: a.date, cash: a.amount, kind: 'advance_received' })
  }

  return out
}

/** Account balance = opening balance + posted cash movements up to `asOf` (inclusive). */
export function accountBalance(
  account: Account,
  movements: readonly Movement[],
  asOf?: ISODate,
): Minor {
  let bal = account.openingBalance
  for (const m of movements) {
    if (m.accountId !== account.id) continue
    if (asOf && m.date > asOf) continue
    bal += m.cash
  }
  return bal
}

export function accountBalances(
  accounts: readonly Account[],
  movements: readonly Movement[],
  asOf?: ISODate,
): Map<string, Minor> {
  const map = new Map<string, Minor>()
  for (const a of accounts) map.set(a.id, a.openingBalance)
  for (const m of movements) {
    if (asOf && m.date > asOf) continue
    if (!map.has(m.accountId)) continue
    map.set(m.accountId, map.get(m.accountId)! + m.cash)
  }
  return map
}

export interface PeriodTotals {
  income: Minor
  expense: Minor
  net: Minor
}

/** Monthly net savings: recognised income − recognised expenses (month key YYYY-MM). */
export function monthTotals(movements: readonly Movement[], month: string, upTo?: ISODate): PeriodTotals {
  let income = 0
  let expense = 0
  for (const m of movements) {
    if (!inMonth(m.date, month)) continue
    if (upTo && m.date > upTo) continue
    income += m.recognizedIncome
    expense += m.recognizedExpense
  }
  return { income, expense, net: income - expense }
}

export function receivableOutstanding(l: LoanReceivable): Minor {
  const repaid = sum(l.repayments.map((r) => r.amount))
  return Math.max(0, l.principal - repaid - l.writtenOff)
}

export function debtOutstanding(d: PersonalDebt): Minor {
  const paid = sum(d.repayments.map((r) => r.principalPart))
  return Math.max(0, d.principal - paid)
}

/** Amount of an advance/employer loan not yet recovered through payroll deductions. */
export function advanceOutstanding(
  a: SalaryAdvance,
  transactions: LedgerData['transactions'],
): Minor {
  if (a.status !== 'received') return 0
  let recovered = 0
  for (const t of transactions) {
    if (t.deletedAt || t.status !== 'posted') continue
    for (const d of t.payrollDeductions ?? []) if (d.advanceId === a.id) recovered += d.amount
  }
  return Math.max(0, a.amount - recovered)
}

/** Money received for others that has not yet been forwarded (or has been cancelled). */
export function passThroughUnresolved(p: PassThroughTransfer): Minor {
  if (p.status === 'pending') return 0
  const forwarded = sum(p.legs.map((l) => l.amount))
  return Math.max(0, p.amount - forwarded)
}

export function totalHeldForOthers(passThroughs: readonly PassThroughTransfer[]): Minor {
  return sum(passThroughs.filter(live).map(passThroughUnresolved))
}

export interface AvailableMoney {
  /** Physical cash across active accounts. */
  physical: Minor
  /** Money held on behalf of others (not ours to spend). */
  heldForOthers: Minor
  /** Our own available money = physical − held for others. */
  available: Minor
  perAccount: { account: Account; balance: Minor }[]
}

export function availableMoney(data: LedgerData, asOf?: ISODate): AvailableMoney {
  const movements = buildMovements(data)
  const active = data.accounts.filter((a) => live(a) && !a.archived)
  const balances = accountBalances(active, movements, asOf)
  const perAccount = active.map((account) => ({ account, balance: balances.get(account.id) ?? 0 }))
  const physical = sum(perAccount.map((p) => p.balance))
  const heldForOthers = totalHeldForOthers(data.passThroughs)
  return { physical, heldForOthers, available: physical - heldForOthers, perAccount }
}

export interface ReconciliationResult {
  calculated: Minor
  confirmed: Minor
  difference: Minor // confirmed − calculated
  matches: boolean
}

export function reconcile(account: Account, movements: readonly Movement[], confirmed: Minor, asOf?: ISODate): ReconciliationResult {
  const calculated = accountBalance(account, movements, asOf)
  const difference = confirmed - calculated
  return { calculated, confirmed, difference, matches: difference === 0 }
}
