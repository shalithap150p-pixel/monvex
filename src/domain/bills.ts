import {
  addDays,
  addMonths,
  compareDates,
  diffDays,
  parseDate,
  type ISODate,
} from './dates'
import type { Minor } from './money'
import type {
  Frequency,
  OccurrenceStatus,
  PaymentObligation,
  PaymentOccurrence,
} from './types'

const MONTH_STEP: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 }

/** Due dates of an obligation inside [from, to]. Keeps the anchor day (31st clamps, then recovers). */
export function dueDatesBetween(ob: PaymentObligation, from: ISODate, to: ISODate): ISODate[] {
  if (!ob.active) return []
  const last = ob.endDate && ob.endDate < to ? ob.endDate : to
  const out: ISODate[] = []

  if (ob.frequency === 'once') {
    if (ob.dueDate >= from && ob.dueDate <= last) out.push(ob.dueDate)
    return out
  }

  if (ob.frequency === 'weekly') {
    let d = ob.dueDate
    if (d < from) {
      const skip = Math.floor(diffDays(from, d) / 7)
      d = addDays(d, skip * 7)
      if (d < from) d = addDays(d, 7)
    }
    for (; d <= last; d = addDays(d, 7)) out.push(d)
    return out
  }

  const step = MONTH_STEP[ob.frequency]!
  const anchorDay = parseDate(ob.dueDate).day
  for (let i = 0; ; i++) {
    const d = addMonths(ob.dueDate, i * step, anchorDay)
    if (d > last) break
    if (d >= from) out.push(d)
    if (i > 2400) break // safety net
  }
  return out
}

export const occurrenceKey = (obligationId: string, dueDate: ISODate) => `${obligationId}@${dueDate}`

/**
 * Create the missing occurrences for a window. Idempotent: an occurrence that
 * already exists for (obligation, dueDate) is never recreated or modified, so
 * editing a recurring rule cannot rewrite paid history.
 */
export function generateOccurrences(
  obligations: readonly PaymentObligation[],
  existing: readonly PaymentOccurrence[],
  from: ISODate,
  to: ISODate,
  makeId: () => string,
  nowIso: string,
): PaymentOccurrence[] {
  const have = new Set(existing.map((o) => occurrenceKey(o.obligationId, o.dueDate)))
  const created: PaymentOccurrence[] = []
  for (const ob of obligations) {
    if (ob.deletedAt) continue
    for (const due of dueDatesBetween(ob, from, to)) {
      const key = occurrenceKey(ob.id, due)
      if (have.has(key)) continue
      have.add(key)
      created.push({
        id: makeId(),
        obligationId: ob.id,
        dueDate: due,
        expectedAmount: ob.amount,
        paidAmount: 0,
        paidTransactionIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }
  }
  return created
}

export function remainingAmount(o: PaymentOccurrence): Minor {
  return Math.max(0, o.expectedAmount - o.paidAmount)
}

export function occurrenceStatus(
  o: PaymentOccurrence,
  today: ISODate,
  reminderDays: number,
): OccurrenceStatus {
  if (o.paidAmount >= o.expectedAmount) return 'paid'
  if (o.dueDate < today) return 'overdue'
  if (o.paidAmount > 0) return 'partially_paid'
  if (o.dueDate === today) return 'due'
  if (diffDays(o.dueDate, today) <= reminderDays) return 'unpaid'
  return 'upcoming'
}

export class DuplicatePaymentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicatePaymentError'
  }
}

/**
 * Apply a payment transaction to an occurrence. Refuses to apply the same
 * transaction twice, and refuses to overpay a settled occurrence.
 */
export function applyPayment(
  o: PaymentOccurrence,
  txnId: string,
  amount: Minor,
  nowIso: string,
): PaymentOccurrence {
  if (o.paidTransactionIds.includes(txnId)) {
    throw new DuplicatePaymentError('This payment is already linked to the bill.')
  }
  if (o.paidAmount >= o.expectedAmount) {
    throw new DuplicatePaymentError('This bill occurrence is already fully paid.')
  }
  if (amount <= 0) throw new Error('Payment amount must be positive')
  return {
    ...o,
    paidAmount: o.paidAmount + amount,
    paidTransactionIds: [...o.paidTransactionIds, txnId],
    updatedAt: nowIso,
  }
}

/** Reverse a payment (when the linked transaction is edited/deleted). */
export function removePayment(
  o: PaymentOccurrence,
  txnId: string,
  amount: Minor,
  nowIso: string,
): PaymentOccurrence {
  if (!o.paidTransactionIds.includes(txnId)) return o
  return {
    ...o,
    paidAmount: Math.max(0, o.paidAmount - amount),
    paidTransactionIds: o.paidTransactionIds.filter((id) => id !== txnId),
    updatedAt: nowIso,
  }
}

export function sortByDue<T extends { dueDate: ISODate }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareDates(a.dueDate, b.dueDate))
}
