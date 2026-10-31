import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
let db: PGlite

async function as(user: string | null, fn: () => Promise<void>) {
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  await db.exec(`select set_config('request.jwt.claim.sub', '${user ?? ''}', false)`)
  try {
    await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function fails(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params)
  } catch (e) {
    return String((e as Error).message)
  }
  throw new Error(`Expected statement to fail: ${sql}`)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(join(root, 'tests/stubs.sql'), 'utf8'))
  for (const f of readdirSync(join(root, 'migrations')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'))
  }
  await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com')`)
})

describe('Supabase migrations', () => {
  it('creates a profile and preferences for each new user', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.profiles')
    expect(r.rows[0].n).toBe(2)
    const p = await db.query<{ n: number }>('select count(*)::int as n from public.user_preferences')
    expect(p.rows[0].n).toBe(2)
  })

  it('has RLS enabled and forced on every public table', async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`,
    )
    expect(r.rows.map((x) => x.relname)).toEqual([])
  })

  it('stores money as numeric, never floating point', async () => {
    const r = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type in ('real','double precision')`,
    )
    expect(r.rows).toEqual([])
  })

  it('isolates users from each other', async () => {
    let accA = ''
    await as(A, async () => {
      const r = await db.query<{ id: string }>(
        `insert into public.finance_accounts (name, type, opening_balance) values ('A cash', 'cash', 1000.50) returning id`,
      )
      accA = r.rows[0].id
    })
    await as(B, async () => {
      const seen = await db.query('select * from public.finance_accounts')
      expect(seen.rows).toHaveLength(0)
      // cannot write a row that claims to belong to someone else
      expect(await fails(`insert into public.finance_accounts (user_id, name, type) values ('${A}', 'x', 'cash')`)).toMatch(/row-level security/)
      // cannot reference someone else's account from own transaction
      expect(
        await fails(
          `insert into public.transactions (type, account_id, amount, txn_date, description) values ('expense', $1, 10, '2026-10-01', 'steal')`,
          [accA],
        ),
      ).toMatch(/foreign key|violates/)
      // cannot update or delete another user's rows
      const upd = await db.query(`update public.finance_accounts set name = 'hacked' where id = $1 returning id`, [accA])
      expect(upd.rows).toHaveLength(0)
      const del = await db.query(`delete from public.finance_accounts where id = $1 returning id`, [accA])
      expect(del.rows).toHaveLength(0)
    })
    await as(null, async () => {
      expect(await fails('select * from public.finance_accounts')).toMatch(/permission denied/)
    })
    await as(A, async () => {
      const r = await db.query<{ name: string; opening_balance: string }>('select name, opening_balance from public.finance_accounts')
      expect(r.rows).toEqual([{ name: 'A cash', opening_balance: '1000.500' }])
    })
  })

  it('rejects zero amounts, same-account transfers and moving rows between users', async () => {
    await as(A, async () => {
      const acc = (await db.query<{ id: string }>('select id from public.finance_accounts limit 1')).rows[0].id
      const acc2 = (await db.query<{ id: string }>(`insert into public.finance_accounts (name, type) values ('A bank','bank') returning id`)).rows[0].id
      expect(await fails(`insert into public.transactions (type, account_id, amount, txn_date, description) values ('expense', $1, 0, '2026-10-01', 'zero')`, [acc])).toMatch(/check/)
      expect(await fails(`insert into public.internal_transfers (source_account_id, destination_account_id, amount, transfer_date) values ($1, $1, 5, '2026-10-01')`, [acc])).toMatch(/check/)
      await db.query(`insert into public.internal_transfers (source_account_id, destination_account_id, amount, fee, transfer_date) values ($1, $2, 5, 0.5, '2026-10-01')`, [acc, acc2])
      expect(await fails(`update public.finance_accounts set user_id = '${B}' where id = $1`, [acc])).toMatch(/row-level security|cannot be changed/)
    })
  })

  it('refuses to over-pay a bill occurrence', async () => {
    await as(A, async () => {
      const acc = (await db.query<{ id: string }>('select id from public.finance_accounts limit 1')).rows[0].id
      const ob = (await db.query<{ id: string }>(
        `insert into public.payment_obligations (name, amount, frequency, due_date) values ('Rent', 100, 'monthly', '2026-10-25') returning id`,
      )).rows[0].id
      const occ = (await db.query<{ id: string }>(
        `insert into public.payment_occurrences (obligation_id, due_date, expected_amount) values ($1, '2026-10-25', 100) returning id`,
        [ob],
      )).rows[0].id
      // a second occurrence for the same period can never be created
      expect(await fails(`insert into public.payment_occurrences (obligation_id, due_date, expected_amount) values ($1, '2026-10-25', 100)`, [ob])).toMatch(/unique|duplicate/)
      const pay = (amount: number) =>
        db.query(
          `insert into public.transactions (type, account_id, amount, txn_date, description, occurrence_id) values ('expense', $1, $2, '2026-10-25', 'rent', $3)`,
          [acc, amount, occ],
        )
      await pay(60)
      await pay(40)
      expect(await fails(`insert into public.transactions (type, account_id, amount, txn_date, description, occurrence_id) values ('expense', $1, 1, '2026-10-26', 'dup', $2)`, [acc, occ])).toMatch(/exceed/)
    })
  })

  it('sync_apply is idempotent and reports conflicts', async () => {
    await as(A, async () => {
      const id = '33333333-3333-3333-3333-333333333333'
      const op1 = '44444444-4444-4444-4444-444444444444'
      const record = { id, name: 'Wallet', type: 'wallet', currency: 'LKR', opening_balance: '50.00', archived: false, deleted_at: null }
      const first = await db.query<{ r: { status: string; updated_at: string } }>(
        `select public.sync_apply($1, 'finance_accounts', 'upsert', $2, null, $3::jsonb) as r`,
        [op1, id, JSON.stringify(record)],
      )
      expect(first.rows[0].r.status).toBe('applied')
      const retry = await db.query<{ r: { status: string } }>(
        `select public.sync_apply($1, 'finance_accounts', 'upsert', $2, null, $3::jsonb) as r`,
        [op1, id, JSON.stringify(record)],
      )
      expect(retry.rows[0].r.status).toBe('duplicate')
      const count = await db.query<{ n: number }>(`select count(*)::int as n from public.finance_accounts where id = $1`, [id])
      expect(count.rows[0].n).toBe(1)

      // editing from the version the client saw succeeds…
      const base = first.rows[0].r.updated_at
      const edit = await db.query<{ r: { status: string; updated_at: string } }>(
        `select public.sync_apply($1, 'finance_accounts', 'upsert', $2, $3::timestamptz, $4::jsonb) as r`,
        ['55555555-5555-5555-5555-555555555555', id, base, JSON.stringify({ ...record, name: 'Wallet 2' })],
      )
      expect(edit.rows[0].r.status).toBe('applied')
      // …but editing from a stale base is reported as a conflict, not applied
      const stale = await db.query<{ r: { status: string } }>(
        `select public.sync_apply($1, 'finance_accounts', 'upsert', $2, $3::timestamptz, $4::jsonb) as r`,
        ['66666666-6666-6666-6666-666666666666', id, base, JSON.stringify({ ...record, name: 'Stale' })],
      )
      expect(stale.rows[0].r.status).toBe('conflict')
      const name = await db.query<{ name: string }>(`select name from public.finance_accounts where id = $1`, [id])
      expect(name.rows[0].name).toBe('Wallet 2')
      // tables outside the allow-list are refused
      expect(await fails(`select public.sync_apply(gen_random_uuid(), 'audit_log', 'upsert', gen_random_uuid(), null, '{}'::jsonb)`)).toMatch(/cannot be synced/)
    })
  })

  it('keeps bank details private, valid and out of the audit log', async () => {
    const id = '77777777-7777-7777-7777-777777777777'
    const rec = { id, label: 'Salary', bank_name: 'Sample Bank', account_number: '0000 1111 2222', account_type: 'savings', currency: 'LKR', card_last4: '1234', deleted_at: null }
    await as(A, async () => {
      const r = await db.query<{ r: { status: string } }>(`select public.sync_apply(gen_random_uuid(), 'bank_account_details', 'upsert', $1, null, $2::jsonb) as r`, [id, JSON.stringify(rec)])
      expect(r.rows[0].r.status).toBe('applied')
      expect((await db.query('select * from public.bank_account_details')).rows).toHaveLength(1)
      // a full card number (or anything but 4 digits) is refused by the database itself
      const bad = '88888888-8888-8888-8888-888888888888'
      expect(await fails(`select public.sync_apply(gen_random_uuid(), 'bank_account_details', 'upsert', $1, null, $2::jsonb)`, [bad, JSON.stringify({ ...rec, id: bad, card_last4: '4242424242424242' })])).toMatch(/check|violat/i)
      expect(await fails(`select public.sync_apply(gen_random_uuid(), 'bank_account_details', 'upsert', $1, null, $2::jsonb)`, [bad, JSON.stringify({ ...rec, id: bad, account_type: 'wallet' })])).toMatch(/check|violat/i)
    })
    await as(B, async () => {
      expect((await db.query('select * from public.bank_account_details')).rows).toHaveLength(0)
    })
    await as(null, async () => {
      expect(await fails('select * from public.bank_account_details')).toMatch(/permission denied/)
    })
    // account numbers are not copied into the audit log
    const audited = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where table_name = 'bank_account_details'`)
    expect(audited.rows[0].n).toBe(0)
  })

  it('keeps the audit log read-only for users', async () => {
    await as(A, async () => {
      const rows = await db.query('select * from public.audit_log')
      expect(rows.rows.length).toBeGreaterThan(0)
      expect(await fails(`delete from public.audit_log`)).toMatch(/permission denied/)
      expect(await fails(`update public.audit_log set action = 'DELETE'`)).toMatch(/permission denied/)
    })
    await as(B, async () => {
      expect((await db.query('select * from public.audit_log')).rows).toHaveLength(0)
    })
  })

  it('creates a private evidence bucket restricted to the owner folder', async () => {
    const b = await db.query<{ public: boolean; file_size_limit: string }>(`select public, file_size_limit from storage.buckets where id = 'evidence'`)
    expect(b.rows[0].public).toBe(false)
    await as(A, async () => {
      await db.query(`insert into storage.objects (bucket_id, name, owner) values ('evidence', '${A}/receipt.pdf', '${A}')`)
      expect(await fails(`insert into storage.objects (bucket_id, name, owner) values ('evidence', '${B}/receipt.pdf', '${A}')`)).toMatch(/row-level security/)
    })
    await as(B, async () => {
      expect((await db.query(`select * from storage.objects`)).rows).toHaveLength(0)
    })
  })

  it('only allows evidence records that point inside the owner folder', async () => {
    await as(A, async () => {
      expect(
        await fails(
          `insert into public.evidence_attachments (storage_path, file_name, mime_type, size_bytes) values ('${B}/x.pdf', 'x.pdf', 'application/pdf', 100)`,
        ),
      ).toMatch(/check/)
      expect(
        await fails(
          `insert into public.evidence_attachments (storage_path, file_name, mime_type, size_bytes) values ('${A}/x.exe', 'x.exe', 'application/x-msdownload', 100)`,
        ),
      ).toMatch(/check/)
    })
  })
})
