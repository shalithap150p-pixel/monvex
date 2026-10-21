import type { SupabaseClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { deriveSyncStatus, type SyncStatus } from '../domain/sync'
import { readPrefs, tableOf, type MonvexDB, type QueuedOp } from './db'
import { ENTITIES, ENTITY_ORDER, fromRow } from './registry'
import { newId } from './repo'
import type { EntityName } from './records'
import { parseAmount, toDecimalString } from '../domain/money'

/* -------------------------------------------------------------- tiny external store */

interface SyncState {
  syncing: boolean
  online: boolean
  lastSyncedAt: string | null
  lastError: string | null
  pendingCount: number
  failedCount: number
  conflictCount: number
}

let state: SyncState = {
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
}
const listeners = new Set<() => void>()
const setState = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const useSyncState = (): SyncState =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setState({ online: true }))
  window.addEventListener('offline', () => setState({ online: false }))
}

export function statusOf(s: SyncState, configured: boolean, signedIn: boolean): SyncStatus {
  return deriveSyncStatus({
    configured,
    signedIn,
    online: s.online,
    syncing: s.syncing,
    pendingCount: s.pendingCount,
    failedCount: s.failedCount + s.conflictCount,
  })
}

export async function refreshCounts(db: MonvexDB): Promise<void> {
  const ops = await db.queue.toArray()
  const prefs = await readPrefs(db)
  setState({
    pendingCount: ops.filter((o) => o.state === 'pending').length + (prefs.dirty ? 1 : 0),
    failedCount: ops.filter((o) => o.state === 'failed').length,
    conflictCount: ops.filter((o) => o.state === 'conflict').length,
  })
}

/* -------------------------------------------------------------- sync */

let running = false
const PAGE = 500

function isNetworkError(message: string): boolean {
  return /fetch|network|failed to|load failed|timeout|offline/i.test(message)
}

