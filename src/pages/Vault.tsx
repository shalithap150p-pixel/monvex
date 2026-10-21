import { ExternalLink, FileText, FolderLock, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../app/AppContext'
import { newId } from '../data/repo'
import { supabase } from '../data/supabase'
import { EVIDENCE_MAX_BYTES, validateEvidenceFile } from '../domain/validation'
import { isValidDate } from '../domain/dates'
import { useConfirm } from '../ui/Confirm'
import { Modal } from '../ui/Modal'
import { FilterSelect, SearchAndFilterBar } from '../ui/Inputs'
import { InlineNote, PageHeader, SelectField, TextField } from '../ui/Primitives'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { useToast } from '../ui/Toast'

interface Row {
  id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  reference_code: string | null
  description: string | null
  keywords: string[]
  document_date: string | null
  transaction_id: string | null
  internal_transfer_id: string | null
  pass_through_id: string | null
  obligation_id: string | null
  loan_id: string | null
  debt_id: string | null
  salary_advance_id: string | null
  created_at: string
}

const LINK_COLUMN = {
  transaction: 'transaction_id',
  transfer: 'internal_transfer_id',
  passThrough: 'pass_through_id',
  bill: 'obligation_id',
  loan: 'loan_id',
  debt: 'debt_id',
  advance: 'salary_advance_id',
} as const
type LinkKind = keyof typeof LINK_COLUMN

const KIND_LABEL: Record<LinkKind, string> = {
  transaction: 'Transaction',
  transfer: 'Transfer',
  passThrough: 'Held for others',
  bill: 'Bill',
  loan: 'Loan to someone',
  debt: 'Debt',
  advance: 'Salary advance',
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80)
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

export default function Vault() {
  const { mode, userId, data, syncEnabled } = useApp()
  const toast = useToast()
  const { ask, dialog } = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  const available = mode === 'cloud' && syncEnabled && supabase !== null && userId !== null

  const load = useCallback(async () => {
    if (!supabase) return
    const { data: res, error: err } = await supabase.from('evidence_attachments').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (err) setError('Could not load your documents. Check your connection and try again.')
    else {
      setError(null)
      setRows(res as Row[])
    }
  }, [])

  useEffect(() => {
    if (available) void load()
  }, [available, load])

  /** Display names for linkable records. */
  const targets = useMemo(() => {
    const t: { kind: LinkKind; id: string; label: string }[] = []
    for (const x of [...data.ledger.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 100)) t.push({ kind: 'transaction', id: x.id, label: `${x.date} · ${x.description}` })
    for (const x of data.ledger.transfers) t.push({ kind: 'transfer', id: x.id, label: `${x.date} · transfer` })
    for (const x of data.ledger.passThroughs) t.push({ kind: 'passThrough', id: x.id, label: `${x.sender} → ${x.recipient}` })
    for (const x of data.obligations) t.push({ kind: 'bill', id: x.id, label: x.name })
    for (const x of data.ledger.loans) t.push({ kind: 'loan', id: x.id, label: x.borrower })
    for (const x of data.ledger.debts) t.push({ kind: 'debt', id: x.id, label: x.creditor })
    for (const x of data.ledger.advances) t.push({ kind: 'advance', id: x.id, label: x.employer })
    return t
  }, [data])

  const linkOf = (r: Row) => {
    for (const k of Object.keys(LINK_COLUMN) as LinkKind[]) {
      const id = r[LINK_COLUMN[k]]
      if (id) return { kind: k, label: targets.find((t) => t.kind === k && t.id === id)?.label ?? KIND_LABEL[k] }
    }
    return null
  }

  const filtered = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind) {
        const l = linkOf(r)
        if (kind === 'none' ? l !== null : l?.kind !== kind) return false
      }
      if (!needle) return true
      return `${r.file_name} ${r.description ?? ''} ${r.reference_code ?? ''} ${r.keywords.join(' ')}`.toLowerCase().includes(needle)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, kind, targets])

  const open = async (r: Row) => {
    if (!supabase) return
    const { data: signed, error: err } = await supabase.storage.from('evidence').createSignedUrl(r.storage_path, 60)
    if (err || !signed) return toast('Could not open this file right now.', 'error')
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const del = (r: Row) =>
    ask({
      title: 'Delete this document?',
      message: `“${r.file_name}” will be permanently removed from your vault. Linked records are not affected.`,
      success: 'Document deleted.',
      run: async () => {
        if (!supabase) throw new Error('Not connected')
        const { error: e1 } = await supabase.from('evidence_attachments').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)
        if (e1) throw new Error(e1.message)
        await supabase.storage.from('evidence').remove([r.storage_path])
        await load()
      },
    })

  return (
    <>
      <PageHeader
        title="Evidence Vault"
        description="Keep receipts, payment slips and agreements safely attached to your records. Files are private to you and only upload while you are online."
        actions={
          available && (
            <button type="button" className="btn btn-primary" disabled={!online} onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" aria-hidden /> Upload document
            </button>
          )
        }
      />

      {!available ? (
        <div className="card">
          <EmptyState
            icon={<FolderLock className="size-6" />}
            title={mode === 'demo' ? 'The vault isn’t available in demo mode' : 'Connect your database to use the vault'}
            description={mode === 'demo' ? 'Demo data stays on this device only. Sign in with a real account to store documents securely.' : 'Documents are stored in a private bucket in your Supabase project. Finish the setup, then sign in.'}
          />
        </div>
      ) : (
        <>
          {!online && <div className="mb-4"><InlineNote tone="warning">You are offline. You can’t upload or open documents until you reconnect.</InlineNote></div>}
          <div className="card">
            <SearchAndFilterBar query={q} onQuery={setQ} placeholder="Search name, description, reference or keyword" hasFilters={Boolean(q || kind)} onClear={() => { setQ(''); setKind('') }}>
              <FilterSelect label="Linked to" value={kind} onChange={setKind}>
                <option value="">Anything</option>
                <option value="none">Not linked</option>
                {(Object.keys(KIND_LABEL) as LinkKind[]).map((k) => (<option key={k} value={k}>{KIND_LABEL[k]}</option>))}
              </FilterSelect>
            </SearchAndFilterBar>
            {error ? (
              <ErrorState message={error} action={<button type="button" className="btn btn-secondary" onClick={() => void load()}>Try again</button>} />
            ) : rows === null ? (
              <LoadingState label="Loading documents…" />
            ) : filtered.length === 0 ? (
              <EmptyState icon={<FileText className="size-6" />} title={rows.length === 0 ? 'No documents yet' : 'No matching documents'} description={rows.length === 0 ? 'Upload a receipt or slip (JPEG, PNG, WebP or PDF, up to 10 MB).' : 'Try a different search.'} />
            ) : (
              <ul className="m-0 list-none divide-y divide-border/60 p-0">
                {filtered.map((r) => {
                  const link = linkOf(r)
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.file_name}</p>
                        <p className="t-helper">
                          {r.document_date ?? r.created_at.slice(0, 10)} · {size(r.size_bytes)}
                          {r.reference_code ? ` · ref ${r.reference_code}` : ''}
                          {link ? ` · ${KIND_LABEL[link.kind]}: ${link.label}` : ' · not linked'}
                        </p>
                        {r.description && <p className="text-sm text-muted">{r.description}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!online} onClick={() => void open(r)}><ExternalLink className="size-4" aria-hidden /> Open</button>
                        <button type="button" className="btn btn-ghost btn-icon text-negative" aria-label={`Delete ${r.file_name}`} onClick={() => del(r)}><Trash2 className="size-4" aria-hidden /></button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {available && userId && (
        <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} userId={userId} targets={targets} onDone={() => void load()} />
      )}
      {dialog}
    </>
  )
}

function UploadModal({ open, onClose, userId, targets, onDone }: { open: boolean; onClose: () => void; userId: string; targets: { kind: LinkKind; id: string; label: string }[]; onDone: () => void }) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [keywords, setKeywords] = useState('')
  const [docDate, setDocDate] = useState('')
  const [link, setLink] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)

  const reset = () => {
    setFile(null)
    setDescription('')
    setReference('')
    setKeywords('')
    setDocDate('')
    setLink('')
    setErr('')
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (lock.current || !supabase) return
    if (!file) return setErr('Choose a file to upload.')
    const problem = validateEvidenceFile({ name: file.name, size: file.size, type: file.type })
    if (problem) return setErr(problem)
    if (docDate && !isValidDate(docDate)) return setErr('Enter a valid document date.')
    lock.current = true
    setBusy(true)
    setErr('')
    const id = newId()
    const path = `${userId}/${id}-${safeName(file.name)}`
    try {
      const up = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw new Error(up.error.message)
      const [lk, lid] = link ? link.split(':') : []
      const row: Record<string, unknown> = {
        id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        reference_code: reference.trim() || null,
        description: description.trim() || null,
        keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        document_date: docDate || null,
      }
      if (lk && lid) row[LINK_COLUMN[lk as LinkKind]] = lid
      const ins = await supabase.from('evidence_attachments').insert(row)
      if (ins.error) {
        await supabase.storage.from('evidence').remove([path]) // don't leave an orphan file
        throw new Error(ins.error.message)
      }
      toast('Document uploaded.', 'success')
      reset()
      onClose()
      onDone()
    } catch (ex) {
      setErr(`Upload failed: ${ex instanceof Error ? ex.message : 'unknown error'}. Nothing was saved.`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Upload a document" description={`JPEG, PNG, WebP or PDF, up to ${EVIDENCE_MAX_BYTES / 1048576} MB. Stored privately.`}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ev-file" className="text-sm font-medium">File</label>
          <input id="ev-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr('') }} />
        </div>
        <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <TextField label="Reference code (optional)" value={reference} onChange={(e) => setReference(e.target.value)} helper="For example a slip or invoice number." />
        <TextField label="Keywords (optional)" value={keywords} onChange={(e) => setKeywords(e.target.value)} helper="Separate with commas." />
        <TextField label="Document date (optional)" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        <SelectField label="Link to a record (optional)" value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">Not linked</option>
          {(Object.keys(KIND_LABEL) as LinkKind[]).map((k) => {
            const items = targets.filter((t) => t.kind === k)
            return items.length === 0 ? null : (
              <optgroup key={k} label={KIND_LABEL[k]}>
                {items.map((t) => (<option key={t.id} value={`${k}:${t.id}`}>{t.label}</option>))}
              </optgroup>
            )
          })}
        </SelectField>
        {err && <InlineNote tone="negative">{err}</InlineNote>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </form>
    </Modal>
  )
}
