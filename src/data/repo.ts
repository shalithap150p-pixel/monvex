import { toRow, ENTITIES } from './registry'
import { readPrefs, tableOf, type MonvexDB, type QueuedOp } from './db'
import type { EntityMap, EntityName } from './records'
import type { UserPreferences } from '../domain/types'

export const newId = (): string => crypto.randomUUID()
export const nowIso = (): string => new Date().toISOString()

type Input<K extends EntityName> = Omit<EntityMap[K], 'createdAt' | 'updatedAt' | 'serverUpdatedAt'> &
  Partial<Pick<EntityMap[K], 'createdAt' | 'updatedAt'>>

/**
 * Write a record locally and queue it for sync in ONE IndexedDB transaction,
 * so a stored change can never exist without its queued operation.
 * `syncEnabled` is false in demo mode (nothing is ever sent anywhere).
 */
export async function saveRecord<K extends EntityName>(
  db: MonvexDB,
  entity: K,
  input: Input<K>,
  opts: { syncEnabled: boolean },
): Promise<EntityMap[K]> {
  const table = tableOf(db, entity)
  let saved!: EntityMap[K]
  await db.transaction('rw', [table, db.queue], async () => {
    const existing = (await table.get(input.id)) as EntityMap[K] | undefined
    const at = nowIso()
    saved = {
      ...existing,
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? at,
      updatedAt: at,
      serverUpdatedAt: existing?.serverUpdatedAt ?? null,
    } as EntityMap[K]
    await table.put(saved)
    if (opts.syncEnabled) await queueOp(db, entity, saved, 'upsert', existing?.serverUpdatedAt ?? null)
  })
  return saved
}

/** Soft delete. A record that never reached the server simply disappears. */
export async function deleteRecord(
  db: MonvexDB,
  entity: EntityName,
  id: string,
  opts: { syncEnabled: boolean },
): Promise<void> {
  const table = tableOf(db, entity)
  await db.transaction('rw', [table, db.queue], async () => {
    const existing = await table.get(id)
    if (!existing) return
    const never = !existing.serverUpdatedAt
    if (never) {
      await table.delete(id)
      const old = await db.queue.where('[table+recordId]').equals([ENTITIES[entity].table, id]).toArray()
      await db.queue.bulkDelete(old.map((o) => o.opId))
      return
    }
    const at = nowIso()
    const next = { ...existing, deletedAt: at, updatedAt: at } as EntityMap[typeof entity]
    await table.put(next)
    if (opts.syncEnabled) await queueOp(db, entity, next, 'delete', existing.serverUpdatedAt ?? null)
  })
}

async function queueOp(
  db: MonvexDB,
  entity: EntityName,
  record: EntityMap[EntityName],
  type: 'upsert' | 'delete',
  serverUpdatedAt: string | null,
): Promise<void> {
  const tableName = ENTITIES[entity].table
  const previous = await db.queue.where('[table+recordId]').equals([tableName, record.id]).toArray()
  // Keep the version the first queued edit was based on; replace payload under a fresh op id
  // (a retry of an op that may already have reached the server surfaces as a conflict, never a silent loss).
  const base = previous.length ? previous[0].baseUpdatedAt : serverUpdatedAt
  await db.queue.bulkDelete(previous.map((o) => o.opId))
  if (type === 'delete' && base === null) return // created and deleted before ever syncing
  const op: QueuedOp = {
    opId: newId(),
    entity,
    table: tableName,
    recordId: record.id,
    type,
    payload: toRow(entity, record as unknown as Record<string, unknown>) as QueuedOp['payload'],
    baseUpdatedAt: base,
    createdAt: previous.length ? previous[0].createdAt : nowIso(),
    attempts: 0,
    state: 'pending',
  }
  await db.queue.put(op)
}

export async function savePrefs(db: MonvexDB, patch: Partial<UserPreferences>, opts: { syncEnabled: boolean }) {
  const current = await readPrefs(db)
  await db.prefs.put({ ...current, ...patch, updatedAt: nowIso(), dirty: opts.syncEnabled })
}
