import { describe, expect, it } from 'vitest'
import { budgetStatuses } from './budgets'
import { computeSafeToSpend } from './safeToSpend'
import { buildSavingsPlan } from './savingsPlan'
import { computeSmartFinance, type SmartFinance } from './smartFinance'
import {
  DEFAULT_PREFERENCES,
  type Account,
  type Budget,
  type Category,
  type InternalTransfer,
  type LedgerData,
  type PaymentObligation,
  type PaymentOccurrence,
  type SavingsGoal,
  type Transaction,
  type UserPreferences,
} from './types'
import { acct, debt, ledger, obligation, occurrence, passThrough, transfer, txn } from './testFactories'

const NOW = '2026-10-21T00:00:00.000Z'
const TODAY = '2026-10-21'
const PAYDAY = '2026-11-01' // window = Oct 21 … Oct 31 = 11 days, ends exactly at month end
const R = (n: number) => n * 100 // rupees → minor units

const bank = acct({ id: 'bank', name: 'Bank', type: 'bank', openingBalance: R(100_000) })
const cash = acct({ id: 'cash', name: 'Cash', type: 'cash', openingBalance: R(20_000) })

const cat = (id: string, name: string): Category => ({ id, name, type: 'expense', createdAt: NOW, updatedAt: NOW })
const CATS = [cat('c-food', 'Food'), cat('c-transport', 'Transport'), cat('c-dining', 'Dining'), cat('c-housing', 'Housing')]

