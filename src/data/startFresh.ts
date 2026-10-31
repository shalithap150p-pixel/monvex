import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteDb, type MonvexDB, type Scope } from './db'
import { pauseSync, resumeSync } from './syncEngine'

/** The exact phrase the server requires, so a stray click or call can never erase anything. */
export const ERASE_PHRASE = 'ERASE ALL MY DATA'

const BUCKET = 'evidence'
const BATCH = 100

const MISSING_FUNCTION = /could not find the function|does not exist|schema cache/i

/** Every file this user has stored in the vault (database rows plus any leftover files in their folder). */
async function evidencePaths(client: SupabaseClient, userId: string): Promise<string[]> {
  const paths = new Set<string>()
  const rows = await client.from('evidence_attachments').select('storage_path')
  if (rows.error) throw new Error(rows.error.message)
  for (const r of rows.data ?? []) if (typeof r.storage_path === 'string' && r.storage_path) paths.add(r.storage_path)

  for (let offset = 0; ; offset += 1000) {
    const list = await client.storage.from(BUCKET).list(userId, { limit: 1000, offset })
    if (list.error) throw new Error(list.error.message)
    for (const f of list.data ?? []) if (f.name && f.id) paths.add(`${userId}/${f.name}`)
    if ((list.data?.length ?? 0) < 1000) break
  }
  // Only ever remove files inside the signed-in user's own folder.
  return [...paths].filter((p) => p.startsWith(`${userId}/`))
}

async function removeEvidenceFiles(client: SupabaseClient, userId: string): Promise<number> {
  const paths = await evidencePaths(client, userId)
  for (let i = 0; i < paths.length; i += BATCH) {
    const { error } = await client.storage.from(BUCKET).remove(paths.slice(i, i + BATCH))
    if (error) throw new Error(`Could not remove stored files: ${error.message}`)
  }
  return paths.length
}

export interface StartFreshResult {
  files: number
  counts: Record<string, number>
}

/**
 * One-time "start fresh": removes the signed-in user's stored vault files, then ALL of their records on the
 * server (the `erase_my_data` function), then this device's local copy. The login, currency and theme stay.
 * If anything fails before the server was erased, nothing is lost and it can simply be tried again.
 */
export async function startFresh(opts: { client: SupabaseClient; db: MonvexDB; scope: Scope; userId: string; phrase: string }): Promise<StartFreshResult> {
  const { client, db, scope, userId, phrase } = opts
  if (phrase !== ERASE_PHRASE) throw new Error('The confirmation phrase does not match. Nothing was erased.')
  await pauseSync() // no background sync may push or pull while we erase
  let serverErased = false
  try {
    const files = await removeEvidenceFiles(client, userId)
    const { data, error } = await client.rpc('erase_my_data', { p_confirm: phrase })
    if (error) {
      if (MISSING_FUNCTION.test(error.message)) {
        throw new Error('The server is missing a database update. Run supabase/migrations/0007_erase_my_data.sql in the Supabase SQL editor first, then try again.')
      }
      throw new Error(error.message)
    }
    serverErased = true
    // The server is now empty. Remove this device's copy (and its sync queue); a reload starts clean.
    db.close()
    await deleteDb(scope)
    return { files, counts: (data ?? {}) as Record<string, number> }
  } catch (e) {
    if (serverErased) {
      throw new Error('Your server data was erased, but this device could not be cleared. Reload the page, then use Settings → Clear data on this device.')
    }
    resumeSync()
    throw e
  }
}
