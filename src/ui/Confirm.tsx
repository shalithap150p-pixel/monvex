import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './Modal'
import { useToast } from './Toast'

interface Pending {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  success: string
  run: () => Promise<void>
}

/** One confirm dialog per page: `ask({...})` opens it, the dialog runs the task and reports the result. */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const ask = useCallback((p: Pending) => setPending(p), [])
  const dialog = (
    <ConfirmDialog
      open={Boolean(pending)}
      title={pending?.title ?? ''}
      message={pending?.message}
      confirmLabel={pending?.confirmLabel}
      danger={pending?.danger}
      busy={busy}
      onCancel={() => !busy && setPending(null)}
      onConfirm={async () => {
        if (!pending || busy) return
        setBusy(true)
        try {
          await pending.run()
          toast(pending.success, 'success')
          setPending(null)
        } catch (e) {
          toast(`That did not work: ${e instanceof Error ? e.message : 'unknown error'}`, 'error')
        } finally {
          setBusy(false)
        }
      }}
    />
  )
  return { ask, dialog }
}

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon" onClick={onClick} aria-label={label} title={label}>
      <Pencil className="size-4" aria-hidden />
    </button>
  )
}

export function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon text-negative" onClick={onClick} aria-label={label} title={label}>
      <Trash2 className="size-4" aria-hidden />
    </button>
  )
}
