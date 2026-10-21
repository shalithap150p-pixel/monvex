import { describe, expect, it } from 'vitest'
import {
  DuplicatePaymentError,
  applyPayment,
  dueDatesBetween,
  generateOccurrences,
  occurrenceStatus,
  removePayment,
} from './bills'
import { addMonths } from './dates'
import {
  billEvents,
  debtEvents,
  passThroughEvents,
  receivableEvents,
  runForecast,
  salaryEvent,
  type ForecastEvent,
} from './forecast'
import {
  accountBalance,
  accountBalances,
  advanceOutstanding,
  availableMoney,
  buildMovements,
  debtOutstanding,
  monthTotals,
  passThroughUnresolved,
  receivableOutstanding,
  reconcile,
} from './ledger'
import { allocate, formatMoney, parseAmount, toDecimalString, tryParseAmount } from './money'
import { computeSafeToSpend } from './safeToSpend'
import { monthlySavings, projectedClosingBalance } from './savings'
import { projectPayday } from './salary'
import { applyOps, compactQueue, deriveSyncStatus, type ServerRow, type SyncOp } from './sync'
import { validateEvidenceFile, validateTransactionInput, validateTransferInput } from './validation'
import { acct, advance, debt, ledger, loan, obligation, occurrence, passThrough, transfer, txn } from './testFactories'

const NOW = '2026-10-21T00:00:00.000Z'

describe('currency precision', () => {
  it('parses decimal strings without floating point error', () => {
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(parseAmount('0.3'))
    expect(parseAmount('1,250.50')).toBe(125_050)
    expect(parseAmount('19.99')).toBe(1_999)
  })
  it('rejects too many decimals, junk and unsafe values', () => {
    expect(tryParseAmount('1.005')).toBeNull()
    expect(tryParseAmount('abc')).toBeNull()
    expect(tryParseAmount('')).toBeNull()
    expect(tryParseAmount('99999999999999999999')).toBeNull()
  })
  it('respects zero-decimal currencies', () => {
    expect(parseAmount('1500', 'JPY')).toBe(1500)
    expect(tryParseAmount('1500.5', 'JPY')).toBeNull()
  })
  it('formats and round-trips', () => {
    expect(formatMoney(125_050)).toBe('LKR 1,250.50')
    expect(formatMoney(-5_000)).toBe('− LKR 50.00')
    expect(toDecimalString(125_050)).toBe('1250.50')
    expect(parseAmount(toDecimalString(7))).toBe(7)
  })
  it('allocates without losing a minor unit', () => {
    const parts = allocate(100, 3)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
  })
})

describe('account balances, income and expenses', () => {
  it('adds an expense once: balance decreases once, month expense increases once', () => {
    const a = acct({ id: 'a', openingBalance: 100_000_00 })
    const data = ledger({ accounts: [a], transactions: [txn({ accountId: 'a', amount: 2_500_00 })] })
    const m = buildMovements(data)
    expect(accountBalance(a, m)).toBe(97_500_00)
    expect(monthTotals(m, '2026-10')).toEqual({ income: 0, expense: 2_500_00, net: -2_500_00 })
  })
  it('opening balance is not income', () => {
    const a = acct({ id: 'a', openingBalance: 500_000_00 })
    const m = buildMovements(ledger({ accounts: [a] }))
    expect(monthTotals(m, '2026-10').income).toBe(0)
    expect(accountBalance(a, m)).toBe(500_000_00)
  })
  it('ignores pending and soft-deleted transactions; editing recalculates', () => {
    const a = acct({ id: 'a', openingBalance: 1_000_00 })
    const t1 = txn({ accountId: 'a', amount: 100_00 })
    const t2 = txn({ accountId: 'a', amount: 200_00, status: 'pending' })
    const t3 = txn({ accountId: 'a', amount: 300_00, deletedAt: NOW })
    const before = buildMovements(ledger({ accounts: [a], transactions: [t1, t2, t3] }))
    expect(accountBalance(a, before)).toBe(900_00)
    const edited = buildMovements(ledger({ accounts: [a], transactions: [{ ...t1, amount: 150_00 }] }))
    expect(accountBalance(a, edited)).toBe(850_00)
  })
  it('supports negative balances', () => {
    const a = acct({ id: 'a', openingBalance: 100_00 })
    const m = buildMovements(ledger({ accounts: [a], transactions: [txn({ accountId: 'a', amount: 250_00 })] }))
    expect(accountBalance(a, m)).toBe(-150_00)
  })
  it('as-of date excludes later movements', () => {
    const a = acct({ id: 'a' })
    const m = buildMovements(ledger({ accounts: [a], transactions: [txn({ accountId: 'a', type: 'income', amount: 100_00, date: '2026-10-20' })] }))
    expect(accountBalance(a, m, '2026-10-19')).toBe(0)
    expect(accountBalance(a, m, '2026-10-20')).toBe(100_00)
  })
  it('reconciliation reports the difference', () => {
    const a = acct({ id: 'a', openingBalance: 1_000_00 })
    const m = buildMovements(ledger({ accounts: [a] }))
    expect(reconcile(a, m, 990_00)).toMatchObject({ difference: -10_00, matches: false })
    expect(reconcile(a, m, 1_000_00).matches).toBe(true)
  })
})

