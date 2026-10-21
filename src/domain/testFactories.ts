import type {
  Account,
  InternalTransfer,
  LedgerData,
  LoanReceivable,
  PassThroughTransfer,
  PaymentObligation,
  PaymentOccurrence,
  PersonalDebt,
  SalaryAdvance,
  Transaction,
} from './types'
import { EMPTY_LEDGER } from './types'

const NOW = '2026-10-01T00:00:00.000Z'
let n = 0
const id = (p: string) => `${p}-${++n}`

export const acct = (over: Partial<Account> = {}): Account => ({
  id: id('acc'),
  name: 'Cash',
  type: 'cash',
  currency: 'LKR',
  openingBalance: 0,
  archived: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const txn = (over: Partial<Transaction> = {}): Transaction => ({
  id: id('txn'),
  type: 'expense',
  accountId: 'acc',
  amount: 100_00,
  currency: 'LKR',
  date: '2026-10-05',
  description: 'test',
  status: 'posted',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const transfer = (over: Partial<InternalTransfer> = {}): InternalTransfer => ({
  id: id('tr'),
  sourceAccountId: 'a',
  destinationAccountId: 'b',
  amount: 100_00,
  fee: 0,
  date: '2026-10-05',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const passThrough = (over: Partial<PassThroughTransfer> = {}): PassThroughTransfer => ({
  id: id('pt'),
  accountId: 'a',
  sender: 'Nimal',
  recipient: 'Kamal',
  amount: 50_000_00,
  currency: 'LKR',
  receivedDate: '2026-10-05',
  status: 'received',
  legs: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const loan = (over: Partial<LoanReceivable> = {}): LoanReceivable => ({
  id: id('loan'),
  borrower: 'Friend',
  accountId: 'a',
  principal: 20_000_00,
  currency: 'LKR',
  lentDate: '2026-10-02',
  repayments: [],
  writtenOff: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const debt = (over: Partial<PersonalDebt> = {}): PersonalDebt => ({
  id: id('debt'),
  creditor: 'Bank',
  accountId: 'a',
  principal: 30_000_00,
  currency: 'LKR',
  borrowedDate: '2026-10-02',
  repayments: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const advance = (over: Partial<SalaryAdvance> = {}): SalaryAdvance => ({
  id: id('adv'),
  employer: 'Acme',
  kind: 'advance',
  accountId: 'a',
  amount: 10_000_00,
  currency: 'LKR',
  date: '2026-10-10',
  status: 'received',
  schedule: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const obligation = (over: Partial<PaymentObligation> = {}): PaymentObligation => ({
  id: id('ob'),
  name: 'Rent',
  amount: 25_000_00,
  isEstimate: false,
  currency: 'LKR',
  frequency: 'monthly',
  dueDate: '2026-10-25',
  reminderDays: 5,
  essential: true,
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const occurrence = (over: Partial<PaymentOccurrence> = {}): PaymentOccurrence => ({
  id: id('occ'),
  obligationId: 'ob',
  dueDate: '2026-10-25',
  expectedAmount: 25_000_00,
  paidAmount: 0,
  paidTransactionIds: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

export const ledger = (over: Partial<LedgerData> = {}): LedgerData => ({ ...EMPTY_LEDGER, ...over })
