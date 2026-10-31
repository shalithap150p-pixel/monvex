import type { EntityName } from '../../src/data/records'

/** One valid sample record per synced entity. Shared by the contract test and the erase test. */
export const T = '2026-01-01T00:00:00.000Z'
export const ts = { createdAt: T, updatedAt: T, deletedAt: null }
export const ID = '33333333-3333-3333-3333-333333333333'
export const D = '2026-03-05'

export const SAMPLES: Record<EntityName, Record<string, unknown>> = {
  accounts: { id: ID, name: 'Cash', type: 'cash', currency: 'LKR', openingBalance: 123456, confirmedBalance: 100, lastReconciledAt: D, archived: false },
  categories: { id: ID, name: 'Food', type: 'expense' },
  obligations: { id: ID, name: 'Rent', amount: 2500000, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: D, endDate: null, accountId: ID, reminderDays: 3, essential: true, active: true, notes: null, categoryId: ID },
  occurrences: { id: ID, obligationId: ID, dueDate: D, expectedAmount: 2500000, currency: 'LKR' },
  transactions: { id: ID, type: 'expense', accountId: ID, amount: 150050, currency: 'LKR', date: D, time: '09:30', categoryId: ID, description: 'Lunch', counterparty: null, reference: null, notes: null, status: 'posted', occurrenceId: null },
  transfers: { id: ID, sourceAccountId: ID, destinationAccountId: ID, amount: 5000, fee: 100, date: D, reference: null, notes: null, currency: 'LKR' },
  passThroughs: { id: ID, accountId: ID, sender: 'A', recipient: 'B', destination: null, amount: 1000, currency: 'LKR', receivedDate: D, status: 'received', reference: null, notes: null },
  passThroughLegs: { id: ID, passThroughId: ID, amount: 500, fee: 10, date: D, reference: null, currency: 'LKR' },
  loans: { id: ID, borrower: 'X', accountId: ID, principal: 100000, currency: 'LKR', lentDate: D, dueDate: null, writtenOff: 0, notes: null, reminderDays: null },
  loanRepayments: { id: ID, loanId: ID, accountId: ID, amount: 5000, date: D, reference: null, currency: 'LKR' },
  debts: { id: ID, creditor: 'Y', accountId: ID, principal: 100000, currency: 'LKR', borrowedDate: D, dueDate: null, notes: null, reminderDays: null },
  debtRepayments: { id: ID, debtId: ID, accountId: ID, principalPart: 4000, interestPart: 100, date: D, reference: null, currency: 'LKR' },
  advances: { id: ID, employer: 'Co', kind: 'advance', accountId: ID, amount: 5000000, currency: 'LKR', date: D, status: 'received', schedule: [{ month: '2026-04', amount: 5000000 }], payrollMonth: null, notes: null },
  payrollDeductions: { id: ID, transactionId: ID, advanceId: ID, amount: 5000000, currency: 'LKR' },
  budgets: { id: ID, currency: 'LKR', categoryId: ID, period: 'monthly', limit: 3000000, alertThresholdPct: 80, essential: true },
  goals: { id: ID, currency: 'LKR', name: 'Trip', target: 10000000, targetDate: null, accountId: null, reserveInSafeToSpend: false, priority: 'high', monthlyContribution: 400000 },
  allocations: { id: ID, goalId: ID, accountId: null, amount: 1000, date: D, note: null, currency: 'LKR' },
  reconciliations: { id: ID, accountId: ID, statementBalance: 1000, appBalance: 900, date: D, notes: null, currency: 'LKR' },
  bankDetails: { id: ID, label: 'Salary account', bankName: 'Sample Bank', branchName: 'Colombo', branchCode: '001', bankCode: '7010', accountHolder: 'A. Person', accountNumber: '0000 1111 2222', accountType: 'savings', currency: 'LKR', iban: null, swiftBic: 'SAMPLKLX', cardLast4: '1234', openedOn: D, contactPhone: '0112000000', linkedAccountId: ID, notes: null },
}
