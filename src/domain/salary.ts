import { addDays, addMonths, parseDate, type ISODate } from './dates'
import type { Minor } from './money'
import { advanceOutstanding } from './ledger'
import type { Frequency, SalaryAdvance, Transaction } from './types'

export interface PaydayProjection {
  month: string
  expectedSalary: Minor
  deductions: { advanceId: string; employer: string; amount: Minor }[]
  totalDeductions: Minor
  /** expected salary − advance deductions (other deductions are not assumed). */
  expectedRemainder: Minor
  warnings: string[]
}

/**
 * Expected payday remainder = expected salary − scheduled advance deductions
 * for that payroll month. Deductions follow the user's own schedule; nothing
 * is assumed to come out of "next month" automatically. A deduction never
 * exceeds what is still outstanding on the advance.
 */
export function projectPayday(
  month: string,
  expectedSalary: Minor,
  advances: readonly SalaryAdvance[],
  transactions: readonly Transaction[],
): PaydayProjection {
  const deductions: PaydayProjection['deductions'] = []
  const warnings: string[] = []
  for (const a of advances) {
    if (a.deletedAt || a.status !== 'received') continue
    const outstanding = advanceOutstanding(a, [...transactions])
    if (outstanding <= 0) continue
    const scheduled = a.schedule.find((s) => s.month === month)
    if (!scheduled) continue
    const amount = Math.min(scheduled.amount, outstanding)
    deductions.push({ advanceId: a.id, employer: a.employer, amount })
  }
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0)

  for (const a of advances) {
    if (a.deletedAt || a.status !== 'received') continue
    if (advanceOutstanding(a, [...transactions]) > 0 && a.schedule.length === 0) {
      warnings.push(`The advance from ${a.employer} has no deduction schedule, so it is not included in this projection.`)
    }
  }
  if (totalDeductions > expectedSalary) {
    warnings.push('Scheduled deductions are larger than the expected salary for this month.')
  }
  return {
    month,
    expectedSalary,
    deductions,
    totalDeductions,
    expectedRemainder: expectedSalary - totalDeductions,
    warnings,
  }
}

/**
 * The next payday on or after `today`, rolling a past anchor date forward by the
 * salary frequency (keeping the anchor day-of-month, so 31st clamps and recovers).
 */
export function nextPayday(anchor: ISODate | null | undefined, frequency: Frequency, today: ISODate): ISODate | null {
  if (!anchor) return null
  if (anchor >= today) return anchor
  if (frequency === 'once') return null
  const anchorDay = parseDate(anchor).day
  if (frequency === 'weekly') {
    let d = anchor
    while (d < today) d = addDays(d, 7)
    return d
  }
  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12
  let i = 1
  for (;;) {
    const d = addMonths(anchor, i * step, anchorDay)
    if (d >= today) return d
    if (++i > 2400) return null
  }
}
