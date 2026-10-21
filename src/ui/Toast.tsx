import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const Ctx = createContext<{ notify: (message: string, kind?: ToastKind) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const notify = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = ++seq.current
      setItems((l) => [...l.slice(-3), { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ notify }), [notify])
  const Icon = { success: CheckCircle2, error: TriangleAlert, info: Info }

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6"
        role="region"
        aria-label="Notifications"
      >
        {items.map((t) => {
          const I = Icon[t.kind]
          const color = t.kind === 'error' ? 'text-negative' : t.kind === 'success' ? 'text-positive' : 'text-info'
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="card sheet-in flex w-full max-w-sm items-start gap-3 !p-3 shadow-xl"
            >
              <I className={`mt-0.5 size-5 shrink-0 ${color}`} aria-hidden />
              <p className="flex-1 text-sm">
                <span className="sr-only">{t.kind === 'error' ? 'Error: ' : t.kind === 'success' ? 'Success: ' : 'Notice: '}</span>
                {t.message}
              </p>
              <button className="btn btn-ghost btn-icon !min-h-6 !min-w-6" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast must be used inside ToastProvider')
  return v.notify
}
