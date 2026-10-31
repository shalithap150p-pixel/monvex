import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ENTITIES, ENTITY_ORDER, toRow } from '../../src/data/registry'
import { ID, SAMPLES, ts } from './samples'

/** "Start fresh": the erase_my_data function removes one user's records completely and nobody else's. */
const root = join(__dirname, '..')
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const ID_B = '44444444-4444-4444-4444-444444444444'
const PHRASE = 'ERASE ALL MY DATA'
// synced records, plus the vault index, saved forecasts and the history log
const TABLES = [...ENTITY_ORDER.map((e) => ENTITIES[e].table), 'evidence_attachments', 'forecast_snapshots', 'audit_log']
let db: PGlite

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ''}', false)`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function failsWith(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params)
  } catch (e) {
    return String((e as Error).message)
  }
  throw new Error(`Expected statement to fail: ${sql}`)
}

/** Fill every synced table for one user through sync_apply, exactly like the app does. */
async function fill(user: string, id: string, firstOp: string) {
  const SECOND = id.replace(/^(.)/, 'a')
  const swap = (v: unknown) => JSON.parse(JSON.stringify(v).split(ID).join(id))
  await as(user, async () => {
    for (const entity of ENTITY_ORDER) {
      // a transfer needs two different accounts, so create a second one first
      if (entity === 'transfers') {
        const second = swap({ ...SAMPLES.accounts, id: SECOND, name: 'Second', ...ts })
        const r = await db.query<{ r: { status: string } }>(`select public.sync_apply(gen_random_uuid(), 'finance_accounts', 'upsert', $1, null, $2::jsonb) as r`, [second.id, JSON.stringify(toRow('accounts', second))])
        expect(r.rows[0].r.status).toBe('applied')
      }
      const sample = entity === 'transfers' ? { ...SAMPLES.transfers, destinationAccountId: SECOND } : SAMPLES[entity]
      const row = toRow(entity, swap({ ...sample, ...ts }))
      const op = entity === ENTITY_ORDER[0] ? firstOp : crypto.randomUUID()
      const r = await db.query<{ r: { status: string } }>(`select public.sync_apply($1, $2, 'upsert', $3, null, $4::jsonb) as r`, [op, ENTITIES[entity].table, id, JSON.stringify(row)])
      expect(r.rows[0].r.status, `${entity} was applied`).toBe('applied')
    }
    // vault index (linked to a transaction) and a saved forecast — not part of the sync queue
    await db.query(
      `insert into public.evidence_attachments (storage_path, file_name, mime_type, size_bytes, transaction_id) values ($1, 'receipt.pdf', 'application/pdf', 1000, $2)`,
      [`${user}/receipt.pdf`, id],
    )
    await db.query(`insert into public.forecast_snapshots (horizon_days, scenario, as_of, target_date, projected_total) values (30, 'expected', '2026-10-01', '2026-10-31', 1000)`)
  })
}

async function counts(user: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of TABLES) out[t] = (await db.query<{ n: number }>(`select count(*)::int as n from public.${t} where user_id = $1`, [user])).rows[0].n
  return out
}

const OP_A = '99999999-9999-9999-9999-999999999999'
let beforeA: Record<string, number>
let beforeB: Record<string, number>

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(join(root, 'tests/stubs.sql'), 'utf8'))
  for (const f of readdirSync(join(root, 'migrations')).sort()) await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'))
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com')`)
  await fill(A, ID, OP_A)
  await fill(B, ID_B, crypto.randomUUID())
  for (const [u, theme, acc] of [[A, 'noir', ID], [B, 'navy', ID_B]]) {
    await db.query(
      `update public.user_preferences set currency = 'USD', theme = $2, payday_date = '2026-10-25', expected_salary = 100000, salary_account_id = $3,
         essential_daily_amount = 500, safety_buffer = 1000, safe_to_spend_period_days = 14, carry_forward_allowance = false where user_id = $1`,
      [u, theme, acc],
    )
  }
  beforeA = await counts(A)
  beforeB = await counts(B)
})