const budget = (over: Partial<Budget> = {}): Budget => ({
  id: 'b-food',
  categoryId: 'c-food',
  period: 'monthly',
  limit: R(15_000),
  alertThresholdPct: 80,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1',
  name: 'Emergency fund',
  target: R(150_000),
  allocated: 0,
  reserveInSafeToSpend: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

const spend = (amount: number, over: Partial<Transaction> = {}): Transaction =>
  txn({ type: 'expense', accountId: 'bank', amount: R(amount), date: TODAY, ...over })
const earn = (amount: number, over: Partial<Transaction> = {}): Transaction =>
  txn({ type: 'income', accountId: 'bank', amount: R(amount), date: TODAY, description: 'Income', ...over })

interface Scenario {
  today?: string
  payday?: string | null
  accounts?: Account[]
  txns?: Transaction[]
  transfers?: InternalTransfer[]
  ledger?: Partial<LedgerData>
  prefs?: Partial<UserPreferences>
  obligations?: PaymentObligation[]
  occurrences?: PaymentOccurrence[]
  budgets?: Budget[]
  goals?: SavingsGoal[]
}

function run(s: Scenario = {}): SmartFinance {
  const l = ledger({ accounts: s.accounts ?? [bank, cash], transactions: s.txns ?? [], transfers: s.transfers ?? [], ...s.ledger })
  return computeSmartFinance({
    today: s.today ?? TODAY,
    ledger: l,
    prefs: { ...DEFAULT_PREFERENCES, ...s.prefs },
    obligations: s.obligations ?? [],
    occurrences: s.occurrences ?? [],
    budgets: s.budgets ?? [],
    goals: s.goals ?? [],
    categories: CATS,
    payday: s.payday === undefined ? PAYDAY : s.payday,
  })
}

const rent = obligation({ id: 'ob-rent', name: 'Rent', amount: R(25_000), dueDate: '2026-10-25', categoryId: 'c-housing' })
const rentOcc = occurrence({ id: 'occ-rent', obligationId: 'ob-rent', dueDate: '2026-10-25', expectedAmount: R(25_000) })

describe('Smart Safe-to-Spend — engine rules', () => {
  it('reserves the remaining budget as committed money and never deducts an expense twice', () => {
    const before = run({ budgets: [budget({ limit: R(5_000) })] })
    expect(before.daily.pool).toBe(R(120_000) - R(5_000))
    // Spend LKR 500 on Food earlier this month: funds fall by 500 AND the budget remaining falls by 500.
    const after = run({ budgets: [budget({ limit: R(5_000) })], txns: [spend(500, { categoryId: 'c-food', date: '2026-10-20' })] })
    expect(after.budgets[0].spent).toBe(R(500))
    expect(after.budgets[0].remaining).toBe(R(4_500))
    expect(after.daily.reserved.find((r) => r.kind === 'budget')?.amount).toBe(R(4_500))
    expect(after.daily.pool).toBe(before.daily.pool) // flexible money is unchanged
  })

  it('does not reserve a bill twice when it belongs to a budgeted category', () => {
    const bus = obligation({ id: 'ob-bus', name: 'Bus pass', amount: R(3_000), dueDate: '2026-10-23', categoryId: 'c-transport' })
    const busOcc = occurrence({ id: 'occ-bus', obligationId: 'ob-bus', dueDate: '2026-10-23', expectedAmount: R(3_000) })
    const r = run({ obligations: [bus], occurrences: [busOcc], budgets: [budget({ id: 'b-t', categoryId: 'c-transport', limit: R(5_000) })] })
    const total = r.daily.reserved.filter((x) => x.kind === 'bill' || x.kind === 'budget').reduce((s, x) => s + x.amount, 0)
    expect(total).toBe(R(5_000)) // 3,000 bill + 2,000 rest of the budget — not 8,000
    expect(r.daily.pool).toBe(R(115_000))
  })

  it('reserves a bill that is bigger than its budget in full', () => {
    const bus = obligation({ id: 'ob-bus', name: 'Bus pass', amount: R(8_000), dueDate: '2026-10-23', categoryId: 'c-transport' })
    const busOcc = occurrence({ id: 'occ-bus', obligationId: 'ob-bus', dueDate: '2026-10-23', expectedAmount: R(8_000) })
    const r = run({ obligations: [bus], occurrences: [busOcc], budgets: [budget({ id: 'b-t', categoryId: 'c-transport', limit: R(5_000) })] })
    expect(r.daily.pool).toBe(R(120_000) - R(8_000))
  })

  it('counts a bill payment in its bill\'s category even when the payment has no category', () => {
    const paid = spend(25_000, { occurrenceId: 'occ-rent', date: '2026-10-22', categoryId: null })
    const paidOcc = { ...rentOcc, paidAmount: R(25_000), paidTransactionIds: [paid.id] }
    const r = run({
      obligations: [rent],
      occurrences: [paidOcc],
      budgets: [budget({ id: 'b-h', categoryId: 'c-housing', limit: R(30_000) })],
      txns: [paid],
      today: '2026-10-22',
    })
    expect(r.budgets[0].spent).toBe(R(25_000))
    expect(r.budgets[0].remaining).toBe(R(5_000))
  })

  it('matches the classic calculation when there are no budgets, goals or debts', () => {
    const prefs = { essentialDailyAmount: R(1_000), safetyBuffer: R(2_000) }
    const smart = run({ prefs, obligations: [rent], occurrences: [rentOcc] })
    const classic = computeSafeToSpend({
      today: TODAY,
      availableFunds: R(120_000),
      periodEnd: PAYDAY,
      obligations: [rent],
      occurrences: [rentOcc],
      goals: [],
      essentialDailyAmount: prefs.essentialDailyAmount,
      safetyBuffer: prefs.safetyBuffer,
      carryForward: true,
      hasPayday: true,
      hasAnyAccount: true,
    })
    expect(smart.daily.now.safeToSpend).toBe(classic.safeToSpend)
    expect(smart.daily.pool).toBe(R(120_000) - R(25_000) - R(11_000) - R(2_000))
  })

  it('essential budgets cover the daily essentials instead of reserving them twice', () => {
    const r = run({ prefs: { essentialDailyAmount: R(1_000) }, budgets: [budget({ essential: true })] })
    const covered = Math.floor((R(15_000) * 11) / 31)
    expect(r.daily.reserved.find((x) => x.kind === 'essentials')?.amount).toBe(R(11_000) - covered)
    expect(r.daily.reserved.find((x) => x.kind === 'budget')?.amount).toBe(R(15_000))
  })

  it('reserves pending expenses, unless a budget with room already holds that money', () => {
    const pendingDining = spend(2_000, { status: 'pending', categoryId: 'c-dining' })
    expect(run({ txns: [pendingDining] }).daily.pool).toBe(R(118_000))
    const pendingFood = spend(2_000, { status: 'pending', categoryId: 'c-food', date: '2026-10-20' })
    const r = run({ txns: [pendingFood], budgets: [budget()] })
    expect(r.daily.pool).toBe(R(120_000) - R(15_000)) // absorbed by the Food budget
    expect(r.daily.reserved.some((x) => x.kind === 'pending')).toBe(false)
  })

  it('reserves debt payments that fall due in the window, ignores later or undated debts', () => {
    const base = R(120_000) + R(30_000) // borrowed money arrives in the account
    const due = debt({ id: 'd1', accountId: 'bank', principal: R(30_000), dueDate: '2026-10-28' })
    expect(run({ ledger: { debts: [due] } }).daily.pool).toBe(base - R(30_000))
    const later = { ...due, dueDate: '2026-12-01' }
    expect(run({ ledger: { debts: [later] } }).daily.pool).toBe(base)
    const undated = { ...due, dueDate: null }
    const r = run({ ledger: { debts: [undated] } })
    expect(r.daily.pool).toBe(base)
    expect(r.daily.now.assumptions.join(' ')).toMatch(/no due date/)
  })

  it('reserves approved monthly contributions once, even after part has been set aside', () => {
    const none = run({ goals: [goal({ monthlyContribution: R(4_000) })] })
    expect(none.daily.reserved.find((x) => x.kind === 'contribution')?.amount).toBe(R(4_000))
    expect(none.daily.pool).toBe(R(116_000))
    const partly = run({
      goals: [goal({ monthlyContribution: R(4_000), allocated: R(1_000), contributions: [{ date: '2026-10-10', amount: R(1_000) }] })],
    })
    expect(partly.daily.reserved.find((x) => x.kind === 'goal')?.amount).toBe(R(1_000))
    expect(partly.daily.reserved.find((x) => x.kind === 'contribution')?.amount).toBe(R(3_000))
    expect(partly.daily.pool).toBe(R(116_000)) // same total — nothing counted twice
  })

  it('a goal that is almost full only reserves what is still missing', () => {
    const r = run({ goals: [goal({ target: R(2_000), allocated: R(1_500), monthlyContribution: R(4_000), contributions: [] })] })
    expect(r.daily.reserved.find((x) => x.kind === 'contribution')?.amount).toBe(R(500))
  })

  it('spreads budgets across a window that crosses a month end', () => {
    const r = run({ payday: null, budgets: [budget()] }) // 30-day window: Oct 21 → Nov 20
    const items = r.daily.reserved.filter((x) => x.kind === 'budget')
    expect(items.map((x) => x.amount)).toEqual([R(15_000), R(9_500)]) // rest of October + 19/30 of November (the window ends Nov 20, exclusive)
  })

  it('reserves only the part of a budget that falls before a mid-month payday', () => {
    const r = run({ payday: '2026-10-25', budgets: [budget()] })
    expect(r.daily.reserved.find((x) => x.kind === 'budget')?.amount).toBe(Math.ceil((R(15_000) * 4) / 11))
  })

  it('keeps the five kinds of money apart and consistent', () => {
    const r = run({
      prefs: { essentialDailyAmount: R(500), safetyBuffer: R(1_000) },
      obligations: [rent],
      occurrences: [rentOcc],
      budgets: [budget()],
      goals: [goal({ allocated: R(5_000), monthlyContribution: R(2_000) })],
      txns: [spend(300, { categoryId: 'c-food', date: '2026-10-19' })],
    })
    const b = r.daily.now.buckets
    expect(b.spentThisMonth).toBe(R(300))
    expect(b.availableFunds - b.reservedForExpenses - b.allocatedToGoals).toBe(b.uncommitted)
    expect(b.uncommitted).toBe(r.daily.now.safeToSpend)
    expect(b.allocatedToGoals).toBe(R(5_000) + R(2_000))
  })
})

describe('Smart Safe-to-Spend — daily allowance and rollover', () => {
  it('matches the product example: LKR 20,000 over 30 days, spend 200 today', () => {
    const only = acct({ id: 'bank', openingBalance: R(20_000) })
    const r = run({ accounts: [only], payday: null, txns: [spend(200)] })
    // pool before today's spending = 20,000 → allowance = floor(20,000 / 30) = 666.66 (never rounded up past the pool)
    expect(r.daily.daysRemaining).toBe(30)
    expect(r.daily.allowanceToday).toBe(66_666)
    expect(r.daily.spentToday).toBe(R(200))
    expect(r.daily.remainingToday).toBe(66_666 - R(200))
    expect(r.daily.pool).toBe(R(19_800))
    expect(r.daily.status).toBe('healthy')
  })

  it('never lets the allowance exceed the pool and never produces NaN', () => {
    for (const funds of [0, 1, 99, R(1), R(10), R(120_000)]) {
      const only = acct({ id: 'bank', openingBalance: funds })
      const r = run({ accounts: [only] })
      expect(Number.isFinite(r.daily.allowanceToday)).toBe(true)
      expect(r.daily.allowanceToday).toBeLessThanOrEqual(Math.max(0, r.daily.poolAtStartOfDay))
      expect(r.daily.remainingToday).toBeLessThanOrEqual(Math.max(0, r.daily.pool))
    }
  })

  it('overspending is allowed, explained, lowers tomorrow and does not touch budgets or goals', () => {
    const budgets = [budget()]
    const goals = [goal({ monthlyContribution: R(2_000) })]
    const calm = run({ budgets, goals })
    const r = run({ budgets, goals, txns: [spend(30_000, { categoryId: 'c-dining' })] })
    expect(r.daily.status).toBe('overspent')
    expect(r.daily.overspentToday).toBe(R(30_000) - r.daily.allowanceToday)
    expect(r.daily.remainingToday).toBeLessThan(0)
    expect(r.daily.tomorrowAllowance!).toBeLessThan(r.daily.tomorrowIfOnPlan!)
    expect(r.daily.explanation.join(' ')).toMatch(/not changed|lowers/)
    expect(r.budgets[0].limit).toBe(calm.budgets[0].limit)
    expect(r.daily.reserved.find((x) => x.kind === 'contribution')?.amount).toBe(R(2_000))
  })

  it('unused allowance stays in the pool: tomorrow is higher, nothing is discarded at midnight', () => {
    const today = run({ txns: [spend(100)] })
    const tomorrow = run({ txns: [spend(100)], today: '2026-10-22' })
    expect(tomorrow.daily.daysRemaining).toBe(today.daily.daysRemaining - 1)
    expect(tomorrow.daily.poolAtStartOfDay).toBe(R(120_000) - R(100)) // the unspent money is all still there
    expect(tomorrow.daily.allowanceToday).toBeGreaterThan(today.daily.allowanceToday)
    expect(today.daily.tomorrowAllowance).toBe(tomorrow.daily.allowanceToday)
  })

  it('bill payments and budgeted spending do not reduce the flexible allowance a second time', () => {
    const budgets = [budget()]
    const calm = run({ obligations: [rent], occurrences: [rentOcc], budgets })
    const paid = spend(25_000, { occurrenceId: 'occ-rent', categoryId: 'c-housing' })
    const food = spend(800, { categoryId: 'c-food' })
    const r = run({ obligations: [rent], occurrences: [{ ...rentOcc, paidAmount: R(25_000), paidTransactionIds: [paid.id] }], budgets, txns: [paid, food] })
    expect(r.daily.spentToday).toBe(0)
    expect(r.daily.billsPaidToday).toBe(R(25_000))
    expect(r.daily.coveredByBudgetsToday).toBe(R(800))
    expect(r.daily.totalSpentToday).toBe(R(25_800))
    expect(r.daily.pool).toBe(calm.daily.pool)
  })

  it('the first part of everyday spending is charged to the daily essentials amount', () => {
    const prefs = { essentialDailyAmount: R(1_000) }
    const r = run({ prefs, txns: [spend(700)] })
    expect(r.daily.spentToday).toBe(0)
    expect(r.daily.coveredByEssentialsToday).toBe(R(700))
    const more = run({ prefs, txns: [spend(1_500)] })
    expect(more.daily.spentToday).toBe(R(500))
    // reserved items and the pool still add up after the essentials already spent are released
    expect(more.daily.pool).toBe(R(118_500) - more.daily.totalReserved) // funds after the 1,500 spent
  })

  it('classifies healthy / warning / overspent / shortfall', () => {
    const allowance = Math.floor(R(120_000) / 11)
    expect(run().daily.status).toBe('healthy')
    expect(run({ txns: [spend(allowance * 0.9 / 100)] }).daily.status).toBe('warning')
    expect(run({ txns: [spend(20_000)] }).daily.status).toBe('overspent')
    expect(run({ accounts: [acct({ id: 'bank', openingBalance: R(1_000) })], obligations: [rent], occurrences: [rentOcc] }).daily.status).toBe('shortfall')
  })

  it('has no "tomorrow" on the last day of the window', () => {
    const r = run({ payday: '2026-10-22' })
    expect(r.daily.daysRemaining).toBe(1)
    expect(r.daily.tomorrowAllowance).toBeNull()
  })

  it('a new month starts with the unused flexible money still there and budgets reset', () => {
    const sept = { food: spend(3_000, { categoryId: 'c-food', date: '2026-10-20' }) }
    const oct31 = run({ today: '2026-10-31', payday: '2026-11-30', budgets: [budget()], txns: [sept.food] })
    const nov1 = run({ today: '2026-11-01', payday: '2026-12-01', budgets: [budget()], txns: [sept.food] })
    expect(oct31.budgets[0].spent).toBe(R(3_000))
    expect(nov1.budgets[0].spent).toBe(0) // the new month starts at zero
    expect(nov1.budgets[0].remaining).toBe(R(15_000))
    // no budgets: every unspent rupee is still in the pool on the first day of the month
    const plain = run({ today: '2026-11-01', payday: '2026-12-01' })
    expect(plain.daily.pool).toBe(R(120_000))
    expect(plain.daily.allowanceToday).toBe(Math.floor(R(120_000) / 30))
  })
})

describe('Smart Safe-to-Spend — the 14 edge cases', () => {
  it('1. no active goals', () => {
    const r = run()
    expect(r.plan.lines).toHaveLength(0)
    expect(r.plan.totalRecommended).toBe(0)
    expect(r.daily.reserved.some((x) => x.kind === 'goal' || x.kind === 'contribution')).toBe(false)
    expect(r.plan.explanation.join(' ')).toMatch(/no active goals/i)
  })

  it('2. no monthly budget', () => {
    const r = run()
    expect(r.budgets).toHaveLength(0)
    expect(r.daily.reserved.some((x) => x.kind === 'budget')).toBe(false)
    expect(r.daily.pool).toBe(R(120_000))
  })

  it('3. insufficient available money gives a shortfall, never a negative recommendation', () => {
    const poor = acct({ id: 'bank', openingBalance: R(5_000) })
    const r = run({ accounts: [poor], obligations: [rent], occurrences: [rentOcc], goals: [goal(), goal({ id: 'g2', name: 'Trip' })] })
    expect(r.daily.pool).toBe(R(5_000) - R(25_000))
    expect(r.daily.status).toBe('shortfall')
    expect(r.daily.allowanceToday).toBe(0)
    expect(r.plan.capacity).toBe(0)
    expect(r.plan.lines.every((l) => l.recommended === 0)).toBe(true)
    expect(r.plan.warnings.join(' ')).toMatch(/no spare flexible money/i)
    expect(r.insights.some((i) => i.tone === 'negative' && /short/.test(i.text))).toBe(true)
  })

  it('4. zero income this month', () => {
    const r = run()
    expect(r.plan.averageKept).toBeNull()
    expect(r.plan.explanation.join(' ')).toMatch(/no completed past months/i)
    expect(r.daily.pool).toBe(R(120_000)) // opening balances are money, not income
    expect(r.trend.monthToDate).toBe(0)
    expect(Number.isFinite(r.daily.allowanceToday)).toBe(true)
  })

  it('5. spending more than the daily recommendation (see rollover tests)', () => {
    const r = run({ txns: [spend(15_000)] })
    expect(r.daily.status).toBe('overspent')
    expect(r.daily.pool).toBe(R(105_000))
  })

  it('6. adding a new bill lowers the pool by exactly that bill', () => {
    const before = run()
    const after = run({ obligations: [rent], occurrences: [rentOcc] })
    expect(before.daily.pool - after.daily.pool).toBe(R(25_000))
  })

  it('7. changing a monthly budget changes the committed amount', () => {
    const a = run({ budgets: [budget({ limit: R(15_000) })] })
    const b = run({ budgets: [budget({ limit: R(20_000) })] })
    expect(a.daily.pool - b.daily.pool).toBe(R(5_000))
    const tiny = run({ budgets: [budget({ limit: R(1_000) })], txns: [spend(3_000, { categoryId: 'c-food', date: '2026-10-20' })] })
    expect(tiny.budgets[0].health).toBe('over')
    expect(tiny.budgets[0].overBy).toBe(R(2_000))
    expect(tiny.daily.reserved.some((x) => x.kind === 'budget')).toBe(false) // nothing left to commit, never negative
    expect(tiny.daily.pool).toBe(R(117_000))
  })

  it('8. editing or deleting an expense is reflected exactly once', () => {
    const food = spend(3_000, { id: 'e-food', categoryId: 'c-food', date: '2026-10-20' })
    const dining = spend(2_000, { id: 'e-dining', categoryId: 'c-dining', date: '2026-10-20' })
    const budgets = [budget()]
    const full = run({ budgets, txns: [food, dining] })
    // deleting a budgeted expense: budget remaining grows, funds grow, pool unchanged
    const noFood = run({ budgets, txns: [{ ...food, deletedAt: NOW }, dining] })
    expect(noFood.budgets[0].spent).toBe(0)
    expect(noFood.daily.pool).toBe(full.daily.pool)
    // editing it: same
    const bigger = run({ budgets, txns: [{ ...food, amount: R(4_000) }, dining] })
    expect(bigger.budgets[0].spent).toBe(R(4_000))
    expect(bigger.daily.pool).toBe(full.daily.pool)
    // deleting an unbudgeted expense frees the money
    const noDining = run({ budgets, txns: [food, { ...dining, deletedAt: NOW }] })
    expect(noDining.daily.pool - full.daily.pool).toBe(R(2_000))
  })

  it('9. extra income raises the pool and is not counted as spending', () => {
    const base = run()
    const r = run({ txns: [earn(10_000)] })
    expect(r.daily.pool - base.daily.pool).toBe(R(10_000))
    expect(r.daily.spentToday).toBe(0)
    expect(r.daily.allowanceToday).toBeGreaterThan(base.daily.allowanceToday)
  })

  it('10. transfers between accounts do not change the pool; a fee does', () => {
    const t = transfer({ sourceAccountId: 'bank', destinationAccountId: 'cash', amount: R(10_000), date: TODAY })
    expect(run({ transfers: [t] }).daily.pool).toBe(R(120_000))
    expect(run({ transfers: [{ ...t, fee: R(50) }] }).daily.pool).toBe(R(120_000) - R(50))
  })

  it('11. changing goal priorities changes the shares, not the total', () => {
    const tight = acct({ id: 'bank', openingBalance: R(12_000) }) // capacity LKR 6,000
    const mk = (a: 'high' | 'low', b: 'high' | 'low') =>
      run({
        accounts: [tight],
        goals: [goal({ id: 'a', name: 'A', target: R(120_000), priority: a }), goal({ id: 'b', name: 'B', target: R(120_000), priority: b })],
      }).plan
    const first = mk('high', 'low')
    const second = mk('low', 'high')
    const pick = (p: typeof first, id: string) => p.lines.find((l) => l.goalId === id)!.recommended
    expect(pick(first, 'a')).toBe(R(4_500))
    expect(pick(first, 'b')).toBe(R(1_500))
    expect(pick(second, 'a')).toBe(R(1_500))
    expect(pick(second, 'b')).toBe(R(4_500))
    expect(first.totalRecommended).toBe(second.totalRecommended)
    expect(first.totalRecommended).toBe(R(6_000))
  })

  it('12. a completed goal drops out of the plan and stops reserving contributions', () => {
    const done = goal({ target: R(50_000), allocated: R(50_000), monthlyContribution: R(4_000), contributions: [] })
    const r = run({ goals: [done] })
    expect(r.plan.lines).toHaveLength(0)
    expect(r.plan.completed).toHaveLength(1)
    expect(r.daily.reserved.some((x) => x.kind === 'contribution')).toBe(false)
    expect(r.plan.totalApproved).toBe(0)
  })

  it('13. multiple bank and cash accounts; archived accounts and money held for others are excluded', () => {
    expect(run().daily.pool).toBe(R(120_000))
    expect(run({ accounts: [bank, { ...cash, archived: true }] }).daily.pool).toBe(R(100_000))
    const held = passThrough({ accountId: 'bank', amount: R(30_000), status: 'received', receivedDate: '2026-10-10' })
    expect(run({ ledger: { passThroughs: [held] } }).daily.pool).toBe(R(120_000)) // 30,000 arrived but is not ours
  })

  it('14. a new month with unused flexible money', () => {
    const r = run({ today: '2026-11-01', payday: '2026-12-01' })
    expect(r.daily.pool).toBe(R(120_000))
    expect(r.daily.daysRemaining).toBe(30)
  })
})

describe('Savings plan', () => {
  it('is capped by half of the pool and, when known, by what the user really kept', () => {
    const goals = [goal({ target: R(600_000) })]
    const noHistory = buildSavingsPlan({ today: TODAY, currency: 'LKR', goals, basePool: R(100_000), history: [] })
    expect(noHistory.capacity).toBe(R(50_000))
    const history = [{ month: '2026-09', income: R(90_000), expense: R(85_000) }]
    const kept = buildSavingsPlan({ today: TODAY, currency: 'LKR', goals, basePool: R(100_000), history })
    expect(kept.capacity).toBe(R(5_000)) // the user kept 5,000, so 5,000 is realistic
    expect(kept.explanation.join(' ')).toMatch(/kept/)
  })

  it('shares by priority, caps each goal at what it needs and passes the rest on', () => {
    const goals = [
      goal({ id: 'small', name: 'Small', target: R(1_200), priority: 'high' }), // needs 100/month
      goal({ id: 'big', name: 'Big', target: R(120_000), priority: 'medium' }), // needs 10,000/month
    ]
    const plan = buildSavingsPlan({ today: TODAY, currency: 'LKR', goals, basePool: R(12_000), history: [] })
    expect(plan.capacity).toBe(R(6_000))
    expect(plan.lines.find((l) => l.goalId === 'small')!.recommended).toBe(R(100))
    expect(plan.lines.find((l) => l.goalId === 'big')!.recommended).toBe(R(5_900))
  })

  it('uses the target date: remaining ÷ months left', () => {
    const plan = buildSavingsPlan({
      today: TODAY,
      currency: 'LKR',
      goals: [goal({ target: R(60_000), targetDate: '2027-04-21' })],
      basePool: R(1_000_000),
      history: [],
    })
    expect(plan.lines[0].monthsLeft).toBe(6)
    expect(plan.lines[0].idealMonthly).toBe(R(10_000))
    expect(plan.lines[0].onTrack).toBe(true)
    expect(plan.affordable).toBe(true)
  })

  it('recommends a lower realistic amount when the ideal does not fit, with a reason', () => {
    const plan = buildSavingsPlan({
      today: TODAY,
      currency: 'LKR',
      goals: [goal({ target: R(60_000), targetDate: '2027-04-21' })],
      basePool: R(8_000),
      history: [],
    })
    expect(plan.lines[0].recommended).toBe(R(4_000))
    expect(plan.lines[0].onTrack).toBe(false)
    expect(plan.affordable).toBe(false)
    expect(plan.lines[0].reason).toMatch(/covers 40%/)
    expect(plan.explanation.join(' ')).toMatch(/lower amount/)
  })

  it('warns when the approved amount is more than what is realistic', () => {
    const plan = buildSavingsPlan({
      today: TODAY,
      currency: 'LKR',
      goals: [goal({ target: R(60_000), monthlyContribution: R(20_000) })],
      basePool: R(10_000),
      history: [],
    })
    expect(plan.approvedExceedsCapacity).toBe(true)
    expect(plan.warnings.join(' ')).toMatch(/approved/i)
  })

  it('recalculates when the situation changes (income raises the capacity)', () => {
    const goals = [goal({ target: R(600_000) })]
    const a = run({ goals }).plan.capacity
    const b = run({ goals, txns: [earn(40_000)] }).plan.capacity
    expect(b).toBeGreaterThan(a)
  })

  it('never counts the approved contributions against its own capacity', () => {
    const goals = [goal({ target: R(600_000), monthlyContribution: R(10_000) })]
    const approved = run({ goals })
    const none = run({ goals: [goal({ target: R(600_000) })] })
    expect(approved.plan.capacity).toBe(none.plan.capacity)
  })
})

describe('Insights are built from real data only', () => {
  it('says nothing about trends or budgets that do not exist', () => {
    const texts = run().insights.map((i) => i.text).join(' ')
    expect(texts).not.toMatch(/higher|lower|budget|goal|save an additional/i)
    expect(run().insights[0].id).toBe('pool') // the flexible pool statement always comes first
    expect(run().insights[0].text).toMatch(/available for flexible spending/)
  })

  it('reports budget use with the real percentage and labels projections as projections', () => {
    const r = run({
      budgets: [budget({ limit: R(4_000), alertThresholdPct: 70 })],
      txns: [spend(3_000, { categoryId: 'c-food', date: '2026-10-05' })],
    })
    const warn = r.insights.find((i) => i.id.startsWith('budget-warn'))!
    expect(warn.text).toMatch(/75%/)
    expect(warn.kind).toBe('fact')
    const pace = r.insights.find((i) => i.id.startsWith('budget-pace'))
    if (pace) expect(pace.kind).toBe('projection')
  })

  it('compares weeks using real transactions', () => {
    const txns = [spend(1_000, { date: '2026-10-10' }), spend(3_000, { date: '2026-10-19' })]
    const r = run({ txns })
    expect(r.trend.last7).toBe(R(3_000))
    expect(r.trend.previous7).toBe(R(1_000))
    expect(r.insights.some((i) => /200% higher/.test(i.text))).toBe(true)
  })

  it('budget statuses use the same spending as the engine', () => {
    const txns = [spend(500, { categoryId: 'c-food', date: '2026-10-20' }), spend(900, { categoryId: 'c-food', date: '2026-09-28' })]
    const rows = budgetStatuses([budget()], txns, TODAY, new Map([['c-food', 'Food']]))
    expect(rows[0].spent).toBe(R(500)) // last month is not counted
  })
})
