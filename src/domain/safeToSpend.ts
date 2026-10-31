import { addDays, daysInMonth, diffDays, monthEnd, monthKey, type ISODate } from './dates'
import { remainingAmount } from './bills'
import { spentByCategory } from './budgets'
import { debtOutstanding } from './ledger'
import type { Minor } from './money'
import type { Budget, PaymentObligation, PaymentOccurrence, PersonalDebt, SavingsGoal, Transaction } from './types'

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
  /** Monthly budgets. Their remaining amounts are committed money. */
  budgets?: readonly Budget[]
  /** Transactions: used for budget spending (posted) and pending payments. */
  transactions?: readonly Transaction[]
  /** Personal debts that fall due inside the window. */
  debts?: readonly PersonalDebt[]
  /** Category id → name (labels only). */
  categoryNames?: ReadonlyMap<string, string>
  /** Recognised expenses this month so far (information only, not part of the pool). */
  spentThisMonth?: Minor
}

export type ReservedKind = 'bill' | 'essentials' | 'goal' | 'buffer' | 'budget' | 'debt' | 'contribution' | 'pending'

export interface ReservedItem {
  id: string
  label: string
  dueDate: ISODate | null
  amount: Minor
  kind: ReservedKind
}

/** The five kinds of money the engine keeps apart. */
export interface MoneyBuckets {
  /** Real, liquid balances you can use (held-for-others already removed). */
  availableFunds: Minor
  /** Recognised expenses already paid this month (information; already out of the balance). */
  spentThisMonth: Minor
  /** Reserved for future expenses: bills, debts, budgets, essentials, pending payments, buffer. */
  reservedForExpenses: Minor
  /** Set aside for goals: money already allocated plus approved contributions. */
  allocatedToGoals: Minor
  /** Part of allocatedToGoals that is approved monthly contributions still to be set aside. */
  contributionsReserved: Minor
  /** What is left for discretionary spending (can be negative). */
  uncommitted: Minor
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
  buckets: MoneyBuckets
  /** Daily essentials amount not covered by essential budgets (0 when budgets cover it). */
  essentialPerDayUncovered: Minor
}

/** The part of the planning window that falls in one calendar month. */
export interface MonthSlice {
  month: string
  /** Days of the window that fall in this month. */
  days: number
  daysInMonth: number
  /** Days from the slice start to the end of the month (for the current month: today → month end). */
  monthRemainingDays: number
  current: boolean
}

/** Splits [today, periodEnd) by calendar month so monthly amounts can be applied correctly across month ends. */
export function monthSlices(today: ISODate, periodEnd: ISODate): MonthSlice[] {
  const out: MonthSlice[] = []
  const currentMonth = monthKey(today)
  let start = today
  while (start < periodEnd && out.length < 36) {
    const month = monthKey(start)
    const [y, m] = month.split('-').map(Number)
    const nextMonthStart = addDays(monthEnd(month), 1)
    const end = nextMonthStart < periodEnd ? nextMonthStart : periodEnd
    out.push({
      month,
      days: diffDays(end, start),
      daysInMonth: daysInMonth(y, m),
      monthRemainingDays: diffDays(nextMonthStart, start),
      current: month === currentMonth,
    })
    start = end
  }
  return out
}

/** Part of what is left of this month that falls inside the window (all of it when the window reaches month end). */
const prorateRemaining = (remaining: Minor, slice: MonthSlice): Minor =>
  slice.days >= slice.monthRemainingDays ? remaining : Math.ceil((remaining * slice.days) / slice.monthRemainingDays)

const share = (amount: Minor, slice: MonthSlice, round: 'up' | 'down'): Minor => {
  const v = (amount * slice.days) / slice.daysInMonth
  return round === 'up' ? Math.ceil(v) : Math.floor(v)
}

/**
 * Explainable, rules-based Safe-to-Spend (the flexible pool):
 *   available funds
 *   − unpaid bills and debts due in the window
 *   − remaining budget allocations (bills inside a budgeted category are counted once, inside the budget)
 *   − essentials not already covered by essential budgets
 *   − pending payments not already covered by a budget
 *   − money allocated to goals + approved monthly contributions
 *   − safety buffer.
 * Expected salary / receivables are never added here (they are forecast only).
 * Every occurrence is reserved at most once, and only for what remains unpaid.
 */
