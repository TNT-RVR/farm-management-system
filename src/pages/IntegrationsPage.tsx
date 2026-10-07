import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, Upload } from 'lucide-react'
import { Select } from '@/components/Select'
import { canSeeFinances, hasManagerAccess, useAuth } from '@/lib/auth'
import { useBrand } from '@/lib/farm-setup'
import { quickbooksConnect, useQbCompany, useQbDisconnect, useQbSync } from '@/lib/quickbooks'
import { useCropYear } from '@/lib/crop-year'
import { supabase } from '@/lib/supabase'
import { useCrops, useFields } from '@/lib/queries'
import { useBins } from '@/lib/bins'
import {
  jdConnect,
  useAddBinReading,
  useIntegrations,
  useJdExplore,
  useJdOrgs,
  useJdSync,
  useSetJdOrg,
} from '@/lib/integrations'
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
import { useSyncFieldOperations } from '@/lib/fieldOps'
import { parseCsv } from '@/lib/csv'
import { HealthPanel } from '@/pages/integrations/HealthPanel'
import { PlcCard } from '@/pages/integrations/PlcCard'
import { cn } from '@/lib/utils'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { AppIssuesCard } from '@/pages/integrations/AppIssuesCard'

/** "14 Sept, 2:42 p.m." or "never" — the last-sync half of a status line. */
const syncedAt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-CA') : 'never'

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
        ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500',
      )}
    >
      {label}
    </span>
  )
}

/**
 * One integration as one line: name, status, last sync and its Sync button,
 * folded over everything else. The tab used to stack every card open, so the
 * question people came with — is it connected, when did it last sync — was
 * answered five times over a page of setup text.
 *
 * `attention` opens it: an OAuth result, an error, or a step still to do must
 * not hide behind a fold. It is also the key, so a problem that arrives after
 * the page loaded opens the section rather than waiting for a tap.
 */
function IntegrationFold({
  title,
  status,
  summary,
  actions,
  attention = false,
  open = false,
  children,
}: {
  title: React.ReactNode
  status?: React.ReactNode
  summary?: React.ReactNode
  actions?: React.ReactNode
  attention?: boolean
  /** Opened by a link (?open=<card>) from somewhere that needs it set up. */
  open?: boolean
  children: React.ReactNode
}) {
  return (
    <Fold
      key={attention || open ? 'attention' : 'calm'}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {status}
        </span>
      }
      summary={summary}
      actions={actions}
      defaultOpen={attention || open}
    >
      {children}
    </Fold>
  )
}

/** A card a setup link asked for (?open=<card>): opened, and scrolled into view. */
function useOpenedBy(card: string) {
  const [params] = useSearchParams()
  const opened = params.get('open') === card
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (opened) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [opened])
  return [opened, ref] as const
}

