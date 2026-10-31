import { computeSafeToSpend, type ReservedItem, type SafeToSpendInput, type SafeToSpendResult } from './safeToSpend'
import type { Minor } from './money'

/**
 * Daily Safe-to-Spend.
 *
 * The flexible pool is turned into a daily allowance (pool ÷ days left). Nothing is
 * "discarded at midnight": money you did not spend today simply stays in the pool,
 * so tomorrow's allowance is recalculated from what is really left.
 *
 * "Spent today" is the part of today's everyday spending that actually used the
 * flexible pool. Spending that is covered elsewhere is NOT charged twice:
 *   - bill payments are already reserved as bills,
 *   - spending inside a category budget uses that budget's reserved money,
 *   - your daily essentials amount is reserved separately, so the first part of
 *     everyday spending is charged to it.
 * To measure this we recompute the pool as it was before today's everyday expenses
 * (same income, same bills, same everything else) and compare it with the pool now.
 */

export type DailyStatus = 'healthy' | 'warning' | 'overspent' | 'shortfall'

export interface DailySafeToSpendInput extends SafeToSpendInput {
  /** Accounts whose balances make up availableFunds (active accounts). */
  activeAccountIds?: ReadonlySet<string>
}

export interface DailySafeToSpend {
  /** The full result for right now (reserved items, assumptions, warnings…). */
  now: SafeToSpendResult
  /**
   * Flexible pool right now (= pool at start of day − today's spending that used it).
   * Differs from now.safeToSpend only by the essentials already spent today (reserved earlier, now used).
   */
  pool: Minor
  /** Reserved items with today's already-spent essentials taken out, so that available − reserved = pool. */
  reserved: ReservedItem[]
  totalReserved: Minor
  /** Flexible pool before today's everyday spending (includes today's income, bills, budget changes). */
  poolAtStartOfDay: Minor
  daysRemaining: number
  /** Today's recommended allowance. Never exceeds the pool. */
  allowanceToday: Minor
  /** Part of today's spending that used the flexible pool. */
  spentToday: Minor
  /** allowanceToday − spentToday. Negative means overspent. */
  remainingToday: Minor
  overspentToday: Minor
  /** Everything posted as an expense today (bills included) — information. */
  totalSpentToday: Minor
  billsPaidToday: Minor
  /** Everyday spending today that used money already reserved in category budgets. */
  coveredByBudgetsToday: Minor
  /** Everyday spending today charged to the daily essentials amount. */
  coveredByEssentialsToday: Minor
  /** Pending expenses dated today (reserved, but not yet out of the account). */
  pendingToday: Minor
  /** Allowance tomorrow if nothing else changes (null on the last day of the window). */
  tomorrowAllowance: Minor | null
  /** Allowance tomorrow if today had ended exactly on the recommendation. */
  tomorrowIfOnPlan: Minor | null
  status: DailyStatus
  /** Plain-language, data-based explanation lines. */
  explanation: string[]
}

const WARNING_SHARE = 0.8

