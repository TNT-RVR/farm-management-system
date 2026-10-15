import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Select } from '@/components/Select'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { jdConnect, useIntegrations, useJdExplore, useJdOrgs, useJdSync, useSetJdOrg } from '@/lib/integrations'
import { useSyncFieldOperations } from '@/lib/fieldOps'
import { cn } from '@/lib/utils'
import { OAuthBanner } from './OAuthBanner'
import { syncedAt } from './format'

/**
 * John Deere Operations Center: sign in, pick the organization, sync. Moved
 * from the old Integrations card unchanged; only its fold is gone, since it
 * now opens in the connection's own panel.
 */
export function JohnDeerePanel() {
  const { data: integrations } = useIntegrations()
  const jd = integrations?.find((i) => i.provider === 'john_deere')
  const sync = useJdSync()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)
  const connected = jd?.status === 'connected'
  // 'error' still means we hold valid tokens — a call failed, usually because the
  // org isn't shared or the wrong one was selected. The picker and Sync must stay
  // reachable in that state, or the only way out of a recoverable error is a full
  // reconnect.
  const linked = connected || jd?.status === 'error'
  // John Deere's OAuth is only half the handshake — the user must also pick which
  // organizations this app may see, or every sync comes back empty.
  const jdMeta = (jd?.meta ?? null) as {
    needs_org_access?: boolean
    connections_url?: string
  } | null
  const needsOrgAccess = Boolean(jdMeta?.needs_org_access && jdMeta?.connections_url)
  const connectionsUrl = jdMeta?.connections_url ?? null
  // A Deere login can hold several organizations; the app has to be pointed at
  // the right one rather than whichever Deere lists first.
  const { data: orgData } = useJdOrgs(linked)
  const setOrg = useSetJdOrg()
  const orgs = orgData?.orgs ?? []
  const explore = useJdExplore()
  const syncOps = useSyncFieldOperations()

  const banner = params.get('jd_connected')
    ? { ok: true, msg: 'John Deere connected.' }
    : params.get('jd_error')
      ? { ok: false, msg: `Connect failed: ${params.get('jd_error')}` }
      : null

  return (
    <div>
      <OAuthBanner banner={banner} />

      {linked && orgs.length > 0 && (
        <div className="mt-3 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-700">Organization to sync</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Your John Deere login can see {orgs.length} organizations. Only the one chosen here is
            read.
          </p>
          <Select
            value={orgData?.selectedId ?? ''}
            ariaLabel="John Deere organization"
            className="mt-2 w-full sm:w-72"
            onChange={(v) => v && setOrg.mutate(v)}
            options={[
              { value: '', label: '— choose an organization —' },
              ...orgs.map((o) => ({
                value: o.id,
                label: `${o.name ?? o.id}${o.needsConnection ? ' (not shared yet)' : ''}`,
              })),
            ]}
          />
          {setOrg.isError && (
            <p className="mt-1 text-xs text-red-600">{(setOrg.error as Error).message}</p>
          )}
        </div>
      )}

      {linked && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Organization</dt>
            <dd className="font-medium">{jd?.external_org_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Last sync</dt>
            <dd className="font-medium">{syncedAt(jd?.last_sync_at)}</dd>
          </div>
        </dl>
      )}

      {needsOrgAccess && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            One more step: share your organization
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            You're signed in to John Deere, but Operations Center still needs you to choose which
            organizations this app may read. Until you do, syncs return nothing.
          </p>
          <a
            href={connectionsUrl ?? '#'}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800"
          >
            Grant organization access <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {jd?.last_error && <p className="mt-2 text-xs text-red-600">{jd.last_error}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {linked && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} /> Sync now
          </button>
        )}
        {linked && (
          <button
            onClick={() => syncOps.mutate()}
            disabled={syncOps.isPending}
            className="flex items-center gap-1.5 rounded-md border border-brand-700 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', syncOps.isPending && 'animate-spin')} /> Sync field
            work
          </button>
        )}
        <button
          onClick={async () => {
            setErr(null)
            try {
              window.location.href = await jdConnect()
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium',
            linked ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-brand-700 text-white hover:bg-brand-800',
          )}
        >
          {linked ? 'Reconnect' : 'Connect John Deere'}
        </button>
      </div>
      {sync.isSuccess && (
        <p className="mt-2 text-xs text-green-700">
          Synced: {(sync.data as { fields: number }).fields} new fields,{' '}
          {(sync.data as { boundaries: number }).boundaries} boundaries.
        </p>
      )}
      {sync.isError && <p className="mt-2 text-xs text-red-600">{(sync.error as Error).message}</p>}
      {syncOps.isSuccess && (
        <p className="mt-2 text-xs text-green-700">{(syncOps.data as { detail: string }).detail}</p>
      )}
      {syncOps.isError && (
        <p className="mt-2 text-xs text-red-600">{(syncOps.error as Error).message}</p>
      )}

      {/* The raw-payload explorer is for whoever maintains the Deere mapping, so
          it is admin-only (TechnicalDetails renders nothing for anyone else). */}
      {linked && (
        <TechnicalDetails title="API explorer" className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => explore.mutate()}
              disabled={explore.isPending}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {explore.isPending ? 'Reading…' : 'Explore API'}
            </button>
            <span className="text-[11px] text-gray-500">
              Read-only. Samples each endpoint so the field-operations mapping can be written
              against real payloads.
            </span>
          </div>
          {explore.isError && (
            <p className="mt-2 text-xs text-red-600">{(explore.error as Error).message}</p>
          )}
          {explore.data && (
            <>
              <ul className="mt-2 text-[11px] text-gray-600">
                {explore.data.summary.map((line) => (
                  <li key={line} className="font-mono">
                    {line}
                  </li>
                ))}
              </ul>
              <textarea
                readOnly
                onFocus={(e) => e.target.select()}
                value={JSON.stringify(explore.data.probes, null, 2)}
                className="mt-2 h-48 w-full rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[10px]"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Click the box, copy, and paste it back to me.
              </p>
            </>
          )}
        </TechnicalDetails>
      )}
    </div>
  )
}
