import { monthEnd, monthStart, type ISODate } from './dates'
import type { ForecastEvent } from './forecast'
import { accountBalances, buildMovements, monthTotals, type Movement } from './ledger'
import { addDays } from './dates'
import type { Minor } from './money'
import type { LedgerData } from './types'

export interface SavingsBreakdown {
  month: string
  /** Recognised, already-posted activity this month. */
  actual: { income: Minor; expense: Minor; net: Minor }
  /** Remaining scheduled items that will count as income/expense. */
  projected: { income: Minor; expense: Minor; net: Minor }
  /** actual + projected */
  projectedNetSavings: Minor
  isComplete: boolean // true once the month has ended
  assumptions: string[]
}

export interface ClosingBalanceBreakdown {
  month: string
  /** Balance at the end of the day before the month started. NOT income. */
  openingBalance: Minor
  actualCashMovement: Minor // posted, up to today
  projectedInflows: Minor
  projectedOutflows: Minor
  projectedClosingBalance: Minor
  perAccount: { accountId: string; opening: Minor; projectedClosing: Minor }[]
  assumptions: string[]
}

function dayBefore(month: string): ISODate {
  return addDays(monthStart(month), -1)
}

function eventsRemaining(events: readonly ForecastEvent[], today: ISODate, month: string): ForecastEvent[] {
  const end = monthEnd(month)
  const seen = new Set<string>()
  return events.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    if (e.certainty === 'uncertain' && e.amount > 0) return false // uncertain inflows excluded
    const date = e.date < today ? today : e.date
    return date <= end && date >= monthStart(month)
  })
}

/** Net savings (recognised income − expenses) with a separate projected portion. */
export function monthlySavings(
  movements: readonly Movement[],
  events: readonly ForecastEvent[],
  month: string,
  today: ISODate,
): SavingsBreakdown {
  const actual = monthTotals(movements, month, today)
  let income = 0
  let expense = 0
  for (const e of eventsRemaining(events, today, month)) {
    const amount = e.recognizedAmount ?? Math.abs(e.amount)
    if (e.recognizes === 'income') income += amount
    else if (e.recognizes === 'expense') expense += amount
  }
  const projected = { income, expense, net: income - expense }
  return {
    month,
    actual,
    projected,
    projectedNetSavings: actual.net + projected.net,
    isComplete: today > monthEnd(month),
    assumptions: [
      'Net savings = recognised income − recognised expenses.',
      'Internal transfers, pass-through money, loans and advances are excluded from income and expenses.',
      'Opening balances are never counted as income.',
    ],
  }
}

/**
 * Projected closing balance = balance before the month + actual posted cash
 * movement to date + remaining scheduled inflows − outflows, account by account.
 * This is deliberately different from net savings.
 */
export function projectedClosingBalance(
  data: LedgerData,
  events: readonly ForecastEvent[],
  month: string,
  today: ISODate,
): ClosingBalanceBreakdown {
  const movements = buildMovements(data)
  const active = data.accounts.filter((a) => !a.deletedAt && !a.archived)
  const opening = accountBalances(active, movements, dayBefore(month))
  const asOfToday = accountBalances(active, movements, today < monthEnd(month) ? today : monthEnd(month))
  const remaining = eventsRemaining(events, today, month)

  let inflows = 0
  let outflows = 0
  const projected = new Map(asOfToday)
  for (const e of remaining) {
    if (!projected.has(e.accountId)) continue
    projected.set(e.accountId, projected.get(e.accountId)! + e.amount)
    if (e.amount > 0) inflows += e.amount
    else outflows += -e.amount
  }

  const openingTotal = [...opening.values()].reduce((s, v) => s + v, 0)
  const todayTotal = [...asOfToday.values()].reduce((s, v) => s + v, 0)
  const closing = [...projected.values()].reduce((s, v) => s + v, 0)

  return {
    month,
    openingBalance: openingTotal,
    actualCashMovement: todayTotal - openingTotal,
    projectedInflows: inflows,
    projectedOutflows: outflows,
    projectedClosingBalance: closing,
    perAccount: active.map((a) => ({
      accountId: a.id,
      opening: opening.get(a.id) ?? 0,
      projectedClosing: projected.get(a.id) ?? 0,
    })),
    assumptions: [
      'Closing balance = opening balance + posted movement to date + remaining scheduled inflows − outflows.',
      'Uncertain inflows (such as repayments from others) are excluded.',
      'Closing balance includes money you hold for others; it is not the same as net savings.',
    ],
  }
}
