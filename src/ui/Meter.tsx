export type MeterTone = 'ok' | 'warn' | 'over'

/** Accessible progress bar. The value is also shown as text by the caller, so colour is never the only signal. */
export function Meter({ pct, label, tone = 'ok', height = 'h-2.5' }: { pct: number; label: string; tone?: MeterTone; height?: string }) {
  const color = tone === 'over' ? 'var(--negative)' : tone === 'warn' ? 'var(--warning)' : 'var(--accent)'
  const safe = Number.isFinite(pct) ? pct : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(safe))}
      className={`${height} overflow-hidden rounded-full bg-surface-2`}
    >
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(safe > 0 ? 2 : 0, safe))}%`, background: color }} />
    </div>
  )
}
