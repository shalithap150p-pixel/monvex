import { addDays, diffDays, eachDay, type ISODate } from './dates'
import { remainingAmount } from './bills'
import { receivableOutstanding, debtOutstanding } from './ledger'
import type { Minor } from './money'
import type {
  Account,
  LoanReceivable,
  PassThroughTransfer,
  PaymentObligation,
  PaymentOccurrence,
  PersonalDebt,
} from './types'

export type Certainty = 'confirmed' | 'expected' | 'uncertain'
export type EventSource =
  | 'bill'
  | 'salary'
  | 'receivable'
  | 'debt'
  | 'pass_through'
  | 'other'

/** A scheduled future cash event. Signed: inflow > 0, outflow < 0. */
export interface ForecastEvent {
  id: string // unique per underlying scheduled item (used for de-duplication)
  date: ISODate
  accountId: string
  amount: Minor
  label: string
  certainty: Certainty
  source: EventSource
  sourceId: string
  /** How this event counts towards personal income/expense once it happens. */
  recognizes: 'income' | 'expense' | null
  /** Positive recognised amount if it differs from |amount| (e.g. gross salary vs net cash). */
  recognizedAmount?: Minor
}

export type Scenario = 'expected' | 'conservative'

export interface ForecastInput {
  today: ISODate
  horizonDays: 30 | 60 | 90 | number
  accounts: readonly Account[]
  /** Balances as of `today` (from the ledger). */
  balances: ReadonlyMap<string, Minor>
  events: readonly ForecastEvent[]
  scenario?: Scenario
}

export interface DayPoint {
  date: ISODate
  total: Minor
  perAccount: Record<string, Minor>
}

export interface Shortfall {
  date: ISODate
  accountId: string | null // null = combined balance
  accountName: string
  balance: Minor
  shortBy: Minor
  /** The event that pushed the balance below zero, plus other events that day. */
  cause: ForecastEvent | null
  contributing: ForecastEvent[]
  confirmedOnly: boolean
  actions: string[]
}

export interface ForecastResult {
  series: DayPoint[]
  closingBalance: Minor
  lowestPoint: DayPoint
  shortfalls: Shortfall[]
  eventsUsed: ForecastEvent[]
  scenario: Scenario
  assumptions: string[]
  warnings: string[]
}