function JohnDeereCard() {
  const { data: integrations } = useIntegrations()
  const jd = integrations?.find((i) => i.provider === 'john_deere')
  const sync = useJdSync()
  const [params] = useSearchParams()
  const [opened, cardRef] = useOpenedBy('deere')
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

  const attention = Boolean(
    banner || needsOrgAccess || jd?.last_error || err || sync.isError || syncOps.isError,
  )

  return (
    <div ref={cardRef} className="scroll-mt-4">
    <IntegrationFold
      open={opened}
      title="John Deere Operations Center"
      status={<StatusPill ok={connected} label={jd?.status ?? 'disconnected'} />}
      summary={linked ? `last sync ${syncedAt(jd?.last_sync_at)}` : undefined}
      attention={attention}
      actions={
        linked && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} /> Sync now
          </button>
        )
      }
    >
      <HelpNote
        title="John Deere Operations Center"
        summary="One-way sync of fields and boundaries."
      >
        <p>
          One-way sync of fields &amp; boundaries. Harvest → crop history via CSV import below until
          the field-operations mapping is confirmed on a live org.
        </p>
      </HelpNote>

      {banner && (
        <p
          className={cn(
            'mt-3 rounded-md px-3 py-2 text-xs',
            banner.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700',
          )}
        >
          {banner.msg}
        </p>
      )}

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
        <button
          onClick={async () => {
            setErr(null)
            try {
              window.location.href = await jdConnect()
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {linked ? 'Reconnect' : 'Connect John Deere'}
        </button>
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
    </IntegrationFold>
    </div>
  )
}

function CropHistoryImportCard() {
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<string | null>(null)

  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const rows = parseCsv(await file.text())
      const fieldByName = new Map((fields ?? []).map((f) => [f.name.toLowerCase(), f.id]))
      const fieldByFah = new Map(
        (fields ?? [])
          .filter((f) => f.fah_field_id != null)
          .map((f) => [String(f.fah_field_id), f.id]),
      )
      const cropByName = new Map((crops ?? []).map((c) => [c.name.toLowerCase(), c.id]))
      const inserts: {
        crop_year: number
        field_id: string
        crop_id: string
        variety: string | null
        acres: number | null
        yield_per_acre: number | null
        actual_yield_total: number | null
        source: 'jd_import'
      }[] = []
      const errors: string[] = []
      rows.forEach((r, i) => {
        const fieldId =
          fieldByName.get((r.field ?? '').toLowerCase()) ??
          fieldByFah.get(r.field ?? r.fah_field_id ?? '')
        const cropId = cropByName.get((r.crop ?? '').toLowerCase())
        const year = Number(r.crop_year ?? r.year)
        if (!year || !fieldId || !cropId) {
          errors.push(
            `Row ${i + 2}: ${!year ? 'bad year' : !fieldId ? `unknown field "${r.field}"` : `unknown crop "${r.crop}"`}`,
          )
          return
        }
        inserts.push({
          crop_year: year,
          field_id: fieldId,
          crop_id: cropId,
          variety: r.variety || null,
          acres: r.acres ? Number(r.acres) : null,
          yield_per_acre: r.yield_per_acre ? Number(r.yield_per_acre) : null,
          actual_yield_total: r.actual_yield_total ? Number(r.actual_yield_total) : null,
          source: 'jd_import',
        })
      })
      if (inserts.length) {
        const { error } = await supabase
          .from('crop_history')
          .upsert(inserts, { onConflict: 'crop_year,field_id' })
        if (error) throw error
      }
      return { imported: inserts.length, errors }
    },
    onSuccess: (r) => {
      setReport(
        `Imported ${r.imported} rows.` +
          (r.errors.length
            ? ` Skipped ${r.errors.length}: ${r.errors.slice(0, 3).join('; ')}`
            : ''),
      )
      void queryClient.invalidateQueries({ queryKey: ['crop_history'] })
    },
    onError: (e) => setReport(`Failed: ${(e as Error).message}`),
  })

  return (
    <IntegrationFold
      title="Crop history import (CSV)"
      summary="manual import"
      attention={Boolean(report)}
    >
      <HelpNote title="Crop history CSV" summary="A John Deere harvest export or any spreadsheet.">
        <p>
          Columns:{' '}
          <code>crop_year, field, crop, variety, acres, yield_per_acre, actual_yield_total</code>.
          Field matches by name or Farm-at-Hand id; crop by name. Works for a John Deere harvest
          export or any spreadsheet.
        </p>
      </HelpNote>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={importCsv.isPending}
        className="mt-3 flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        <Upload className="h-4 w-4" /> {importCsv.isPending ? 'Importing…' : 'Choose CSV'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importCsv.mutate(f)
          e.target.value = ''
        }}
      />
      {report && <p className="mt-2 text-xs text-gray-600">{report}</p>}
    </IntegrationFold>
  )
}

