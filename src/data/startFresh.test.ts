import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { openDb } from './db'
import { newId, saveRecord } from './repo'
import { ERASE_PHRASE, startFresh } from './startFresh'
import { pauseSync, resumeSync, syncNow } from './syncEngine'

const USER = '11111111-1111-1111-1111-111111111111'

/** A tiny fake Supabase client that records what was called, in order. */
function fakeClient(opts: { rows?: string[]; listed?: string[]; rpcError?: string; removeError?: string } = {}) {
  const calls: string[] = []
  const removed: string[] = []
  const client = {
    from: (table: string) => ({
      select: async () => {
        calls.push(`select ${table}`)
        return { data: (opts.rows ?? []).map((storage_path) => ({ storage_path })), error: null }
      },
    }),
    storage: {
      from: () => ({
        list: async (folder: string) => {
          calls.push(`list ${folder}`)
          return { data: (opts.listed ?? []).map((name) => ({ name, id: `id-${name}` })), error: null }
        },
        remove: async (paths: string[]) => {
          calls.push('remove')
          if (opts.removeError) return { data: null, error: { message: opts.removeError } }
          removed.push(...paths)
          return { data: null, error: null }
        },
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`rpc ${fn} ${String(args.p_confirm)}`)
      return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { transactions: 3 }, error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls, removed }
}

async function localDb(scope: string) {
  const db = openDb(scope)
  await saveRecord(db, 'accounts', { id: newId(), name: 'Cash', type: 'cash', currency: 'LKR', openingBalance: 1000, archived: false }, { syncEnabled: true })
  return db
}

describe('startFresh', () => {
  it('removes vault files, then erases the server, then this device — in that order', async () => {
    const db = await localDb('fresh-1')
    const { client, calls, removed } = fakeClient({ rows: [`${USER}/a.pdf`, `${USER}/b.png`], listed: ['a.pdf', 'orphan.jpg'] })
    const result = await startFresh({ client, db, scope: 'fresh-1', userId: USER, phrase: ERASE_PHRASE })

    expect(removed.sort()).toEqual([`${USER}/a.pdf`, `${USER}/b.png`, `${USER}/orphan.jpg`])
    expect(calls.indexOf('remove')).toBeLessThan(calls.findIndex((c) => c.startsWith('rpc')))
    expect(calls).toContain(`rpc erase_my_data ${ERASE_PHRASE}`)
    expect(result.files).toBe(3)
    expect(result.counts).toEqual({ transactions: 3 })
    expect(await Dexie.exists('monvex-fresh-1')).toBe(false) // local copy and its sync queue are gone
  })

  it('never touches files outside the signed-in user’s own folder', async () => {
    const db = await localDb('fresh-2')
    const { client, removed } = fakeClient({ rows: [`${USER}/mine.pdf`, '22222222-2222-2222-2222-222222222222/theirs.pdf', '../escape.pdf'] })
    await startFresh({ client, db, scope: 'fresh-2', userId: USER, phrase: ERASE_PHRASE })
    expect(removed).toEqual([`${USER}/mine.pdf`])
  })

  it('refuses a wrong phrase before doing anything', async () => {
    const db = await localDb('fresh-3')
    const { client, calls } = fakeClient()
    await expect(startFresh({ client, db, scope: 'fresh-3', userId: USER, phrase: 'erase all my data' })).rejects.toThrow(/does not match/)
    expect(calls).toEqual([])
    expect(await db.accounts.count()).toBe(1)
  })

  it('keeps the local data when the server refuses, and says what to do if the update is missing', async () => {
    const db = await localDb('fresh-4')
    const { client } = fakeClient({ rpcError: 'Could not find the function public.erase_my_data(p_confirm) in the schema cache' })
    await expect(startFresh({ client, db, scope: 'fresh-4', userId: USER, phrase: ERASE_PHRASE })).rejects.toThrow(/0007_erase_my_data\.sql/)
    expect(await db.accounts.count()).toBe(1)
    expect(await db.queue.count()).toBe(1)
  })

  it('shows the real server error instead of blaming a missing update', async () => {
    const db = await localDb('fresh-4b')
    const { client } = fakeClient({ rpcError: 'relation "public.bank_account_details" does not exist' })
    await expect(startFresh({ client, db, scope: 'fresh-4b', userId: USER, phrase: ERASE_PHRASE })).rejects.toThrow(/bank_account_details/)
    expect(await db.accounts.count()).toBe(1)
  })

  it('does not erase the database if the stored files could not be removed', async () => {
    const db = await localDb('fresh-5')
    const { client, calls } = fakeClient({ rows: [`${USER}/a.pdf`], removeError: 'storage unavailable' })
    await expect(startFresh({ client, db, scope: 'fresh-5', userId: USER, phrase: ERASE_PHRASE })).rejects.toThrow(/storage unavailable/)
    expect(calls.some((c) => c.startsWith('rpc'))).toBe(false)
    expect(await db.accounts.count()).toBe(1)
  })

  it('pauses background sync while erasing and resumes it if the erase fails', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    try {
      const db = await localDb('fresh-6')
      const pushed = vi.fn(async () => ({ data: { status: 'applied', updated_at: '2026-10-31T00:00:00Z' }, error: null }))
      const sync = {
        rpc: pushed,
        from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null }), order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
      } as unknown as SupabaseClient

      await pauseSync()
      await syncNow(db, sync) // paused: nothing is pushed
      expect(pushed).not.toHaveBeenCalled()
      resumeSync()

      const { client } = fakeClient({ rpcError: 'boom' })
      await expect(startFresh({ client, db, scope: 'fresh-6', userId: USER, phrase: ERASE_PHRASE })).rejects.toThrow(/boom/)
      await syncNow(db, sync) // the failed erase resumed syncing, so the pending change goes out
      expect(pushed).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
