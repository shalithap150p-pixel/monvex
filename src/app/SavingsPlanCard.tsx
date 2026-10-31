import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { parseField } from '../forms/shared'
import type { GoalRec } from '../data/records'
import { formatMoney, toDecimalString } from '../domain/money'
import type { PlanLine } from '../domain/savingsPlan'
import { Meter } from '../ui/Meter'
import { AmountField, InlineNote, StatusBadge, type Tone } from '../ui/Primitives'
import { useToast } from '../ui/Toast'
import { useApp } from './AppContext'
import { useDerived } from './derived'

const PRIORITY_TONE: Record<PlanLine['priority'], Tone> = { high: 'negative', medium: 'warning', low: 'neutral' }

/**
 * Smart monthly savings suggestion. It explains itself, can be edited, and does nothing until the user approves it.
 * Approving only reserves the amount in Safe-to-Spend — MONVEX never moves or withdraws money.
 */
export function SavingsPlanCard() {
  const { db, currency, save } = useApp()
  const { smart } = useDerived()
  const toast = useToast()
  const plan = smart.plan
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const money = (m: number) => formatMoney(m, currency)

  const shown = (l: PlanLine) => edits[l.goalId] ?? toDecimalString(l.recommended, currency)

  const validate = (l: PlanLine): number | null => {
    const v = parseField(shown(l), currency)
    if (v === null || v < 0) {
      setErrors((e) => ({ ...e, [l.goalId]: 'Enter a valid amount (0 or more).' }))
      return null
    }
    if (v > l.remaining) {
      setErrors((e) => ({ ...e, [l.goalId]: `This goal only needs ${money(l.remaining)} more.` }))
      return null
    }
    setErrors((e) => ({ ...e, [l.goalId]: '' }))
    return v
  }

  const apply = async (l: PlanLine, amount: number) => {
    const rec = (await db.goals.get(l.goalId)) as GoalRec | undefined
    if (!rec) throw new Error('Goal not found')
    await save('goals', { ...rec, monthlyContribution: amount, reserveInSafeToSpend: amount > 0 ? true : rec.reserveInSafeToSpend })
  }

  const approveOne = async (l: PlanLine) => {
    const v = validate(l)
    if (v === null) return
    setBusy(true)
    try {
      await apply(l, v)
      setEdits((e) => {
        const { [l.goalId]: _drop, ...rest } = e
        return rest
      })
      toast(v > 0 ? `${money(v)} per month approved for ${l.name}. Nothing was moved — it is only set aside in Safe-to-Spend.` : `Monthly saving for ${l.name} stopped.`, 'success')
    } catch {
      toast('Could not save. Nothing was changed — please try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const approveAll = async () => {
    const todo = plan.lines.map((l) => ({ l, v: validate(l) }))
    if (todo.some((t) => t.v === null)) return
    setBusy(true)
    try {
      for (const { l, v } of todo) if (v !== null && v !== l.approvedMonthly) await apply(l, v)
      setEdits({})
      toast('Monthly savings approved. Nothing was moved — it is only set aside in Safe-to-Spend.', 'success')
    } catch {
      toast('Could not save everything. Please check your goals and try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const enteredTotal = plan.lines.reduce((s, l) => s + (parseField(shown(l), currency) ?? 0), 0)
  const anyDifferent = plan.lines.some((l) => (parseField(shown(l), currency) ?? 0) !== l.approvedMonthly)

  return (
    <section className="card" aria-labelledby="sp-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="sp-title" className="t-section flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden /> Smart savings plan
          </h2>
          <p className="t-helper mt-0.5 max-w-2xl">
            A suggested monthly saving for each goal, based on your free money, past months, goal priority and target dates. Edit any amount, then approve. It is recalculated whenever your situation changes.
          </p>
        </div>
        {plan.lines.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !anyDifferent} onClick={() => void approveAll()}>
            Approve {money(enteredTotal)} / month
          </button>
        )}
      </div>

      {plan.lines.length === 0 ? (
        <p className="t-helper py-4">
          {plan.completed.length > 0 ? 'All your goals are complete.' : 'Create a savings goal to get a monthly suggestion.'}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            Realistic monthly savings capacity: <strong className="amount">{money(plan.capacity)}</strong> · suggested in total:{' '}
            <strong className="amount">{money(plan.totalRecommended)}</strong>
            {plan.totalApproved > 0 && <> · approved now: <strong className="amount">{money(plan.totalApproved)}</strong></>}
          </p>
          {plan.warnings.map((w) => (
            <div key={w} className="mt-3">
              <InlineNote tone="warning">{w}</InlineNote>
            </div>
          ))}

          <ul className="m-0 mt-4 flex list-none flex-col gap-5 p-0">
            {plan.lines.map((l) => {
              const entered = parseField(shown(l), currency)
              const changed = l.approvedMonthly > 0 && l.approvedMonthly !== l.recommended
              return (
                <li key={l.goalId} className="rounded-[12px] border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <StatusBadge tone={PRIORITY_TONE[l.priority]} label={`${l.priority[0].toUpperCase()}${l.priority.slice(1)} priority`} />
                    </span>
                    {l.approvedMonthly > 0 ? <StatusBadge tone="positive" label={`Approved ${money(l.approvedMonthly)}/month`} /> : <StatusBadge tone="neutral" label="Not approved" />}
                  </div>
                  <div className="mt-2">
                    <Meter pct={l.target > 0 ? (l.allocated / l.target) * 100 : 0} label={`${l.name} progress`} />
                    <p className="t-helper mt-1">
                      {money(l.allocated)} of {money(l.target)} saved · {money(l.remaining)} to go
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-muted">{l.reason}</p>
                  {changed && (
                    <p className="t-helper mt-1">
                      Your situation changed: the suggestion is now {money(l.recommended)} (you approved {money(l.approvedMonthly)}).
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <AmountField
                        label={`Monthly amount for ${l.name}`}
                        value={shown(l)}
                        onChange={(v) => setEdits((e) => ({ ...e, [l.goalId]: v }))}
                        currency={currency}
                        error={errors[l.goalId] || undefined}
                      />
                    </div>
                    <button type="button" className="btn btn-primary btn-sm mb-1" disabled={busy || entered === null || entered === l.approvedMonthly} onClick={() => void approveOne(l)}>
                      {l.approvedMonthly > 0 ? 'Update' : 'Approve'}
                    </button>
                    {l.approvedMonthly > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm mb-1"
                        disabled={busy}
                        onClick={() => {
                          setEdits((e) => ({ ...e, [l.goalId]: '0' }))
                          void (async () => {
                            setBusy(true)
                            try {
                              await apply(l, 0)
                              setEdits((e) => {
                                const { [l.goalId]: _drop, ...rest } = e
                                return rest
                              })
                              toast(`Monthly saving for ${l.name} stopped.`, 'success')
                            } catch {
                              toast('Could not save. Nothing was changed.', 'error')
                            } finally {
                              setBusy(false)
                            }
                          })()
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-medium">Why this suggestion?</summary>
            <ul className="mt-2 list-disc pl-5 text-muted">
              {plan.explanation.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="t-helper mt-3">Approving only sets the amount aside in Safe-to-Spend. MONVEX never moves, withdraws or transfers money for you.</p>
    </section>
  )
}
