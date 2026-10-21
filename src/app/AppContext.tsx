import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { todayLocal, type ISODate } from '../domain/dates'
import type { UserPreferences } from '../domain/types'
import { loadAppData, type AppData } from '../data/assemble'
import { openDb, type MonvexDB } from '../data/db'
import { seedCategories, seedDemoData } from '../data/demo'
import { ensureOccurrences } from '../data/occurrences'
import type { EntityMap, EntityName } from '../data/records'
import { deleteRecord, savePrefs, saveRecord } from '../data/repo'
import { supabase } from '../data/supabase'
import { refreshCounts, syncNow, useSyncState } from '../data/syncEngine'
import { ErrorState, LoadingState } from '../ui/States'

export interface AppCtx {
  scope: string
  mode: 'demo' | 'cloud'
  userId: string | null
  db: MonvexDB
  data: AppData
  today: ISODate
  currency: string
  syncEnabled: boolean
  save: <K extends EntityName>(
    entity: K,
    input: Omit<EntityMap[K], 'createdAt' | 'updatedAt' | 'serverUpdatedAt'> & Partial<Pick<EntityMap[K], 'createdAt' | 'updatedAt'>>,
  ) => Promise<EntityMap[K]>
  remove: (entity: EntityName, id: string) => Promise<void>
  setPrefs: (patch: Partial<UserPreferences>) => Promise<void>
  sync: () => Promise<void>
  resetDemo: () => Promise<void>
}

const Ctx = createContext<AppCtx | null>(null)

export function DataProvider({
  scope,
  mode,
  userId,
  children,
}: {
  scope: string
  mode: 'demo' | 'cloud'
  userId: string | null
  children: ReactNode
}) {
  const db = useMemo(() => openDb(scope), [scope])
  // Note: never close `db` in an effect cleanup — React StrictMode (dev) runs cleanup right after mount,
  // and Dexie 4 does not reopen a closed database automatically.

  const syncEnabled = mode === 'cloud' && supabase !== null
  const data = useLiveQuery(() => loadAppData(db), [db])
  const [today, setToday] = useState<ISODate>(() => todayLocal())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seeded = useRef(false)
  const seeding = useRef(false)
  const { lastSyncedAt } = useSyncState()
  const [openError, setOpenError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)

  // If the browser blocks or hangs IndexedDB (e.g. some embedded/preview browsers), say so
  // instead of showing a spinner forever.
  useEffect(() => {
    let cancelled = false
    db.open().catch((e: unknown) => {
      if (!cancelled) setOpenError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
  }, [db])
  useEffect(() => {
    if (data) return
    const t = setTimeout(() => setStalled(true), 6000)
    return () => clearTimeout(t)
  }, [data])

  // Keep "today" correct across midnight and when the app returns to the foreground.
  useEffect(() => {
    const tick = () => setToday((t) => (todayLocal() === t ? t : todayLocal()))
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  const sync = useCallback(async () => {
    if (syncEnabled && supabase) await syncNow(db, supabase)
    else await refreshCounts(db)
  }, [db, syncEnabled])

  const scheduleSync = useCallback(() => {
    if (!syncEnabled) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void sync(), 1200)
  }, [sync, syncEnabled])

  useEffect(() => {
    void refreshCounts(db)
    if (!syncEnabled) return
    void sync()
    const onOnline = () => void sync()
    const onVisible = () => document.visibilityState === 'visible' && void sync()
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(() => void sync(), 60_000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [db, sync, syncEnabled])

  // Fresh stores get starter categories. In cloud mode we wait for the first pull so we
  // never create duplicates of categories the server already has. Demo mode gets a
  // clearly labelled sample data set in its own separate database.
  useEffect(() => {
    if (!data || seeded.current || seeding.current) return
    seeding.current = true
    void (async () => {
      try {
        const [cats, accts] = await Promise.all([db.categories.count(), db.accounts.count()])
        if (mode === 'demo') {
          seeded.current = true
          if (accts === 0 && cats === 0) await seedDemoData(db, todayLocal())
          else if (cats === 0) await seedCategories(db, false)
        } else if (cats > 0) {
          seeded.current = true
        } else if (!syncEnabled) {
          seeded.current = true
          await seedCategories(db, false)
        } else if (await db.meta.get('initialPullDone')) {
          seeded.current = true
          await seedCategories(db, true)
          scheduleSync()
        }
      } finally {
        seeding.current = false
      }
    })()
  }, [data, db, mode, syncEnabled, scheduleSync, lastSyncedAt])

  // Keep upcoming bill occurrences generated (idempotent, deterministic ids).
  const obligations = data?.obligations
  const generating = useRef(false)
  useEffect(() => {
    if (!obligations || generating.current) return
    generating.current = true
    ensureOccurrences(db, obligations, today, syncEnabled)
      .then((n) => {
        if (n > 0) scheduleSync()
      })
      .catch(() => undefined)
      .finally(() => {
        generating.current = false
      })
  }, [db, obligations, today, syncEnabled, scheduleSync])

  const save: AppCtx['save'] = useCallback(
    async (entity, input) => {
      const rec = await saveRecord(db, entity, input, { syncEnabled })
      await refreshCounts(db)
      scheduleSync()
      return rec
    },
    [db, syncEnabled, scheduleSync],
  )
  const remove: AppCtx['remove'] = useCallback(
    async (entity, id) => {
      await deleteRecord(db, entity, id, { syncEnabled })
      await refreshCounts(db)
      scheduleSync()
    },
    [db, syncEnabled, scheduleSync],
  )
  const setPrefs: AppCtx['setPrefs'] = useCallback(
    async (patch) => {
      await savePrefs(db, patch, { syncEnabled })
      if (patch.theme) {
        try {
          localStorage.setItem('monvex.theme', patch.theme)
        } catch {
          /* ignore */
        }
      }
      await refreshCounts(db)
      scheduleSync()
    },
    [db, syncEnabled, scheduleSync],
  )
  const resetDemo = useCallback(async () => {
    if (mode !== 'demo') return
    await db.delete()
    window.location.reload()
  }, [db, mode])

  // Apply the stored theme to the document.
  const theme = data?.prefs.theme
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
  }, [theme])

  const value = useMemo<AppCtx | null>(
    () =>
      data
        ? {
            scope,
            mode,
            userId,
            db,
            data,
            today,
            currency: data.prefs.currency,
            syncEnabled,
            save,
            remove,
            setPrefs,
            sync,
            resetDemo,
          }
        : null,
    [data, scope, mode, userId, db, today, syncEnabled, save, remove, setPrefs, sync, resetDemo],
  )

  if (!value) {
    if (openError || stalled) {
      return (
        <div className="grid min-h-screen place-items-center px-4">
          <ErrorState
            title="Can't open local storage"
            message={`MONVEX keeps your data in this browser's IndexedDB, but it could not be opened${openError ? ` (${openError})` : ''}. Try reloading. If it keeps happening, make sure the site is not in a private window and that site data is not blocked in your browser.`}
            action={
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            }
          />
        </div>
      )
    }
    return <LoadingState label="Opening your finances…" fullScreen />
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside DataProvider')
  return v
}