function BinSenseCard() {
  const { data: bins } = useBins()
  const addReading = useAddBinReading()
  const inputRef = useRef<HTMLInputElement>(null)
  const [manual, setManual] = useState({ bin_id: '', moisture: '', temp: '' })
  const [report, setReport] = useState<string | null>(null)
  const activeBins = useMemo(() => (bins ?? []).filter((b) => b.active), [bins])

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text())
    const byName = new Map(activeBins.map((b) => [b.name.toLowerCase(), b.id]))
    const inserts = rows
      .map((r) => {
        const binId = byName.get((r.bin ?? r.bin_name ?? '').toLowerCase())
        if (!binId) return null
        return {
          bin_id: binId,
          moisture_pct: r.moisture ? Number(r.moisture) : null,
          temp_c: (r.temp_c ?? r.temp) ? Number(r.temp_c ?? r.temp) : null,
          source: 'binsense_csv',
        }
      })
      .filter(Boolean) as Parameters<typeof addReading.mutate>[0]
    if (inserts.length) addReading.mutate(inserts)
    setReport(`Imported ${inserts.length} of ${rows.length} readings.`)
  }

  return (
    <IntegrationFold
      title="BinSense readings (CSV / manual)"
      summary="manual import"
      attention={Boolean(report)}
    >
      <HelpNote title="BinSense readings" summary="Import by CSV or log a reading by hand.">
        <p>
          BinSense’s API is partner-gated — import readings by CSV (columns{' '}
          <code>bin, moisture, temp</code>) or log one manually. The bin estimator works without
          this.
        </p>
      </HelpNote>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">
          Bin
          <Select
            value={manual.bin_id}
            ariaLabel="Bin"
            className="mt-1"
            onChange={(v) => setManual((m) => ({ ...m, bin_id: v }))}
            options={[
              { value: '', label: '—' },
              ...activeBins.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Moisture %
          <input
            type="number"
            step="0.1"
            value={manual.moisture}
            onChange={(e) => setManual((m) => ({ ...m, moisture: e.target.value }))}
            className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Temp °C
          <input
            type="number"
            step="0.1"
            value={manual.temp}
            onChange={(e) => setManual((m) => ({ ...m, temp: e.target.value }))}
            className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => {
            if (!manual.bin_id) return
            addReading.mutate(
              [
                {
                  bin_id: manual.bin_id,
                  moisture_pct: manual.moisture ? Number(manual.moisture) : null,
                  temp_c: manual.temp ? Number(manual.temp) : null,
                  source: 'manual',
                },
              ],
              { onSuccess: () => setManual({ bin_id: '', moisture: '', temp: '' }) },
            )
          }}
          disabled={!manual.bin_id || addReading.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Log reading
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload className="h-4 w-4" /> Import CSV
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importCsv(f)
            e.target.value = ''
          }}
        />
      </div>
      {report && <p className="mt-2 text-xs text-gray-600">{report}</p>}
    </IntegrationFold>
  )
}

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

