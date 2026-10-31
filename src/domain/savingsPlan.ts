import { diffDays, type ISODate } from './dates'
import { decimalsFor, formatMoney, type Minor } from './money'
import type { GoalPriority, SavingsGoal } from './types'

/**
 * Smart savings recommendation.
 *
 * This is a transparent, rules-based planner (not a hidden model): every number can be
 * traced back to the user's own data, and every line says why it was recommended.
 *
 *   1. Capacity = what the user can realistically set aside this month:
 *        - at most HALF of the flexible pool (the other half stays available for spending),
 *        - and, when there are past months, no more than what the user actually kept on average.
 *   2. Each active goal has an "ideal" monthly amount (remaining ÷ months to its target date,
 *      or ÷ 12 when it has no date).
 *   3. Capacity is shared by priority weight (high 3 · medium 2 · low 1), no goal gets more
 *      than it needs, and anything a capped goal cannot use flows to the others.
 *   4. If capacity is smaller than the ideal total, every goal gets a lower, realistic amount —
 *      the recommendation never creates a negative Safe-to-Spend.
 *
 * Nothing is applied automatically: the user edits and approves, and MONVEX never moves money.
 */

export const PRIORITY_WEIGHT: Record<GoalPriority, number> = { high: 3, medium: 2, low: 1 }
export const DEFAULT_GOAL_MONTHS = 12
/** Share of the flexible pool that may be recommended for savings. */
export const MAX_POOL_SHARE = 0.5

export interface MonthlyHistory {
  /** Completed month, YYYY-MM. */
  month: string
  income: Minor
  expense: Minor
}

export interface SavingsPlanInput {
  today: ISODate
  currency: string
  goals: readonly SavingsGoal[]
  /** Flexible pool WITHOUT any approved contributions reserved (current pool + approved contributions). */
  basePool: Minor
  /** Completed past months of real income/expense (most recent first, up to 3 are used). */
  history: readonly MonthlyHistory[]
}

export interface PlanLine {
  goalId: string
  name: string
  priority: GoalPriority
  target: Minor
  allocated: Minor
  remaining: Minor
  /** Months until the target date (min 1), or null when the goal has no date. */
  monthsLeft: number | null
  dateBased: boolean
  /** Monthly amount needed to reach the goal on time (or over 12 months when there is no date). */
  idealMonthly: Minor
  approvedMonthly: Minor
  recommended: Minor
  /** recommended covers everything needed. */
  onTrack: boolean
  /** Months to finish at the recommended amount (null when nothing is recommended). */
  monthsToFinish: number | null
  reason: string
}

export interface SavingsPlan {
  capacity: Minor
  poolCapacity: Minor
  /** Average net kept per month over past months (null when there is no history). */
  averageKept: Minor | null
  historyMonths: number
  lines: PlanLine[]
  completed: SavingsGoal[]
  totalIdeal: Minor
  totalRecommended: Minor
  totalApproved: Minor
  /** The ideal amounts all fit in the capacity. */
  affordable: boolean
  /** The user's approved amounts are larger than today's capacity. */
  approvedExceedsCapacity: boolean
  explanation: string[]
  warnings: string[]
}

const floorTo = (v: number, unit: number) => Math.floor(v / unit) * unit
const ceilTo = (v: number, unit: number) => Math.ceil(v / unit) * unit

export function monthsUntil(from: ISODate, to: ISODate): number {
  return Math.max(1, Math.ceil(diffDays(to, from) / 30.4375))
}