describe('internal transfers', () => {
  const a = acct({ id: 'a', openingBalance: 100_000_00 })
  const b = acct({ id: 'b', openingBalance: 0 })
  it('moves money between accounts with no income/expense and unchanged consolidated balance', () => {
    const data = ledger({ accounts: [a, b], transfers: [transfer({ sourceAccountId: 'a', destinationAccountId: 'b', amount: 30_000_00 })] })
    const m = buildMovements(data)
    const bal = accountBalances(data.accounts, m)
    expect(bal.get('a')).toBe(70_000_00)
    expect(bal.get('b')).toBe(30_000_00)
    expect(availableMoney(data).physical).toBe(100_000_00)
    expect(monthTotals(m, '2026-10')).toEqual({ income: 0, expense: 0, net: 0 })
  })
  it('records the fee as an expense from the source account', () => {
    const data = ledger({ accounts: [a, b], transfers: [transfer({ sourceAccountId: 'a', destinationAccountId: 'b', amount: 30_000_00, fee: 50_00 })] })
    const m = buildMovements(data)
    expect(accountBalances(data.accounts, m).get('a')).toBe(69_950_00)
    expect(availableMoney(data).physical).toBe(99_950_00)
    expect(monthTotals(m, '2026-10').expense).toBe(50_00)
  })
})

describe('pass-through money for others', () => {
  const a = acct({ id: 'a', openingBalance: 10_000_00 })
  it('is not income, is excluded from available money, and does not double count on transfer', () => {
    const p = passThrough({ accountId: 'a', amount: 50_000_00 })
    const received = ledger({ accounts: [a], passThroughs: [p] })
    const m1 = buildMovements(received)
    expect(accountBalance(a, m1)).toBe(60_000_00)
    expect(monthTotals(m1, '2026-10').income).toBe(0)
    expect(availableMoney(received)).toMatchObject({ physical: 60_000_00, heldForOthers: 50_000_00, available: 10_000_00 })

    const done: typeof p = { ...p, status: 'transferred', legs: [{ id: 'l1', amount: 50_000_00, date: '2026-10-06', fee: 100_00 }] }
    const sent = ledger({ accounts: [a], passThroughs: [done] })
    const m2 = buildMovements(sent)
    expect(accountBalance(a, m2)).toBe(9_900_00) // 10,000 + 50,000 − 50,000 − 100 fee
    expect(monthTotals(m2, '2026-10')).toEqual({ income: 0, expense: 100_00, net: -100_00 })
    expect(passThroughUnresolved(done)).toBe(0)
  })
  it('shows unresolved amount for partial transfers', () => {
    const p = passThrough({ amount: 50_000_00, status: 'partially_transferred', legs: [{ id: 'l1', amount: 20_000_00, date: '2026-10-06', fee: 0 }] })
    expect(passThroughUnresolved(p)).toBe(30_000_00)
  })
  it('a pending record has not moved any cash yet', () => {
    const m = buildMovements(ledger({ accounts: [a], passThroughs: [passThrough({ accountId: 'a', status: 'pending' })] }))
    expect(accountBalance(a, m)).toBe(10_000_00)
  })
})

