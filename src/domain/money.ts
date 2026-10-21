/**
 * Money is represented as an integer count of minor units (e.g. LKR cents).
 * No floating-point arithmetic is ever used for authoritative amounts:
 * strings are parsed digit-by-digit and formatting uses integer division.
 */

export type Minor = number

const CURRENCY_DECIMALS: Record<string, number> = {
  LKR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  AUD: 2,
  JPY: 0,
  KWD: 3,
}

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2
}

export class MoneyParseError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid amount`)
    this.name = 'MoneyParseError'
  }
}

/**
 * Parse a user-entered decimal string ("1,250.50") into minor units without
 * floating point. Rejects more fractional digits than the currency allows.
 */
export function parseAmount(input: string, currency = 'LKR'): Minor {
  const decimals = decimalsFor(currency)
  const cleaned = input.trim().replace(/,/g, '').replace(/\s/g, '')
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned)
  if (!match) throw new MoneyParseError(input)
  const [, sign, whole, frac = ''] = match
  if (frac.length > decimals) throw new MoneyParseError(input)
  const fracPadded = frac.padEnd(decimals, '0')
  const minor = Number(whole) * 10 ** decimals + (decimals ? Number(fracPadded) : 0)
  if (!Number.isSafeInteger(minor)) throw new MoneyParseError(input)
  return sign ? -minor : minor
}

export function tryParseAmount(input: string, currency = 'LKR'): Minor | null {
  try {
    return parseAmount(input, currency)
  } catch {
    return null
  }
}

/** Plain decimal string (no grouping) for editing fields: 125050 -> "1250.50". */
export function toDecimalString(minor: Minor, currency = 'LKR'): string {
  const decimals = decimalsFor(currency)
  const negative = minor < 0
  const abs = Math.abs(minor)
  if (decimals === 0) return `${negative ? '-' : ''}${abs}`
  const base = 10 ** decimals
  const whole = Math.floor(abs / base)
  const frac = String(abs % base).padStart(decimals, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** Display string with grouping, e.g. "LKR 1,250.50" or "- LKR 50.00". */
export function formatMoney(
  minor: Minor,
  currency = 'LKR',
  opts: { signed?: boolean; withCurrency?: boolean } = {},
): string {
  const { signed = false, withCurrency = true } = opts
  const decimals = decimalsFor(currency)
  const abs = Math.abs(minor)
  const base = 10 ** decimals
  const whole = Math.floor(abs / base)
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = decimals ? `.${String(abs % base).padStart(decimals, '0')}` : ''
  const body = `${withCurrency ? `${currency} ` : ''}${grouped}${frac}`
  if (minor < 0) return `− ${body}`
  if (signed && minor > 0) return `+ ${body}`
  return body
}

export function sum(values: readonly Minor[]): Minor {
  let total = 0
  for (const v of values) total += v
  return total
}

/** Split an amount into n parts without losing a minor unit. */
export function allocate(total: Minor, parts: number): Minor[] {
  if (parts <= 0) throw new Error('parts must be positive')
  const base = Math.trunc(total / parts)
  const remainder = total - base * parts
  const result: Minor[] = Array.from({ length: parts }, () => base)
  const step = remainder >= 0 ? 1 : -1
  for (let i = 0; i < Math.abs(remainder); i++) result[i] += step
  return result
}

export function isPositive(minor: Minor): boolean {
  return Number.isSafeInteger(minor) && minor > 0
}
