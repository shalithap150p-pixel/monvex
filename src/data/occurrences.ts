import { addDays, type ISODate } from '../domain/dates'
import { dueDatesBetween, occurrenceKey } from '../domain/bills'
import type { PaymentObligation } from '../domain/types'
import type { MonvexDB } from './db'
import { saveRecord } from './repo'

/** Deterministic UUID from text, so two devices generating the same occurrence agree on its id. */
export async function stableId(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Create any missing payment occurrences for the next months. Idempotent:
 * existing occurrences are never touched, so paid history is never rewritten.
 * Returns how many were created.
 */
export async function ensureOccurrences(
  db: MonvexDB,
  obligations: readonly PaymentObligation[],
  today: ISODate,
  syncEnabled: boolean,
): Promise<number> {
  const from = addDays(today, -90)
  const to = addDays(today, 150)
  const existing = await db.occurrences.toArray()
  const have = new Set(existing.map((o) => occurrenceKey(o.obligationId, o.dueDate)))
  let created = 0
  for (const ob of obligations) {
    if (ob.deletedAt || !ob.active) continue
    for (const due of dueDatesBetween(ob, from < ob.dueDate ? ob.dueDate : from, to)) {
      const key = occurrenceKey(ob.id, due)
      if (have.has(key)) continue
      have.add(key)
      await saveRecord(
        db,
        'occurrences',
        { id: await stableId(key), obligationId: ob.id, dueDate: due, expectedAmount: ob.amount, currency: ob.currency },
        { syncEnabled },
      )
      created++
    }
  }
  return created
}
