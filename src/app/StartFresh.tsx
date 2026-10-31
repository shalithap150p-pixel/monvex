import { Eraser } from 'lucide-react'
import { useState } from 'react'
import { startFresh, ERASE_PHRASE } from '../data/startFresh'
import { supabase } from '../data/supabase'
import { Modal } from '../ui/Modal'
import { InlineNote, TextField } from '../ui/Primitives'
import { useToast } from '../ui/Toast'
import { useApp } from './AppContext'

const ERASED = [
  'Accounts, transactions, transfers, bills and payment history',
  'Debts, loans, salary advances and payroll deductions',
  'Budgets, savings goals and Bank Details',
  'Vault files (receipts and documents)',
  'Balance checks, forecasts and the history log',
  'Your salary, payday and Safe-to-Spend settings (reset to their starting values)',
]

/**
 * One-time "start fresh". Erases everything the signed-in user entered (server + this device) after a typed confirmation.
 * The sign-in, currency and theme are kept. Cloud mode only — demo data has its own "Reset demo data".
 */
export function StartFresh({ onExport }: { onExport: () => Promise<void> }) {
  const { db, scope, mode, userId } = useApp()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (mode !== 'cloud' || !supabase || !userId) return null
  const client = supabase

  const close = () => {
    if (busy) return
    setOpen(false)
    setPhrase('')
    setError('')
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await startFresh({ client, db, scope, userId, phrase })
      toast('Everything was erased. Starting fresh…', 'success')
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing else was changed.')
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary text-negative" onClick={() => setOpen(true)}>
        <Eraser className="size-4" aria-hidden /> Start fresh (erase everything)
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Erase everything and start fresh?"
        description="This cannot be undone."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void run()} disabled={busy || phrase !== ERASE_PHRASE}>
              {busy ? 'Erasing…' : 'Erase everything'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium text-text">This permanently erases, on the server and on this device:</p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {ERASED.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <p className="text-muted">
            Kept: your sign-in, your currency and your theme. Other devices keep their old copy until you use <strong className="text-text">Clear data on this device</strong> on each of them.
          </p>
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onExport()} disabled={busy}>
              Download a backup first (optional)
            </button>
          </div>
          <TextField
            label={`Type ${ERASE_PHRASE} to confirm`}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
          />
          {error && <InlineNote tone="negative">{error}</InlineNote>}
        </div>
      </Modal>
    </>
  )
}
