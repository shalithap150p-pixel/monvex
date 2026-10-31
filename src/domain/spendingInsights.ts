import { addDays, daysInMonth, eachDay, monthKey, parseDate, toISO, type ISODate } from './dates'
import type { BudgetStatus } from './budgets'
import { categoryOfExpense, type BillLinks } from './budgets'
import type { DailySafeToSpend } from './dailySafeToSpend'
import { formatMoney, type Minor } from './money'
import type { SavingsPlan } from './savingsPlan'
import type { Transaction } from './types'

/** Everything here is computed from the user's own posted transactions — nothing is estimated unless it says so. */

export interface DaySpending {
  date: ISODate
  /** Bill payments. */
  bills: Minor
  /** Everyday spending (everything except bill payments). */
  everyday: Minor
  total: Minor
}

const isSpend = (t: Transaction) => !t.deletedAt && t.type === 'expense' && t.status === 'posted'

export function dailySpending(transactions: readonly Transaction[], today: ISODate, days = 14): DaySpending[] {
  const from = addDays(today, -(days - 1))
  const map = new Map<ISODate, DaySpending>(eachDay(from, today).map((date) => [date, { date, bills: 0, everyday: 0, total: 0 }]))
  for (const t of transactions) {
    if (!isSpend(t)) continue
    const row = map.get(t.date)
    if (!row) continue
    if (t.occurrenceId) row.bills += t.amount
    else row.everyday += t.amount
    row.total += t.amount
  }
  return [...map.values()]
}

export interface SpendingTrend {
  /** Everyday spending in the last 7 days (including today) and the 7 days before. */
  last7: Minor
  previous7: Minor
  /** Percent change, or null when there is no earlier week to compare. */
  weekChangePct: number | null
  /** Everyday spending this month so far, and last month up to the same day. */
  monthToDate: Minor
  lastMonthSamePoint: Minor
  monthChangePct: number | null
  hasLastMonthData: boolean
}

const everydaySum = (transactions: readonly Transaction[], from: ISODate, to: ISODate) =>
  transactions.reduce((s, t) => (isSpend(t) && !t.occurrenceId && t.date >= from && t.date <= to ? s + t.amount : s), 0)

function lastMonthWindow(today: ISODate): { from: ISODate; to: ISODate } {
  const { y, m, day } = parseDate(today)
  const ly = m === 1 ? y - 1 : y
  const lm = m === 1 ? 12 : m - 1
  return { from: toISO(ly, lm, 1), to: toISO(ly, lm, Math.min(day, daysInMonth(ly, lm))) }
}

export function spendingTrend(transactions: readonly Transaction[], today: ISODate): SpendingTrend {
  const last7 = everydaySum(transactions, addDays(today, -6), today)
  const previous7 = everydaySum(transactions, addDays(today, -13), addDays(today, -7))
  const monthToDate = everydaySum(transactions, `${monthKey(today)}-01`, today)
  const w = lastMonthWindow(today)
  const lastMonthSamePoint = everydaySum(transactions, w.from, w.to)
  const hasLastMonthData = transactions.some((t) => isSpend(t) && t.date >= w.from && t.date <= w.to)
  const pct = (now: Minor, before: Minor) => (before > 0 ? ((now - before) / before) * 100 : null)
  return {
    last7,
    previous7,
    weekChangePct: pct(last7, previous7),
    monthToDate,
    lastMonthSamePoint,
    monthChangePct: hasLastMonthData ? pct(monthToDate, lastMonthSamePoint) : null,
    hasLastMonthData,
  }
}

export type InsightTone = 'positive' | 'neutral' | 'warning' | 'negative'
/** fact = measured from your records · projection = "if this pace continues" · suggestion = a recommendation */
export type InsightKind = 'fact' | 'projection' | 'suggestion'

export interface Insight {
  id: string
  tone: InsightTone
  kind: InsightKind
  text: string
}

export interface InsightInput {
  today: ISODate
  currency: string
  daily: DailySafeToSpend
  budgets: readonly BudgetStatus[]
  plan: SavingsPlan
  transactions: readonly Transaction[]
  categoryNames: ReadonlyMap<string, string>
  links?: BillLinks
}

const TONE_ORDER: Record<InsightTone, number> = { negative: 0, warning: 1, neutral: 2, positive: 3 }