export function computeDailySafeToSpend(input: DailySafeToSpendInput): DailySafeToSpend {
  const { today } = input
  const now = computeSafeToSpend(input)
  const days = now.daysRemaining

  // Today's everyday expenses: everything except bill payments (those are reserved as bills).
  const everydayToday = (input.transactions ?? []).filter(
    (t) => !t.deletedAt && t.type === 'expense' && t.date === today && !t.occurrenceId,
  )
  const postedEveryday = everydayToday.filter((t) => t.status === 'posted')
  const pendingEveryday = everydayToday.filter((t) => t.status === 'pending')
  const everydayIds = new Set(everydayToday.map((t) => t.id))
  const addBack = postedEveryday
    .filter((t) => !input.activeAccountIds || input.activeAccountIds.has(t.accountId))
    .reduce((s, t) => s + t.amount, 0)

  const start =
    everydayToday.length === 0
      ? now
      : computeSafeToSpend({
          ...input,
          availableFunds: input.availableFunds + addBack,
          transactions: (input.transactions ?? []).filter((t) => !everydayIds.has(t.id)),
        })

  const everydayTotal = everydayToday.reduce((s, t) => s + t.amount, 0)
  // How much of today's everyday spending really reduced the pool (after budgets absorbed their share).
  const poolImpact = Math.max(0, start.safeToSpend - now.safeToSpend)
  const coveredByBudgets = Math.max(0, everydayTotal - poolImpact)
  const essentialsPerDay = now.essentialPerDayUncovered
  const coveredByEssentials = Math.min(poolImpact, essentialsPerDay)
  const spentToday = Math.max(0, poolImpact - essentialsPerDay)
  const pool = now.safeToSpend + coveredByEssentials
  const reserved = now.reserved
    .map((r) => (r.kind === 'essentials' ? { ...r, amount: r.amount - coveredByEssentials } : r))
    .filter((r) => r.amount > 0)

  const poolAtStart = start.safeToSpend
  const allowanceToday = start.dailyAllowance // floor(max(0, pool) / days), or the fixed amount when carry-forward is off
  const remainingToday = Math.min(allowanceToday - spentToday, Math.max(0, now.safeToSpend + coveredByEssentials))
  const overspentToday = Math.max(0, spentToday - allowanceToday)

  const totalSpentToday = (input.transactions ?? [])
    .filter((t) => !t.deletedAt && t.type === 'expense' && t.date === today && t.status === 'posted')
    .reduce((s, t) => s + t.amount, 0)
  const billsPaidToday = (input.transactions ?? [])
    .filter((t) => !t.deletedAt && t.type === 'expense' && t.date === today && t.status === 'posted' && t.occurrenceId)
    .reduce((s, t) => s + t.amount, 0)
  const pendingToday = pendingEveryday.reduce((s, t) => s + t.amount, 0)

  let tomorrowAllowance: Minor | null = null
  let tomorrowIfOnPlan: Minor | null = null
  if (days > 1) {
    // Tomorrow the engine releases one day of essentials, then splits what is left over one day fewer.
    tomorrowAllowance = Math.floor(Math.max(0, now.safeToSpend + essentialsPerDay) / (days - 1))
    tomorrowIfOnPlan = Math.floor(Math.max(0, poolAtStart - allowanceToday) / (days - 1))
  }

  let status: DailyStatus
  if (pool < 0) status = 'shortfall'
  else if (spentToday > allowanceToday) status = 'overspent'
  else if (allowanceToday === 0 || (spentToday > 0 && spentToday >= allowanceToday * WARNING_SHARE)) status = 'warning'
  else status = 'healthy'

  const explanation: string[] = []
  if (status === 'shortfall') {
    explanation.push('After bills, budgets and approved savings are set aside, there is not enough money left for flexible spending until your next payday.')
  } else {
    explanation.push(`Allowance = flexible pool ÷ days left (${days} day${days === 1 ? '' : 's'}). Unspent money stays in the pool — nothing is lost at midnight.`)
  }
  if (billsPaidToday > 0) explanation.push('Bill payments made today were already reserved, so they do not reduce today\'s allowance.')
  if (coveredByBudgets > 0) explanation.push('Spending inside a category budget uses that budget\'s reserved money, so it does not reduce today\'s allowance a second time.')
  if (coveredByEssentials > 0) explanation.push('The first part of everyday spending is charged to your daily essentials amount, which is reserved separately.')
  if (overspentToday > 0 && tomorrowAllowance !== null && tomorrowIfOnPlan !== null) {
    explanation.push(
      tomorrowAllowance < tomorrowIfOnPlan
        ? 'You went over today\'s recommendation. That is allowed — it only lowers the allowance for the remaining days. Your budgets and goals were not changed.'
        : 'You went over today\'s recommendation, but your daily essentials amount covers it, so tomorrow\'s allowance is not lower.',
    )
  }
  if (pendingToday > 0) explanation.push('Pending expenses are already reserved, so they count as spent until they settle.')

  return {
    now,
    pool,
    reserved,
    totalReserved: reserved.reduce((a, r) => a + r.amount, 0),
    poolAtStartOfDay: poolAtStart,
    daysRemaining: days,
    allowanceToday,
    spentToday,
    remainingToday,
    overspentToday,
    totalSpentToday,
    billsPaidToday,
    coveredByBudgetsToday: coveredByBudgets,
    coveredByEssentialsToday: coveredByEssentials,
    pendingToday,
    tomorrowAllowance,
    tomorrowIfOnPlan,
    status,
    explanation,
  }
}
