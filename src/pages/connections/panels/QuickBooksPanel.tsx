import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { useBrand } from '@/lib/farm-setup'
import { quickbooksConnect, useQbCompany, useQbDisconnect, useQbSync } from '@/lib/quickbooks'
import { cn } from '@/lib/utils'
import { OAuthBanner } from './OAuthBanner'
import { syncedAt } from './format'

/**
 * QuickBooks Online: connect, sync, disconnect. Owners and finance access only
 * (the functions refuse anyone else); everybody else sees the status line.
 * Moved from the old Integrations card.
 */
export function QuickBooksPanel() {
  const { profile } = useAuth()
  const brand = useBrand()
  const finances = canSeeFinances(profile)
  const { data: company } = useQbCompany()
  const sync = useQbSync()
  const disconnect = useQbDisconnect()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)
  const connected = company?.status === 'connected'
  const banner = params.get('qb_connected')
    ? { ok: true, msg: 'QuickBooks connected. The first sync is running — the QuickBooks page fills in as it lands.' }
    : params.get('qb_error')
      ? { ok: false, msg: `Connect failed: ${params.get('qb_error')}` }
      : // Intuit's "Disconnect URL": someone removed the app from QuickBooks' side.
        params.has('qb_disconnected')
        ? { ok: false, msg: 'QuickBooks was disconnected from QuickBooks itself. Nothing new comes in until it is connected again.' }
        : null
  const env = company?.environment === 'production' ? 'live books' : 'sandbox'
  const problem = Boolean(company?.last_error || err || sync.error || disconnect.error)

  return (
    <div>
      <OAuthBanner banner={banner} />
      {connected && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Company</dt>
            <dd className="font-medium">
              {company?.company_name ?? '—'} <span className="text-xs font-normal text-gray-500">· {env}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Last sync</dt>
            <dd className="font-medium">{syncedAt(company?.last_sync_at)}</dd>
          </div>
        </dl>
      )}
      {company?.last_error && <p className="mt-2 text-xs text-red-600">{company.last_error}</p>}
      {sync.isSuccess && <p className="mt-2 text-xs text-gray-600">Sync started — it runs in the background.</p>}
      {(err || sync.error || disconnect.error) && (
        <p className="mt-2 text-xs text-red-600">{err ?? ((sync.error ?? disconnect.error) as Error).message}</p>
      )}
      {/* Who to ask, beside the error it is for. The error includes Intuit's
          reference (intuit_tid) to pass on to QuickBooks support. */}
      {problem && brand.supportEmail && (
        <p className="mt-1 text-xs text-gray-500">
          Problems with the connection:{' '}
          <a className="text-brand-700 underline" href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent('QuickBooks connection')}`}>
            {brand.supportEmail}
          </a>
        </p>
      )}
      {finances ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {connected && (
            <button
              onClick={() => sync.mutate(false)}
              disabled={sync.isPending}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} /> Sync now
            </button>
          )}
          <button
            onClick={async () => {
              setErr(null)
              try {
                window.location.href = await quickbooksConnect()
              } catch (e) {
                setErr((e as Error).message)
              }
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              connected ? 'border border-gray-300 text-gray-800 hover:bg-gray-50' : 'bg-brand-700 text-white hover:bg-brand-800',
            )}
          >
            {connected ? 'Reconnect' : 'Connect QuickBooks'}
          </button>
          {connected && (
            <>
              <button
                onClick={() => sync.mutate(true)}
                disabled={sync.isPending}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Re-read everything
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Disconnect QuickBooks? The synced records stay; nothing new comes in until you connect again.')) disconnect.mutate()
                }}
                disabled={disconnect.isPending}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-500">Connecting QuickBooks is for the owners and the farm&apos;s accountant.</p>
      )}
    </div>
  )
}
