/**
 * Offline sync model (pure, so it can be unit tested without a network):
 *
 *  - every record has a stable client-generated UUID
 *  - local writes become queued operations with their own stable op id
 *  - the server applies an op at most once (idempotent by op id)
 *  - conflicts are explicit: if the server copy is newer than the version the
 *    client edited, the op is reported as a conflict and NOT applied silently
 *  - a local change is only "synced" after the server confirmed it
 */

export type OpType = 'upsert' | 'delete'

export interface SyncOp {
  opId: string
  table: string
  recordId: string
  type: OpType
  /** Record payload for upserts (camelCase domain shape). */
  payload?: Record<string, unknown> & { updatedAt: string }
  /** `updatedAt` of the server copy the client last saw (null = new record). */
  baseUpdatedAt: string | null
  createdAt: string
  attempts: number
  lastError?: string | null
}

export interface ServerRow {
  id: string
  updatedAt: string
  deletedAt?: string | null
  [key: string]: unknown
}

export interface ApplyResult {
  applied: string[] // op ids applied
  duplicates: string[] // op ids that were already applied earlier
  conflicts: { opId: string; recordId: string; serverUpdatedAt: string }[]
}

/** Server-side reference implementation used by tests and the in-memory dev store. */
export function applyOps(
  store: Map<string, ServerRow>, // key: `${table}:${recordId}`
  processed: Set<string>,
  ops: readonly SyncOp[],
): ApplyResult {
  const result: ApplyResult = { applied: [], duplicates: [], conflicts: [] }
  const ordered = [...ops].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  for (const op of ordered) {
    if (processed.has(op.opId)) {
      result.duplicates.push(op.opId)
      continue
    }
    const key = `${op.table}:${op.recordId}`
    const current = store.get(key)
    if (current && op.baseUpdatedAt !== null && current.updatedAt > op.baseUpdatedAt) {
      result.conflicts.push({ opId: op.opId, recordId: op.recordId, serverUpdatedAt: current.updatedAt })
      continue
    }
    if (current && op.baseUpdatedAt === null && op.type === 'upsert') {
      // Same new record sent twice under a different op id: treat as already created.
      result.duplicates.push(op.opId)
      processed.add(op.opId)
      continue
    }
    if (op.type === 'upsert' && op.payload) {
      store.set(key, { ...(current ?? {}), ...op.payload, id: op.recordId, deletedAt: null } as ServerRow)
    } else if (op.type === 'delete') {
      const at = op.payload?.updatedAt ?? op.createdAt
      store.set(key, { ...(current ?? { id: op.recordId }), updatedAt: at, deletedAt: at } as ServerRow)
    }
    processed.add(op.opId)
    result.applied.push(op.opId)
  }
  return result
}

/** Collapse several queued ops for one record into the latest (keeps the original base version). */
export function compactQueue(ops: readonly SyncOp[]): SyncOp[] {
  const byRecord = new Map<string, SyncOp>()
  const sorted = [...ops].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  for (const op of sorted) {
    const key = `${op.table}:${op.recordId}`
    const prev = byRecord.get(key)
    if (!prev) {
      byRecord.set(key, op)
      continue
    }
    // A brand-new record that is deleted before ever syncing never needs to reach the server.
    if (prev.baseUpdatedAt === null && op.type === 'delete') {
      byRecord.delete(key)
      continue
    }
    byRecord.set(key, { ...op, opId: prev.opId === op.opId ? op.opId : op.opId, baseUpdatedAt: prev.baseUpdatedAt })
  }
  return [...byRecord.values()]
}

export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed' | 'offline' | 'not_configured'

export function deriveSyncStatus(args: {
  configured: boolean
  signedIn: boolean
  online: boolean
  syncing: boolean
  pendingCount: number
  failedCount: number
}): SyncStatus {
  if (!args.configured || !args.signedIn) return 'not_configured'
  if (!args.online) return 'offline'
  if (args.syncing) return 'syncing'
  if (args.failedCount > 0) return 'failed'
  if (args.pendingCount > 0) return 'pending'
  return 'synced'
}
