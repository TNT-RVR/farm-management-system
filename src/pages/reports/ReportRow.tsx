import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ArrowUpRight, Download, Loader2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { downloadCsv } from '@/hooks/useExport'
import { useCropYear } from '@/lib/crop-year'
import { useBins } from '@/lib/bins'
import { useCrops, useFields } from '@/lib/queries'
import { useRanches } from '@/lib/ranches'
import { downloadBlob, tableReportToPdf } from '@/lib/table-report'
import { initialParams, isFile, reportCsv, reportTable, rowCount, type GatherContext, type LookupKey, type Made, type ParamSpec, type ParamValues } from '@/lib/reports/framework'
import type { BuiltReport, OpenReport, ReportFormat, SourceLink } from '@/lib/reports/catalogue'
import { GATHERERS, type HookRun } from './gatherers'
import { LOOKUP_LISTS } from './lookups'
import { cn } from '@/lib/utils'

/**
 * One report as one row: a white card with a green edge, the name and one
 * line of what is in it, then a link to the page its data comes from and
 * Download. Download opens a dialog for the rest — file type, year, field,
 * crop, dates, whatever this report asks for — and makes the file from
 * there. The choices stay as set for the visit; the file type is remembered
 * per report on this device.
 */

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Make the file: the PDF through the branded layout, the CSV as one flat
 * table, and a file the report made in its own shape (a ZIP, Markdown) as it is.
 */
async function deliver(g: Made, format: ReportFormat) {
  if (isFile(g)) return downloadBlob(g.blob, g.filename)
  if (!rowCount(g)) throw new Error('Nothing to put in it.')
  if (format === 'CSV') downloadCsv(reportCsv(g), g.filename)
  else downloadBlob(await tableReportToPdf(reportTable(g)), `${g.filename}.pdf`)
}

function useRemembered(id: string, formats: ReportFormat[]): [ReportFormat, (f: ReportFormat) => void] {
  const key = `reports:format:${id}`
  const [format, setFormat] = useState<ReportFormat>(() => {
    try {
      const saved = localStorage.getItem(key) as ReportFormat | null
      if (saved && formats.includes(saved)) return saved
    } catch {
      /* private window */
    }
    return formats[0]
  })
  const choose = (f: ReportFormat) => {
    setFormat(f)
    try {
      localStorage.setItem(key, f)
    } catch {
      /* private window: remembered for this visit only */
    }
  }
  return [format, choose]
}

/* ── Pickers ────────────────────────────────────────────────────────────── */

function useLookup(key: LookupKey) {
  return useQuery({ queryKey: ['report_lookup', key], staleTime: 10 * 60_000, queryFn: LOOKUP_LISTS[key] })
}

type PickProps = { value: string; onChange: (v: string) => void }
type Opt = { value: string; label: string }

function Sel({ value, onChange, options, label, placeholder }: PickProps & { options: Opt[]; label: string; placeholder?: string }) {
  return <Select value={value} onChange={onChange} className="w-full" ariaLabel={label} placeholder={placeholder ?? label} options={options} />
}
const allOf = (allLabel?: string): Opt[] => (allLabel ? [{ value: '', label: allLabel }] : [])

/** What a picker is called in the dialog. */
function labelOf(spec: ParamSpec): string {
  switch (spec.kind) {
    case 'year':
      return spec.label ?? 'Crop year'
    case 'field':
      return spec.label ?? 'Field'
    case 'crop':
      return spec.label ?? 'Crop'
    case 'ranch':
      return spec.label ?? 'Ranch'
    case 'bin':
      return spec.label ?? 'Bin'
    default:
      return spec.label
  }
}

