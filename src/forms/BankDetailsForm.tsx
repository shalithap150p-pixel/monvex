import { useState } from 'react'
import { useApp } from '../app/AppContext'
import type { BankDetailsRec } from '../data/records'
import { ACCOUNT_TYPE_LABEL, emptyToNull, normalizeSpaces, validateBankDetails, type BankDetailsInput } from '../domain/bankDetails'
import type { BankAccountType } from '../domain/types'
import { AccountSelector } from '../ui/Inputs'
import { InlineNote, SelectField, TextAreaField, TextField } from '../ui/Primitives'
import { FormModal, useFormSubmit } from './shared'

export function BankDetailsForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: BankDetailsRec }) {
  if (!open) return null
  return <Inner onClose={onClose} initial={initial} />
}

function Inner({ onClose, initial }: { onClose: () => void; initial?: BankDetailsRec }) {
  const { data, currency, save } = useApp()
  const { busy, error, run, id } = useFormSubmit()
  const [v, setV] = useState<BankDetailsInput>({
    label: initial?.label ?? '',
    bankName: initial?.bankName ?? '',
    branchName: initial?.branchName ?? '',
    branchCode: initial?.branchCode ?? '',
    bankCode: initial?.bankCode ?? '',
    accountHolder: initial?.accountHolder ?? '',
    accountNumber: initial?.accountNumber ?? '',
    accountType: initial?.accountType ?? 'savings',
    currency: initial?.currency ?? currency,
    iban: initial?.iban ?? '',
    swiftBic: initial?.swiftBic ?? '',
    cardLast4: initial?.cardLast4 ?? '',
    openedOn: initial?.openedOn ?? '',
    contactPhone: initial?.contactPhone ?? '',
    notes: initial?.notes ?? '',
  })
  const [linked, setLinked] = useState(initial?.linkedAccountId ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof BankDetailsInput>(k: K, value: BankDetailsInput[K]) => setV((s) => ({ ...s, [k]: value }))
  const text = (k: keyof BankDetailsInput) => ({ value: v[k], onChange: (e: { target: { value: string } }) => set(k, e.target.value as never), error: errors[k] })

  const submit = () => {
    const e = validateBankDetails(v)
    setErrors(e)
    if (Object.keys(e).length) return
    void run(
      () =>
        save('bankDetails', {
          id: initial?.id ?? id,
          label: normalizeSpaces(v.label),
          bankName: normalizeSpaces(v.bankName),
          branchName: emptyToNull(v.branchName),
          branchCode: emptyToNull(v.branchCode),
          bankCode: emptyToNull(v.bankCode),
          accountHolder: emptyToNull(v.accountHolder),
          accountNumber: normalizeSpaces(v.accountNumber),
          accountType: v.accountType,
          currency: v.currency.toUpperCase(),
          iban: emptyToNull(v.iban)?.replace(/\s/g, '').toUpperCase() ?? null,
          swiftBic: emptyToNull(v.swiftBic)?.replace(/\s/g, '').toUpperCase() ?? null,
          cardLast4: emptyToNull(v.cardLast4),
          openedOn: emptyToNull(v.openedOn),
          contactPhone: emptyToNull(v.contactPhone),
          linkedAccountId: linked || null,
          notes: v.notes.trim() ? v.notes.trim() : null,
        }).then(() => undefined),
      initial ? 'Bank details updated.' : 'Bank details saved.',
      onClose,
    )
  }

  return (
    <FormModal title={initial ? 'Edit bank details' : 'Add bank details'} onClose={onClose} onSubmit={submit} busy={busy} error={error} size="lg">
      <InlineNote tone="warning">
        Never enter online-banking passwords, PINs, OTPs, card security codes (CVV/CVC) or full card numbers. MONVEX does not store them — only the last 4 digits of a card.
      </InlineNote>
      <TextField label="Name for this account" placeholder="e.g. Salary account" {...text('label')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Bank" placeholder="e.g. Commercial Bank of Ceylon" {...text('bankName')} />
        <TextField label="Branch (optional)" {...text('branchName')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Bank code (optional)" {...text('bankCode')} />
        <TextField label="Branch code (optional)" {...text('branchCode')} />
      </div>
      <TextField label="Account holder name (optional)" {...text('accountHolder')} />
      <TextField label="Account number" inputMode="text" autoComplete="off" {...text('accountNumber')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Account type" value={v.accountType} onChange={(e) => set('accountType', e.target.value as BankAccountType)}>
          {(Object.keys(ACCOUNT_TYPE_LABEL) as BankAccountType[]).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Currency" maxLength={3} value={v.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} error={errors.currency} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="IBAN (optional)" autoComplete="off" {...text('iban')} />
        <TextField label="SWIFT / BIC (optional)" autoComplete="off" {...text('swiftBic')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Card — last 4 digits (optional)" inputMode="numeric" maxLength={4} autoComplete="off" helper="Only the last 4 digits." {...text('cardLast4')} />
        <TextField label="Opened on (optional)" type="date" {...text('openedOn')} />
        <TextField label="Bank phone (optional)" inputMode="tel" {...text('contactPhone')} />
      </div>
      <AccountSelector label="Linked MONVEX account (optional)" value={linked} onChange={setLinked} accounts={data.ledger.accounts} allowEmpty emptyLabel="Not linked" />
      <TextAreaField label="Notes (optional)" {...text('notes')} />
    </FormModal>
  )
}
