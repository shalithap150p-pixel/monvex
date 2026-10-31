import { useMemo } from 'react'
import { billEvents, debtEvents, passThroughEvents, receivableEvents, runForecast, salaryEvent, type ForecastEvent, type ForecastResult, type Scenario } from '../domain/forecast'
import { accountBalances, availableMoney, buildMovements, passThroughUnresolved, type AvailableMoney, type Movement } from '../domain/ledger'
import { monthKey } from '../domain/dates'
import type { SafeToSpendResult } from '../domain/safeToSpend'
import { computeSmartFinance, type SmartFinance } from '../domain/smartFinance'
import { monthlySavings, projectedClosingBalance, type ClosingBalanceBreakdown, type SavingsBreakdown } from '../domain/savings'
import { nextPayday, projectPayday, type PaydayProjection } from '../domain/salary'
import type { ISODate } from '../domain/dates'
import { useApp } from './AppContext'

export interface Derived {
  movements: Movement[]
  money: AvailableMoney
  balances: Map<string, number>
  events: ForecastEvent[]
  payday: ISODate | null
  paydayProjection: PaydayProjection | null
  /** Flexible-pool engine result for right now (same numbers as smart.daily.now). */
  safe: SafeToSpendResult
  /** Daily allowance, budgets, savings plan, spending history and insights. */
  smart: SmartFinance
  savings: SavingsBreakdown
  closing: ClosingBalanceBreakdown
  forecast: (days: 30 | 60 | 90, scenario?: Scenario) => ForecastResult
}

/** All derived financial numbers come from tested domain functions — never from UI code. */
export function useDerived(): Derived {
  const { data, today } = useApp()
  return useMemo(() => {
    const { ledger, prefs, obligations, occurrences, goals } = data
    const movements = buildMovements(ledger)
    const money = availableMoney(ledger, today)
    const activeAccounts = ledger.accounts.filter((a) => !a.archived)
    const balances = accountBalances(activeAccounts, movements, today)

    const payday = nextPayday(prefs.paydayDate, prefs.salaryFrequency, today)
    const defaultAccountId = activeAccounts[0]?.id ?? null
    const salaryAccountId = prefs.salaryAccountId && activeAccounts.some((a) => a.id === prefs.salaryAccountId) ? prefs.salaryAccountId : defaultAccountId
    const paydayProjection =
      payday && prefs.expectedSalary ? projectPayday(monthKey(payday), prefs.expectedSalary, ledger.advances, ledger.transactions) : null

    const events: ForecastEvent[] = [
      ...billEvents(obligations, occurrences, defaultAccountId),
      ...receivableEvents(ledger.loans),
      ...debtEvents(ledger.debts),
      ...passThroughEvents(ledger.passThroughs, today, passThroughUnresolved),
    ]
    const sal = salaryEvent({
      paydayDate: payday,
      netAmount: paydayProjection?.expectedRemainder ?? null,
      grossAmount: paydayProjection?.expectedSalary ?? null,
      accountId: salaryAccountId,
      today,
    })
    if (sal) events.push(sal)

    const smart = computeSmartFinance({
      today,
      ledger,
      prefs,
      obligations,
      occurrences,
      budgets: data.budgets,
      goals,
      categories: data.categories,
      payday,
      movements,
      availableFunds: money.available,
    })
    const safe = smart.daily.now

    const month = monthKey(today)
    const savings = monthlySavings(movements, events, month, today)
    const closing = projectedClosingBalance(ledger, events, month, today)
    const forecast = (days: 30 | 60 | 90, scenario: Scenario = 'expected') =>
      runForecast({ today, horizonDays: days, accounts: activeAccounts, balances, events, scenario })

    return { movements, money, balances, events, payday, paydayProjection, safe, smart, savings, closing, forecast }
  }, [data, today])
}