// One component per list, so a dialog only loads the lists it asks for.
function FieldPick({ spec, ...p }: PickProps & { spec: Extract<ParamSpec, { kind: 'field' }> }) {
  const { data } = useFields()
  return <Sel {...p} label={labelOf(spec)} placeholder={data ? 'Field' : 'Loading…'} options={[...allOf(spec.allLabel), ...(data ?? []).map((f) => ({ value: f.id, label: f.name }))]} />
}
function CropPick({ spec, ...p }: PickProps & { spec: Extract<ParamSpec, { kind: 'crop' }> }) {
  const { data } = useCrops()
  return <Sel {...p} label={labelOf(spec)} options={[...allOf(spec.allLabel), ...(data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
}
function RanchPick({ spec, ...p }: PickProps & { spec: Extract<ParamSpec, { kind: 'ranch' }> }) {
  const { data } = useRanches()
  return <Sel {...p} label={labelOf(spec)} options={[...allOf(spec.allLabel), ...(data ?? []).map((r) => ({ value: r.id, label: r.name }))]} />
}
/** A bin report needs a bin: the first one, until another is chosen. */
function BinPick({ spec, value, onChange }: PickProps & { spec: Extract<ParamSpec, { kind: 'bin' }> }) {
  const { data } = useBins()
  const bins = useMemo(() => (data ?? []).filter((b) => b.active), [data])
  useEffect(() => {
    if (!value && bins[0]) onChange(bins[0].id)
  }, [value, bins, onChange])
  return (
    <Sel
      value={value}
      onChange={onChange}
      label={labelOf(spec)}
      placeholder={data ? 'No bins' : 'Loading…'}
      options={bins.map((b) => ({ value: b.id, label: b.site ? `${b.name} · ${b.site}` : b.name }))}
    />
  )
}
/** A list from the database; one that must be chosen starts on its first entry, as a bin does. */
function LookupPick({ spec, value, onChange }: PickProps & { spec: Extract<ParamSpec, { kind: 'lookup' }> }) {
  const lookup = useLookup(spec.lookup)
  const first = spec.allLabel == null ? lookup.data?.[0]?.value : undefined
  useEffect(() => {
    if (!value && first) onChange(first)
  }, [value, first, onChange])
  return (
    <Sel
      value={value}
      onChange={onChange}
      label={spec.label}
      placeholder={!lookup.data ? 'Loading…' : lookup.data.length ? spec.label : `No ${spec.label.toLowerCase()}s yet`}
      options={[...allOf(spec.allLabel), ...(lookup.data ?? [])]}
    />
  )
}
function YearPick({ spec, ...p }: PickProps & { spec: Extract<ParamSpec, { kind: 'year' }> }) {
  const { cropYear } = useCropYear()
  const years = Array.from({ length: 8 }, (_, i) => cropYear + 1 - i)
  return <Sel {...p} label={labelOf(spec)} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
}

function Picker({ spec, value, onChange }: { spec: ParamSpec } & PickProps) {
  const p = { value, onChange }
  switch (spec.kind) {
    case 'year':
      return <YearPick spec={spec} {...p} />
    case 'field':
      return <FieldPick spec={spec} {...p} />
    case 'crop':
      return <CropPick spec={spec} {...p} />
    case 'ranch':
      return <RanchPick spec={spec} {...p} />
    case 'bin':
      return <BinPick spec={spec} {...p} />
    case 'lookup':
      return <LookupPick spec={spec} {...p} />
    case 'choice':
      return <Sel {...p} label={spec.label} options={spec.options} />
    case 'date':
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={spec.label}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
        />
      )
  }
}

/* ── Pieces shared by both kinds of row ────────────────────────────────── */

function SourceButton({ from }: { from: SourceLink }) {
  return (
    <Link
      to={from.to}
      title={`Open ${from.label}, where this comes from`}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-800"
    >
      {from.label} <ArrowUpRight className="h-3 w-3" />
    </Link>
  )
}

function DownloadButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {busy ? 'Making…' : 'Download'}
    </button>
  )
}

function FormatToggle({ formats, value, onChange }: { formats: ReportFormat[]; value: ReportFormat; onChange: (f: ReportFormat) => void }) {
  if (formats.length < 2) return <span className="inline-block rounded border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600">{formats[0]}</span>
  return (
    <span role="radiogroup" aria-label="File type" className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm">
      {formats.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          onClick={() => onChange(f)}
          className={cn('rounded px-3 py-1 font-semibold', value === f ? 'bg-brand-700 text-white' : 'text-gray-500 hover:bg-gray-50')}
        >
          {f}
        </button>
      ))}
    </span>
  )
}

/** One labelled line in the dialog. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </div>
  )
}

function RowShell({ name, what, tone, children }: { name: string; what: string; tone: 'build' | 'open'; children: React.ReactNode }) {
  return (
    <li className={cn('rounded-lg border border-l-4 border-gray-200 bg-white px-3 py-2', tone === 'build' ? 'border-l-brand-600' : 'border-l-sky-400')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          <p className="truncate text-xs text-gray-500" title={what}>
            {what}
          </p>
        </div>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
    </li>
  )
}

/* ── A report made here ─────────────────────────────────────────────────── */

