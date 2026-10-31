import { addDays, addMonths, monthKey, type ISODate } from '../domain/dates'
import type { MonvexDB } from './db'
import { newId, saveRecord, savePrefs } from './repo'
import type { EntityMap, EntityName } from './records'

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Food & Dining',
  'Transport',
  'Rent',
  'Utilities',
  'Education',
  'Subscriptions',
  'Shopping',
  'Health',
  'Other expense',
]
export const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Freelance', 'Sales', 'Gifts', 'Other income']

/** Create starter categories (called once per fresh store, in cloud and demo mode alike). */
export async function seedCategories(db: MonvexDB, syncEnabled: boolean): Promise<void> {
  const make = (name: string, type: 'income' | 'expense') =>
    saveRecord(db, 'categories', { id: newId(), name, type }, { syncEnabled })
  for (const n of DEFAULT_INCOME_CATEGORIES) await make(n, 'income')
  for (const n of DEFAULT_EXPENSE_CATEGORIES) await make(n, 'expense')
}

/**
 * Realistic sample data for the clearly labelled DEMO store only.
 * It is written to its own IndexedDB database and is never synced, so it
 * can never mix with a signed-in user's real records.
 */
export async function seedDemoData(db: MonvexDB, today: ISODate): Promise<void> {
  const o = { syncEnabled: false }
  const put = <K extends EntityName>(entity: K, rec: Omit<EntityMap[K], 'createdAt' | 'updatedAt' | 'serverUpdatedAt'>) =>
    saveRecord(db, entity, rec as never, o)

  await seedCategories(db, false)
  const cats = await db.categories.toArray()
  const cat = (name: string) => cats.find((c) => c.name === name)!.id

  const cash = newId()
  const bank = newId()
  const wallet = newId()
  await put('accounts', { id: cash, name: 'Cash on hand', type: 'cash', currency: 'LKR', openingBalance: 12_000_00, archived: false })
  await put('accounts', { id: bank, name: 'Main bank account', type: 'bank', currency: 'LKR', openingBalance: 85_000_00, archived: false })
  await put('accounts', { id: wallet, name: 'E-wallet', type: 'wallet', currency: 'LKR', openingBalance: 3_500_00, archived: false })

  const txn = (daysAgo: number, type: 'income' | 'expense', accountId: string, amount: number, description: string, category: string) =>
    put('transactions', {
      id: newId(),
      type,
      accountId,
      amount,
      currency: 'LKR',
      date: addDays(today, -daysAgo),
      description,
      categoryId: cat(category),
      status: 'posted',
    })

  await txn(18, 'income', bank, 60_000_00, 'Monthly salary', 'Salary')
  await txn(16, 'expense', bank, 25_000_00, 'House rent', 'Rent')
  await txn(14, 'expense', cash, 1_850_00, 'Groceries', 'Food & Dining')
  await txn(12, 'expense', wallet, 650_00, 'Bus and tuk-tuk', 'Transport')
  await txn(10, 'expense', bank, 4_200_00, 'Electricity bill', 'Utilities')
  await txn(8, 'income', bank, 7_500_00, 'Freelance logo work', 'Freelance')
  await txn(6, 'expense', cash, 2_400_00, 'Lunch with friends', 'Food & Dining')
  await txn(4, 'expense', wallet, 1_190_00, 'Streaming subscription', 'Subscriptions')
  await txn(2, 'expense', cash, 3_600_00, 'Groceries', 'Food & Dining')
  await txn(1, 'expense', bank, 5_500_00, 'Books and stationery', 'Education')

  const rent = newId()
  const internet = newId()
  const insurance = newId()
  await put('obligations', { id: rent, name: 'House rent', amount: 25_000_00, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: addDays(today, 6), accountId: bank, categoryId: cat('Rent'), reminderDays: 5, essential: true, active: true })
  await put('obligations', { id: internet, name: 'Home internet', amount: 4_500_00, isEstimate: false, currency: 'LKR', frequency: 'monthly', dueDate: addDays(today, 3), accountId: bank, categoryId: cat('Utilities'), reminderDays: 3, essential: true, active: true })
  await put('obligations', { id: insurance, name: 'Insurance premium', amount: 9_000_00, isEstimate: true, currency: 'LKR', frequency: 'quarterly', dueDate: addDays(today, 20), accountId: bank, reminderDays: 7, essential: false, active: true })

  await put('loans', { id: newId(), borrower: 'Kasun (friend)', accountId: cash, principal: 15_000_00, currency: 'LKR', lentDate: addDays(today, -20), dueDate: addDays(today, 10), writtenOff: 0 })
  await put('debts', { id: newId(), creditor: 'Family loan', accountId: bank, principal: 20_000_00, currency: 'LKR', borrowedDate: addDays(today, -40), dueDate: addDays(today, 25) })
  await put('passThroughs', { id: newId(), accountId: cash, sender: 'Aunt Malani', recipient: 'Nimal (bank transfer)', destination: 'Nimal – Sampath Bank', amount: 10_000_00, currency: 'LKR', receivedDate: addDays(today, -1), status: 'received' })

  await put('budgets', { id: newId(), categoryId: cat('Food & Dining'), period: 'monthly', limit: 15_000_00, currency: 'LKR', alertThresholdPct: 80, essential: true })
  await put('budgets', { id: newId(), categoryId: cat('Transport'), period: 'monthly', limit: 5_000_00, currency: 'LKR', alertThresholdPct: 80, essential: true })
  await put('budgets', { id: newId(), categoryId: cat('Shopping'), period: 'monthly', limit: 6_000_00, currency: 'LKR', alertThresholdPct: 80 })
  const goal = newId()
  await put('goals', { id: goal, name: 'Emergency fund', target: 150_000_00, currency: 'LKR', targetDate: addMonths(today, 10), accountId: bank, reserveInSafeToSpend: true, priority: 'high', monthlyContribution: 0 })
  await put('goals', { id: newId(), name: 'New laptop', target: 120_000_00, currency: 'LKR', targetDate: addMonths(today, 8), accountId: bank, reserveInSafeToSpend: true, priority: 'medium', monthlyContribution: 0 })
  await put('goals', { id: newId(), name: 'Weekend trip', target: 40_000_00, currency: 'LKR', targetDate: null, accountId: bank, reserveInSafeToSpend: true, priority: 'low', monthlyContribution: 0 })
  await put('allocations', { id: newId(), goalId: goal, accountId: bank, amount: 10_000_00, currency: 'LKR', date: addDays(today, -10), note: 'First deposit' })

  await savePrefs(db, {
    paydayDate: addDays(today, 12),
    expectedSalary: 60_000_00,
    essentialDailyAmount: 1_000_00,
    safetyBuffer: 2_000_00,
  }, o)
  void monthKey
}
