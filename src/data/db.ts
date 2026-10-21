import Dexie, { type Table } from 'dexie'
import type { SyncOp } from '../domain/sync'
import { DEFAULT_PREFERENCES, type UserPreferences } from '../domain/types'
import { ENTITY_ORDER } from './registry'
import type { EntityMap, EntityName } from './records'

export type OpState = 'pending' | 'failed' | 'conflict'

export interface QueuedOp extends SyncOp {
  entity: EntityName
  state: OpState
  /** Server version found when a conflict was detected. */
  serverUpdatedAt?: string | null
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface PrefsRow extends UserPreferences {
  id: 'prefs'
  updatedAt: string
  dirty: boolean
}

type EntityTables = { [K in EntityName]: Table<EntityMap[K], string> }

export type MonvexDB = Dexie & EntityTables & {
  queue: Table<QueuedOp, string>
  meta: Table<MetaRow, string>
  prefs: Table<PrefsRow, string>
}

export type Scope = string // 'demo' or a Supabase user id

const STORES: Record<string, string> = {
  accounts: 'id',
  categories: 'id',
  obligations: 'id',
  occurrences: 'id, obligationId, dueDate',
  transactions: 'id, accountId, date, occurrenceId',
  transfers: 'id, date',
  passThroughs: 'id',
  passThroughLegs: 'id, passThroughId',
  loans: 'id',
  loanRepayments: 'id, loanId',
  debts: 'id',
  debtRepayments: 'id, debtId',
  advances: 'id',
  payrollDeductions: 'id, transactionId, advanceId',
  budgets: 'id',
  goals: 'id',
  allocations: 'id, goalId',
  reconciliations: 'id, accountId',
  queue: 'opId, createdAt, [table+recordId], state',
  meta: 'key',
  prefs: 'id',
}

export const dbName = (scope: Scope) => `monvex-${scope}`

export function openDb(scope: Scope): MonvexDB {
  const db = new Dexie(dbName(scope)) as MonvexDB
  db.version(1).stores(STORES)
  return db
}

export async function deleteDb(scope: Scope): Promise<void> {
  await Dexie.delete(dbName(scope))
}

export function tableOf<K extends EntityName>(db: MonvexDB, entity: K): Table<EntityMap[K], string> {
  return (db as unknown as EntityTables)[entity]
}

export async function readPrefs(db: MonvexDB): Promise<PrefsRow> {
  const row = await db.prefs.get('prefs')
  return row ?? { ...DEFAULT_PREFERENCES, id: 'prefs', updatedAt: new Date(0).toISOString(), dirty: false }
}

export { ENTITY_ORDER }
