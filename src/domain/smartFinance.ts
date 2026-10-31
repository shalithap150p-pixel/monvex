import { addDays, addMonths, monthKey, type ISODate } from './dates'
import { budgetStatuses, type BudgetStatus } from './budgets'
import { computeDailySafeToSpend, type DailySafeToSpend } from './dailySafeToSpend'
import { availableMoney, buildMovements, monthTotals, type Movement } from './ledger'
import type { Minor } from './money'
import { buildSavingsPlan, type MonthlyHistory, type SavingsPlan } from './savingsPlan'
import { buildInsights, dailySpending, spendingTrend, type DaySpending, type Insight, type SpendingTrend } from './spendingInsights'
import type { Budget, Category, LedgerData, PaymentObligation, PaymentOccurrence, SavingsGoal, UserPreferences } from './types'

export interface SmartFinanceInput {
  today: ISODate
  ledger: LedgerData
  prefs: UserPreferences
  obligations: readonly PaymentObligation[]
  occurrences: readonly PaymentOccurrence[]
  budgets: readonly Budget[]
  goals: readonly SavingsGoal[]
  categories: readonly Category[]
  /** Next payday (end of the planning window), or null → today + safeToSpendPeriodDays. */
  payday: ISODate | null
  /** Optional precomputed values (the app already has them). */
  movements?: readonly Movement[]
  availableFunds?: Minor
}

export interface SmartFinance {
  daily: DailySafeToSpend
  plan: SavingsPlan
  budgets: BudgetStatus[]
  history: DaySpending[]
  trend: SpendingTrend
  insights: Insight[]
  periodEnd: ISODate
}

/**
 * One pure entry point for the whole Smart Safe-to-Spend system. The app and the tests both
 * call this, so what is tested is exactly what the dashboard shows.
 */
export function computeSmartFinance(input: SmartFinanceInput): SmartFinance {
  const { today, ledger, prefs } = input
  const movements = input.movements ?? buildMovements(ledger)
  const availableFunds = input.availableFunds ?? availableMoney(ledger, today).available
  const activeAccounts = ledger.accounts.filter((a) => !a.deletedAt && !a.archived)
  const categoryNames = new Map(input.categories.filter((c) => !c.deletedAt).map((c) => [c.id, c.name]))
  const periodEnd = input.payday ?? addDays(today, prefs.safeToSpendPeriodDays)
  const month = monthKey(today)

  const daily = computeDailySafeToSpend({
    today,
    availableFunds,
    periodEnd,
    obligations: input.obligations,
    occurrences: input.occurrences,
    goals: input.goals,
    essentialDailyAmount: prefs.essentialDailyAmount,
    safetyBuffer: prefs.safetyBuffer,
    carryForward: prefs.carryForwardAllowance,
    hasPayday: Boolean(input.payday),
    hasAnyAccount: activeAccounts.length > 0,
    budgets: input.budgets,
    transactions: ledger.transactions,
    debts: ledger.debts,
    categoryNames,
    spentThisMonth: monthTotals(movements, month, today).expense,
    activeAccountIds: new Set(activeAccounts.map((a) => a.id)),
  })

  // Completed past months with real activity (most recent first).
  const history: MonthlyHistory[] = []
  for (let i = 1; i <= 3; i++) {
    const key = monthKey(addMonths(`${month}-01`, -i))
    const t = monthTotals(movements, key)
    if (t.income > 0 || t.expense > 0) history.push({ month: key, income: t.income, expense: t.expense })
  }

  const plan = buildSavingsPlan({
    today,
    currency: prefs.currency,
    goals: input.goals,
    // The plan replaces approved contributions, so they are added back before measuring capacity.
    basePool: daily.pool + daily.now.buckets.contributionsReserved,
    history,
  })

  const links = { obligations: input.obligations, occurrences: input.occurrences }
  const budgetRows = budgetStatuses(input.budgets, ledger.transactions, today, categoryNames, links)

  const insights = buildInsights({
    today,
    currency: prefs.currency,
    daily,
    budgets: budgetRows,
    plan,
    transactions: ledger.transactions,
    categoryNames,
    links,
  })

  return {
    daily,
    plan,
    budgets: budgetRows,
    history: dailySpending(ledger.transactions, today, 14),
    trend: spendingTrend(ledger.transactions, today),
    insights,
    periodEnd,
  }
}