export function buildSavingsPlan(input: SavingsPlanInput): SavingsPlan {
  const { today, currency } = input
  const unit = 10 ** decimalsFor(currency)
  const money = (m: Minor) => formatMoney(m, currency)
  const explanation: string[] = []
  const warnings: string[] = []

  const live = input.goals.filter((g) => !g.deletedAt)
  const completed = live.filter((g) => g.allocated >= g.target)
  const active = live.filter((g) => g.allocated < g.target)

  // ---- capacity ---------------------------------------------------------------
  const basePool = Math.max(0, input.basePool)
  const poolCapacity = floorTo(basePool * MAX_POOL_SHARE, unit)
  const recent = input.history.slice(0, 3)
  const averageKept = recent.length ? Math.round(recent.reduce((s, h) => s + (h.income - h.expense), 0) / recent.length) : null
  const keptCapacity = averageKept === null ? null : floorTo(Math.max(0, averageKept), unit)
  const capacity = keptCapacity === null ? poolCapacity : Math.min(poolCapacity, keptCapacity)

  if (input.basePool <= 0) {
    warnings.push('There is no spare flexible money right now, so nothing is recommended. Safe-to-Spend is not pushed below zero for savings.')
  } else {
    explanation.push(
      `Your flexible pool is ${money(basePool)}. At most half of it (${money(poolCapacity)}) is suggested for savings so you keep money for everyday spending.`,
    )
  }
  if (averageKept === null) {
    explanation.push('There are no completed past months yet, so the suggestion is based on your current flexible pool only.')
  } else if (averageKept <= 0) {
    explanation.push(`In the last ${recent.length} completed month${recent.length === 1 ? '' : 's'} you did not keep any money on average, so a larger saving than ${money(capacity)} would not be realistic.`)
  } else if (keptCapacity !== null && keptCapacity < poolCapacity) {
    explanation.push(`In the last ${recent.length} completed month${recent.length === 1 ? '' : 's'} you kept ${money(averageKept)} per month on average, so the suggestion is limited to what you have really been able to save.`)
  } else {
    explanation.push(`In the last ${recent.length} completed month${recent.length === 1 ? '' : 's'} you kept ${money(averageKept)} per month on average, which supports this amount.`)
  }

  // ---- ideal monthly amount per goal -------------------------------------------
  const base = active.map((g) => {
    const remaining = g.target - g.allocated
    const dateBased = Boolean(g.targetDate)
    const monthsLeft = g.targetDate ? monthsUntil(today, g.targetDate) : null
    const months = monthsLeft ?? DEFAULT_GOAL_MONTHS
    const ideal = Math.min(remaining, ceilTo(remaining / months, unit))
    const priority: GoalPriority = g.priority ?? 'medium'
    return { g, remaining, dateBased, monthsLeft, ideal, priority, weight: PRIORITY_WEIGHT[priority] }
  })

  // ---- water-filling by priority weight ---------------------------------------
  const given = new Map<string, number>(base.map((b) => [b.g.id, 0]))
  let pool = capacity
  for (let pass = 0; pass < base.length + 2 && pool >= unit; pass++) {
    const open = base.filter((b) => (given.get(b.g.id) ?? 0) < b.ideal)
    if (open.length === 0) break
    const totalWeight = open.reduce((s, b) => s + b.weight, 0)
    let progress = 0
    for (const b of open) {
      const share = floorTo((pool * b.weight) / totalWeight, unit)
      const give = Math.min(share, b.ideal - (given.get(b.g.id) ?? 0))
      if (give > 0) {
        given.set(b.g.id, (given.get(b.g.id) ?? 0) + give)
        progress += give
      }
    }
    pool -= progress
    if (progress === 0) {
      // Leftover smaller than one share per goal: hand it out unit by unit, highest priority first.
      const ordered = [...open].sort((a, b) => b.weight - a.weight)
      for (const b of ordered) {
        if (pool < unit) break
        const room = b.ideal - (given.get(b.g.id) ?? 0)
        const give = Math.min(room, floorTo(pool, unit))
        if (give > 0) {
          given.set(b.g.id, (given.get(b.g.id) ?? 0) + give)
          pool -= give
        }
      }
      break
    }
  }

  const lines: PlanLine[] = base
    .map((b): PlanLine => {
      const recommended = given.get(b.g.id) ?? 0
      const onTrack = recommended >= b.ideal
      const monthsToFinish = recommended > 0 ? Math.ceil(b.remaining / recommended) : null
      const need = b.dateBased
        ? `needs ${money(b.ideal)}/month to reach ${money(b.g.target)} by ${b.g.targetDate}`
        : `has no target date, so ${money(b.ideal)}/month (over ${DEFAULT_GOAL_MONTHS} months) is used as the guide`
      const share = onTrack
        ? 'Fully covered.'
        : recommended > 0
          ? `Recommended ${money(recommended)} covers ${Math.round((recommended / b.ideal) * 100)}% of that, so the goal will take about ${monthsToFinish} month${monthsToFinish === 1 ? '' : 's'}${b.dateBased && b.monthsLeft ? ` instead of ${b.monthsLeft}` : ''}.`
          : 'There is no spare money to put towards it this month.'
      return {
        goalId: b.g.id,
        name: b.g.name,
        priority: b.priority,
        target: b.g.target,
        allocated: b.g.allocated,
        remaining: b.remaining,
        monthsLeft: b.monthsLeft,
        dateBased: b.dateBased,
        idealMonthly: b.ideal,
        approvedMonthly: b.g.monthlyContribution ?? 0,
        recommended,
        onTrack,
        monthsToFinish,
        reason: `${b.priority[0].toUpperCase()}${b.priority.slice(1)} priority · ${need}. ${share}`,
      }
    })
    .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.name.localeCompare(b.name))

  const totalIdeal = lines.reduce((s, l) => s + l.idealMonthly, 0)
  const totalRecommended = lines.reduce((s, l) => s + l.recommended, 0)
  const totalApproved = live.reduce((s, g) => s + (g.allocated < g.target ? g.monthlyContribution ?? 0 : 0), 0)
  const affordable = totalRecommended >= totalIdeal

  if (lines.length === 0) {
    explanation.push(completed.length ? 'All your goals are complete.' : 'You have no active goals yet. Add a goal to get a savings suggestion.')
  } else if (!affordable) {
    explanation.push(`Reaching every goal on time needs ${money(totalIdeal)} per month, but ${money(capacity)} is realistic now — so each goal gets a lower amount, shared by priority (high 3 · medium 2 · low 1).`)
  } else {
    explanation.push(`All goals can be funded on time: ${money(totalIdeal)} per month of ${money(capacity)} available.`)
  }

  const approvedExceedsCapacity = totalApproved > capacity && totalApproved > 0
  if (approvedExceedsCapacity) {
    warnings.push(`You approved ${money(totalApproved)} per month, which is more than the ${money(capacity)} that looks realistic now. Consider lowering it.`)
  }

  return {
    capacity,
    poolCapacity,
    averageKept,
    historyMonths: recent.length,
    lines,
    completed,
    totalIdeal,
    totalRecommended,
    totalApproved,
    affordable,
    approvedExceedsCapacity,
    explanation,
    warnings,
  }
}
