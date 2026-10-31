import { Download, LogOut, Moon, RefreshCw, RotateCcw, Sun, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../app/AppContext'
import { useAuth } from '../app/auth'
import { StartFresh } from '../app/StartFresh'
import { ALL_ENTITIES } from '../data/assemble'
import { deleteDb, tableOf } from '../data/db'
import { supabaseConfigured } from '../data/supabase'
import { discardOp, resolveConflict, retryFailed, statusOf, useSyncState } from '../data/syncEngine'
import { newId } from '../data/repo'
import { isValidDate } from '../domain/dates'
import { toDecimalString } from '../domain/money'
import type { Frequency, TransactionType } from '../domain/types'
import { liveQuery } from 'dexie'
import { useConfirm } from '../ui/Confirm'
import { AmountField, CheckboxField, InlineNote, PageHeader, SelectField, StatusBadge, TextField } from '../ui/Primitives'
import { CompanyCredit, CompanyWordmark } from '../ui/Company'
import { useToast } from '../ui/Toast'
import { parseField } from '../forms/shared'
import type { QueuedOp } from '../data/db'

const SECTION = 'card scroll-mt-20'

export default function Settings() {
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <>
      <PageHeader title="Settings" description="Appearance, your salary and Safe-to-Spend preferences, categories, sync and data." />
      <div className="flex flex-col gap-4">
        <Appearance />
        <Preferences />
        <Categories />
        <SyncSection />
        <DataSection />
        <AccountSection />
        <AboutSection />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ appearance */

function Appearance() {
  const { data, setPrefs } = useApp()
  const theme = data.prefs.theme
  const opts = [
    { v: 'navy' as const, label: 'Navy & Blue', hint: 'Deep navy with electric blue accents', Icon: Moon },
    { v: 'noir' as const, label: 'Noir & Orange', hint: 'Near-black with warm orange accents', Icon: Sun },
  ]
  return (
    <section className={SECTION} id="appearance" aria-labelledby="ap-title">
      <h2 id="ap-title" className="t-section mb-3">Appearance</h2>
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2">
        {opts.map(({ v, label, hint, Icon }) => (
          <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => void setPrefs({ theme: v })} className={`flex items-center gap-3 rounded-[12px] border p-4 text-left ${theme === v ? 'border-accent bg-surface-2' : 'border-border'}`}>
            <span className="grid size-10 place-items-center rounded-full bg-surface-2"><Icon className="size-5" aria-hidden /></span>
            <span><span className="block font-semibold">{label}</span><span className="t-helper">{hint}</span></span>
            {theme === v && <span className="ml-auto"><StatusBadge tone="positive" label="Selected" /></span>}
          </button>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ preferences */

function Preferences() {
  const { data, setPrefs } = useApp()
  const p = data.prefs
  const toast = useToast()
  const accounts = data.ledger.accounts.filter((a) => !a.archived)
  const cur = p.currency

  const [currency, setCurrency] = useState(p.currency)
  const [payday, setPayday] = useState(p.paydayDate ?? '')
  const [salary, setSalary] = useState(p.expectedSalary != null ? toDecimalString(p.expectedSalary, cur) : '')
  const [freq, setFreq] = useState<Frequency>(p.salaryFrequency)
  const [salaryAcct, setSalaryAcct] = useState(p.salaryAccountId ?? '')
  const [daily, setDaily] = useState(toDecimalString(p.essentialDailyAmount, cur))
  const [buffer, setBuffer] = useState(toDecimalString(p.safetyBuffer, cur))
  const [days, setDays] = useState(String(p.safeToSpendPeriodDays))
  const [carry, setCarry] = useState(p.carryForwardAllowance)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const errs: Record<string, string> = {}
    if (!/^[A-Za-z]{3}$/.test(currency)) errs.currency = 'Use a 3-letter currency code, e.g. LKR.'
    if (payday && !isValidDate(payday)) errs.payday = 'Enter a valid date.'
    const sal = parseField(salary, currency)
    if (salary.trim() && (sal === null || sal < 0)) errs.salary = 'Enter a valid amount.'
    const dly = parseField(daily, currency) ?? 0
    const buf = parseField(buffer, currency) ?? 0
    if (daily.trim() && parseField(daily, currency) === null) errs.daily = 'Enter a valid amount.'
    if (buffer.trim() && parseField(buffer, currency) === null) errs.buffer = 'Enter a valid amount.'
    const n = Number(days)
    if (!Number.isInteger(n) || n < 1 || n > 366) errs.days = 'Enter a whole number of days between 1 and 366.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await setPrefs({
        currency: currency.toUpperCase(),
        paydayDate: payday || null,
        expectedSalary: salary.trim() ? sal : null,
        salaryFrequency: freq,
        salaryAccountId: salaryAcct || null,
        essentialDailyAmount: dly,
        safetyBuffer: buf,
        safeToSpendPeriodDays: n,
        carryForwardAllowance: carry,
      })
      toast('Preferences saved.', 'success')
    } catch {
      toast('Could not save preferences. Please try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={SECTION} id="salary" aria-labelledby="pf-title">
      <h2 id="pf-title" className="t-section mb-1">Salary & Safe-to-Spend</h2>
      <p className="t-helper mb-4">Used for the payday plan, forecasts and your daily allowance. Expected salary is only a forecast — it never counts as income until you record it.</p>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <TextField label="Default currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} error={errors.currency} helper="Used for new accounts. Existing accounts keep their own currency." />
        <TextField label="Next / anchor payday" type="date" value={payday} onChange={(e) => setPayday(e.target.value)} error={errors.payday} helper="MONVEX rolls this forward automatically." />
        <AmountField label="Expected salary (per payday)" value={salary} onChange={setSalary} currency={currency} error={errors.salary} />
        <SelectField label="Salary frequency" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
          <option value="once">One time</option>
        </SelectField>
        <SelectField label="Salary is paid into" value={salaryAcct} onChange={(e) => setSalaryAcct(e.target.value)}>
          <option value="">First active account</option>
          {accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
        </SelectField>
        <AmountField label="Essential spending per day" value={daily} onChange={setDaily} currency={currency} error={errors.daily} helper="Food and transport you’ll need each day; reserved in Safe-to-Spend." />
        <AmountField label="Safety buffer" value={buffer} onChange={setBuffer} currency={currency} error={errors.buffer} helper="Money you never want to touch." />
        <TextField label="Safe-to-Spend period (days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} error={errors.days} helper="Used when no payday is set." />
        <div className="md:col-span-2"><CheckboxField label="Carry forward unused daily allowance" helper="Money you didn’t spend yesterday adds to today’s allowance." checked={carry} onChange={(e) => setCarry(e.target.checked)} /></div>
        <div className="md:col-span-2"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button></div>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ categories */

function Categories() {
  const { data, db, save, remove } = useApp()
  const { ask, dialog } = useConfirm()
  const toast = useToast()
  const [name, setName] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Enter a category name.')
    if (data.categories.some((c) => c.type === type && c.name.toLowerCase() === n.toLowerCase())) return setError('That category already exists.')
    setError('')
    await save('categories', { id: newId(), name: n, type })
    setName('')
    toast('Category added.', 'success')
  }
  const rename = async () => {
    if (!editing) return
    const n = editing.name.trim()
    const c = data.categories.find((x) => x.id === editing.id)
    if (!n || !c) return setEditing(null)
    const rec = await db.categories.get(c.id)
    if (rec) await save('categories', { ...rec, name: n })
    setEditing(null)
    toast('Category renamed.', 'success')
  }
  const del = (id: string, label: string) => {
    const used = data.ledger.transactions.some((t) => t.categoryId === id) || data.budgets.some((b) => b.categoryId === id)
    if (used) return toast(`“${label}” is used by transactions or budgets, so it can’t be deleted. Rename it instead.`, 'error')
    ask({ title: `Delete “${label}”?`, message: 'It isn’t used by any transaction or budget.', success: 'Category deleted.', run: () => remove('categories', id) })
  }

  return (
    <section className={SECTION} id="categories" aria-labelledby="cat-title">
      <h2 id="cat-title" className="t-section mb-3">Categories</h2>
      <form onSubmit={add} className="mb-4 grid items-start gap-3 sm:grid-cols-[1fr_auto_auto]" noValidate>
        <TextField label="New category" value={name} onChange={(e) => setName(e.target.value)} error={error} />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </SelectField>
        <button type="submit" className="btn btn-primary sm:mt-[1.65rem]">Add</button>
      </form>
      <div className="grid gap-6 md:grid-cols-2">
        {(['expense', 'income'] as const).map((tp) => (
          <div key={tp}>
            <h3 className="t-label mb-1 capitalize">{tp} categories</h3>
            <ul className="m-0 list-none divide-y divide-border/60 p-0 text-sm">
              {data.categories.filter((c) => c.type === tp).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  {editing?.id === c.id ? (
                    <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void rename() }}>
                      <input aria-label={`Rename ${c.name}`} className="input !min-h-9 flex-1" value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} autoFocus />
                      <button type="submit" className="btn btn-primary btn-sm">Save</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span>{c.name}</span>
                      <span className="flex gap-1">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`}>Rename</button>
                        <button type="button" className="btn btn-ghost btn-sm text-negative" onClick={() => del(c.id, c.name)} aria-label={`Delete ${c.name}`}>Delete</button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {dialog}
    </section>
  )
}

/* ------------------------------------------------------------------ sync */

const LABEL: Record<string, string> = { synced: 'Everything is synced', pending: 'Changes waiting to sync', syncing: 'Syncing…', failed: 'Some changes need attention', offline: 'Offline — changes are saved on this device', not_configured: 'Local only' }

function SyncSection() {
  const { mode, db, syncEnabled, sync } = useApp()
  const s = useSyncState()
  const [ops, setOps] = useState<QueuedOp[]>([])

  useEffect(() => {
    const sub = liveQuery(() => db.queue.toArray()).subscribe({ next: setOps })
    return () => sub.unsubscribe()
  }, [db])

  const problems = ops.filter((o) => o.state !== 'pending')

  if (mode === 'demo') {
    return (
      <section className={SECTION} id="sync" aria-labelledby="sy-title">
        <h2 id="sy-title" className="t-section mb-2">Sync</h2>
        <InlineNote tone="warning">You are using demo data. It is stored only on this device and is never uploaded.</InlineNote>
      </section>
    )
  }
  const status = statusOf(s, syncEnabled, true)
  return (
    <section className={SECTION} id="sync" aria-labelledby="sy-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sy-title" className="t-section">Sync</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sync()} disabled={s.syncing}><RefreshCw className={`size-4 ${s.syncing ? 'animate-spin' : ''}`} aria-hidden /> Sync now</button>
      </div>
      <p className="mt-2 text-sm" role="status">{LABEL[status]}</p>
      <p className="t-helper">
        {s.lastSyncedAt ? `Last confirmed by the server: ${new Date(s.lastSyncedAt).toLocaleString()}.` : 'Not confirmed by the server yet.'} {s.pendingCount > 0 ? `${s.pendingCount} change${s.pendingCount === 1 ? '' : 's'} waiting.` : ''}
      </p>
      {s.lastError && <div className="mt-3"><InlineNote tone="negative">Last error: {s.lastError}</InlineNote></div>}
      {problems.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="t-label">Needs attention</h3>{problems.some((o) => o.state === 'failed') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryFailed(db)}>Retry failed</button>}</div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {problems.map((o) => (
              <li key={o.opId} className="rounded-[10px] border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{o.state === 'conflict' ? <StatusBadge tone="warning" label="Conflict" /> : <StatusBadge tone="negative" label="Failed" />} <span className="ml-1 font-medium">{o.entity} · {o.type}</span></span>
                  <span className="flex gap-1">
                    {o.state === 'conflict' ? (
                      <>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void resolveConflict(db, o.opId, 'mine')}>Keep my version</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void resolveConflict(db, o.opId, 'server')}>Use server version</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void discardOp(db, o.opId)}>Discard change</button>
                    )}
                  </span>
                </div>
                <p className="t-helper mt-1">{o.state === 'conflict' ? 'This record was changed on another device after you edited it. Choose which version to keep.' : o.lastError ?? 'The server rejected this change.'}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ data */

function DataSection() {
  const { db, scope, mode, resetDemo } = useApp()
  const { ask, dialog } = useConfirm()
  const s = useSyncState()

  const exportJson = async () => {
    const out: Record<string, unknown> = {
      app: 'MONVEX',
      exportedAt: new Date().toISOString(),
      note: 'Money amounts are stored as integers in the smallest currency unit (e.g. cents).',
    }
    for (const e of ALL_ENTITIES) out[e] = await tableOf(db, e).toArray()
    out.preferences = await db.prefs.toArray()
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monvex-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearLocal = () =>
    ask({
      title: 'Clear data on this device?',
      message: s.pendingCount + s.failedCount + s.conflictCount > 0 ? <strong>{s.pendingCount + s.failedCount + s.conflictCount} change(s) have not reached the server yet and will be lost. Sync first, or export a backup.</strong> : 'Your synced records stay safe in the cloud and are downloaded again when you reopen the app.',
      confirmLabel: 'Clear local data',
      success: 'Local data cleared.',
      run: async () => {
        db.close()
        await deleteDb(scope)
        window.location.reload()
      },
    })

  return (
    <section className={SECTION} id="data" aria-labelledby="da-title">
      <h2 id="da-title" className="t-section mb-1">Your data</h2>
      <p className="t-helper mb-4">Export a full backup any time. MONVEX never stores bank passwords, PINs or OTPs.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void exportJson()}><Download className="size-4" aria-hidden /> Export backup (JSON)</button>
        {mode === 'demo' ? (
          <button type="button" className="btn btn-secondary" onClick={() => ask({ title: 'Reset demo data?', message: 'All demo changes are removed and the sample data is restored.', confirmLabel: 'Reset demo', danger: false, success: 'Demo reset.', run: resetDemo })}><RotateCcw className="size-4" aria-hidden /> Reset demo data</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary text-negative" onClick={clearLocal}><Trash2 className="size-4" aria-hidden /> Clear data on this device</button>
            <StartFresh onExport={exportJson} />
          </>
        )}
      </div>
      {dialog}
    </section>
  )
}

/* ------------------------------------------------------------------ account */

function AccountSection() {
  const { user, demo, signOut, leaveDemo } = useAuth()
  return (
    <section className={SECTION} id="account" aria-labelledby="ac-title">
      <h2 id="ac-title" className="t-section mb-2">Account</h2>
      {demo ? (
        <>
          <p className="mb-3 text-sm text-muted">You are exploring with demo data.</p>
          <button type="button" className="btn btn-primary" onClick={leaveDemo}>{supabaseConfigured ? 'Leave demo and sign in' : 'Leave demo'}</button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">Signed in as <strong className="text-text">{user?.email}</strong></p>
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}><LogOut className="size-4" aria-hidden /> Sign out</button>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ about */

function AboutSection() {
  return (
    <section className={SECTION} id="about" aria-labelledby="ab-title">
      <h2 id="ab-title" className="t-section mb-3">About</h2>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">MONVEX — Master Your Money</p>
          <p className="t-helper">Plan · Track · Grow. Your records stay private to you; MONVEX never pays anything on your behalf and never asks for bank passwords, PINs or OTPs.</p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <CompanyWordmark height={36} />
          <CompanyCredit />
        </div>
      </div>
    </section>
  )
}