describe('loans receivable and personal debts', () => {
  const a = acct({ id: 'a', openingBalance: 100_000_00 })
  it('lending reduces cash but is not an expense; partial repayments reduce the outstanding', () => {
    const l = loan({
      accountId: 'a',
      principal: 20_000_00,
      repayments: [{ id: 'r1', amount: 5_000_00, date: '2026-10-15', accountId: 'a' }],
    })
    const m = buildMovements(ledger({ accounts: [a], loans: [l] }))
    expect(accountBalance(a, m)).toBe(85_000_00) // 100k − 20k + 5k
    expect(monthTotals(m, '2026-10')).toEqual({ income: 0, expense: 0, net: 0 })
    expect(receivableOutstanding(l)).toBe(15_000_00)
  })
  it('receivable is not available cash and write-offs reduce the outstanding', () => {
    const l = loan({ accountId: 'a', principal: 20_000_00, writtenOff: 2_000_00 })
    expect(availableMoney(ledger({ accounts: [a], loans: [l] })).physical).toBe(80_000_00)
    expect(receivableOutstanding(l)).toBe(18_000_00)
  })
  it('borrowing is not income; interest is an expense; principal repayment is not', () => {
    const d = debt({
      accountId: 'a',
      principal: 30_000_00,
      repayments: [{ id: 'r1', principalPart: 10_000_00, interestPart: 500_00, date: '2026-10-20', accountId: 'a' }],
    })
    const m = buildMovements(ledger({ accounts: [a], debts: [d] }))
    expect(accountBalance(a, m)).toBe(119_500_00) // +30,000 −10,000 −500
    expect(monthTotals(m, '2026-10')).toEqual({ income: 0, expense: 500_00, net: -500_00 })
    expect(debtOutstanding(d)).toBe(20_000_00)
  })
})

describe('salary advance accounting', () => {
  const a = acct({ id: 'a', openingBalance: 0 })
  it('pending advances do not change balances', () => {
    const m = buildMovements(ledger({ accounts: [a], advances: [advance({ accountId: 'a', status: 'pending' })] }))
    expect(accountBalance(a, m)).toBe(0)
  })
  it('received advance raises cash but is not income', () => {
    const m = buildMovements(ledger({ accounts: [a], advances: [advance({ accountId: 'a', amount: 10_000_00 })] }))
    expect(accountBalance(a, m)).toBe(10_000_00)
    expect(monthTotals(m, '2026-10').income).toBe(0)
  })
  it('salary of 60,000 with a 10,000 advance counts as 60,000 income once, 60,000 cash total', () => {
    const adv = advance({ id: 'adv1', accountId: 'a', amount: 10_000_00, date: '2026-10-05' })
    const salary = txn({
      accountId: 'a',
      type: 'income',
      amount: 50_000_00,
      date: '2026-10-28',
      payrollDeductions: [{ advanceId: 'adv1', amount: 10_000_00 }],
    })
    const data = ledger({ accounts: [a], advances: [adv], transactions: [salary] })
    const m = buildMovements(data)
    expect(accountBalance(a, m)).toBe(60_000_00)
    expect(monthTotals(m, '2026-10').income).toBe(60_000_00)
    expect(advanceOutstanding(adv, data.transactions)).toBe(0)
  })
  it('uses the configured schedule, not an assumption about next month', () => {
    const adv = advance({
      id: 'adv2',
      amount: 30_000_00,
      kind: 'employer_loan',
      schedule: [
        { month: '2026-11', amount: 10_000_00 },
        { month: '2026-12', amount: 10_000_00 },
      ],
    })
    const nov = projectPayday('2026-11', 60_000_00, [adv], [])
    expect(nov.expectedRemainder).toBe(50_000_00)
    const oct = projectPayday('2026-10', 60_000_00, [adv], [])
    expect(oct.totalDeductions).toBe(0)
    expect(oct.expectedRemainder).toBe(60_000_00)
  })
  it('never deducts more than is outstanding and warns when no schedule exists', () => {
    const adv = advance({ id: 'adv3', amount: 5_000_00, schedule: [{ month: '2026-11', amount: 9_000_00 }] })
    expect(projectPayday('2026-11', 60_000_00, [adv], []).totalDeductions).toBe(5_000_00)
    const noSchedule = advance({ id: 'adv4' })
    expect(projectPayday('2026-11', 60_000_00, [noSchedule], []).warnings.length).toBeGreaterThan(0)
  })
})

