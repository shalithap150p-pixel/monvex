import {
  ArrowLeftRight,
  BarChart3,
  Banknote,
  CalendarClock,
  FolderLock,
  Handshake,
  LayoutDashboard,
  Landmark,
  LineChart,
  PiggyBank,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'Money' | 'Plan' | 'Insight' | 'System'
  /** Shown in the mobile bottom bar. */
  primary?: boolean
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Money', primary: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt, group: 'Money', primary: true },
  { to: '/accounts', label: 'Accounts', icon: Landmark, group: 'Money' },
  { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, group: 'Money' },
  { to: '/bills', label: 'Bills & Subscriptions', icon: CalendarClock, group: 'Plan' },
  { to: '/debts', label: 'Loans & Debts', icon: Handshake, group: 'Plan' },
  { to: '/advances', label: 'Salary Advances', icon: Banknote, group: 'Plan' },
  { to: '/budgets', label: 'Budgets & Goals', icon: PiggyBank, group: 'Plan' },
  { to: '/forecast', label: 'Forecasts', icon: LineChart, group: 'Insight', primary: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, group: 'Insight' },
  { to: '/vault', label: 'Evidence Vault', icon: FolderLock, group: 'System' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'System' },
]

export const NAV_GROUPS = ['Money', 'Plan', 'Insight', 'System'] as const

export const titleFor = (pathname: string): string =>
  NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)))?.label ?? 'MONVEX'
