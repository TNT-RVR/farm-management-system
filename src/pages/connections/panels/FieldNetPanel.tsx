import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Select } from '@/components/Select'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { useFields } from '@/lib/queries'
import { useIntegrations } from '@/lib/integrations'
import {
  fieldnetConnect,
  fieldnetMotion,
  fnStatus,
  useFieldnetCapabilities,
  useFieldnetProbe,
  useFieldnetSync,
  useFieldnetSystems,
  useSetFieldnetLink,
  FN_STATUS_COLOR,
  FN_STATUS_LABEL,
  type FieldnetSystem,
} from '@/lib/fieldnet'
import { cn } from '@/lib/utils'
import { OAuthBanner } from './OAuthBanner'
import { syncedAt } from './format'

// One-click test of whether the FieldNET panel PATCH will accept direction /
// speed / auto-stop angle. Sends only type-invalid values, so it cannot start,
// stop, turn or re-aim anything — see the PROBES table in fieldnet-control.mts.
function FieldNetControlProbe({ systems }: { systems: FieldnetSystem[] }) {
  const probe = useFieldnetProbe()
  const [pivot, setPivot] = useState('')
  const options = useMemo(
    () => [
      { value: '', label: '— choose a pivot —' },
      ...systems.map((s) => ({
        value: s.fieldnet_id,
        label: `${s.name ?? s.fieldnet_id}${s.operational_status ? ` (${s.operational_status})` : ''}`,
      })),
    ],
    [systems],
  )
  const writable = probe.data?.verdict.filter((v) => v.differsFromUnknownField) ?? []

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-xs font-medium text-amber-900">Test control capability</p>
      <p className="mt-0.5 text-[11px] text-amber-800">
        Checks whether FieldNET will accept direction, speed and auto-stop angle on a panel. It
        sends deliberately invalid values, so it cannot move a pivot — it only reads back how the
        API objects. Pick a stopped pivot if you have one.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          value={pivot}
          ariaLabel="Pivot to probe"
          size="sm"
          className="w-56"
          onChange={setPivot}
          options={options}
        />
        <button
          onClick={() => probe.mutate(pivot)}
          disabled={!pivot || probe.isPending}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {probe.isPending ? 'Testing…' : 'Run test'}
        </button>
      </div>

      {probe.isError && (
        <p className="mt-2 text-xs text-red-600">{(probe.error as Error).message}</p>
      )}

      {probe.data && (
        <div className="mt-2 text-[11px] text-amber-900">
          <p className="font-medium">
            {writable.length > 0
              ? `${writable.length} field(s) look writable — control may be possible.`
              : 'No field was recognised. The panel PATCH really does accept the note only.'}
          </p>
          <ul className="mt-1 space-y-0.5">
            {probe.data.verdict.map((v) => (
              <li key={v.field}>
                <span className={cn('font-mono', v.differsFromUnknownField && 'font-semibold')}>
                  {v.field}
                </span>{' '}
                <span className="text-amber-700">
                  — {v.why} · HTTP {v.status} ·{' '}
                  {v.differsFromUnknownField ? 'recognised' : 'not recognised'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-amber-700">{probe.data.note}</p>
        </div>
      )}
    </div>
  )
}

// Live view of what Lindsay has granted the app. Read from FieldNET rather than
// hardcoded, because the granted set only ever changes on their side.
function FieldNetCapabilities() {
  const { data, isLoading, error } = useFieldnetCapabilities(true)
  const [open, setOpen] = useState(false)

  if (isLoading) return null
  if (error) {
    return (
      <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        Could not read FieldNET permissions: {(error as Error).message}
      </p>
    )
  }
  if (!data) return null

  const missing = [
    !data.capabilities.advisor && 'Advisor soil-moisture model',
    !data.capabilities.satelliteImagery && 'satellite imagery',
  ].filter(Boolean) as string[]

  return (
    <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-medium text-gray-600 hover:text-gray-900"
      >
        API permissions ({data.policies.length} granted) {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5">
          {data.policies.map((p) => (
            <li key={p.policy}>
              <span className="font-mono text-gray-700">{p.policy}</span>
              {p.grants && <span className="text-gray-400"> — {p.grants}</span>}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <p className="mt-1.5">
          Not granted: {missing.join(', ')} — ask Lindsay for the advisor-* policies.
        </p>
      )}
      <p className="mt-1.5 text-gray-400">
        {data.capabilities.remoteStartStop ? 'Pivot control: ' : 'Pivot control blocked: '}
        {data.remoteControlNote}
      </p>
    </div>
  )
}

/**
 * FieldNET: sign in, sync, and which field each pivot waters. Moved from the
 * old Integrations card; a field's "Link a FieldNET pivot" opens it with
 * ?field=<id> and the note says which field to pick.
 */
export function FieldNetPanel() {
  const { data: integrations } = useIntegrations()
  const fn = integrations?.find((i) => i.provider === 'fieldnet')
  const { data: systems } = useFieldnetSystems()
  const { data: fields } = useFields()
  const setLink = useSetFieldnetLink()
  const sync = useFieldnetSync()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)
  // From a field's "Link a FieldNET pivot": say which field.
  const forField = (fields ?? []).find((f) => f.id === params.get('field'))
  // Treat as connected if the status says so OR pivots have synced — the status
  // view occasionally lags, and the synced pivot list is proof we're linked.
  const connected = fn?.status === 'connected' || (systems?.length ?? 0) > 0
  const fieldOptions = useMemo(
    () => [
      { value: '', label: '— link field —' },
      ...(fields ?? []).map((f) => ({ value: f.id, label: f.name })),
    ],
    [fields],
  )

  const banner = params.get('fieldnet_connected')
    ? { ok: true, msg: 'FieldNET connected.' }
    : params.get('fieldnet_error')
      ? { ok: false, msg: `Connect failed: ${params.get('fieldnet_error')}` }
      : null

  return (
    <div>
      <OAuthBanner banner={banner} />

      {connected && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Organization</dt>
            <dd className="font-medium">{fn?.external_org_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Last sync</dt>
            <dd className="font-medium">{syncedAt(fn?.last_sync_at)}</dd>
          </div>
        </dl>
      )}

      {forField && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {connected
            ? <>Pick <b>{forField.name}</b> beside the pivot that waters it.</>
            : <>Connect FieldNET first, then pick <b>{forField.name}</b> beside the pivot that waters it.</>}
        </p>
      )}
      {connected && (systems?.length ?? 0) > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-100">
          {systems!.map((s) => {
            const st = fnStatus(s)
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: FN_STATUS_COLOR[st] }}
                  title={FN_STATUS_LABEL[st]}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-800">
                  {s.name ?? s.fieldnet_id}
                  <span className="ml-1.5 text-xs font-normal text-gray-400">
                    {fieldnetMotion(s)}
                  </span>
                </span>
                <Select
                  value={s.field_id ?? ''}
                  ariaLabel={`Field for ${s.name ?? 'pivot'}`}
                  size="sm"
                  className="w-40"
                  onChange={(v) => setLink.mutate({ id: s.id, field_id: v || null })}
                  options={fieldOptions}
                />
              </li>
            )
          })}
        </ul>
      )}

      {fn?.last_error && <p className="mt-2 text-xs text-red-600">{fn.last_error}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {connected && (
          <button
            onClick={() => sync.mutate()}
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
              window.location.href = await fieldnetConnect()
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium',
            connected ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-brand-700 text-white hover:bg-brand-800',
          )}
        >
          {connected ? 'Reconnect' : 'Connect FieldNET'}
        </button>
        <a
          href="https://v2.api.myfieldnet.com/manage-applications"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
        >
          Manage app <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {sync.isSuccess && (
        <p className="mt-2 text-xs text-green-700">
          Synced {(sync.data as { systems: number }).systems} systems,{' '}
          {(sync.data as { controllers: number }).controllers} controllers,{' '}
          {(sync.data as { appliedWritten: number }).appliedWritten} applied-irrigation records.
        </p>
      )}
      {sync.isError && <p className="mt-2 text-xs text-red-600">{(sync.error as Error).message}</p>}
      {/* The control probe and the granted-policy list are for whoever is
          chasing Lindsay for permissions, not for the people watching pivots. */}
      {connected && (
        <TechnicalDetails title="Advanced" className="mt-3">
          <FieldNetControlProbe systems={systems ?? []} />
          <FieldNetCapabilities />
        </TechnicalDetails>
      )}
    </div>
  )
}
