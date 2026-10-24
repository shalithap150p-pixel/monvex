/** LevelUP Web Solutions branding: logos live in /public/brand (light variants are made for the dark themes). */
export function CompanyWordmark({ height = 44 }: { height?: number }) {
  return <img src="/brand/levelup-wordmark-light.png" alt="LevelUP" height={height} style={{ height, width: 'auto' }} draggable={false} />
}

export function CompanyCredit({ withMark = false }: { withMark?: boolean }) {
  return (
    <p className="t-helper flex flex-col items-center gap-1 text-center">
      {withMark && <img src="/brand/levelup-mark-light.png" alt="" aria-hidden height={22} style={{ height: 22, width: 'auto' }} draggable={false} />}
      <span>© 2026 LevelUP Web Solutions</span>
      <span>Created by MR.FIXS (Shalitha Roshan)</span>
    </p>
  )
}