/** Drop duplicate scheduled items (same id) so nothing is counted twice. */
export function dedupeEvents(events: readonly ForecastEvent[]): ForecastEvent[] {
  const seen = new Set<string>()
  const out: ForecastEvent[] = []
  for (const e of events) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/** Conservative: every outflow, but only confirmed inflows. Expected: confirmed + expected. */
function includeEvent(e: ForecastEvent, scenario: Scenario): boolean {
  if (scenario === 'conservative') return e.amount < 0 || e.certainty === 'confirmed'
  return e.certainty !== 'uncertain' || e.amount < 0
}

export function runForecast(input: ForecastInput): ForecastResult {
  const scenario = input.scenario ?? 'expected'
  const end = addDays(input.today, input.horizonDays)
  const events = dedupeEvents(input.events)
    .filter((e) => includeEvent(e, scenario))
    // Anything dated in the past that is still unpaid is treated as due today.
    .map((e) => (e.date < input.today ? { ...e, date: input.today } : e))
    .filter((e) => e.date <= end)
    .sort((a, b) => (a.date === b.date ? a.amount - b.amount : a.date < b.date ? -1 : 1))

  const accounts = input.accounts
  const running: Record<string, Minor> = {}
  for (const a of accounts) running[a.id] = input.balances.get(a.id) ?? 0

  const byDate = new Map<ISODate, ForecastEvent[]>()
  for (const e of events) {
    if (!(e.accountId in running)) continue
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }

  const series: DayPoint[] = []
  const shortfalls: Shortfall[] = []
  const flaggedAccounts = new Set<string>()
  let combinedFlagged = false
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account'

  for (const date of eachDay(input.today, end)) {
    const todays = byDate.get(date) ?? []
    for (const e of todays) running[e.accountId] += e.amount
    const total = Object.values(running).reduce((s, v) => s + v, 0)
    series.push({ date, total, perAccount: { ...running } })

    for (const a of accounts) {
      if (running[a.id] < 0 && !flaggedAccounts.has(a.id)) {
        flaggedAccounts.add(a.id)
        const contributing = todays.filter((e) => e.accountId === a.id && e.amount < 0)
        const cause = contributing.length
          ? contributing.reduce((m, e) => (e.amount < m.amount ? e : m))
          : null
        shortfalls.push(buildShortfall(date, a.id, nameOf(a.id), running[a.id], cause, contributing))
      }
    }
    if (total < 0 && !combinedFlagged) {
      combinedFlagged = true
      const contributing = todays.filter((e) => e.amount < 0)
      const cause = contributing.length
        ? contributing.reduce((m, e) => (e.amount < m.amount ? e : m))
        : null
      shortfalls.push(buildShortfall(date, null, 'All accounts combined', total, cause, contributing))
    }
  }

  const lowestPoint = series.reduce((m, p) => (p.total < m.total ? p : m), series[0])

  const assumptions = [
    `Starts from today's calculated account balances (${input.today}).`,
    'Overdue unpaid items are assumed to be paid today.',
    scenario === 'conservative'
      ? 'Conservative scenario: all outflows included, only confirmed inflows counted.'
      : 'Expected scenario: confirmed and expected items included; uncertain inflows excluded.',
    'Expected salary and expected repayments are forecasts, not cash in hand.',
  ]
  const warnings: string[] = []
  if (events.length === 0) warnings.push('No scheduled bills or expected income were found, so this forecast only reflects current balances.')
  if (accounts.length === 0) warnings.push('Add an account to produce a forecast.')
  if (!events.some((e) => e.amount > 0)) warnings.push('No expected income is recorded in this period; the forecast may be pessimistic.')

  return {
    series,
    closingBalance: series[series.length - 1].total,
    lowestPoint,
    shortfalls,
    eventsUsed: events,
    scenario,
    assumptions,
    warnings,
  }
}

function buildShortfall(
  date: ISODate,
  accountId: string | null,
  accountName: string,
  balance: Minor,
  cause: ForecastEvent | null,
  contributing: ForecastEvent[],
): Shortfall {
  const actions: string[] = []
  if (cause?.source === 'bill') {
    actions.push(`Review the amount or date of "${cause.label}", or contact the biller about a later due date.`)
  }
  if (cause?.source === 'debt') actions.push(`Contact the creditor about "${cause.label}" if you cannot pay on time.`)
  actions.push('Review discretionary spending before this date.')
  if (accountId) actions.push(`Consider moving money into ${accountName} from another account before ${date}.`)
  return {
    date,
    accountId,
    accountName,
    balance,
    shortBy: -balance,
    cause,
    contributing,
    confirmedOnly: contributing.every((e) => e.certainty === 'confirmed'),
    actions,
  }
}

/* ------------------------------------------------------------------ */
/* Event builders — turn scheduled records into forecast events.      */
/* Nothing already paid is emitted, so a paid bill is never forecast. */
/* ------------------------------------------------------------------ */

export function billEvents(
  obligations: readonly PaymentObligation[],
  occurrences: readonly PaymentOccurrence[],
  defaultAccountId: string | null,
): ForecastEvent[] {
  const obMap = new Map(obligations.map((o) => [o.id, o]))
  const out: ForecastEvent[] = []
  for (const occ of occurrences) {
    if (occ.deletedAt) continue
    const ob = obMap.get(occ.obligationId)
    if (!ob || ob.deletedAt || !ob.active) continue
    const remaining = remainingAmount(occ)
    if (remaining <= 0) continue // paid: removed from the forecast
    const accountId = ob.accountId ?? defaultAccountId
    if (!accountId) continue
    out.push({
      id: `bill:${occ.id}`,
      date: occ.dueDate,
      accountId,
      amount: -remaining,
      label: ob.name,
      certainty: ob.isEstimate ? 'expected' : 'confirmed',
      source: 'bill',
      sourceId: occ.id,
      recognizes: 'expense',
    })
  }
  return out
}

export function receivableEvents(loans: readonly LoanReceivable[]): ForecastEvent[] {
  const out: ForecastEvent[] = []
  for (const l of loans) {
    if (l.deletedAt || !l.dueDate) continue
    const outstanding = receivableOutstanding(l)
    if (outstanding <= 0) continue
    out.push({
      id: `receivable:${l.id}`,
      date: l.dueDate,
      accountId: l.accountId,
      amount: outstanding,
      label: `Repayment from ${l.borrower}`,
      certainty: 'uncertain', // someone else's promise
      source: 'receivable',
      sourceId: l.id,
      recognizes: null,
    })
  }
  return out
}

export function debtEvents(debts: readonly PersonalDebt[]): ForecastEvent[] {
  const out: ForecastEvent[] = []
  for (const d of debts) {
    if (d.deletedAt || !d.dueDate) continue
    const outstanding = debtOutstanding(d)
    if (outstanding <= 0) continue
    out.push({
      id: `debt:${d.id}`,
      date: d.dueDate,
      accountId: d.accountId,
      amount: -outstanding,
      label: `Repay ${d.creditor}`,
      certainty: 'confirmed',
      source: 'debt',
      sourceId: d.id,
      recognizes: null, // principal repayment is not an expense
    })
  }
  return out
}

/** Unresolved pass-through money is an expected outflow when it is forwarded. */
export function passThroughEvents(
  passThroughs: readonly PassThroughTransfer[],
  today: ISODate,
  unresolved: (p: PassThroughTransfer) => Minor,
): ForecastEvent[] {
  const out: ForecastEvent[] = []
  for (const p of passThroughs) {
    if (p.deletedAt || p.status === 'cancelled' || p.status === 'pending') continue
    const left = unresolved(p)
    if (left <= 0) continue
    out.push({
      id: `passthrough:${p.id}`,
      date: today,
      accountId: p.accountId,
      amount: -left,
      label: `Forward to ${p.recipient}`,
      certainty: 'confirmed',
      source: 'pass_through',
      sourceId: p.id,
      recognizes: null,
    })
  }
  return out
}

export function salaryEvent(args: {
  paydayDate: ISODate | null | undefined
  netAmount: Minor | null | undefined
  /** Earned salary before advance deductions; defaults to the net amount. */
  grossAmount?: Minor | null
  accountId: string | null
  today: ISODate
}): ForecastEvent | null {
  const { paydayDate, netAmount, accountId, today } = args
  if (!paydayDate || !netAmount || !accountId || paydayDate < today) return null
  return {
    id: `salary:${paydayDate}`,
    date: paydayDate,
    accountId,
    amount: netAmount,
    label: 'Expected salary',
    certainty: 'expected',
    source: 'salary',
    sourceId: paydayDate,
    recognizes: 'income',
    recognizedAmount: args.grossAmount ?? netAmount,
  }
}

export function daysUntil(date: ISODate, today: ISODate): number {
  return diffDays(date, today)
}