/** Push queued changes, then pull server changes. Never reports success unless the server confirmed. */
export async function syncNow(db: MonvexDB, client: SupabaseClient): Promise<void> {
  if (running) return
  if (!navigator.onLine) {
    setState({ online: false })
    await refreshCounts(db)
    return
  }
  running = true
  setState({ syncing: true, lastError: null, online: true })
  try {
    const ok = await pushQueue(db, client)
    if (ok) {
      await pushPrefs(db, client)
      await pull(db, client)
      await db.meta.put({ key: 'initialPullDone', value: true })
      setState({ lastSyncedAt: new Date().toISOString() })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    setState({ lastError: isNetworkError(message) ? 'Could not reach the server. Your changes are saved on this device and will sync later.' : message })
  } finally {
    running = false
    setState({ syncing: false })
    await refreshCounts(db)
  }
}

async function pushQueue(db: MonvexDB, client: SupabaseClient): Promise<boolean> {
  const ops = (await db.queue.where('state').equals('pending').sortBy('createdAt')) as QueuedOp[]
  for (const op of ops) {
    const { data, error } = await client.rpc('sync_apply', {
      p_op_id: op.opId,
      p_table: op.table,
      p_type: op.type,
      p_record_id: op.recordId,
      p_base: op.baseUpdatedAt,
      p_record: op.payload ?? {},
    })
    if (error) {
      if (isNetworkError(error.message)) throw new Error(error.message)
      await db.queue.update(op.opId, { state: 'failed', attempts: op.attempts + 1, lastError: error.message })
      continue
    }
    const result = data as { status: 'applied' | 'duplicate' | 'conflict'; updated_at?: string; server_updated_at?: string }
    if (result.status === 'conflict') {
      await db.queue.update(op.opId, { state: 'conflict', serverUpdatedAt: result.server_updated_at ?? null })
      continue
    }
    // applied or duplicate: the server has it, so record the confirmed version and drop the op.
    const table = tableOf(db, op.entity)
    await db.transaction('rw', [table, db.queue], async () => {
      const local = await table.get(op.recordId)
      if (local && result.updated_at) await table.update(op.recordId, { serverUpdatedAt: result.updated_at } as never)
      await db.queue.delete(op.opId)
    })
  }
  const blocked = await db.queue.where('state').anyOf('failed', 'conflict').count()
  return blocked === 0 // do not pull over data that failed to push
}

async function pushPrefs(db: MonvexDB, client: SupabaseClient): Promise<void> {
  const prefs = await readPrefs(db)
  if (!prefs.dirty) return
  const { data: userData } = await client.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return
  const c = prefs.currency
  const { error } = await client.from('user_preferences').upsert({
    user_id: userId,
    currency: c,
    payday_date: prefs.paydayDate ?? null,
    expected_salary: prefs.expectedSalary == null ? null : toDecimalString(prefs.expectedSalary, c),
    salary_frequency: prefs.salaryFrequency,
    salary_account_id: prefs.salaryAccountId ?? null,
    essential_daily_amount: toDecimalString(prefs.essentialDailyAmount, c),
    safety_buffer: toDecimalString(prefs.safetyBuffer, c),
    safe_to_spend_period_days: prefs.safeToSpendPeriodDays,
    carry_forward_allowance: prefs.carryForwardAllowance,
    theme: prefs.theme,
  })
  if (error) throw new Error(error.message)
  await db.prefs.update('prefs', { dirty: false })
}

async function pull(db: MonvexDB, client: SupabaseClient): Promise<void> {
  // First sign-in on a device: fetch preferences once if nothing local is dirty.
  const prefs = await readPrefs(db)
  if (!prefs.dirty) {
    const { data } = await client.from('user_preferences').select('*').maybeSingle()
    if (data && (await db.meta.get('prefsPulled')) === undefined) {
      const c = (data.currency as string).trim()
      await db.prefs.put({
        ...prefs,
        currency: c,
        paydayDate: data.payday_date,
        expectedSalary: data.expected_salary == null ? null : parseAmount(String(data.expected_salary), c),
        salaryFrequency: data.salary_frequency,
        salaryAccountId: data.salary_account_id ?? null,
        essentialDailyAmount: parseAmount(String(data.essential_daily_amount), c),
        safetyBuffer: parseAmount(String(data.safety_buffer), c),
        safeToSpendPeriodDays: data.safe_to_spend_period_days,
        carryForwardAllowance: data.carry_forward_allowance,
        theme: data.theme,
        updatedAt: new Date().toISOString(),
        dirty: false,
      })
      await db.meta.put({ key: 'prefsPulled', value: true })
    }
  }

  for (const entity of ENTITY_ORDER) {
    const cfg = ENTITIES[entity]
    let cursor = ((await db.meta.get(`lastPull:${entity}`))?.value as string | undefined) ?? null
    for (;;) {
      let query = client.from(cfg.table).select('*').order('updated_at', { ascending: true }).limit(PAGE)
      if (cursor) query = query.gt('updated_at', cursor)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      await mergeRows(db, entity, data as Record<string, unknown>[])
      cursor = data[data.length - 1].updated_at as string
      await db.meta.put({ key: `lastPull:${entity}`, value: cursor })
      if (data.length < PAGE) break
    }
  }
}

async function mergeRows(db: MonvexDB, entity: EntityName, rows: Record<string, unknown>[]): Promise<void> {
  const table = tableOf(db, entity)
  const tableName = ENTITIES[entity].table
  await db.transaction('rw', [table, db.queue], async () => {
    for (const row of rows) {
      const id = row.id as string
      const pending = await db.queue.where('[table+recordId]').equals([tableName, id]).count()
      if (pending > 0) continue // local edit not yet pushed: the push step will detect any conflict
      await table.put(fromRow(entity, row) as never)
    }
  })
}

/* -------------------------------------------------------------- conflict & failure handling */

export async function resolveConflict(db: MonvexDB, opId: string, keep: 'mine' | 'server'): Promise<void> {
  const op = await db.queue.get(opId)
  if (!op) return
  if (keep === 'mine') {
    // Re-base on the server version we now know about and send again under a new op id.
    await db.queue.delete(opId)
    await db.queue.put({ ...op, opId: newId(), baseUpdatedAt: op.serverUpdatedAt ?? null, state: 'pending', attempts: 0, lastError: null })
  } else {
    await db.queue.delete(opId)
    // Force a re-fetch of this table so the server's version replaces the local one.
    await db.meta.delete(`lastPull:${op.entity}`)
    await tableOf(db, op.entity).delete(op.recordId)
  }
  await refreshCounts(db)
}

export async function retryFailed(db: MonvexDB): Promise<void> {
  const failed = await db.queue.where('state').equals('failed').toArray()
  await db.queue.bulkPut(failed.map((o) => ({ ...o, state: 'pending' as const, lastError: null })))
  await refreshCounts(db)
}

export async function discardOp(db: MonvexDB, opId: string): Promise<void> {
  const op = await db.queue.get(opId)
  if (!op) return
  await db.queue.delete(opId)
  await db.meta.delete(`lastPull:${op.entity}`)
  await tableOf(db, op.entity).delete(op.recordId)
  await refreshCounts(db)
}
