import { diffDays, monthKey, monthEnd, addDays, type ISODate } from './dates'
import type { Minor } from './money'
import type { Budget, PaymentObligation, PaymentOccurrence, Transaction } from './types'

/**
 * Single source of truth for "how much of a category budget is used".
 * The Budgets page, the Safe-to-Spend engine and the insights all call this,
 * so an expense can never be counted twice or differently in different places.
 */

export interface BillLinks {
  obligations: readonly PaymentObligation[]
  occurrences: readonly PaymentOccurrence[]
}

/**
 * Category an expense counts against: its own category, otherwise the category
 * of the bill it pays (so a rent payment without a category still lands in "Housing").
 */
export function categoryOfExpense(t: Transaction, links?: BillLinks): string | null {
  if (t.categoryId) return t.categoryId
  if (!t.occurrenceId || !links) return null
  const occ = links.occurrences.find((o) => o.id === t.occurrenceId)
  if (!occ) return null
  return links.obligations.find((o) => o.id === occ.obligationId)?.categoryId ?? null
}

/** Posted expense per category in the month of `today`, up to and including `today`. */
export function spentByCategory(transactions: readonly Transaction[], today: ISODate, links?: BillLinks): Map<string, Minor> {
  const month = monthKey(today)
  const out = new Map<string, Minor>()
  for (const t of transactions) {
    if (t.deletedAt || t.type !== 'expense' || t.status !== 'posted') continue
    if (monthKey(t.date) !== month || t.date > today) continue
    const cat = categoryOfExpense(t, links)
    if (!cat) continue
    out.set(cat, (out.get(cat) ?? 0) + t.amount)
  }
  return out
}

export type BudgetHealth = 'healthy' | 'warning' | 'over'

export interface BudgetStatus {
  budget: Budget
  categoryName: string
  limit: Minor
  spent: Minor
  /** limit − spent (negative when over budget). */
  remaining: Minor
  overBy: Minor
  /** Share of the budget used, in percent (can exceed 100). */
  usedPct: number
  health: BudgetHealth
  /** Share of the month that has passed, in percent. */
  monthElapsedPct: number
  /** Spending is clearly faster than the calendar (≥ 15 points ahead). */
  aheadOfPace: boolean
}

export function monthElapsedPct(today: ISODate): number {
  const month = monthKey(today)
  const total = diffDays(addDays(monthEnd(month), 1), `${month}-01`)
  return Math.min(100, Math.max(0, (diffDays(today, `${month}-01`) + 1) / total * 100))
}

export function budgetStatuses(
  budgets: readonly Budget[],
  transactions: readonly Transaction[],
  today: ISODate,
  categoryNames: ReadonlyMap<string, string>,
  links?: BillLinks,
): BudgetStatus[] {
  const spent = spentByCategory(transactions, today, links)
  const elapsed = monthElapsedPct(today)
  return budgets
    .filter((b) => !b.deletedAt && b.limit > 0)
    .map((budget) => {
      const s = spent.get(budget.categoryId) ?? 0
      const usedPct = (s / budget.limit) * 100
      const threshold = budget.alertThresholdPct > 0 ? budget.alertThresholdPct : 80
      const health: BudgetHealth = s > budget.limit ? 'over' : usedPct >= threshold ? 'warning' : 'healthy'
      return {
        budget,
        categoryName: categoryNames.get(budget.categoryId) ?? 'Category',
        limit: budget.limit,
        spent: s,
        remaining: budget.limit - s,
        overBy: Math.max(0, s - budget.limit),
        usedPct,
        health,
        monthElapsedPct: elapsed,
        aheadOfPace: usedPct - elapsed >= 15 && s <= budget.limit,
      }
    })
    .sort((a, b) => b.usedPct - a.usedPct)
}
