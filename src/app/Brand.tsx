export function Logo({ size = 28, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--accent)" />
        <path d="M14 46V20l18 18 18-18v26" fill="none" stroke="var(--accent-contrast)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withWord && <span className="text-lg font-bold tracking-[0.14em]">MONVEX</span>}
    </span>
  )
}