describe('recurring bills', () => {
  it('generates monthly due dates keeping the anchor day (31st clamps then recovers)', () => {
    const ob = obligation({ dueDate: '2026-01-31', frequency: 'monthly' })
    expect(dueDatesBetween(ob, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(addMonths('2028-01-31', 1, 31)).toBe('2028-02-29')
  })
  it('handles weekly, quarterly, yearly, once, and end dates', () => {
    expect(dueDatesBetween(obligation({ frequency: 'weekly', dueDate: '2026-10-01' }), '2026-10-10', '2026-10-31')).toEqual(['2026-10-15', '2026-10-22', '2026-10-29'])
    expect(dueDatesBetween(obligation({ frequency: 'quarterly', dueDate: '2026-01-15' }), '2026-01-01', '2026-12-31')).toHaveLength(4)
    expect(dueDatesBetween(obligation({ frequency: 'yearly', dueDate: '2026-03-01' }), '2026-01-01', '2028-12-31')).toHaveLength(3)
    expect(dueDatesBetween(obligation({ frequency: 'once', dueDate: '2026-11-01' }), '2026-10-01', '2026-12-31')).toEqual(['2026-11-01'])
    expect(dueDatesBetween(obligation({ frequency: 'monthly', dueDate: '2026-10-01', endDate: '2026-12-15' }), '2026-10-01', '2027-06-01')).toHaveLength(3)
    expect(dueDatesBetween(obligation({ active: false }), '2026-10-01', '2027-06-01')).toEqual([])
  })
  it('occurrence generation is idempotent and never rewrites existing (paid) occurrences', () => {
    const ob = obligation({ id: 'ob1', dueDate: '2026-10-25', amount: 25_000_00 })
    let n = 0
    const mk = () => `occ-${++n}`
    const first = generateOccurrences([ob], [], '2026-10-01', '2026-12-31', mk, NOW)
    expect(first).toHaveLength(3)
    const paid = { ...first[0], paidAmount: 25_000_00 }
    const changedRule = { ...ob, amount: 30_000_00 }
    const second = generateOccurrences([changedRule], [paid, first[1], first[2]], '2026-10-01', '2026-12-31', mk, NOW)
    expect(second).toHaveLength(0)
    const extended = generateOccurrences([changedRule], first, '2026-10-01', '2027-01-31', mk, NOW)
    expect(extended).toHaveLength(1)
    expect(extended[0].expectedAmount).toBe(30_000_00) // new periods use the new amount
  })
  it('derives statuses', () => {
    const o = occurrence({ dueDate: '2026-10-25' })
    expect(occurrenceStatus(o, '2026-10-01', 5)).toBe('upcoming')
    expect(occurrenceStatus(o, '2026-10-21', 5)).toBe('unpaid')
    expect(occurrenceStatus(o, '2026-10-25', 5)).toBe('due')
    expect(occurrenceStatus(o, '2026-10-26', 5)).toBe('overdue')
    expect(occurrenceStatus({ ...o, paidAmount: 5_000_00 }, '2026-10-21', 5)).toBe('partially_paid')
    expect(occurrenceStatus({ ...o, paidAmount: 25_000_00 }, '2026-12-01', 5)).toBe('paid')
  })
  it('prevents duplicate payments', () => {
    const o = occurrence({ expectedAmount: 10_000_00 })
    const partial = applyPayment(o, 't1', 4_000_00, NOW)
    expect(partial.paidAmount).toBe(4_000_00)
    expect(() => applyPayment(partial, 't1', 4_000_00, NOW)).toThrow(DuplicatePaymentError)
    const full = applyPayment(partial, 't2', 6_000_00, NOW)
    expect(() => applyPayment(full, 't3', 1_00, NOW)).toThrow(DuplicatePaymentError)
    expect(removePayment(full, 't2', 6_000_00, NOW).paidAmount).toBe(4_000_00)
  })
})

describe('Safe-to-Spend', () => {
  const base = {
    today: '2026-10-21',
    periodEnd: '2026-10-31',
    availableFunds: 50_000_00,
    obligations: [obligation({ id: 'ob1', name: 'Rent', isEstimate: false })],
    occurrences: [occurrence({ id: 'o1', obligationId: 'ob1', dueDate: '2026-10-25', expectedAmount: 25_000_00 })],
    goals: [],
    essentialDailyAmount: 500_00,
    safetyBuffer: 2_000_00,
    carryForward: true,
    hasPayday: true,
    hasAnyAccount: true,
  }
  it('subtracts unpaid bills, essentials and buffer from available funds', () => {
    const r = computeSafeToSpend(base)
    expect(r.daysRemaining).toBe(10)
    expect(r.totalReserved).toBe(25_000_00 + 5_000_00 + 2_000_00)
    expect(r.safeToSpend).toBe(18_000_00)
    expect(r.dailyAllowance).toBe(1_800_00)
    expect(r.confidence).toBe('normal')
  })
  it('does not reserve paid or out-of-window obligations, and never twice', () => {
    const paid = occurrence({ id: 'o2', obligationId: 'ob1', dueDate: '2026-10-26', expectedAmount: 1_000_00, paidAmount: 1_000_00 })
    const later = occurrence({ id: 'o3', obligationId: 'ob1', dueDate: '2026-11-25', expectedAmount: 25_000_00 })
    const dup = base.occurrences[0]
    const r = computeSafeToSpend({ ...base, occurrences: [...base.occurrences, paid, later, dup] })
    expect(r.reserved.filter((x) => x.kind === 'bill')).toHaveLength(1)
  })
  it('reserves only the unpaid remainder of a partly paid bill', () => {
    const part = { ...base.occurrences[0], paidAmount: 10_000_00 }
    expect(computeSafeToSpend({ ...base, occurrences: [part] }).reserved.find((x) => x.kind === 'bill')?.amount).toBe(15_000_00)
  })
  it('reserves savings goals only when the user chose to', () => {
    const goal = { id: 'g', name: 'Trip', target: 100_000_00, allocated: 5_000_00, reserveInSafeToSpend: false, createdAt: NOW, updatedAt: NOW }
    expect(computeSafeToSpend({ ...base, goals: [goal] }).totalReserved).toBe(32_000_00)
    expect(computeSafeToSpend({ ...base, goals: [{ ...goal, reserveInSafeToSpend: true }] }).totalReserved).toBe(37_000_00)
  })
  it('shows a negative result as a shortfall and never counts expected salary', () => {
    const r = computeSafeToSpend({ ...base, availableFunds: 10_000_00 })
    expect(r.safeToSpend).toBe(-22_000_00)
    expect(r.shortfall).toBe(22_000_00)
    expect(r.dailyAllowance).toBe(0)
    expect(r.warnings[0]).toMatch(/short/)
  })
  it('flags incomplete data as low confidence', () => {
    const r = computeSafeToSpend({ ...base, obligations: [], occurrences: [], essentialDailyAmount: 0, hasPayday: false })
    expect(r.confidence).toBe('low')
    expect(r.warnings.length).toBeGreaterThan(1)
  })
  it('carry-forward off keeps a fixed daily allowance', () => {
    const r = computeSafeToSpend({ ...base, carryForward: false, fixedDailyAllowance: 1_000_00 })
    expect(r.dailyAllowance).toBe(1_000_00)
  })
})

describe('forecast and shortfall detection', () => {
  const a = acct({ id: 'a', name: 'Bank', openingBalance: 0 })
  const bal = new Map([['a', 20_000_00]])
  const ev = (over: Partial<ForecastEvent>): ForecastEvent => ({
    id: 'e',
    date: '2026-10-25',
    accountId: 'a',
    amount: -1_000_00,
    label: 'Bill',
    certainty: 'confirmed',
    source: 'bill',
    sourceId: 's',
    recognizes: 'expense',
    ...over,
  })
  it('finds the date, account and causing bill of the first shortfall', () => {
    const r = runForecast({
      today: '2026-10-21',
      horizonDays: 30,
      accounts: [a],
      balances: bal,
      events: [ev({ id: 'rent', label: 'Rent', date: '2026-10-25', amount: -25_000_00 })],
    })
    expect(r.shortfalls[0]).toMatchObject({ date: '2026-10-25', accountId: 'a', shortBy: 5_000_00 })
    expect(r.shortfalls[0].cause?.label).toBe('Rent')
    expect(r.shortfalls.some((s) => s.accountId === null)).toBe(true)
    expect(r.closingBalance).toBe(-5_000_00)
  })
  it('does not double count the same scheduled item', () => {
    const e = ev({ id: 'same', amount: -3_000_00 })
    const r = runForecast({ today: '2026-10-21', horizonDays: 30, accounts: [a], balances: bal, events: [e, e] })
    expect(r.closingBalance).toBe(17_000_00)
  })
  it('expected salary is forecast only: it never raises the opening balance', () => {
    const salary = salaryEvent({ paydayDate: '2026-10-28', netAmount: 50_000_00, grossAmount: 60_000_00, accountId: 'a', today: '2026-10-21' })!
    const r = runForecast({ today: '2026-10-21', horizonDays: 30, accounts: [a], balances: bal, events: [salary] })
    expect(r.series[0].total).toBe(20_000_00)
    expect(r.closingBalance).toBe(70_000_00)
  })
  it('conservative scenario ignores unconfirmed inflows but keeps all outflows', () => {
    const events = [
      ev({ id: 'in', amount: 10_000_00, certainty: 'expected', source: 'salary', recognizes: 'income' }),
      ev({ id: 'out', amount: -2_000_00, certainty: 'uncertain' }),
    ]
    const cons = runForecast({ today: '2026-10-21', horizonDays: 30, accounts: [a], balances: bal, events, scenario: 'conservative' })
    expect(cons.closingBalance).toBe(18_000_00)
    const exp = runForecast({ today: '2026-10-21', horizonDays: 30, accounts: [a], balances: bal, events, scenario: 'expected' })
    expect(exp.closingBalance).toBe(28_000_00)
  })
  it('paid bills are not forecast; partly paid bills only forecast the remainder', () => {
    const ob = obligation({ id: 'ob1', accountId: 'a' })
    const paid = occurrence({ id: 'p', obligationId: 'ob1', expectedAmount: 10_000_00, paidAmount: 10_000_00 })
    const partial = occurrence({ id: 'q', obligationId: 'ob1', dueDate: '2026-11-01', expectedAmount: 10_000_00, paidAmount: 4_000_00 })
    const events = billEvents([ob], [paid, partial], null)
    expect(events).toHaveLength(1)
    expect(events[0].amount).toBe(-6_000_00)
  })
  it('overdue unpaid items land on today; items beyond the horizon are ignored', () => {
    const r = runForecast({
      today: '2026-10-21',
      horizonDays: 30,
      accounts: [a],
      balances: bal,
      events: [ev({ id: 'late', date: '2026-10-10', amount: -5_000_00 }), ev({ id: 'far', date: '2027-03-01', amount: -9_999_00 })],
    })
    expect(r.series[0].total).toBe(15_000_00)
    expect(r.closingBalance).toBe(15_000_00)
  })
  it('warns when there is no data', () => {
    const r = runForecast({ today: '2026-10-21', horizonDays: 30, accounts: [a], balances: bal, events: [] })
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.shortfalls).toHaveLength(0)
  })
  it('builds receivable, debt and pass-through events from outstanding amounts', () => {
    const l = loan({ id: 'l1', dueDate: '2026-11-05', principal: 10_000_00 })
    expect(receivableEvents([l])[0]).toMatchObject({ amount: 10_000_00, certainty: 'uncertain' })
    const d = debt({ id: 'd1', dueDate: '2026-11-05', principal: 8_000_00 })
    expect(debtEvents([d])[0]).toMatchObject({ amount: -8_000_00, recognizes: null })
    const p = passThrough({ amount: 5_000_00 })
    expect(passThroughEvents([p], '2026-10-21', passThroughUnresolved)[0].amount).toBe(-5_000_00)
  })
})

describe('monthly net savings vs projected closing balance', () => {
  const a = acct({ id: 'a', openingBalance: 100_000_00 })
  const today = '2026-10-21'
  const data = ledger({
    accounts: [a],
    transactions: [
      txn({ accountId: 'a', type: 'income', amount: 60_000_00, date: '2026-10-05' }),
      txn({ accountId: 'a', type: 'expense', amount: 20_000_00, date: '2026-10-10' }),
    ],
    loans: [loan({ accountId: 'a', principal: 15_000_00, lentDate: '2026-10-12' })],
  })
  const events: ForecastEvent[] = [
    { id: 'rent', date: '2026-10-25', accountId: 'a', amount: -25_000_00, label: 'Rent', certainty: 'confirmed', source: 'bill', sourceId: 'x', recognizes: 'expense' },
    { id: 'repay', date: '2026-10-28', accountId: 'a', amount: 5_000_00, label: 'Repayment', certainty: 'uncertain', source: 'receivable', sourceId: 'y', recognizes: null },
  ]
  it('net savings is recognised income − expenses, split into actual and projected', () => {
    const s = monthlySavings(buildMovements(data), events, '2026-10', today)
    expect(s.actual).toEqual({ income: 60_000_00, expense: 20_000_00, net: 40_000_00 })
    expect(s.projected.expense).toBe(25_000_00)
    expect(s.projectedNetSavings).toBe(15_000_00)
  })
  it('closing balance is different from net savings and includes the opening balance', () => {
    const c = projectedClosingBalance(data, events, '2026-10', today)
    expect(c.openingBalance).toBe(100_000_00)
    // 100k + 60k − 20k − 15k loan out = 125k today; −25k rent; uncertain repayment excluded
    expect(c.projectedClosingBalance).toBe(100_000_00)
    expect(c.projectedOutflows).toBe(25_000_00)
    expect(c.projectedInflows).toBe(0)
  })
  it('projected salary counts gross as income even though cash is net', () => {
    const salary = salaryEvent({ paydayDate: '2026-10-28', netAmount: 50_000_00, grossAmount: 60_000_00, accountId: 'a', today })!
    const s = monthlySavings(buildMovements(data), [salary], '2026-10', today)
    expect(s.projected.income).toBe(60_000_00)
    const c = projectedClosingBalance(data, [salary], '2026-10', today)
    expect(c.projectedInflows).toBe(50_000_00)
  })
})

describe('offline sync and duplicate prevention', () => {
  const op = (over: Partial<SyncOp> = {}): SyncOp => ({
    opId: 'op1',
    table: 'transactions',
    recordId: 'r1',
    type: 'upsert',
    payload: { updatedAt: '2026-10-21T10:00:00.000Z', amount: 100 },
    baseUpdatedAt: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    attempts: 0,
    ...over,
  })
  it('applies an op once even if the same batch is retried', () => {
    const store = new Map<string, ServerRow>()
    const processed = new Set<string>()
    const first = applyOps(store, processed, [op()])
    const retry = applyOps(store, processed, [op()])
    expect(first.applied).toEqual(['op1'])
    expect(retry.duplicates).toEqual(['op1'])
    expect(store.size).toBe(1)
  })
  it('does not create a duplicate record when the same new record arrives under another op id', () => {
    const store = new Map<string, ServerRow>()
    const processed = new Set<string>()
    applyOps(store, processed, [op()])
    const again = applyOps(store, processed, [op({ opId: 'op2' })])
    expect(again.duplicates).toEqual(['op2'])
    expect(store.size).toBe(1)
  })
  it('reports a conflict instead of silently overwriting a newer server copy', () => {
    const store = new Map<string, ServerRow>([['transactions:r1', { id: 'r1', updatedAt: '2026-10-21T12:00:00.000Z', amount: 999 }]])
    const result = applyOps(store, new Set(), [op({ opId: 'op3', baseUpdatedAt: '2026-10-21T09:00:00.000Z' })])
    expect(result.conflicts).toHaveLength(1)
    expect(store.get('transactions:r1')?.amount).toBe(999)
  })
  it('applies deletes as soft deletes', () => {
    const store = new Map<string, ServerRow>([['transactions:r1', { id: 'r1', updatedAt: '2026-10-21T09:00:00.000Z' }]])
    applyOps(store, new Set(), [op({ opId: 'del', type: 'delete', baseUpdatedAt: '2026-10-21T09:00:00.000Z', payload: { updatedAt: '2026-10-21T11:00:00.000Z' } })])
    expect(store.get('transactions:r1')?.deletedAt).toBe('2026-10-21T11:00:00.000Z')
  })
  it('compacts the queue: later edits win and unsynced create+delete cancels out', () => {
    const queue = compactQueue([
      op({ opId: 'a', createdAt: '2026-10-21T10:00:00.000Z' }),
      op({ opId: 'b', createdAt: '2026-10-21T10:05:00.000Z', payload: { updatedAt: '2026-10-21T10:05:00.000Z', amount: 200 } }),
    ])
    expect(queue).toHaveLength(1)
    expect(queue[0].payload?.amount).toBe(200)
    expect(queue[0].baseUpdatedAt).toBeNull()
    expect(compactQueue([op({ opId: 'a' }), op({ opId: 'd', type: 'delete', createdAt: '2026-10-21T10:06:00.000Z' })])).toHaveLength(0)
  })
  it('never reports synced while changes are pending or failed', () => {
    const base = { configured: true, signedIn: true, online: true, syncing: false, pendingCount: 0, failedCount: 0 }
    expect(deriveSyncStatus(base)).toBe('synced')
    expect(deriveSyncStatus({ ...base, pendingCount: 2 })).toBe('pending')
    expect(deriveSyncStatus({ ...base, failedCount: 1 })).toBe('failed')
    expect(deriveSyncStatus({ ...base, online: false, pendingCount: 2 })).toBe('offline')
    expect(deriveSyncStatus({ ...base, configured: false })).toBe('not_configured')
  })
})

describe('validation', () => {
  it('rejects zero or invalid transaction amounts, bad dates and missing fields', () => {
    expect(validateTransactionInput({ amount: 0, date: '2026-10-05', accountId: 'a', description: 'x' }).amount).toBeTruthy()
    expect(validateTransactionInput({ amount: null, date: '2026-10-05', accountId: 'a', description: 'x' }).amount).toBeTruthy()
    expect(validateTransactionInput({ amount: 100, date: '2026-02-30', accountId: 'a', description: 'x' }).date).toBeTruthy()
    expect(validateTransactionInput({ amount: 100, date: '2026-10-05', accountId: '', description: ' ' })).toMatchObject({ accountId: expect.any(String), description: expect.any(String) })
    expect(validateTransactionInput({ amount: 100, date: '2026-10-05', accountId: 'a', description: 'x' })).toEqual({})
  })
  it('rejects transfers to the same account', () => {
    expect(validateTransferInput({ amount: 100, fee: 0, date: '2026-10-05', sourceAccountId: 'a', destinationAccountId: 'a' }).destinationAccountId).toBeTruthy()
  })
  it('validates evidence files by type and size', () => {
    expect(validateEvidenceFile({ name: 'a.exe', size: 10, type: 'application/x-msdownload' })).toBeTruthy()
    expect(validateEvidenceFile({ name: 'a.pdf', size: 11 * 1024 * 1024, type: 'application/pdf' })).toBeTruthy()
    expect(validateEvidenceFile({ name: 'a.pdf', size: 1024, type: 'application/pdf' })).toBeNull()
  })
})

describe('next payday', () => {
  it('rolls a past anchor forward keeping the anchor day', async () => {
    const { nextPayday } = await import('./salary')
    expect(nextPayday('2026-10-25', 'monthly', '2026-10-21')).toBe('2026-10-25')
    expect(nextPayday('2026-09-25', 'monthly', '2026-10-21')).toBe('2026-10-25')
    expect(nextPayday('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28')
    expect(nextPayday('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31')
    expect(nextPayday('2026-10-01', 'weekly', '2026-10-21')).toBe('2026-10-22')
    expect(nextPayday('2026-09-01', 'once', '2026-10-21')).toBeNull()
    expect(nextPayday(null, 'monthly', '2026-10-21')).toBeNull()
  })
})
