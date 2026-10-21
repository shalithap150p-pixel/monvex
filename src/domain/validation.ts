import { isValidDate } from './dates'
import type { Minor } from './money'

export type FieldErrors = Record<string, string>

export function validateTransactionInput(input: {
  amount: Minor | null
  date: string
  accountId: string
  description: string
}): FieldErrors {
  const errors: FieldErrors = {}
  if (input.amount === null || !Number.isSafeInteger(input.amount) || input.amount <= 0) {
    errors.amount = 'Enter an amount greater than zero.'
  }
  if (!isValidDate(input.date)) errors.date = 'Enter a valid date.'
  if (!input.accountId) errors.accountId = 'Choose an account.'
  if (!input.description.trim()) errors.description = 'Add a short description.'
  return errors
}

export function validateTransferInput(input: {
  amount: Minor | null
  fee: Minor
  date: string
  sourceAccountId: string
  destinationAccountId: string
}): FieldErrors {
  const errors: FieldErrors = {}
  if (input.amount === null || input.amount <= 0) errors.amount = 'Enter an amount greater than zero.'
  if (input.fee < 0) errors.fee = 'The fee cannot be negative.'
  if (!isValidDate(input.date)) errors.date = 'Enter a valid date.'
  if (!input.sourceAccountId) errors.sourceAccountId = 'Choose the account to move money from.'
  if (!input.destinationAccountId) errors.destinationAccountId = 'Choose the account to move money to.'
  if (input.sourceAccountId && input.sourceAccountId === input.destinationAccountId) {
    errors.destinationAccountId = 'Choose two different accounts.'
  }
  return errors
}

/** Allowed attachment types and size for the Evidence Vault. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

export function validateEvidenceFile(file: { name: string; size: number; type: string }): string | null {
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Only JPEG, PNG, WebP images and PDF files are allowed.'
  }
  if (file.size <= 0) return 'The file is empty.'
  if (file.size > EVIDENCE_MAX_BYTES) return 'The file is larger than 10 MB.'
  return null
}

/** Stable key for detecting duplicate submissions / imported statement rows. */
export function duplicateKey(parts: { accountId: string; date: string; amount: Minor; reference?: string | null }): string {
  return [parts.accountId, parts.date, parts.amount, (parts.reference ?? '').trim().toLowerCase()].join('|')
}
