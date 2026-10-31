import { describe, expect, it } from 'vitest'
import { detailsAsText, maskAccountNumber, validateBankDetails, type BankDetailsInput } from './bankDetails'
import type { BankDetails } from './types'

const ok: BankDetailsInput = {
  label: 'Salary account',
  bankName: 'Sample Bank',
  branchName: 'Colombo',
  branchCode: '001',
  bankCode: '7000',
  accountHolder: 'A. Person',
  accountNumber: '0012 3456 7890',
  accountType: 'savings',
  currency: 'LKR',
  iban: '',
  swiftBic: '',
  cardLast4: '',
  openedOn: '',
  contactPhone: '',
  notes: '',
}

describe('bank details validation', () => {
  it('accepts a complete, valid record', () => {
    expect(validateBankDetails(ok)).toEqual({})
  })

  it('requires a name, a bank and an account number', () => {
    const e = validateBankDetails({ ...ok, label: ' ', bankName: '', accountNumber: '' })
    expect(Object.keys(e).sort()).toEqual(['accountNumber', 'bankName', 'label'])
  })

  it('rejects malformed account numbers, IBAN, SWIFT and card digits', () => {
    expect(validateBankDetails({ ...ok, accountNumber: '12' }).accountNumber).toBeDefined()
    expect(validateBankDetails({ ...ok, accountNumber: '<script>' }).accountNumber).toBeDefined()
    expect(validateBankDetails({ ...ok, iban: 'LK12' }).iban).toBeDefined()
    expect(validateBankDetails({ ...ok, iban: 'GB82 WEST 1234 5698 7654 32' }).iban).toBeUndefined()
    expect(validateBankDetails({ ...ok, swiftBic: 'ABC' }).swiftBic).toBeDefined()
    expect(validateBankDetails({ ...ok, swiftBic: 'BCEYLKLX' }).swiftBic).toBeUndefined()
    expect(validateBankDetails({ ...ok, currency: 'LK' }).currency).toBeDefined()
  })

  it('only ever accepts the last four digits of a card', () => {
    expect(validateBankDetails({ ...ok, cardLast4: '1234' })).toEqual({})
    expect(validateBankDetails({ ...ok, cardLast4: '4242424242424242' }).cardLast4).toMatch(/last 4/)
    expect(validateBankDetails({ ...ok, cardLast4: '12a4' }).cardLast4).toBeDefined()
  })

  it('refuses passwords, PINs, OTPs and card security codes in free text', () => {
    for (const notes of ['my password is abc', 'ATM PIN 1234', 'otp: 998877', 'CVV 123', 'internet banking Password: x']) {
      expect(validateBankDetails({ ...ok, notes }).notes, notes).toMatch(/never stores/)
    }
    expect(validateBankDetails({ ...ok, label: 'My PIN account' }).label).toMatch(/never stores/)
    // ordinary words that merely contain those letters are fine
    expect(validateBankDetails({ ...ok, notes: 'Opened in Spinney branch, ask for the manager' })).toEqual({})
  })

  it('checks dates and phone numbers', () => {
    expect(validateBankDetails({ ...ok, openedOn: '2026-02-31' }).openedOn).toBeDefined()
    expect(validateBankDetails({ ...ok, openedOn: '2020-02-29' })).toEqual({})
    expect(validateBankDetails({ ...ok, contactPhone: 'call me' }).contactPhone).toBeDefined()
    expect(validateBankDetails({ ...ok, contactPhone: '+94 11 234 5678' })).toEqual({})
  })
})

describe('bank details display', () => {
  it('masks all but the last four characters', () => {
    expect(maskAccountNumber('0012 3456 7890')).toBe('•••• •••• 7890')
    expect(maskAccountNumber('1234')).toBe('••••')
    expect(maskAccountNumber('12')).toBe('••')
  })

  it('builds a shareable text without empty lines', () => {
    const d = {
      id: '1',
      createdAt: '',
      updatedAt: '',
      label: 'Salary',
      bankName: 'Sample Bank',
      branchName: 'Colombo',
      branchCode: '001',
      accountHolder: 'A. Person',
      accountNumber: '0012 3456 7890',
      accountType: 'current',
      currency: 'LKR',
      iban: null,
    } satisfies BankDetails
    expect(detailsAsText(d)).toBe(
      ['Bank: Sample Bank', 'Branch: Colombo (001)', 'Account name: A. Person', 'Account number: 0012 3456 7890', 'Account type: Current', 'Currency: LKR'].join('\n'),
    )
  })
})
