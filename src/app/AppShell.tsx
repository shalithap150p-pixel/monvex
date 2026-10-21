import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { formatMoney } from '../domain/money'
import { availableMoney } from '../domain/ledger'
import { Modal } from '../ui/Modal'
import { useApp } from './AppContext'
import { useAuth } from './auth'
import { Logo } from './Brand'
import { NAV, NAV_GROUPS, titleFor } from './nav'
import { QuickActionsProvider, useQuickActions } from './QuickActions'
import { SyncBadge } from './SyncBadge'

const SIDEBAR_KEY = 'monvex.sidebar'

export function AppShell() {
  return (
    <QuickActionsProvider>
      <Shell />
    </QuickActionsProvider>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [moreOpen, setMoreOpen] = useState(false)
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    setMoreOpen(false)
    setAnnounce(`${titleFor(pathname)} page`)
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-[var(--accent-contrast)]">
        Skip to main content
      </a>
      <div className="sr-only-live" role="status" aria-live="polite">
        {announce}
      </div>

      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMore={() => setMoreOpen(true)} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 lg:px-8 lg:pb-10">
          <Outlet />
        </main>
        <MobileBottomNav onMore={() => setMoreOpen(true)} />
      </div>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  )
}

/* ------------------------------------------------------------ Sidebar (desktop) */

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-bg py-4 transition-[width] duration-200 lg:flex ${collapsed ? 'w-[4.5rem] px-2' : 'w-64 px-3'}`}
      aria-label="Sidebar"
    >
      <div className={`mb-5 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
        <Link to="/" aria-label="MONVEX dashboard">
          <Logo withWord={!collapsed} />
        </Link>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-4">
            {!collapsed && <h2 className="t-label mb-1 px-3 uppercase">{group}</h2>}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {NAV.filter((n) => n.group === group).map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/'}
                    className="nav-link"
                    title={collapsed ? n.label : undefined}
                    aria-label={collapsed ? n.label : undefined}
                  >
                    <n.icon className="size-5 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{n.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <button type="button" className="btn btn-ghost mt-2 w-full justify-start" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  )
}

/* ------------------------------------------------------------ Top bar */

function TopBar({ onMore }: { onMore: () => void }) {
  const { pathname } = useLocation()
  const { today, data, currency } = useApp()
  const { open } = useQuickActions()
  const total = availableMoney(data.ledger, today).available
  const date = new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
        <div className="lg:hidden">
          <Logo size={26} />
        </div>
        <p className="t-section hidden flex-1 lg:block" aria-hidden="true">{titleFor(pathname)}</p>
        <div className="flex-1 lg:hidden" />
        <span className="t-helper hidden sm:inline">{date}</span>
        <span className="hidden amount text-sm text-muted xl:inline" title="Total available money (excludes money held for others)">
          Available {formatMoney(total, currency)}
        </span>
        <SyncBadge compact />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open('menu')} aria-haspopup="dialog">
          <Plus className="size-4" aria-hidden /> <span className="hidden sm:inline">Quick add</span>
          <span className="sr-only sm:hidden">Quick add</span>
        </button>
        <ProfileMenu />
        <button type="button" className="btn btn-ghost btn-icon lg:hidden" onClick={onMore} aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </button>
      </div>
    </header>
  )
}

function ProfileMenu() {
  const { mode } = useApp()
  const { user, leaveDemo } = useAuth()
  const navigate = useNavigate()
  const initial = (user?.user_metadata?.display_name || user?.email || 'D').toString().charAt(0).toUpperCase()
  return (
    <div className="hidden items-center gap-1 lg:flex">
      <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate('/settings')} aria-label="Profile and settings" title={user?.email ?? 'Demo user'}>
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-text" aria-hidden>
          {initial}
        </span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={mode === 'demo' ? 'Exit demo' : 'Sign out'}
        title={mode === 'demo' ? 'Exit demo' : 'Sign out'}
        onClick={() => (mode === 'demo' ? leaveDemo() : navigate('/settings#account'))}
      >
        <LogOut className="size-5" aria-hidden />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------ Mobile navigation */

function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const primary = NAV.filter((n) => n.primary)
  return (
    <nav
      aria-label="Primary mobile"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="m-0 grid list-none grid-cols-4 p-0" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
        {primary.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.to === '/'}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium text-subtle aria-[current=page]:text-accent-text"
            >
              <n.icon className="size-5" aria-hidden />
              {n.label.split(' ')[0]}
            </NavLink>
          </li>
        ))}
        <li>
          <button type="button" onClick={onMore} className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium text-subtle">
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode } = useApp()
  const { leaveDemo } = useAuth()
  const navigate = useNavigate()
  return (
    <Modal open={open} onClose={onClose} title="Menu" size="sm">
      <nav aria-label="All sections">
        {NAV_GROUPS.map((group) => (
          <div key={group} className="mb-3">
            <h3 className="t-label mb-1 uppercase">{group}</h3>
            <ul className="m-0 grid list-none gap-1 p-0">
              {NAV.filter((n) => n.group === group).map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.to === '/'} className="nav-link" onClick={onClose}>
                    <n.icon className="size-5" aria-hidden />
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <button
        type="button"
        className="btn btn-secondary w-full"
        onClick={() => {
          onClose()
          if (mode === 'demo') leaveDemo()
          else navigate('/settings#account')
        }}
      >
        <LogOut className="size-4" aria-hidden /> {mode === 'demo' ? 'Exit demo' : 'Account & sign out'}
      </button>
    </Modal>
  )
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
}
