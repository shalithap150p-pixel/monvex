import { Cloud, CloudAlert, CloudOff, FlaskConical, Loader2, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { statusOf, useSyncState } from '../data/syncEngine'
import { useApp } from './AppContext'

const LABEL = {
  synced: 'Synced',
  pending: 'Changes waiting to sync',
  syncing: 'Syncing…',
  failed: 'Sync needs attention',
  offline: 'Offline — saved on this device',
  not_configured: 'Local only',
} as const

/** Never claims "Synced" unless the server confirmed everything. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const { mode, syncEnabled, sync } = useApp()
  const s = useSyncState()

  if (mode === 'demo') {
    return (
      <Link to="/settings" className="badge text-warning no-underline" title="Demo data is stored only on this device and is never synced.">
        <FlaskConical className="size-3" aria-hidden />
        {compact ? 'Demo' : 'Demo data — not synced'}
      </Link>
    )
  }
  const status = statusOf(s, syncEnabled, true)
  const Icon = status === 'syncing' ? Loader2 : status === 'offline' ? CloudOff : status === 'failed' ? CloudAlert : status === 'pending' ? RefreshCw : Cloud
  const tone = status === 'synced' ? 'text-positive' : status === 'failed' ? 'text-negative' : status === 'offline' || status === 'pending' ? 'text-warning' : 'text-subtle'
  const count = s.pendingCount + s.failedCount + s.conflictCount
  return (
    <button
      type="button"
      className={`badge ${tone} cursor-pointer bg-transparent`}
      onClick={() => void sync()}
      title="Sync now"
      aria-label={`${LABEL[status]}${count ? `, ${count} item${count === 1 ? '' : 's'}` : ''}. Press to sync now.`}
    >
      <Icon className={`size-3 ${status === 'syncing' ? 'animate-spin' : ''}`} aria-hidden />
      {compact ? (status === 'synced' ? 'Synced' : count || LABEL[status].split(' ')[0]) : LABEL[status]}
      {!compact && count > 0 && status !== 'synced' ? ` (${count})` : ''}
    </button>
  )
}
