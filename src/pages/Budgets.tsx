import { PiggyBank, Plus, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '../app/AppContext'
import { useLookups } from '../app/FinanceCards'
import { AllocationForm, BudgetForm, GoalForm } from '../forms/PlanningForms'
import type { BudgetRec, GoalRec } from '../data/records'
import { monthKey } from '../domain/dates'
import { formatMoney, sum } from '../domain/money'
import type { Budget, SavingsGoal } from '../domain/types'
import { DeleteButton, EditButton, useConfirm } from '../ui/Confirm'
import { CurrencyAmount, PageHeader, StatusBadge } from '../ui/Primitives'
import { EmptyState } from '../ui/States'

function Progress({ pct, label, tone }: { pct: number; label: string; tone: 'ok' | 'warn' | 'over' }) {
  const color = tone === 'over' ? 'var(--negative)' : tone === 'warn' ? 'var(--warning)' : 'var(--accent)'
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(pct))}
      className="h-2.5 overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`, background: color }} />
    </div>
  )
}

export default function Budgets() {
  const { data, db, today, currency, remove } = useApp()
  const { categoryName } = useLookups()
  const { ask, dialog } = useConfirm()
  const [bForm, setBForm] = useState<{ open: boolean; initial?: BudgetRec }>({ open: false })
  const [gForm, setGForm] = useState<{ open: boolean; initial?: GoalRec }>({ open: false })
  const [alloc, setAlloc] = useState<GoalRec | null>(null)

  const month = monthKey(today)
  const spentBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of data.ledger.transactions) {
      if (t.type !== 'expense' || t.status !== 'posted' || monthKey(t.date) !== month || !t.categoryId) continue
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    }
    return m
  }, [data.ledger.transactions, month])

  const budgetRec = async (b: Budget) => (await db.budgets.get(b.id)) as BudgetRec
  const goalRec = async (g: SavingsGoal) => (await db.goals.get(g.id)) as GoalRec

  const totalLimit = sum(data.budgets.map((b) => b.limit))
  const totalSpent = sum(data.budgets.map((b) => spentBy.get(b.categoryId) ?? 0))

  return (
    <>
      <PageHeader
        title="Budgets & Goals"
        description={`Monthly spending limits by category and savings goals. Budgets cover ${month}.`}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setGForm({ open: true })}>
              <Plus className="size-4" aria-hidden /> New goal
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setBForm({ open: true })}>
              <Plus className="size-4" aria-hidden /> New budget
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card" aria-labelledby="bud-title">
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 id="bud-title" className="t-section">Monthly budgets</h2>
            {data.budgets.length > 0 && <span className="t-helper">{formatMoney(totalSpent, currency)} of {formatMoney(totalLimit, currency)}</span>}
          </div>
          {data.budgets.length === 0 ? (
            <EmptyState icon={<PiggyBank className="size-6" />} title="No budgets yet" description="Set a monthly limit for a category such as Food or Transport to see how you are tracking." action={<button type="button" className="btn btn-primary" onClick={() => setBForm({ open: true })}>Create a budget</button>} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              {data.budgets.map((b) => {
                const spent = spentBy.get(b.categoryId) ?? 0
                const pct = b.limit > 0 ? (spent / b.limit) * 100 : 0
                const over = spent > b.limit
                const warn = pct >= b.alertThresholdPct
                const name = categoryName(b.categoryId)
                return (
                  <li key={b.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium">{name}</span>
                      <span className="flex items-center gap-2">
                        {over ? <StatusBadge tone="negative" label={`Over by ${formatMoney(spent - b.limit, currency)}`} /> : warn ? <StatusBadge tone="warning" label="Close to limit" /> : <StatusBadge tone="positive" label="On track" />}
                        <EditButton label={`Edit ${name} budget`} onClick={async () => setBForm({ open: true, initial: await budgetRec(b) })} />
                        <DeleteButton label={`Delete ${name} budget`} onClick={() => ask({ title: `Delete ${name} budget?`, message: 'Your transactions are not affected.', success: 'Budget deleted.', run: () => remove('budgets', b.id) })} />
                      </span>
                    </div>
                    <Progress pct={pct} tone={over ? 'over' : warn ? 'warn' : 'ok'} label={`${name} budget used`} />
                    <p className="t-helper mt-1">
                      {formatMoney(spent, currency)} spent of {formatMoney(b.limit, currency)} ({Math.round(pct)}%) · {over ? 'no budget left' : `${formatMoney(b.limit - spent, currency)} left`}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="goal-title">
          <h2 id="goal-title" className="t-section mb-3">Savings goals</h2>
          {data.goals.length === 0 ? (
            <EmptyState icon={<Target className="size-6" />} title="No savings goals" description="Set aside money for something specific. Goals marked as reserved reduce your Safe-to-Spend." action={<button type="button" className="btn btn-primary" onClick={() => setGForm({ open: true })}>Create a goal</button>} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              {data.goals.map((g) => {
                const pct = g.target > 0 ? (g.allocated / g.target) * 100 : 0
                return (
                  <li key={g.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium">{g.name}</span>
                      <span className="flex items-center gap-1">
                        {g.reserveInSafeToSpend && <StatusBadge tone="info" label="Reserved" />}
                        <EditButton label={`Edit ${g.name}`} onClick={async () => setGForm({ open: true, initial: await goalRec(g) })} />
                        <DeleteButton label={`Delete ${g.name}`} onClick={() => ask({ title: `Delete “${g.name}”?`, message: 'The goal and its allocations are removed. Your account balances are not affected.', success: 'Goal deleted.', run: async () => {
                          for (const a of await db.allocations.where('goalId').equals(g.id).toArray()) if (!a.deletedAt) await remove('allocations', a.id)
                          await remove('goals', g.id)
                        } })} />
                      </span>
                    </div>
                    <Progress pct={pct} tone="ok" label={`${g.name} progress`} />
                    <p className="t-helper mt-1">
                      <CurrencyAmount value={g.allocated} currency={g.currency ?? currency} tone="neutral" /> of <CurrencyAmount value={g.target} currency={g.currency ?? currency} tone="neutral" /> ({Math.round(pct)}%)
                      {g.targetDate ? ` · target ${g.targetDate}` : ''}
                    </p>
                    <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={async () => setAlloc(await goalRec(g))}>Add savings</button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <BudgetForm open={bForm.open} onClose={() => setBForm({ open: false })} initial={bForm.initial} />
      <GoalForm open={gForm.open} onClose={() => setGForm({ open: false })} initial={gForm.initial} />
      <AllocationForm open={Boolean(alloc)} onClose={() => setAlloc(null)} goal={alloc} />
      {dialog}
    </>
  )
}