function FieldNetCard() {
  const { data: integrations } = useIntegrations()
  const fn = integrations?.find((i) => i.provider === 'fieldnet')
  const { data: systems } = useFieldnetSystems()
  const { data: fields } = useFields()
  const setLink = useSetFieldnetLink()
  const sync = useFieldnetSync()
  const [params] = useSearchParams()
  const [err, setErr] = useState<string | null>(null)
  // From a field's "Link a FieldNET pivot": open here, and say which field.
  const linking = params.get('open') === 'fieldnet'
  const forField = linking ? (fields ?? []).find((f) => f.id === params.get('field')) : undefined
  const card = useRef<HTMLDivElement>(null)
  // Once the pivots are in: the cards above load too, and an earlier scroll lands short.
  const loaded = Boolean(systems && integrations)
  useEffect(() => {
    if (linking && loaded) card.current?.scrollIntoView({ block: 'start' })
  }, [linking, loaded])
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
    <div ref={card} className="scroll-mt-4">
    <IntegrationFold
      open={linking}
      title="FieldNET (Lindsay)"
      status={
        <StatusPill
          ok={connected}
          label={connected ? 'connected' : (fn?.status ?? 'disconnected')}
        />
      }
      summary={connected ? `last sync ${syncedAt(fn?.last_sync_at)}` : undefined}
      attention={Boolean(banner || fn?.last_error || err || sync.isError)}
      actions={
        connected && (
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} /> Sync now
          </button>
        )
      }
    >
      <HelpNote
        title="FieldNET (Lindsay)"
        summary="Live pivot status, positions and as-applied irrigation."
      >
        <p>
          Live pivot status &amp; positions and as-applied irrigation via the FieldNET v2 API. Pivot
          control is built but unauthorized — it needs the equipment-configure policy from Lindsay.
        </p>
      </HelpNote>

      {banner && (
        <p
          className={cn(
            'mt-3 rounded-md px-3 py-2 text-xs',
            banner.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700',
          )}
        >
          {banner.msg}
        </p>
      )}

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
        <button
          onClick={async () => {
            setErr(null)
            try {
              window.location.href = await fieldnetConnect()
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
    </IntegrationFold>
    </div>
  )
}

/**
 * The integrations body, rendered as the Integrations tab of Settings. There is
 * no standalone page: /integrations is routed to that tab in App.tsx, because
 * the OAuth callbacks redirect to /integrations?jd_connected=1.
 */
export function IntegrationsPanel() {
  const { profile } = useAuth()
  useCropYear()
  if (!hasManagerAccess(profile?.role)) {
    return <div className="p-6 text-sm text-gray-500">Only managers can manage integrations.</div>
  }
  return (
    <div className="p-4 md:p-6">
      <div className="flex max-w-3xl flex-col gap-3">
        <AppIssuesCard />
        <HealthPanel isManager />
        <JohnDeereCard />
        <CropHistoryImportCard />
        <BinSenseCard />
        <FieldNetCard />
        <PlcCard isManager />
        <QuickBooksCard />
      </div>
    </div>
  )
}

/**
 * QuickBooks Online: connect, sync, disconnect. Owners and finance access only
 * (the functions refuse anyone else); everybody else sees the status line.
 */
function QuickBooksCard() {
  const { profile } = useAuth()
  const brand = useBrand()
  const finances = canSeeFinances(profile)
  const { data: company } = useQbCompany()
  const sync = useQbSync()
  const disconnect = useQbDisconnect()
  const [params] = useSearchParams()
  const [opened, cardRef] = useOpenedBy('quickbooks')
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

  return (
    <div ref={cardRef} className="scroll-mt-4">
    <IntegrationFold
      open={opened}
      title="QuickBooks Online"
      status={<StatusPill ok={connected} label={connected ? `connected · ${env}` : (company?.status ?? 'disconnected')} />}
      summary={connected ? `last sync ${syncedAt(company?.last_sync_at)}` : undefined}
      attention={Boolean(banner || company?.last_error || err || sync.isError)}
      actions={
        connected &&
        finances && (
          <button
            onClick={() => sync.mutate(false)}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} /> Sync now
          </button>
        )
      }
    >
      <HelpNote title="QuickBooks Online" summary="Bills, expenses, invoices and their PDFs, read nightly. Never writes to the books.">
        <p>
          The production Client ID and secret go under Settings → Farm setup → Connections, with the Connect button beside them. Owners and finance users
          only. <SetupLink adminOnly to={SETUP_LINKS.farmSetup('connections')}>Open Connections</SetupLink>
        </p>
        {brand.supportEmail && (
          <p>
            Problems with the connection:{' '}
            <a className="text-brand-700 underline" href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent('QuickBooks connection')}`}>
              {brand.supportEmail}
            </a>
            . The error shown here includes Intuit&apos;s reference (intuit_tid) to pass on to QuickBooks support.
          </p>
        )}
      </HelpNote>
      {banner && (
        <p className={cn('mt-3 rounded-md px-3 py-2 text-xs', banner.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>{banner.msg}</p>
      )}
      {connected && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">Company</dt>
            <dd className="font-medium">{company?.company_name ?? '—'}</dd>
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
      {finances ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={async () => {
              setErr(null)
              try {
                window.location.href = await quickbooksConnect()
              } catch (e) {
                setErr((e as Error).message)
              }
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
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
    </IntegrationFold>
    </div>
  )
}
