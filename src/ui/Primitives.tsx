import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock,
  Minus,
  TriangleAlert,
} from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { formatMoney, type Minor } from '../domain/money'

/* ------------------------------------------------------------ CurrencyAmount */

/** Signs and icons carry the meaning; colour is only reinforcement. */
export function CurrencyAmount({
  value,
  currency = 'LKR',
  tone = 'auto',
  signed = false,
  className = '',
  withIcon = false,
}: {
  value: Minor
  currency?: string
  tone?: 'auto' | 'neutral'
  signed?: boolean
  className?: string
  withIcon?: boolean
}) {
  const color = tone === 'neutral' ? '' : value > 0 && signed ? 'text-positive' : value < 0 ? 'text-negative' : ''
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus
  return (
    <span className={`amount ${color} ${className}`}>
      {withIcon && <Icon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
      {formatMoney(value, currency, { signed })}
    </span>
  )
}

/* ------------------------------------------------------------ StatusBadge */

export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info'

const TONE: Record<Tone, { cls: string; Icon: typeof Circle }> = {
  neutral: { cls: 'text-subtle', Icon: Circle },
  positive: { cls: 'text-positive', Icon: CheckCircle2 },
  negative: { cls: 'text-negative', Icon: CircleAlert },
  warning: { cls: 'text-warning', Icon: TriangleAlert },
  info: { cls: 'text-info', Icon: Clock },
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { cls, Icon } = TONE[tone]
  return (
    <span className={`badge ${cls}`}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

/* ------------------------------------------------------------ Page header */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="t-page">{title}</h1>
        {description && <p className="t-helper mt-0.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/* ------------------------------------------------------------ Metric card */

export function SummaryMetricCard({
  label,
  value,
  helper,
  badge,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  badge?: ReactNode
}) {
  return (
    <section className="card" aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="t-label">{label}</h3>
        {badge}
      </div>
      <div className="t-value mt-1">{value}</div>
      {helper && <div className="t-helper mt-1">{helper}</div>}
    </section>
  )
}

/* ------------------------------------------------------------ Form fields */

export function Field({
  label,
  error,
  helper,
  children,
  htmlFor,
}: {
  label: string
  error?: string
  helper?: string
  children: ReactNode
  htmlFor: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {helper && !error && <p className="t-helper">{helper}</p>}
      {error && (
        <p className="text-sm text-negative" role="alert">
          <CircleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

interface BaseFieldProps {
  label: string
  error?: string
  helper?: string
}

export function TextField({ label, error, helper, ...props }: BaseFieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Field label={label} error={error} helper={helper} htmlFor={id}>
      <input id={id} className="input" aria-invalid={Boolean(error)} {...props} />
    </Field>
  )
}

export function AmountField({
  label,
  error,
  helper,
  value,
  onChange,
  currency = 'LKR',
  ...props
}: BaseFieldProps & { value: string; onChange: (v: string) => void; currency?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  return (
    <Field label={label} error={error} helper={helper} htmlFor={id}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle" aria-hidden>
          {currency}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className="input amount pl-14"
          aria-invalid={Boolean(error)}
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...props}
        />
      </div>
    </Field>
  )
}

export function SelectField({
  label,
  error,
  helper,
  children,
  ...props
}: BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Field label={label} error={error} helper={helper} htmlFor={id}>
      <select id={id} className="input" aria-invalid={Boolean(error)} {...props}>
        {children}
      </select>
    </Field>
  )
}

export function TextAreaField({ label, error, helper, ...props }: BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Field label={label} error={error} helper={helper} htmlFor={id}>
      <textarea id={id} rows={3} className="input" aria-invalid={Boolean(error)} {...props} />
    </Field>
  )
}

export function CheckboxField({ label, helper, ...props }: { label: string; helper?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {helper && <span className="t-helper block">{helper}</span>}
      </label>
    </div>
  )
}

/* ------------------------------------------------------------ Misc */

export function InlineNote({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const { cls, Icon } = TONE[tone]
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-border bg-surface-2 p-3 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} aria-hidden />
      <div className="text-muted">{children}</div>
    </div>
  )
}