/** Mounted only while a hook-gathered report is being made; builds once its data is in. */
export function HookRunner({ useRun, params, ctx, onReady }: { useRun: HookRun; params: ParamValues; ctx: GatherContext; onReady: (g: Promise<Made>) => void }) {
  const r = useRun(params, ctx)
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    if (r.error) {
      fired.current = true
      onReady(Promise.reject(r.error))
    } else if (r.ready) {
      fired.current = true
      onReady(Promise.resolve().then(r.build))
    }
  })
  return null
}

export function BuiltRow({ r, ctx, autoOpen = false }: { r: BuiltReport; ctx: GatherContext; autoOpen?: boolean }) {
  const { cropYear } = useCropYear()
  const [params, setParams] = useState<ParamValues>(() => initialParams(r.params, cropYear, ctx.today))
  const [format, setFormat] = useRemembered(r.id, r.formats)
  const [open, setOpen] = useState(autoOpen)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hookRun, setHookRun] = useState(0)
  const gatherer = GATHERERS[r.id]
  const setParam = useCallback((key: string, v: string) => setParams((p) => ({ ...p, [key]: v })), [])

  // The gather is told which file is wanted: most ignore it, a few make a
  // different cut (or a ZIP) for it.
  const runCtx = useMemo(() => ({ ...ctx, format }), [ctx, format])

  // Made: the dialog closes. Failed: it stays open with the reason.
  const settle = (job: Promise<unknown>) =>
    job
      .then(
        () => {
          setError(null)
          setOpen(false)
        },
        (e: unknown) => setError(messageOf(e)),
      )
      .finally(() => {
        setBusy(false)
        setHookRun(0)
      })

  const start = () => {
    setError(null)
    setBusy(true)
    if (format === 'XLSX' && 'run' in gatherer && gatherer.xlsx) {
      void settle(gatherer.xlsx(params, ctx).then(({ blob, filename }) => downloadBlob(blob, filename)))
      return
    }
    if ('run' in gatherer) void settle(gatherer.run(params, runCtx).then((g) => deliver(g, format)))
    else setHookRun((n) => n + 1)
  }

  return (
    <RowShell name={r.name} what={r.what} tone="build">
      <SourceButton from={r.from} />
      <DownloadButton
        busy={busy}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      />
      {open && (
        <Modal title={r.name} onClose={() => !busy && setOpen(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-500">{r.what}</p>
            <Line label="File type">
              <div>
                <FormatToggle formats={r.formats} value={format} onChange={setFormat} />
              </div>
            </Line>
            {r.params.map((s) => (
              <Line key={s.key} label={labelOf(s)}>
                <Picker spec={s} value={params[s.key] ?? ''} onChange={(v) => setParam(s.key, v)} />
              </Line>
            ))}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={start}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {busy ? 'Making…' : `Download ${format}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {hookRun > 0 && 'useRun' in gatherer && (
        <HookRunner key={hookRun} useRun={gatherer.useRun} params={params} ctx={runCtx} onReady={(j) => void settle(j.then((g) => deliver(g, format)))} />
      )}
    </RowShell>
  )
}

/* ── A report made on its own page ──────────────────────────────────────── */

export function OpenRow({ r, autoOpen = false }: { r: OpenReport; autoOpen?: boolean }) {
  const navigate = useNavigate()
  const { data: fields } = useFields()
  const [open, setOpen] = useState(autoOpen)
  const [fieldId, setFieldId] = useState('')
  const field = fieldId || fields?.[0]?.id || ''
  const to = r.pickField && field ? `${r.to}${r.to.includes('?') ? '&' : '?'}field=${field}` : r.to
  return (
    <RowShell name={r.name} what={r.what} tone="open">
      <SourceButton from={r.from} />
      <DownloadButton onClick={() => setOpen(true)} />
      {open && (
        <Modal title={r.name} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-500">
              {r.what} {r.why}
            </p>
            <Line label="File type">
              <div>
                <FormatToggle formats={r.formats} value={r.formats[0]} onChange={() => {}} />
              </div>
            </Line>
            {r.pickField && (
              <Line label="Field">
                <Select
                  value={field}
                  onChange={setFieldId}
                  className="w-full"
                  ariaLabel="Field"
                  placeholder={fields ? 'No fields' : 'Loading…'}
                  options={(fields ?? []).map((f) => ({ value: f.id, label: f.name }))}
                />
              </Line>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => navigate(to)}
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
              >
                Open to download <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </RowShell>
  )
}