describe('erase_my_data ("Start fresh")', () => {
  it('starts with something in every table, including the audit log', () => {
    for (const t of TABLES) expect(beforeA[t], `${t} has data before erasing`).toBeGreaterThan(0)
  })

  it('refuses a missing or wrong confirmation phrase and erases nothing', async () => {
    await as(A, async () => {
      expect(await failsWith(`select public.erase_my_data('erase all my data')`)).toMatch(/confirmation/i)
      expect(await failsWith(`select public.erase_my_data('')`)).toMatch(/confirmation/i)
      expect(await failsWith(`select public.erase_my_data(null)`)).toMatch(/confirmation/i)
    })
    expect(await counts(A)).toEqual(beforeA)
  })

  it('is not available to signed-out visitors', async () => {
    await as(null, async () => {
      expect(await failsWith(`select public.erase_my_data('${PHRASE}')`)).toMatch(/permission denied/)
    })
    expect(await counts(A)).toEqual(beforeA)
  })

  it('erases every record of the signed-in user and nothing of anyone else', async () => {
    const r = await as(A, () => db.query<{ r: Record<string, number> }>(`select public.erase_my_data('${PHRASE}') as r`))
    expect(Object.keys(r.rows[0].r).sort()).toEqual([...TABLES].sort())

    const afterA = await counts(A)
    for (const t of TABLES) expect(afterA[t], `${t} is empty after erasing`).toBe(0)
    expect(await counts(B)).toEqual(beforeB)

    // user B can still see all of their own data through RLS
    await as(B, async () => {
      expect((await db.query('select * from public.finance_accounts')).rows).toHaveLength(2)
      expect((await db.query('select * from public.bank_account_details')).rows).toHaveLength(1)
    })
  })

  it('keeps the login, currency and theme but resets the salary and Safe-to-Spend settings', async () => {
    const a = (await db.query<Record<string, unknown>>(`select * from public.user_preferences where user_id = $1`, [A])).rows[0]
    expect(String(a.currency).trim()).toBe('USD')
    expect(a.theme).toBe('noir')
    expect(a.payday_date).toBeNull()
    expect(a.expected_salary).toBeNull()
    expect(a.salary_account_id).toBeNull()
    expect(a.salary_frequency).toBe('monthly')
    expect(Number(a.essential_daily_amount)).toBe(0)
    expect(Number(a.safety_buffer)).toBe(0)
    expect(a.safe_to_spend_period_days).toBe(30)
    expect(a.carry_forward_allowance).toBe(true)
    expect((await db.query(`select 1 from public.profiles where user_id = $1`, [A])).rows).toHaveLength(1)
    // the other user's settings were not touched
    const b = (await db.query<Record<string, unknown>>(`select * from public.user_preferences where user_id = $1`, [B])).rows[0]
    expect(b.payday_date).not.toBeNull()
    expect(b.safe_to_spend_period_days).toBe(14)
  })

  it('does not let an old offline change from another device bring an erased record back', async () => {
    await as(A, async () => {
      const row = toRow('accounts', { ...SAMPLES.accounts, ...ts })
      const replay = await db.query<{ r: { status: string } }>(`select public.sync_apply($1, 'finance_accounts', 'upsert', $2, null, $3::jsonb) as r`, [OP_A, ID, JSON.stringify(row)])
      expect(replay.rows[0].r.status).toBe('duplicate')
      expect((await db.query('select * from public.finance_accounts')).rows).toHaveLength(0)
    })
  })

  it('lets the user start entering new data straight away, and erasing again is harmless', async () => {
    await as(A, async () => {
      const row = toRow('accounts', { ...SAMPLES.accounts, name: 'Fresh start', ...ts })
      const r = await db.query<{ r: { status: string } }>(`select public.sync_apply(gen_random_uuid(), 'finance_accounts', 'upsert', $1, null, $2::jsonb) as r`, [ID, JSON.stringify(row)])
      expect(r.rows[0].r.status).toBe('applied')
      await db.query(`select public.erase_my_data('${PHRASE}')`)
      expect((await db.query('select * from public.finance_accounts')).rows).toHaveLength(0)
      await db.query(`select public.erase_my_data('${PHRASE}')`) // nothing left: still fine
    })
  })
})
