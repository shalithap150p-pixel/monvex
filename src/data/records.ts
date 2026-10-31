import type {
  Account,
  Budget,
  Category,
  InternalTransfer,
  LoanReceivable,
  PassThroughTransfer,
  PaymentObligation,
  PaymentOccurrence,
  PersonalDebt,
  SalaryAdvance,
  SavingsGoal,
  Transaction,
} from '../domain/types'
import type { ISODate } from '../domain/dates'
import type { Minor } from '../domain/money'

/** Local sync metadata carried by every stored record. */
export interface Synced {
  /** `updated_at` the server last confirmed (the base version for conflict checks). */
  serverUpdatedAt?: string | null
}

interface ChildBase extends Synced {
  id: string
  currency: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface ReceivableRepaymentRec extends ChildBase {
  loanId: string
  accountId: string
  amount: Minor
  date: ISODate
  reference?: string | null
}

export interface DebtRepaymentRec extends ChildBase {
  debtId: string
  accountId: string
  principalPart: Minor
  interestPart: Minor
  date: ISODate
  reference?: string | null
}

export interface PassThroughLegRec extends ChildBase {
  passThroughId: string
  amount: Minor
  fee: Minor
  date: ISODate
  reference?: string | null
}

export interface PayrollDeductionRec extends ChildBase {
  transactionId: string
  advanceId: string
  amount: Minor
}

export interface SavingsAllocationRec extends ChildBase {
  goalId: string
  accountId?: string | null
  amount: Minor
  date: ISODate
  note?: string | null
}

export interface ReconciliationRec extends ChildBase {
  accountId: string
  statementBalance: Minor
  appBalance: Minor
  date: ISODate
  notes?: string | null
}

export type AccountRec = Account & Synced
export type CategoryRec = Category & Synced
export type TransactionRec = Omit<Transaction, 'payrollDeductions'> & Synced
export type TransferRec = InternalTransfer & Synced & { currency: string }
export type PassThroughRec = Omit<PassThroughTransfer, 'legs'> & Synced
export type LoanRec = Omit<LoanReceivable, 'repayments'> & Synced
export type DebtRec = Omit<PersonalDebt, 'repayments'> & Synced
export type AdvanceRec = SalaryAdvance & Synced
export type ObligationRec = PaymentObligation & Synced
export type OccurrenceRec = Omit<PaymentOccurrence, 'paidAmount' | 'paidTransactionIds'> & Synced & { currency: string }
export type BudgetRec = Budget & Synced
export type GoalRec = Omit<SavingsGoal, 'allocated' | 'contributions'> & Synced

export interface EntityMap {
  accounts: AccountRec
  categories: CategoryRec
  obligations: ObligationRec
  occurrences: OccurrenceRec
  transactions: TransactionRec
  transfers: TransferRec
  passThroughs: PassThroughRec
  passThroughLegs: PassThroughLegRec
  loans: LoanRec
  loanRepayments: ReceivableRepaymentRec
  debts: DebtRec
  debtRepayments: DebtRepaymentRec
  advances: AdvanceRec
  payrollDeductions: PayrollDeductionRec
  budgets: BudgetRec
  goals: GoalRec
  allocations: SavingsAllocationRec
  reconciliations: ReconciliationRec
}

export type EntityName = keyof EntityMap
