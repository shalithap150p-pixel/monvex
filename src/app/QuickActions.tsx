import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Banknote, CalendarPlus, HandCoins, Undo2, type LucideIcon } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LoanForm } from '../forms/LendingForms'
import { DebtRepaymentForm } from '../forms/LendingForms'
import { AdvanceForm, BillForm } from '../forms/PlanningForms'
import { TransactionForm } from '../forms/TransactionForm'
import { TransferForm } from '../forms/TransferForms'
import { debtOutstanding } from '../domain/ledger'
import { Modal } from '../ui/Modal'
import { InlineNote } from '../ui/Primitives'
import { useApp } from './AppContext'
import type { DebtRec } from '../data/records'

export type QuickKind = 'menu' | 'income' | 'expense' | 'transfer' | 'lent' | 'debt_repayment' | 'advance' | 'bill'

const Ctx = createContext<{ open: (k: QuickKind) => void } | null>(null)

export const QUICK: { kind: Exclude<QuickKind, 'menu'>; label: string; icon: LucideIcon }[] = [
  { kind: 'income', label: 'Add income', icon: ArrowDownToLine },
  { kind: 'expense', label: 'Add expense', icon: ArrowUpFromLine },
  { kind: 'transfer', label: 'Transfer money', icon: ArrowLeftRight },
  { kind: 'lent', label: 'Record money lent', icon: HandCoins },
  { kind: 'debt_repayment', label: 'Record debt repayment', icon: Undo2 },
  { kind: 'advance', label: 'Record salary advance', icon: Banknote },
  { kind: 'bill', label: 'Add bill', icon: CalendarPlus },
]

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<QuickKind | null>(null)
  const [debt, setDebt] = useState<DebtRec | null>(null)
  const { data } = useApp()
  const open = useCallback((k: QuickKind) => setKind(k), [])
  const close = useCallback(() => {
    setKind(null)
    setDebt(null)
  }, [])
  const value = useMemo(() => ({ open }), [open])

  const openDebts = data.ledger.debts.filter((d) => debtOutstanding(d) > 0)

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal open={kind === 'menu'} onClose={close} title="Quick add" size="sm">
        <ul className="m-0 grid list-none gap-1 p-0">
          {QUICK.map((q) => (
            <li key={q.kind}>
              <button type="button" className="nav-link w-full bg-transparent text-left" onClick={() => setKind(q.kind)}>
                <q.icon className="size-5" aria-hidden /> {q.label}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
      <TransactionForm open={kind === 'income'} onClose={close} defaultType="income" />
      <TransactionForm open={kind === 'expense'} onClose={close} defaultType="expense" />
      <TransferForm open={kind === 'transfer'} onClose={close} />
      <LoanForm open={kind === 'lent'} onClose={close} />
      <AdvanceForm open={kind === 'advance'} onClose={close} />
      <BillForm open={kind === 'bill'} onClose={close} />

      <Modal open={kind === 'debt_repayment' && !debt} onClose={close} title="Which debt did you repay?" size="sm">
        {openDebts.length === 0 ? (
          <div className="flex flex-col gap-3">
            <InlineNote>You have no outstanding debts recorded.</InlineNote>
            <Link to="/debts" className="btn btn-secondary" onClick={close}>
              Go to Loans & Debts
            </Link>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {openDebts.map((d) => (
              <li key={d.id}>
                <button type="button" className="nav-link w-full bg-transparent text-left" onClick={() => setDebt(d)}>
                  {d.creditor}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <DebtRepaymentForm open={kind === 'debt_repayment' && Boolean(debt)} onClose={close} debt={debt} />
    </Ctx.Provider>
  )
}

export function useQuickActions() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useQuickActions must be used inside QuickActionsProvider')
  return v
}