export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { today, periodEnd } = input
  const daysRemaining = Math.max(1, diffDays(periodEnd, today))
  const slices = monthSlices(today, periodEnd)
  const currentMonth = monthKey(today)
  const reserved: ReservedItem[] = []
  const warnings: string[] = []
  const assumptions: string[] = []
  const names = input.categoryNames ?? new Map<string, string>()

  const budgets = (input.budgets ?? []).filter((b) => !b.deletedAt && b.limit > 0)
  const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b]))
  const spent = spentByCategory(input.transactions ?? [], today, { obligations: input.obligations, occurrences: input.occurrences })
  /** Unpaid bills that sit inside a budget: budget id → month → amount. */
  const billsInBudget = new Map<string, Map<string, Minor>>()

  // ---- bills --------------------------------------------------------------
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
    const budget = ob.categoryId ? budgetByCategory.get(ob.categoryId) : undefined
    if (budget) {
      const month = occ.dueDate < today ? currentMonth : monthKey(occ.dueDate)
      const perMonth = billsInBudget.get(budget.id) ?? new Map<string, Minor>()
      perMonth.set(month, (perMonth.get(month) ?? 0) + remaining)
      billsInBudget.set(budget.id, perMonth)
    }
    if (ob.isEstimate) warnings.push(`"${ob.name}" uses an estimated amount.`)
    if (occ.dueDate < today) warnings.push(`"${ob.name}" is overdue and has been reserved in full.`)
  }

  // ---- debts due in the window -------------------------------------------
  let debtsWithoutDate = 0
  for (const d of input.debts ?? []) {
    if (d.deletedAt) continue
    const outstanding = debtOutstanding(d)
    if (outstanding <= 0) continue
    if (!d.dueDate) {
      debtsWithoutDate += 1
      continue
    }
    if (d.dueDate >= periodEnd) continue
    reserved.push({ id: `debt:${d.id}`, label: `Debt repayment: ${d.creditor}`, dueDate: d.dueDate, amount: outstanding, kind: 'debt' })
    if (d.dueDate < today) warnings.push(`The debt to ${d.creditor} is overdue and has been reserved in full.`)
  }
  if (debtsWithoutDate > 0) {
    assumptions.push(`${debtsWithoutDate} debt${debtsWithoutDate === 1 ? ' has' : 's have'} no due date and ${debtsWithoutDate === 1 ? 'is' : 'are'} not reserved.`)
  }

  // ---- budgets ------------------------------------------------------------
  /** Budget money left in this month after bills, per category: pending payments can be absorbed by it. */
  const slack = new Map<string, Minor>()
  for (const b of budgets) {
    const name = names.get(b.categoryId) ?? 'Budget'
    for (const slice of slices) {
      const part = slice.current
        ? prorateRemaining(Math.max(0, b.limit - (spent.get(b.categoryId) ?? 0)), slice)
        : share(b.limit, slice, 'up')
      const bills = billsInBudget.get(b.id)?.get(slice.month) ?? 0
      const extra = Math.max(0, part - bills)
      if (slice.current) slack.set(b.categoryId, extra)
      if (extra <= 0) continue
      reserved.push({
        id: `budget:${b.id}:${slice.month}`,
        label: slice.current ? `Budget left: ${name}` : `Budget: ${name} (${slice.days} of ${slice.daysInMonth} days of ${slice.month})`,
        dueDate: null,
        amount: extra,
        kind: 'budget',
      })
    }
  }
  if (budgets.length > 0) {
    assumptions.push('The remaining amount of each monthly budget is committed money, not free spending money.')
    if (billsInBudget.size > 0) assumptions.push('Bills that belong to a budgeted category are counted inside that budget, so they are not reserved twice.')
    if (slices.length > 1) assumptions.push('For months after the current one, budgets and approved savings are included in proportion to the days of the window that fall in them.')
    if (slices[0] && slices[0].days < slices[0].monthRemainingDays) {
      assumptions.push('Your payday comes before the month ends, so only the part of each budget that falls before payday is reserved.')
    }
  }

  // ---- pending payments ---------------------------------------------------
  const pendingByCategory = new Map<string, Minor>()
  for (const t of input.transactions ?? []) {
    if (t.deletedAt || t.type !== 'expense' || t.status !== 'pending' || t.occurrenceId) continue
    if (t.date >= periodEnd) continue
    const key = t.categoryId && budgetByCategory.has(t.categoryId) ? t.categoryId : ''
    pendingByCategory.set(key, (pendingByCategory.get(key) ?? 0) + t.amount)
  }
  let pendingExtra = 0
  for (const [key, amount] of pendingByCategory) {
    const absorbed = key ? Math.min(amount, slack.get(key) ?? 0) : 0
    pendingExtra += amount - absorbed
  }
  if (pendingExtra > 0) {
    reserved.push({ id: 'pending', label: 'Pending payments', dueDate: null, amount: pendingExtra, kind: 'pending' })
    assumptions.push('Pending expenses do not change balances yet, but are reserved so the money is still there when they settle.')
  }

  // ---- essentials ---------------------------------------------------------
  const essentials = input.essentialDailyAmount * daysRemaining
  let essentialCover = 0
  for (const b of budgets) {
    if (!b.essential) continue
    for (const slice of slices) essentialCover += share(b.limit, slice, 'down')
  }
  const essentialsExtra = Math.max(0, essentials - essentialCover)
  if (essentialsExtra > 0) {
    reserved.push({
      id: 'essentials',
      label: essentialCover > 0 ? `Essentials not covered by budgets (${daysRemaining} days)` : `Essentials (${daysRemaining} days)`,
      dueDate: null,
      amount: essentialsExtra,
      kind: 'essentials',
    })
    assumptions.push(
      essentialCover > 0
        ? 'Essential spending is your configured daily amount minus what essential budgets already cover; bills are reserved separately so they are not counted twice.'
        : 'Essential spending is your configured daily amount; bills are reserved separately so they are not counted twice.',
    )
  } else if (essentials === 0 && essentialCover === 0) {
    warnings.push('No essential daily spending is configured, so day-to-day costs are not reserved.')
  }

  // ---- goals --------------------------------------------------------------
  const contributedThisMonth = (g: SavingsGoal) =>
    (g.contributions ?? []).reduce((s, c) => (c.amount > 0 && monthKey(c.date) === currentMonth && c.date <= today ? s + c.amount : s), 0)
  for (const g of input.goals) {
    if (g.deletedAt) continue
    const monthly = g.monthlyContribution ?? 0
    const approved = monthly > 0
    if (g.reserveInSafeToSpend && g.allocated > 0) {
      reserved.push({ id: g.id, label: `Savings goal: ${g.name}`, dueDate: null, amount: g.allocated, kind: 'goal' })
    }
    if (approved && g.allocated < g.target) {
      let total = 0
      for (const slice of slices) {
        // This month: what is still due (all of it when the window reaches month end, otherwise in proportion).
        // Later months: in proportion to the days of the window that fall in them.
        total += slice.current
          ? prorateRemaining(Math.max(0, monthly - contributedThisMonth(g)), slice)
          : Math.min(monthly, share(monthly, slice, 'up'))
      }
      total = Math.min(total, g.target - g.allocated)
      if (total > 0) reserved.push({ id: `contribution:${g.id}`, label: `Approved savings: ${g.name}`, dueDate: null, amount: total, kind: 'contribution' })
    }
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
    !input.hasAnyAccount || input.obligations.length === 0 || (input.essentialDailyAmount === 0 && essentialCover === 0) ? 'low' : 'normal'

  const positive = Math.max(0, safeToSpend)
  const evenly = Math.floor(positive / daysRemaining)
  const dailyAllowance =
    input.carryForward || input.fixedDailyAllowance === undefined
      ? evenly
      : Math.min(input.fixedDailyAllowance, positive)

  if (safeToSpend < 0) warnings.unshift(`You may be short by this amount before ${periodEnd}.`)

  const goalKinds: ReservedKind[] = ['goal', 'contribution']
  const allocatedToGoals = reserved.filter((r) => goalKinds.includes(r.kind)).reduce((s, r) => s + r.amount, 0)
  const contributionsReserved = reserved.filter((r) => r.kind === 'contribution').reduce((s, r) => s + r.amount, 0)

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
    essentialPerDayUncovered: Math.floor(essentialsExtra / daysRemaining),
    buckets: {
      availableFunds: input.availableFunds,
      spentThisMonth: input.spentThisMonth ?? 0,
      reservedForExpenses: totalReserved - allocatedToGoals,
      allocatedToGoals,
      contributionsReserved,
      uncommitted: safeToSpend,
    },
  }
}
