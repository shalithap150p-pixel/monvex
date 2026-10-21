/**
 * Calendar dates are plain "YYYY-MM-DD" strings (local transaction dates).
 * All arithmetic is done in UTC on the parsed components so that the user's
 * time zone / DST never shifts a date by one day.
 */

export type ISODate = string

export function parseDate(d: ISODate): { y: number; m: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!match) throw new Error(`Invalid date "${d}"`)
  return { y: Number(match[1]), m: Number(match[2]), day: Number(match[3]) }
}

export function isValidDate(d: string): boolean {
  try {
    const { y, m, day } = parseDate(d)
    const t = new Date(Date.UTC(y, m - 1, day))
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day
  } catch {
    return false
  }
}

export function toISO(y: number, m: number, day: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, day } = parseDate(d)
  const t = new Date(Date.UTC(y, m - 1, day + n))
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** Add months keeping `anchorDay` where possible (31 Jan + 1 month = 28/29 Feb, then 31 Mar). */
export function addMonths(d: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, day } = parseDate(d)
  const target = y * 12 + (m - 1) + n
  const ty = Math.floor(target / 12)
  const tm = (target % 12) + 1
  const want = anchorDay ?? day
  return toISO(ty, tm, Math.min(want, daysInMonth(ty, tm)))
}

export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseDate(a)
  const pb = parseDate(b)
  const ta = Date.UTC(pa.y, pa.m - 1, pa.day)
  const tb = Date.UTC(pb.y, pb.m - 1, pb.day)
  return Math.round((ta - tb) / 86_400_000)
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7)
}

export function monthStart(key: string): ISODate {
  return `${key}-01`
}

export function monthEnd(key: string): ISODate {
  const [y, m] = key.split('-').map(Number)
  return toISO(y, m, daysInMonth(y, m))
}

export function inMonth(d: ISODate, key: string): boolean {
  return monthKey(d) === key
}

export function inRange(d: ISODate, from: ISODate, to: ISODate): boolean {
  return d >= from && d <= to
}

export function todayLocal(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Inclusive list of dates from..to. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
