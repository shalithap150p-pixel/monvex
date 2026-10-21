import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadAppData } from './assemble'
import { openDb, type MonvexDB } from './db'
import { ensureOccurrences, stableId } from './occurrences'
import { deleteRecord, newId, saveRecord } from './repo'
import { monthKey } from '../domain/dates'
import { availableMoney } from '../domain/ledger'
import { remainingAmount } from '../domain/bills'

let db: MonvexDB
let n = 0
beforeEach(() => {
  db = openDb(`test-${++n}`)
})

const account = (id: string) => ({ id, name: 'Cash', type: 'cash' as const, currency: 'LKR', openingBalance: 100000, archived: false })

describe('local store + sync queue', () => {
  it('writes a record and its queue op together', async () => {
    const id = newId()
    await saveRecord(db, 'accounts', account(id), { syncEnabled: true })
    expect(await db.accounts.count()).toBe(1)
    const ops = await db.queue.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ recordId: id, type: 'upsert', baseUpdatedAt: null, state: 'pending' })
  })

  it('queues nothing in demo mode', async () => {
    await saveRecord(db, 'accounts', account(newId()), { syncEnabled: false })
    expect(await db.queue.count()).toBe(0)
  })

  it('a record that never reached the server disappears on delete, with its queued ops', async () => {
    const id = newId()
    await saveRecord(db, 'accounts', account(id), { syncEnabled: true })
    await deleteRecord(db, 'accounts', id, { syncEnabled: true })
    expect(await db.accounts.count()).toBe(0)
    expect(await db.queue.count()).toBe(0)
  })

  it('a synced record is soft-deleted and queued for deletion', async () => {
    const id = newId()
    await saveRecord(db, 'accounts', account(id), { syncEnabled: true })
    await db.accounts.update(id, { serverUpdatedAt: '2026-01-01T00:00:00.000Z' })
    await db.queue.clear()
    await deleteRecord(db, 'accounts', id, { syncEnabled: true })
    expect((await db.accounts.get(id))?.deletedAt).toBeTruthy()
    const ops = await db.queue.toArray()
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe('delete')
    expect(ops[0].baseUpdatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('assembling domain data', () => {
  it('nests repayments and legs, ignores soft-deleted rows, and derives bill payments from transactions', async () => {
    const o = { syncEnabled: false }
    const acc = newId()
    await saveRecord(db, 'accounts', account(acc), o)
    const loan = newId()
    await saveRecord(db, 'loans', { id: loan, borrower: 'Kamal', accountId: acc, principal: 50000, currency: 'LKR', lentDate: '2026-01-01', writtenOff: 0 }, o)
    await saveRecord(db, 'loanRepayments', { id: newId(), loanId: loan, accountId: acc, amount: 20000, date: '2026-01-10', currency: 'LKR' }, o)
    const gone = newId()
    await saveRecord(db, 'loanRepayments', { id: gone, loanId: loan, accountId: acc, amount: 5000, date: '2026-01-11', currency: 'LKR', deletedAt: '2026-01-12T00:00:00.000Z' }, o)

    const ob = newId()
    await saveRecord(db, 'obligations', { id: ob, name: 'Internet', amount: 450000, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: '2026-02-01', reminderDays: 3, essential: true, active: true }, o)
    const occ = newId()
    await saveRecord(db, 'occurrences', { id: occ, obligationId: ob, dueDate: '2026-02-01', expectedAmount: 450000, currency: 'LKR' }, o)
    await saveRecord(db, 'transactions', { id: newId(), type: 'expense', accountId: acc, amount: 200000, currency: 'LKR', date: '2026-02-01', description: 'Internet (part)', status: 'posted', occurrenceId: occ }, o)

    const data = await loadAppData(db)
    expect(data.ledger.loans[0].repayments.map((r) => r.amount)).toEqual([20000])
    expect(data.occurrences[0].paidAmount).toBe(200000)
    expect(remainingAmount(data.occurrences[0])).toBe(250000)
    // loan: 100000 − 50000 lent + 20000 repaid − 200000 bill... balance check
    expect(availableMoney(data.ledger, '2026-12-31').physical).toBe(100000 - 50000 + 20000 - 200000)
  })
})

describe('bill occurrence generation', () => {
  it('is idempotent and uses deterministic ids', async () => {
    const o = { syncEnabled: false }
    const ob = newId()
    await saveRecord(db, 'obligations', { id: ob, name: 'Rent', amount: 2500000, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: '2026-10-27', reminderDays: 3, essential: true, active: true }, o)
    const data = await loadAppData(db)
    const first = await ensureOccurrences(db, data.obligations, '2026-10-21', false)
    const again = await ensureOccurrences(db, data.obligations, '2026-10-21', false)
    expect(first).toBeGreaterThan(3)
    expect(again).toBe(0)
    const rows = await db.occurrences.toArray()
    expect(new Set(rows.map((r) => r.dueDate)).size).toBe(rows.length)
    expect(rows[0].id).toBe(await stableId(`${ob}@${rows[0].dueDate}`))
    expect(monthKey(rows.map((r) => r.dueDate).sort()[0])).toBe('2026-10')
  })
})
