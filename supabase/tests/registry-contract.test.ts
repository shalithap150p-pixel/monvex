import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ENTITIES, ENTITY_ORDER, fromRow, toRow } from '../../src/data/registry'
import { SAMPLES, T, ts } from './samples'

/**
 * Contract between the app's sync mapper and the real database schema:
 * every column the app sends must exist, and every required column must be sent.
 */
const root = join(__dirname, '..')
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(join(root, 'tests/stubs.sql'), 'utf8'))
  for (const f of readdirSync(join(root, 'migrations')).sort()) await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'))
})

describe('sync mapper ↔ database schema', () => {
  it('has a sample for every entity', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...ENTITY_ORDER].sort())
  })

  for (const entity of ENTITY_ORDER) {
    it(`${entity}: every sent column exists and every required column is sent`, async () => {
      const table = ENTITIES[entity].table
      const { rows } = await db.query<{ column_name: string; is_nullable: string; column_default: string | null; is_generated: string; data_type: string }>(
        `select column_name, is_nullable, column_default, is_generated, data_type from information_schema.columns where table_schema='public' and table_name=$1`,
        [table],
      )
      const cols = new Map(rows.map((r) => [r.column_name, r]))
      expect(cols.size, `table ${table} exists`).toBeGreaterThan(0)

      const row = toRow(entity, { ...SAMPLES[entity], ...ts })
      const unknown = Object.keys(row).filter((k) => !cols.has(k))
      expect(unknown, `columns sent but missing in ${table}`).toEqual([])

      const required = rows.filter((r) => r.is_nullable === 'NO' && r.column_default === null && r.is_generated === 'NEVER' && r.column_name !== 'user_id').map((r) => r.column_name)
      const missing = required.filter((c) => !(c in row))
      expect(missing, `required columns of ${table} not sent`).toEqual([])

      // money must be sent as exact decimal strings, never floats
      for (const m of ENTITIES[entity].money) {
        const col = ENTITIES[entity].renames?.[m] ?? m.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
        if (row[col] !== null && row[col] !== undefined) {
          expect(typeof row[col]).toBe('string')
          expect(cols.get(col)?.data_type).toBe('numeric')
        }
      }
    })

    it(`${entity}: round trip keeps the record intact`, () => {
      const rec = { ...SAMPLES[entity], ...ts }
      const row = { ...toRow(entity, rec), updated_at: T }
      const back = fromRow(entity, row)
      const { serverUpdatedAt, ...rest } = back
      expect(serverUpdatedAt).toBe(T)
      for (const [k, v] of Object.entries(rec)) {
        if (v === null || v === undefined) continue
        expect(rest[k], `field ${k}`).toEqual(v)
      }
    })
  }
})
