import { diffDays, type ISODate } from './dates'
import { remainingAmount } from './bills'
import type { Minor } from './money'
import type { PaymentObligation, PaymentOccurrence, SavingsGoal } from './types'

export interface SafeToSpendInput {
  today: ISODate
  /** Own available money (physical balances − money held for others). */
  availableFunds: Minor
  /** First day after the calculation window: payday, or today + period. */
  periodEnd: ISODate
  obligations: readonly PaymentObligation[]
  occurrences: readonly PaymentOccurrence[]
  goals: readonly SavingsGoal[]
  essentialDailyAmount: Minor
  safetyBuffer: Minor
  carryForward: boolean
  /** Fixed daily allowance used when carry-forward is off. */
  fixedDailyAllowance?: Minor
  hasPayday: boolean
  hasAnyAccount: boolean
}

export interface ReservedItem {
  id: string
  label: string
  dueDate: ISODate | null
  amount: Minor
  kind: 'bill' | 'essentials' | 'goal' | 'buffer'
}

export interface SafeToSpendResult {
  safeToSpend: Minor
  shortfall: Minor // > 0 when the result is negative
  periodStart: ISODate
  periodEnd: ISODate
  daysRemaining: number
  availableFunds: Minor
  totalReserved: Minor
  reserved: ReservedItem[]
  dailyAllowance: Minor
  confidence: 'normal' | 'low'
  assumptions: string[]
  warnings: string[]
}

/**
 * Explainable, rules-based Safe-to-Spend:
 *   available funds − unpaid bills due in the window − essentials − reserved goals − buffer.
 * Expected salary / receivables are never added here (they are forecast only).
 * Each occurrence is reserved at most once, and only for what remains unpaid.
 */
export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { today, periodEnd } = input
  const daysRemaining = Math.max(1, diffDays(periodEnd, today))
  const reserved: ReservedItem[] = []
  const warnings: string[] = []
  const assumptions: string[] = []

  const obMap = new Map(input.obligations.map((o) => [o.id, o]))
  const seen = new Set<string>()
  for (const occ of input.occurrences) {
    if (occ.deletedAt || seen.has(occ.id)) continue
    seen.add(occ.id)
    const ob = obMap.get(occ.obligationId)
    if (!ob || ob.deletedAt || !ob.active) continue
    if (occ.dueDate >= periodEnd) continue // outside the window
    const remaining = remainingAmount(occ)
    if (remaining <= 0) continue
    reserved.push({
      id: occ.id,
      label: ob.name,
      dueDate: occ.dueDate,
      amount: remaining,
      kind: 'bill',
    })
    if (ob.isEstimate) warnings.push(`"${ob.name}" uses an estimated amount.`)
    if (occ.dueDate < today) warnings.push(`"${ob.name}" is overdue and has been reserved in full.`)
  }

  const essentials = input.essentialDailyAmount * daysRemaining
  if (essentials > 0) {
    reserved.push({
      id: 'essentials',
      label: `Essentials (${daysRemaining} days)`,
      dueDate: null,
      amount: essentials,
      kind: 'essentials',
    })
    assumptions.push('Essential spending is your configured daily amount; bills are reserved separately so they are not counted twice.')
  } else {
    warnings.push('No essential daily spending is configured, so day-to-day costs are not reserved.')
  }

  for (const g of input.goals) {
    if (g.deletedAt || !g.reserveInSafeToSpend || g.allocated <= 0) continue
    reserved.push({ id: g.id, label: `Savings goal: ${g.name}`, dueDate: null, amount: g.allocated, kind: 'goal' })
  }
  if (input.safetyBuffer > 0) {
    reserved.push({ id: 'buffer', label: 'Safety buffer', dueDate: null, amount: input.safetyBuffer, kind: 'buffer' })
  }

  const totalReserved = reserved.reduce((s, r) => s + r.amount, 0)
  const safeToSpend = input.availableFunds - totalReserved

  assumptions.push(
    input.hasPayday
      ? `Window ends on payday (${periodEnd}). Expected salary is not counted as cash.`
      : `No payday configured; using a ${daysRemaining}-day window ending ${periodEnd}.`,
  )
  assumptions.push('Money held for other people and uncollected receivables are excluded from available funds.')

  if (!input.hasAnyAccount) warnings.push('Add an account so Safe-to-Spend can use real balances.')
  if (input.obligations.length === 0) warnings.push('No bills are recorded, so upcoming obligations may be missing.')
  if (!input.hasPayday) warnings.push('Set your payday in Settings for a more accurate window.')

  const confidence: 'normal' | 'low' =
    !input.hasAnyAccount || input.obligations.length === 0 || input.essentialDailyAmount === 0 ? 'low' : 'normal'

  const positive = Math.max(0, safeToSpend)
  const evenly = Math.floor(positive / daysRemaining)
  const dailyAllowance =
    input.carryForward || input.fixedDailyAllowance === undefined
      ? evenly
      : Math.min(input.fixedDailyAllowance, positive)

  if (safeToSpend < 0) warnings.unshift(`You may be short by this amount before ${periodEnd}.`)

  return {
    safeToSpend,
    shortfall: safeToSpend < 0 ? -safeToSpend : 0,
    periodStart: today,
    periodEnd,
    daysRemaining,
    availableFunds: input.availableFunds,
    totalReserved,
    reserved,
    dailyAllowance,
    confidence,
    assumptions,
    warnings,
  }
}
