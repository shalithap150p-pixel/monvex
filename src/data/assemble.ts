import { sum } from '../domain/money'
import type {
  Budget,
  Category,
  LedgerData,
  PaymentObligation,
  PaymentOccurrence,
  SavingsGoal,
  Transaction,
} from '../domain/types'
import { readPrefs, tableOf, type MonvexDB } from './db'
import type { EntityMap, EntityName, ReconciliationRec } from './records'

export const ALL_ENTITIES: EntityName[] = [
  'accounts',
  'categories',
  'obligations',
  'occurrences',
  'transactions',
  'transfers',
  'passThroughs',
  'passThroughLegs',
  'loans',
  'loanRepayments',
  'debts',
  'debtRepayments',
  'advances',
  'payrollDeductions',
  'budgets',
  'goals',
  'allocations',
  'reconciliations',
]

export interface AppData {
  ledger: LedgerData
  categories: Category[]
  obligations: PaymentObligation[]
  occurrences: PaymentOccurrence[]
  budgets: Budget[]
  goals: SavingsGoal[]
  reconciliations: ReconciliationRec[]
  prefs: Awaited<ReturnType<typeof readPrefs>>
}

type Live<T> = T & { deletedAt?: string | null }
const alive = <T,>(rows: Live<T>[]) => rows.filter((r) => !r.deletedAt)

/** Read every table and rebuild the nested domain objects the pure functions expect. */
export async function loadAppData(db: MonvexDB): Promise<AppData> {
  const raw = {} as { [K in EntityName]: EntityMap[K][] }
  await Promise.all(
    ALL_ENTITIES.map(async (e) => {
      ;(raw as Record<string, unknown[]>)[e] = await tableOf(db, e).toArray()
    }),
  )
  const prefs = await readPrefs(db)
  return assemble(raw, prefs)
}

export function assemble(raw: { [K in EntityName]: EntityMap[K][] }, prefs: AppData['prefs']): AppData {
  const accounts = alive(raw.accounts)
  const loansAlive = alive(raw.loans)
  const debtsAlive = alive(raw.debts)
  const ptAlive = alive(raw.passThroughs)
  const txAlive = alive(raw.transactions)

  const group = <T extends { deletedAt?: string | null }>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      if (r.deletedAt) continue
      const k = key(r)
      const list = m.get(k)
      if (list) list.push(r)
      else m.set(k, [r])
    }
    return m
  }

  const repaymentsByLoan = group(raw.loanRepayments, (r) => r.loanId)
  const repaymentsByDebt = group(raw.debtRepayments, (r) => r.debtId)
  const legsByPt = group(raw.passThroughLegs, (r) => r.passThroughId)
  const deductionsByTx = group(raw.payrollDeductions, (r) => r.transactionId)
  const allocationsByGoal = group(raw.allocations, (r) => r.goalId)

  const transactions: Transaction[] = txAlive.map((t) => ({
    ...t,
    payrollDeductions: (deductionsByTx.get(t.id) ?? []).map((d) => ({ advanceId: d.advanceId, amount: d.amount })),
  }))

  const paidByOcc = new Map<string, { amount: number; ids: string[] }>()
  for (const t of txAlive) {
    if (!t.occurrenceId || t.status !== 'posted') continue
    const cur = paidByOcc.get(t.occurrenceId) ?? { amount: 0, ids: [] }
    cur.amount += t.amount
    cur.ids.push(t.id)
    paidByOcc.set(t.occurrenceId, cur)
  }
  const obligationsAlive = alive(raw.obligations)
  const obIds = new Set(obligationsAlive.map((o) => o.id))
  const occurrences: PaymentOccurrence[] = alive(raw.occurrences)
    .filter((o) => obIds.has(o.obligationId))
    .map((o) => ({
      ...o,
      paidAmount: paidByOcc.get(o.id)?.amount ?? 0,
      paidTransactionIds: paidByOcc.get(o.id)?.ids ?? [],
    }))

  const ledger: LedgerData = {
    accounts,
    transactions,
    transfers: alive(raw.transfers),
    passThroughs: ptAlive.map((p) => ({
      ...p,
      legs: (legsByPt.get(p.id) ?? []).map((l) => ({
        id: l.id,
        amount: l.amount,
        fee: l.fee,
        date: l.date,
        reference: l.reference ?? null,
      })),
    })),
    loans: loansAlive.map((l) => ({
      ...l,
      repayments: (repaymentsByLoan.get(l.id) ?? []).map((r) => ({
        id: r.id,
        amount: r.amount,
        date: r.date,
        accountId: r.accountId,
        reference: r.reference ?? null,
      })),
    })),
    debts: debtsAlive.map((d) => ({
      ...d,
      repayments: (repaymentsByDebt.get(d.id) ?? []).map((r) => ({
        id: r.id,
        principalPart: r.principalPart,
        interestPart: r.interestPart,
        date: r.date,
        accountId: r.accountId,
        reference: r.reference ?? null,
      })),
    })),
    advances: alive(raw.advances),
  }

  const goals: SavingsGoal[] = alive(raw.goals).map((g) => ({
    ...g,
    allocated: sum((allocationsByGoal.get(g.id) ?? []).map((a) => a.amount)),
    contributions: (allocationsByGoal.get(g.id) ?? []).map((a) => ({ date: a.date, amount: a.amount })),
  }))

  return {
    ledger,
    categories: alive(raw.categories),
    obligations: obligationsAlive,
    occurrences,
    budgets: alive(raw.budgets),
    goals,
    reconciliations: alive(raw.reconciliations),
    prefs,
  }
}
