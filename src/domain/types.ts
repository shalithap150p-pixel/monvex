import type { ISODate } from './dates'
import type { Minor } from './money'

/** Fields shared by every user-owned record (mirrors the Postgres tables). */
export interface BaseRecord {
  id: string
  createdAt: string // ISO timestamp (UTC)
  updatedAt: string // ISO timestamp (UTC)
  deletedAt?: string | null // soft delete
}

export type AccountType = 'cash' | 'bank' | 'wallet' | 'other'

export interface Account extends BaseRecord {
  name: string
  type: AccountType
  currency: string
  openingBalance: Minor
  confirmedBalance?: Minor | null
  lastReconciledAt?: ISODate | null
  archived: boolean
}

export type TransactionType = 'income' | 'expense'

export interface PayrollDeduction {
  advanceId: string
  amount: Minor
}

export interface Transaction extends BaseRecord {
  type: TransactionType
  accountId: string
  /** Positive cash amount that actually moved in/out of the account. */
  amount: Minor
  currency: string
  date: ISODate
  time?: string | null
  categoryId?: string | null
  description: string
  counterparty?: string | null
  reference?: string | null
  notes?: string | null
  status: 'posted' | 'pending'
  /** Set when this transaction pays a bill occurrence (links the two records). */
  occurrenceId?: string | null
  /**
   * For salary income only: amounts withheld at payroll to recover earlier
   * salary advances / employer loans. Recognised income = amount + deductions
   * (the earned salary), cash received = amount.
   */
  payrollDeductions?: PayrollDeduction[]
}

export interface Category extends BaseRecord {
  name: string
  type: TransactionType
}

export interface InternalTransfer extends BaseRecord {
  sourceAccountId: string
  destinationAccountId: string
  amount: Minor
  fee: Minor // charged to the source account, recognised as an expense
  date: ISODate
  reference?: string | null
  notes?: string | null
}

export type PassThroughStatus =
  | 'received'
  | 'pending'
  | 'partially_transferred'
  | 'transferred'
  | 'confirmed'
  | 'cancelled'

export interface PassThroughLeg {
  id: string
  amount: Minor
  date: ISODate
  fee: Minor // own fee for sending, recognised as an expense
  reference?: string | null
}

/** Money received on behalf of someone else, to be forwarded. */
export interface PassThroughTransfer extends BaseRecord {
  accountId: string // account where the money is physically held
  sender: string
  recipient: string
  destination?: string | null
  amount: Minor
  currency: string
  receivedDate: ISODate
  status: PassThroughStatus
  legs: PassThroughLeg[]
  reference?: string | null
  notes?: string | null
}

export interface Repayment {
  id: string
  amount: Minor // cash amount
  date: ISODate
  accountId: string
  reference?: string | null
}

export interface LoanReceivable extends BaseRecord {
  borrower: string
  accountId: string // account the money left from
  principal: Minor
  currency: string
  lentDate: ISODate
  dueDate?: ISODate | null
  repayments: Repayment[]
  writtenOff: Minor
  notes?: string | null
  reminderDays?: number | null
}

export interface DebtRepayment {
  id: string
  principalPart: Minor
  interestPart: Minor // interest / fees: recognised as an expense
  date: ISODate
  accountId: string
  reference?: string | null
}

export interface PersonalDebt extends BaseRecord {
  creditor: string
  accountId: string // account the borrowed money was received into
  principal: Minor
  currency: string
  borrowedDate: ISODate
  dueDate?: ISODate | null
  repayments: DebtRepayment[]
  notes?: string | null
  reminderDays?: number | null
}

export type AdvanceKind = 'advance' | 'employer_loan'
export type AdvanceStatus = 'pending' | 'received' | 'cancelled'

export interface ScheduledDeduction {
  month: string // YYYY-MM payroll month
  amount: Minor
}

export interface SalaryAdvance extends BaseRecord {
  employer: string
  kind: AdvanceKind
  accountId: string
  amount: Minor
  currency: string
  date: ISODate
  status: AdvanceStatus
  /** User-configured deduction schedule — never assumed to be "next month". */
  schedule: ScheduledDeduction[]
  payrollMonth?: string | null
  notes?: string | null
}

export type Frequency = 'once' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface PaymentObligation extends BaseRecord {
  name: string
  amount: Minor // amount or estimate
  isEstimate: boolean
  currency: string
  frequency: Frequency
  dueDate: ISODate // first due date (anchor)
  endDate?: ISODate | null
  accountId?: string | null
  reminderDays: number
  essential: boolean
  active: boolean
  notes?: string | null
}

export interface PaymentOccurrence extends BaseRecord {
  obligationId: string
  dueDate: ISODate
  expectedAmount: Minor
  paidAmount: Minor
  paidTransactionIds: string[]
}

export type OccurrenceStatus =
  | 'upcoming'
  | 'unpaid'
  | 'due'
  | 'partially_paid'
  | 'overdue'
  | 'paid'

export interface Budget extends BaseRecord {
  currency?: string
  categoryId: string
  period: 'monthly'
  limit: Minor
  alertThresholdPct: number
}

export interface SavingsGoal extends BaseRecord {
  currency?: string
  name: string
  target: Minor
  targetDate?: ISODate | null
  allocated: Minor
  accountId?: string | null
  /** Only reserved goals reduce Safe-to-Spend. */
  reserveInSafeToSpend: boolean
}

export interface UserPreferences {
  currency: string
  paydayDate?: ISODate | null
  expectedSalary?: Minor | null
  salaryFrequency: Frequency
  salaryAccountId?: string | null
  essentialDailyAmount: Minor
  safetyBuffer: Minor
  safeToSpendPeriodDays: number
  carryForwardAllowance: boolean
  theme: 'navy' | 'noir'
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  currency: 'LKR',
  paydayDate: null,
  expectedSalary: null,
  salaryFrequency: 'monthly',
  salaryAccountId: null,
  essentialDailyAmount: 0,
  safetyBuffer: 0,
  safeToSpendPeriodDays: 30,
  carryForwardAllowance: true,
  theme: 'navy',
}

/** Everything the pure domain functions need. */
export interface LedgerData {
  accounts: Account[]
  transactions: Transaction[]
  transfers: InternalTransfer[]
  passThroughs: PassThroughTransfer[]
  loans: LoanReceivable[]
  debts: PersonalDebt[]
  advances: SalaryAdvance[]
}

export const EMPTY_LEDGER: LedgerData = {
  accounts: [],
  transactions: [],
  transfers: [],
  passThroughs: [],
  loans: [],
  debts: [],
  advances: [],
}
