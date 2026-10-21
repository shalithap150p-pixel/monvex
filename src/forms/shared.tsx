import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useApp } from '../app/AppContext'
import { newId } from '../data/repo'
import { tryParseAmount, type Minor } from '../domain/money'
import type { Account } from '../domain/types'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { InlineNote } from '../ui/Primitives'

export const activeAccounts = (accounts: Account[]) => accounts.filter((a) => !a.archived)

export function currencyOf(accounts: Account[], accountId: string, fallback: string): string {
  return accounts.find((a) => a.id === accountId)?.currency ?? fallback
}

/** Amount text field value → minor units (null when empty/invalid). */
export function parseField(value: string, currency: string): Minor | null {
  if (!value.trim()) return null
  return tryParseAmount(value, currency)
}

/**
 * Guards a submit handler against double clicks and failures:
 * the form id is created once per open (so a repeated submit upserts the same record)
 * and the button is disabled while saving.
 */
export function useFormSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [id] = useState<string>(() => newId())
  const toast = useToast()
  const lock = useRef(false)

  const run = useCallback(
    async (task: () => Promise<void>, successMessage: string, onDone: () => void) => {
      if (lock.current) return
      lock.current = true
      setBusy(true)
      setError(null)
      try {
        await task()
        toast(successMessage, 'success')
        onDone()
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        setError(`Could not save: ${message}`)
        toast('Could not save your changes. Nothing was lost — please try again.', 'error')
      } finally {
        lock.current = false
        setBusy(false)
      }
    },
    [toast],
  )
  return { busy, error, run, id, newId }
}

export function FormModal({
  title,
  description,
  onClose,
  onSubmit,
  busy,
  error,
  submitLabel = 'Save',
  children,
  size,
}: {
  title: string
  description?: string
  onClose: () => void
  onSubmit: () => void
  busy: boolean
  error: string | null
  submitLabel?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="monvex-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      <form id="monvex-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {children}
        {error && <InlineNote tone="negative">{error}</InlineNote>}
      </form>
    </Modal>
  )
}

export function NeedAccountNote() {
  const { data } = useApp()
  if (activeAccounts(data.ledger.accounts).length > 0) return null
  return <InlineNote tone="warning">Create an account first (Accounts page) so this record has somewhere to live.</InlineNote>
}
