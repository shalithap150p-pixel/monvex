import { CircleAlert, Inbox, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { CompanyCredit, CompanyWordmark } from './Company'

export function LoadingState({ label = 'Loading…', fullScreen = false }: { label?: string; fullScreen?: boolean }) {
  if (fullScreen) {
    return (
      <div role="status" className="flex min-h-screen flex-col items-center justify-between px-6 py-10 text-muted">
        <span aria-hidden />
        <div className="flex flex-col items-center gap-8">
          <CompanyWordmark height={44} />
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-accent-text" aria-hidden />
            <span className="text-sm font-medium">{label}</span>
          </div>
        </div>
        <CompanyCredit />
      </div>
    )
  }
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-subtle" aria-hidden>
        {icon ?? <Inbox className="size-6" />}
      </div>
      <h3 className="t-section">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <CircleAlert className="size-8 text-negative" aria-hidden />
      <h3 className="t-section">{title}</h3>
      {message && <p className="max-w-md text-sm text-muted">{message}</p>}
      {action}
    </div>
  )
}
