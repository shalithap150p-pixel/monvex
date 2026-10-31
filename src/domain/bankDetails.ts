import { isValidDate } from './dates'
import type { BankAccountType, BankDetails } from './types'

/**
 * Bank details are reference information the user keeps for themselves.
 * MONVEX never stores online-banking passwords, PINs, OTPs, CVV/CVC or full card numbers:
 * there is no field for them, and free text is checked for them too.
 */

export const ACCOUNT_TYPE_LABEL: Record<BankAccountType, string> = {
  savings: 'Savings',
  current: 'Current',
  fixed_deposit: 'Fixed deposit',
  foreign_currency: 'Foreign currency',
  other: 'Other',
}

export interface BankDetailsInput {
  label: string
  bankName: string
  branchName: string
  branchCode: string
  bankCode: string
  accountHolder: string
  accountNumber: string
  accountType: BankAccountType
  currency: string
  iban: string
  swiftBic: string
  cardLast4: string
  openedOn: string
  contactPhone: string
  notes: string
}

/** Words that mean the user is about to type a secret. */
const SECRET_WORDS = /\b(password|passcode|passwd|pin|otp|cvv|cvc|secret\s*(?:code|answer))\b/i

export const SECRET_MESSAGE =
  'This looks like a password, PIN, OTP or card security code. MONVEX never stores those — please remove it.'

const ACCOUNT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 \-/.]{2,39}$/

export const normalizeSpaces = (s: string) => s.replace(/\s+/g, ' ').trim()
const clean = (s: string) => normalizeSpaces(s)
export const emptyToNull = (s: string): string | null => (clean(s) === '' ? null : clean(s))

/** Returns a message per invalid field (empty object = valid). */
export function validateBankDetails(i: BankDetailsInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!clean(i.label)) e.label = 'Give this account a name you will recognise.'
  if (!clean(i.bankName)) e.bankName = 'Enter the bank name.'
  if (!clean(i.accountNumber)) e.accountNumber = 'Enter the account number.'
  else if (!ACCOUNT_NUMBER.test(clean(i.accountNumber))) e.accountNumber = 'Use 3–40 letters, digits, spaces or dashes.'
  if (!/^[A-Za-z]{3}$/.test(i.currency)) e.currency = 'Use a 3-letter currency code such as LKR.'
  const iban = clean(i.iban).replace(/\s/g, '')
  if (iban && !/^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}$/.test(iban)) e.iban = 'An IBAN starts with 2 letters and 2 digits (15–34 characters in total).'
  const swift = clean(i.swiftBic).replace(/\s/g, '')
  if (swift && !/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(swift)) e.swiftBic = 'A SWIFT/BIC code has 8 or 11 characters, e.g. BCEYLKLX.'
  const card = clean(i.cardLast4)
  if (card && !/^[0-9]{4}$/.test(card)) e.cardLast4 = 'Enter only the last 4 digits of the card — never the full number.'
  if (clean(i.openedOn) && !isValidDate(clean(i.openedOn))) e.openedOn = 'Enter a valid date.'
  if (clean(i.contactPhone) && !/^[0-9+()\-\s]{5,25}$/.test(clean(i.contactPhone))) e.contactPhone = 'Use digits, spaces, + and - only.'
  if (i.notes.length > 1000) e.notes = 'Keep notes under 1,000 characters.'
  if (SECRET_WORDS.test(i.notes)) e.notes = SECRET_MESSAGE
  for (const key of ['label', 'bankName', 'branchName', 'accountHolder'] as const) {
    if (SECRET_WORDS.test(i[key])) e[key] = SECRET_MESSAGE
  }
  return e
}

/** "0012 3456 7890" → "•••• •••• 7890" (keeps the last four characters only). */
export function maskAccountNumber(n: string): string {
  const compact = n.replace(/[\s\-/.]/g, '')
  if (compact.length <= 4) return '•'.repeat(compact.length)
  return `•••• •••• ${compact.slice(-4)}`
}

/** Plain text a user can paste to someone who needs to pay into this account. */
export function detailsAsText(d: BankDetails): string {
  const lines: [string, string | null | undefined][] = [
    ['Bank', d.bankName],
    ['Branch', [d.branchName, d.branchCode ? `(${d.branchCode})` : ''].filter(Boolean).join(' ') || null],
    ['Account name', d.accountHolder],
    ['Account number', d.accountNumber],
    ['Account type', ACCOUNT_TYPE_LABEL[d.accountType]],
    ['Currency', d.currency],
    ['IBAN', d.iban],
    ['SWIFT/BIC', d.swiftBic],
  ]
  return lines
    .filter(([, v]) => v && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}
