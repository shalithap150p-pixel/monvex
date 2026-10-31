import { parseAmount, toDecimalString } from '../domain/money'
import type { EntityName } from './records'

/**
 * Maps local records (camelCase, money in integer minor units) to Postgres
 * rows (snake_case, money as exact decimal strings) and back.
 * Order matters: parents come before children so pulls and pushes satisfy foreign keys.
 */
interface EntityConfig {
  table: string
  money: string[]
  renames?: Record<string, string>
}

export const ENTITIES: Record<EntityName, EntityConfig> = {
  accounts: { table: 'finance_accounts', money: ['openingBalance', 'confirmedBalance'] },
  categories: { table: 'transaction_categories', money: [] },
  obligations: { table: 'payment_obligations', money: ['amount'], renames: { isEstimate: 'is_estimate' } },
  occurrences: { table: 'payment_occurrences', money: ['expectedAmount'], renames: {} },
  transactions: {
    table: 'transactions',
    money: ['amount'],
    renames: { date: 'txn_date', time: 'txn_time' },
  },
  transfers: { table: 'internal_transfers', money: ['amount', 'fee'], renames: { date: 'transfer_date' } },
  passThroughs: { table: 'pass_through_transfers', money: ['amount'] },
  passThroughLegs: { table: 'pass_through_legs', money: ['amount', 'fee'], renames: { date: 'leg_date' } },
  loans: { table: 'loans_receivable', money: ['principal', 'writtenOff'], renames: { lentDate: 'lent_date' } },
  loanRepayments: { table: 'receivable_repayments', money: ['amount'], renames: { date: 'repaid_date' } },
  debts: { table: 'personal_debts', money: ['principal'] },
  debtRepayments: { table: 'debt_repayments', money: ['principalPart', 'interestPart'], renames: { date: 'paid_date' } },
  advances: { table: 'salary_advances', money: ['amount'], renames: { date: 'advance_date' } },
  payrollDeductions: { table: 'payroll_deductions', money: ['amount'] },
  budgets: { table: 'budgets', money: ['limit'], renames: { limit: 'limit_amount' } },
  goals: {
    table: 'savings_goals',
    money: ['target', 'monthlyContribution'],
    renames: { target: 'target_amount' },
  },
  allocations: { table: 'savings_allocations', money: ['amount'], renames: { date: 'allocated_on' } },
  reconciliations: {
    table: 'balance_reconciliations',
    money: ['statementBalance', 'appBalance'],
    renames: { date: 'reconciled_on' },
  },
  // Reference information only (no money fields). Last in the order, so a missing server table never blocks the rest.
  bankDetails: { table: 'bank_account_details', money: [] },
}

export const ENTITY_ORDER = Object.keys(ENTITIES) as EntityName[]

export const entityForTable = (table: string): EntityName | undefined =>
  ENTITY_ORDER.find((e) => ENTITIES[e].table === table)

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/** Columns that exist only locally and are never sent to the server. */
const LOCAL_ONLY = new Set(['serverUpdatedAt'])
/** Computed server-side. */
const SERVER_ONLY = new Set(['user_id', 'difference'])

type Rec = Record<string, unknown>

export function toRow(entity: EntityName, record: Rec): Rec {
  const cfg = ENTITIES[entity]
  const currency = typeof record.currency === 'string' ? record.currency : 'LKR'
  const row: Rec = {}
  for (const [key, value] of Object.entries(record)) {
    if (LOCAL_ONLY.has(key) || value === undefined) continue
    const column = cfg.renames?.[key] ?? camelToSnake(key)
    if (cfg.money.includes(key)) {
      row[column] = value === null ? null : toDecimalString(value as number, currency)
    } else if (key === 'schedule' && Array.isArray(value)) {
      row[column] = (value as { month: string; amount: number }[]).map((s) => ({
        month: s.month,
        amount: toDecimalString(s.amount, currency),
      }))
    } else {
      row[column] = value
    }
  }
  return row
}

export function fromRow(entity: EntityName, row: Rec): Rec {
  const cfg = ENTITIES[entity]
  const reverse: Record<string, string> = {}
  for (const [camel, snake] of Object.entries(cfg.renames ?? {})) reverse[snake] = camel
  const currency = typeof row.currency === 'string' ? row.currency.trim() : 'LKR'
  const rec: Rec = {}
  for (const [column, value] of Object.entries(row)) {
    if (SERVER_ONLY.has(column)) continue
    const key = reverse[column] ?? snakeToCamel(column)
    if (cfg.money.includes(key)) {
      rec[key] = value === null || value === undefined ? null : parseAmount(String(value), currency)
    } else if (key === 'schedule' && Array.isArray(value)) {
      rec[key] = (value as { month: string; amount: string | number }[]).map((s) => ({
        month: s.month,
        amount: parseAmount(String(s.amount), currency),
      }))
    } else if (key === 'currency' && typeof value === 'string') {
      rec[key] = value.trim()
    } else if (key === 'time' && typeof value === 'string') {
      rec[key] = value.slice(0, 5)
    } else {
      rec[key] = value
    }
  }
  rec.serverUpdatedAt = (row.updated_at as string | undefined) ?? null
  return rec
}
