import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ENTITIES, ENTITY_ORDER, fromRow, toRow } from '../../src/data/registry'
import type { EntityName } from '../../src/data/records'

/**
 * Contract between the app's sync mapper and the real database schema:
 * every column the app sends must exist, and every required column must be sent.
 */
const root = join(__dirname, '..')
let db: PGlite

const T = '2026-01-01T00:00:00.000Z'
const ts = { createdAt: T, updatedAt: T, deletedAt: null }
const ID = '33333333-3333-3333-3333-333333333333'
const D = '2026-03-05'

const SAMPLES: Record<EntityName, Record<string, unknown>> = {
  accounts: { id: ID, name: 'Cash', type: 'cash', currency: 'LKR', openingBalance: 123456, confirmedBalance: 100, lastReconciledAt: D, archived: false },
  categories: { id: ID, name: 'Food', type: 'expense' },
  obligations: { id: ID, name: 'Rent', amount: 2500000, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: D, endDate: null, accountId: ID, reminderDays: 3, essential: true, active: true, notes: null },
  occurrences: { id: ID, obligationId: ID, dueDate: D, expectedAmount: 2500000, currency: 'LKR' },
  transactions: { id: ID, type: 'expense', accountId: ID, amount: 150050, currency: 'LKR', date: D, time: '09:30', categoryId: ID, description: 'Lunch', counterparty: null, reference: null, notes: null, status: 'posted', occurrenceId: null },
  transfers: { id: ID, sourceAccountId: ID, destinationAccountId: ID, amount: 5000, fee: 100, date: D, reference: null, notes: null, currency: 'LKR' },
  passThroughs: { id: ID, accountId: ID, sender: 'A', recipient: 'B', destination: null, amount: 1000, currency: 'LKR', receivedDate: D, status: 'received', reference: null, notes: null },
  passThroughLegs: { id: ID, passThroughId: ID, amount: 500, fee: 10, date: D, reference: null, currency: 'LKR' },
  loans: { id: ID, borrower: 'X', accountId: ID, principal: 100000, currency: 'LKR', lentDate: D, dueDate: null, writtenOff: 0, notes: null, reminderDays: null },
  loanRepayments: { id: ID, loanId: ID, accountId: ID, amount: 5000, date: D, reference: null, currency: 'LKR' },
  debts: { id: ID, creditor: 'Y', accountId: ID, principal: 100000, currency: 'LKR', borrowedDate: D, dueDate: null, notes: null, reminderDays: null },
  debtRepayments: { id: ID, debtId: ID, accountId: ID, principalPart: 4000, interestPart: 100, date: D, reference: null, currency: 'LKR' },
  advances: { id: ID, employer: 'Co', kind: 'advance', accountId: ID, amount: 5000000, currency: 'LKR', date: D, status: 'received', schedule: [{ month: '2026-04', amount: 5000000 }], payrollMonth: null, notes: null },
  payrollDeductions: { id: ID, transactionId: ID, advanceId: ID, amount: 5000000, currency: 'LKR' },
  budgets: { id: ID, currency: 'LKR', categoryId: ID, period: 'monthly', limit: 3000000, alertThresholdPct: 80 },
  goals: { id: ID, currency: 'LKR', name: 'Trip', target: 10000000, targetDate: null, accountId: null, reserveInSafeToSpend: false },
  allocations: { id: ID, goalId: ID, accountId: null, amount: 1000, date: D, note: null, currency: 'LKR' },
  reconciliations: { id: ID, accountId: ID, statementBalance: 1000, appBalance: 900, date: D, notes: null, currency: 'LKR' },
}

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