export function buildInsights(input: InsightInput): Insight[] {
  const { today, currency, daily, budgets, plan } = input
  const money = (m: Minor) => formatMoney(m, currency)
  const out: Insight[] = []

  // ---- flexible pool ----------------------------------------------------------
  if (daily.pool < 0) {
    out.push({
      id: 'pool-short',
      tone: 'negative',
      kind: 'fact',
      text: `After your bills, budgets and approved savings, you may be short by ${money(-daily.pool)} before ${daily.now.periodEnd}.`,
    })
  } else if (daily.pool > 0) {
    out.push({
      id: 'pool',
      tone: 'positive',
      kind: 'fact',
      text: `You have ${money(daily.pool)} available for flexible spending until ${daily.now.periodEnd} (${daily.daysRemaining} day${daily.daysRemaining === 1 ? '' : 's'}).`,
    })
  } else {
    out.push({ id: 'pool-zero', tone: 'warning', kind: 'fact', text: 'Everything you have is already set aside for bills, budgets, essentials or savings.' })
  }

  // ---- today -------------------------------------------------------------------
  if (daily.status === 'overspent' && daily.tomorrowAllowance !== null && daily.tomorrowIfOnPlan !== null) {
    out.push({
      id: 'overspent-today',
      tone: 'warning',
      kind: 'fact',
      text: `You are ${money(daily.overspentToday)} over today's recommendation. Tomorrow's allowance becomes ${money(daily.tomorrowAllowance)} instead of ${money(daily.tomorrowIfOnPlan)}. Your budgets and goals were not changed.`,
    })
  }

  // ---- budgets -----------------------------------------------------------------
  for (const b of budgets) {
    if (b.health === 'over') {
      out.push({
        id: `budget-over-${b.budget.id}`,
        tone: 'negative',
        kind: 'fact',
        text: `You are ${money(b.overBy)} over your ${b.categoryName} budget (${money(b.spent)} of ${money(b.limit)}).`,
      })
    } else if (b.health === 'warning') {
      out.push({
        id: `budget-warn-${b.budget.id}`,
        tone: 'warning',
        kind: 'fact',
        text: `You have spent ${Math.round(b.usedPct)}% of your ${b.categoryName} budget (${money(b.spent)} of ${money(b.limit)}); ${money(b.remaining)} is left.`,
      })
    }
    if (b.aheadOfPace && b.spent > 0 && b.monthElapsedPct > 0) {
      const projected = Math.round(b.spent / (b.monthElapsedPct / 100))
      out.push({
        id: `budget-pace-${b.budget.id}`,
        tone: 'warning',
        kind: 'projection',
        text: `${b.categoryName}: ${Math.round(b.usedPct)}% of the budget is used with ${Math.round(b.monthElapsedPct)}% of the month gone. If this pace continues you would reach about ${money(projected)} by month end (limit ${money(b.limit)}).`,
      })
    }
  }

  // ---- goals -------------------------------------------------------------------
  const awaiting = plan.lines.length > 0 && plan.totalApproved === 0 && plan.totalRecommended > 0
  if (awaiting) {
    out.push({
      id: 'plan-awaiting',
      tone: 'neutral',
      kind: 'suggestion',
      text: `A savings suggestion of ${money(plan.totalRecommended)} per month is waiting for your approval in Budgets & goals. Nothing is set aside until you approve it.`,
    })
  }
  for (const l of plan.lines) {
    if (l.approvedMonthly > 0 && l.approvedMonthly >= l.idealMonthly) {
      out.push({ id: `goal-ok-${l.goalId}`, tone: 'positive', kind: 'fact', text: `${l.name} is progressing according to plan: ${money(l.approvedMonthly)} per month is approved and ${money(l.idealMonthly)} is needed.` })
    } else if (l.approvedMonthly > 0 && l.dateBased) {
      out.push({
        id: `goal-behind-${l.goalId}`,
        tone: 'warning',
        kind: 'fact',
        text: `${l.name}: ${money(l.approvedMonthly)} per month is approved but ${money(l.idealMonthly)} is needed to finish by the target date.`,
      })
    }
  }
  if (plan.approvedExceedsCapacity) {
    out.push({ id: 'plan-exceeds', tone: 'warning', kind: 'fact', text: `Your approved savings (${money(plan.totalApproved)} per month) are more than the ${money(plan.capacity)} that looks realistic right now.` })
  }

  // ---- trends ------------------------------------------------------------------
  const trend = spendingTrend(input.transactions, today)
  if (trend.weekChangePct !== null && trend.previous7 > 0) {
    if (trend.weekChangePct >= 25) {
      out.push({ id: 'trend-week-up', tone: 'warning', kind: 'fact', text: `Everyday spending in the last 7 days (${money(trend.last7)}) is ${Math.round(trend.weekChangePct)}% higher than the 7 days before (${money(trend.previous7)}).` })
    } else if (trend.weekChangePct <= -25) {
      out.push({ id: 'trend-week-down', tone: 'positive', kind: 'fact', text: `Everyday spending in the last 7 days (${money(trend.last7)}) is ${Math.round(-trend.weekChangePct)}% lower than the 7 days before (${money(trend.previous7)}).` })
    }
  }

  // Biggest increase by category compared with the same point last month (real numbers only).
  if (trend.hasLastMonthData) {
    const w = lastMonthWindow(today)
    const now = new Map<string, Minor>()
    const before = new Map<string, Minor>()
    for (const t of input.transactions) {
      if (!isSpend(t) || t.occurrenceId) continue
      const cat = categoryOfExpense(t, input.links)
      if (!cat) continue
      if (t.date >= `${monthKey(today)}-01` && t.date <= today) now.set(cat, (now.get(cat) ?? 0) + t.amount)
      else if (t.date >= w.from && t.date <= w.to) before.set(cat, (before.get(cat) ?? 0) + t.amount)
    }
    let best: { cat: string; diff: Minor } | null = null
    for (const [cat, amount] of now) {
      const prev = before.get(cat) ?? 0
      const diff = amount - prev
      if (prev > 0 && diff / prev >= 0.25 && (!best || diff > best.diff)) best = { cat, diff }
    }
    if (best) {
      out.push({
        id: `trend-cat-${best.cat}`,
        tone: 'neutral',
        kind: 'suggestion',
        text: `You have spent ${money(best.diff)} more on ${input.categoryNames.get(best.cat) ?? 'one category'} than at the same point last month. Keeping it at last month's level would leave that much more for savings.`,
      })
    }
  }

  if (daily.now.confidence === 'low') {
    out.push({ id: 'low-confidence', tone: 'warning', kind: 'fact', text: 'Some information is missing (accounts, bills or daily essentials), so treat Safe-to-Spend as a rough guide.' })
  }

  // The flexible-pool statement always leads; the rest is ordered from most to least urgent.
  const [head, ...rest] = out
  return [head, ...rest.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])].slice(0, 8)
}
