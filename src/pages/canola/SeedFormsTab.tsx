import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, PenLine, Plus, RefreshCw, Thermometer, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useCrops, useFields } from '@/lib/queries'
import { useBins, binNumber } from '@/lib/bins'
import { supabase } from '@/lib/supabase'
import { downloadBlob } from '@/lib/table-report'
import { useMySignature } from '@/lib/signature'
import { useBinMonitorReadings, useDeleteBinMonitor, useSaveBinMonitor, type MonitorRow } from '@/lib/bin-monitor-data'
import {
  blanksFromApp,
  suggestSeedReport,
  useDeleteSeedBin,
  useSaveSeedBin,
  useSaveSeedReport,
  useSeedFormFields,
  useSeedReport,
  useSignSeedReport,
  useStartSeedReport,
  type SeedField,
  type SeedReport,
  type SeedReportBin,
} from '@/lib/seed-forms/data'
import { growerBinLabel, longDate, nextCheck, type Position } from '@/lib/seed-forms/format'
import { formStyleFor, type FormStyle } from '@/lib/seed-forms/styles'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'

const input = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-50'
const btn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const primary = 'inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50'
const today = () => new Date().toLocaleDateString('en-CA')
const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))
const str = (v: unknown) => (v == null ? '' : String(v))
/** A field name safe in a file name. */
const safeName = (s: string) => s.replace(/[^\w\s.-]+/g, ' ').trim()

/**
 * The seed company forms (Sam, 19 Oct 2026), as two reports (20 Oct 2026):
 * a seed production report for a seed field, and a bin temperature monitoring
 * record for each bin it went into. The company's field number and codes, its
 * bin labels, moisture and seed temperature are typed here; the rest comes
 * from the app.
 *
 * Which form they print on follows the company (styles.ts): a company with
 * its own pages in the app (on the farm's own copy, its scanned pages) gets
 * those; any other company gets the generic form (24 Oct 2026), as not every
 * farm grows for the same companies.
 *
 * The field and crop year are kept in the address (?field=, ?year=), so the
 * two tabs stay on the same field. The seed fields come first, by company.
 */
function useSeedFieldChoice() {
  const { cropYear } = useCropYear()
  const [params, setParams] = useSearchParams()
  const year = Number(params.get('year')) || cropYear
  const fields = useFields()
  const seedFields = useSeedFormFields(year)
  const ours = useMemo(() => seedFields.data ?? new Map<string, SeedField>(), [seedFields.data])
  const fieldId = params.get('field') || [...ours.keys()][0] || null
  const fieldName = fields.data?.find((f) => f.id === fieldId)?.name ?? ''
  const put = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  const options = useMemo(() => {
    const all = fields.data ?? []
    const seed = all.filter((f) => ours.has(f.id)).sort((a, b) => ours.get(a.id)!.company.localeCompare(ours.get(b.id)!.company))
    return [
      ...seed.map((f) => ({ value: f.id, label: f.name, group: `${ours.get(f.id)!.company} seed in ${year}` })),
      ...all.filter((f) => !ours.has(f.id)).map((f) => ({ value: f.id, label: f.name, group: 'Other fields' })),
    ]
  }, [fields.data, ours, year])

  const picker = (
    <section className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <label className="text-xs text-gray-600">
        Field
        <Select value={fieldId ?? ''} onChange={(v) => put({ field: v || null })} options={options} placeholder="Pick a field" className="mt-1 w-72" ariaLabel="Field" />
      </label>
      <label className="text-xs text-gray-600">
        Crop year
        <Select
          value={String(year)}
          onChange={(v) => put({ year: v === String(cropYear) ? null : v, field: null })}
          options={[cropYear + 1, cropYear, cropYear - 1, cropYear - 2].map((y) => ({ value: String(y), label: String(y) }))}
          className="mt-1 w-28"
          ariaLabel="Crop year"
        />
      </label>
      {!seedFields.isLoading && ours.size === 0 && <span className="pb-2 text-xs text-gray-500">No field has contract seed canola planned for {year}.</span>}
    </section>
  )
  const seed = fieldId ? ours.get(fieldId) : undefined
  return { year, fieldId, fieldName, cropId: seed?.cropId ?? null, company: seed?.company ?? null, picker }
}

/** The seed production report for a seed field. */
export function SeedReportTab() {
  const c = useSeedFieldChoice()
  return (
    <div className="space-y-3">
      {c.picker}
      {c.fieldId && <FieldForms key={`${c.fieldId}:${c.year}`} fieldId={c.fieldId} fieldName={c.fieldName} year={c.year} company={c.company} />}
    </div>
  )
}

/** The bin temperature monitoring record for each bin the seed went into. */
export function BinTempsTab() {
  const c = useSeedFieldChoice()
  return (
    <div className="space-y-3">
      {c.picker}
      {c.fieldId && <FieldBinTemps key={`${c.fieldId}:${c.year}`} fieldId={c.fieldId} fieldName={c.fieldName} year={c.year} cropId={c.cropId} company={c.company} />}
    </div>
  )
}

function FieldForms({ fieldId, fieldName, year, company }: { fieldId: string; fieldName: string; year: number; company: string | null }) {
  const q = useSeedReport(fieldId, year, company)
  const start = useStartSeedReport()
  // A field with no contract company on its plan: the company is typed in.
  const [typed, setTyped] = useState('')
  const [preparing, setPreparing] = useState(false)
  if (q.isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>
  if (!q.data?.report) {
    const co = company ?? typed.trim()
    const begin = async () => {
      const style = formStyleFor(co)
      setPreparing(true)
      try {
        const grower = await style.defaultGrower().catch(() => null)
        start.mutate({ fieldId, year, company: co, grower, legalAs: style.legal })
      } finally {
        setPreparing(false)
      }
    }
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <span className="text-sm text-gray-700">
          No {company ?? 'seed'} report for {fieldName} in {year} yet.
        </span>
        {!company && (
          <label className="text-xs text-gray-600">
            Seed company
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Who the seed is grown for" className={`${input} w-56`} />
          </label>
        )}
        <button type="button" disabled={start.isPending || preparing || !co} onClick={() => void begin()} className={primary}>
          <Plus className="h-4 w-4" /> {start.isPending || preparing ? 'Filling in from the app…' : 'Start the report'}
        </button>
        {start.error && <span className="text-xs text-red-600">{(start.error as Error).message}</span>}
      </section>
    )
  }
  return <ReportEditor report={q.data.report} bins={q.data.bins} fieldName={fieldName} style={formStyleFor(q.data.report.company)} />
}

/** The bins come from the seed report: its bin table, the company's labels and shipped dates. */
function FieldBinTemps({ fieldId, fieldName, year, cropId, company }: { fieldId: string; fieldName: string; year: number; cropId: string | null; company: string | null }) {
  const q = useSeedReport(fieldId, year, company)
  if (q.isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>
  if (!q.data?.report || !q.data.bins.length) {
    const co = q.data?.report?.company ?? company ?? null
    const named = co ? `${co} seed report` : 'seed report'
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        {q.data?.report ? `No bins on the ${named} for ${fieldName} in ${year} yet.` : `No ${named} for ${fieldName} in ${year} yet.`} The
        bins come from it:{' '}
        <Link to={`/harvest-reports?tab=seed-report&field=${fieldId}&year=${year}`} className="font-medium text-brand-700 hover:underline">
          {q.data?.report ? 'add them on the seed report' : 'start the seed report'}
        </Link>
        .
      </section>
    )
  }
  return <BinTemps report={q.data.report} bins={q.data.bins} fieldName={fieldName} cropId={cropId} style={formStyleFor(q.data.report.company)} />
}

/* ── The report ────────────────────────────────────────────────────────── */

type Draft = {
  grower_name: string
  field_number: string
  spin_code: string
  legal_land: string
  gps_acres: string
  total_kg: string
  weight_method: SeedReport['weight_method']
  scale_certified: string
  storage: SeedReport['storage']
  storage_other: string
  harvest_completed_on: string
  weather: string
  acknowledged: boolean
}

const draftOf = (r: SeedReport): Draft => ({
  grower_name: str(r.grower_name),
  field_number: str(r.field_number),
  spin_code: str(r.spin_code),
  legal_land: str(r.legal_land),
  gps_acres: str(r.gps_acres),
  total_kg: str(r.total_kg),
  weight_method: r.weight_method,
  scale_certified: r.scale_certified == null ? '' : r.scale_certified ? 'yes' : 'no',
  storage: r.storage,
  storage_other: str(r.storage_other),
  harvest_completed_on: str(r.harvest_completed_on),
  weather: str(r.weather),
  acknowledged: r.acknowledged,
})

function ReportEditor({ report, bins, fieldName, style }: { report: SeedReport; bins: SeedReportBin[]; fieldName: string; style: FormStyle }) {
  const { profile } = useAuth()
  const save = useSaveSeedReport()
  const saveBin = useSaveSeedBin()
  const sign = useSignSeedReport()
  const mySig = useMySignature()
  const allBins = useBins()
  const [d, setD] = useState<Draft>(() => draftOf(report))
  const [filling, setFilling] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(report))

  const binName = (id: string | null) => allBins.data?.find((b) => b.id === id)?.name ?? ''
  const signerName = useQuery({
    queryKey: ['seed_forms', 'signer', report.signed_by],
    enabled: !!report.signed_by,
    queryFn: async () => (await supabase.from('users').select('full_name').eq('id', report.signed_by!).maybeSingle()).data?.full_name ?? null,
  })

  const saveDraft = () =>
    save.mutate({
      id: report.id,
      patch: {
        grower_name: d.grower_name.trim() || null,
        field_number: d.field_number.trim() || null,
        spin_code: d.spin_code.trim() || null,
        legal_land: d.legal_land.trim() || null,
        gps_acres: num(d.gps_acres),
        total_kg: num(d.total_kg),
        weight_method: d.weight_method,
        scale_certified: d.scale_certified === '' ? null : d.scale_certified === 'yes',
        storage: d.storage,
        storage_other: d.storage_other.trim() || null,
        harvest_completed_on: d.harvest_completed_on || null,
        weather: d.weather.trim() || null,
        acknowledged: d.acknowledged,
      },
    })

  const fillFromApp = async () => {
    setFilling('Looking through the app…')
    setError(null)
    try {
      const s = await suggestSeedReport(report.field_id, report.crop_year, style.legal)
      const { patch, newBins, binKg } = blanksFromApp(report, bins, s)
      if (Object.keys(patch).length) await save.mutateAsync({ id: report.id, patch })
      for (const b of newBins) await saveBin.mutateAsync({ report_id: report.id, patch: { bin_id: b.bin_id, quantity_kg: b.kg, sort: bins.length + newBins.indexOf(b) } })
      for (const b of binKg) await saveBin.mutateAsync({ id: b.id, report_id: report.id, patch: { quantity_kg: b.kg } })
      const filled = Object.keys(patch).length + newBins.length + binKg.length
      setFilling(filled ? `Filled ${filled} blank${filled === 1 ? '' : 's'}${s.harvestFrom ? ` (harvest date from the ${s.harvestFrom})` : ''}.` : 'Nothing new in the app to fill in.')
      setD((x) => ({
        ...x,
        legal_land: x.legal_land || str(patch.legal_land),
        gps_acres: x.gps_acres || str(patch.gps_acres),
        total_kg: x.total_kg || str(patch.total_kg),
        harvest_completed_on: x.harvest_completed_on || str(patch.harvest_completed_on),
        weather: x.weather || str(patch.weather),
      }))
    } catch (e) {
      setFilling(null)
      setError((e as Error).message)
    }
  }

  const download = async () => {
    setBusy('report')
    setError(null)
    try {
      const blob = await style.reportPdf({ report, bins, binName, fieldName, signerName: signerName.data ?? null })
      downloadBlob(blob, `${style.fileLabel(report.company)} seed report - ${safeName(fieldName)} - ${report.crop_year}.pdf`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const canUnsign = !!profile && (report.signed_by === profile.id || profile.role === 'manager' || profile.role === 'admin')

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-gray-800">{style.reportTitle}</h2>
          <button type="button" onClick={() => void fillFromApp()} disabled={!!filling && filling.endsWith('…')} className={btn}>
            <RefreshCw className="h-4 w-4" /> Fill blanks from the app
          </button>
          <button type="button" onClick={() => void download()} disabled={busy === 'report' || dirty} title={dirty ? 'Save first' : undefined} className={primary}>
            <Download className="h-4 w-4" /> {busy === 'report' ? 'Making the PDF…' : 'Report PDF'}
          </button>
        </div>
        {filling && <p className="text-xs text-gray-600">{filling}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Grower name" id="sr-grower" value={d.grower_name} onChange={(v) => set('grower_name', v)} />
          <Field label={style.fieldNumber.label} id="sr-field-number" value={d.field_number} onChange={(v) => set('field_number', v)} placeholder={style.fieldNumber.placeholder} />
          <Field label={style.spinCode.label} id="sr-spin" value={d.spin_code} onChange={(v) => set('spin_code', v)} placeholder={style.spinCode.placeholder} />
          <Field label="Legal land description" id="sr-legal" value={d.legal_land} onChange={(v) => set('legal_land', v)} />
          <Field label="GPS acres" id="sr-acres" value={d.gps_acres} onChange={(v) => set('gps_acres', v)} inputMode="decimal" />
          <Field label="Total seed harvested (kg)" id="sr-kg" value={d.total_kg} onChange={(v) => set('total_kg', v)} inputMode="decimal" />
          <label className="text-xs text-gray-600">
            Weighed on
            <Select
              value={d.weight_method}
              onChange={(v) => set('weight_method', v as Draft['weight_method'])}
              options={[
                { value: 'platform', label: 'Platform scale' },
                { value: 'grain_cart', label: 'Grain cart scale' },
                { value: 'electronic', label: 'Electronic inventory system' },
              ]}
              className="mt-1 w-full"
              ariaLabel="Weighed on"
            />
          </label>
          <label className="text-xs text-gray-600">
            Scale certified
            <Select
              value={d.scale_certified}
              onChange={(v) => set('scale_certified', v)}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
                { value: '', label: 'Leave blank' },
              ]}
              className="mt-1 w-full"
              ariaLabel="Scale certified"
            />
          </label>
          <label className="text-xs text-gray-600">
            Seed stored at
            <Select
              value={d.storage}
              onChange={(v) => set('storage', v as Draft['storage'])}
              options={[
                { value: 'home', label: 'Home farm location' },
                { value: 'same_qtr', label: 'Same quarter as the field' },
                { value: 'other', label: 'Other (legal land)' },
              ]}
              className="mt-1 w-full"
              ariaLabel="Seed stored at"
            />
          </label>
          {d.storage === 'other' && <Field label="Other location (legal land)" id="sr-other" value={d.storage_other} onChange={(v) => set('storage_other', v)} />}
          <Field label="Harvest completed" id="sr-harvest" type="date" value={d.harvest_completed_on} onChange={(v) => set('harvest_completed_on', v)} />
          <Field label="Weather at harvest" id="sr-weather" value={d.weather} onChange={(v) => set('weather', v)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={d.acknowledged} onChange={(e) => set('acknowledged', e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          {style.acknowledge(report.company)}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!dirty || save.isPending} onClick={saveDraft} className={primary}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" onClick={() => setD(draftOf(report))} className={btn}>
              Undo changes
            </button>
          )}
          {save.error && <span className="text-xs text-red-600">{(save.error as Error).message}</span>}
        </div>
      </section>

      <BinTable report={report} bins={bins} binName={binName} style={style} />

      <section className="overflow-hidden flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white">
        <h2 className={cn('w-full font-medium', CARD_HEAD)}>Signature</h2>
        <div className="p-4">
        {report.signature ? (
          <>
            <img src={report.signature} alt="Signature on the report" className="h-14 max-w-[16rem] rounded border border-gray-200 bg-white object-contain p-1" />
            <span className="text-sm text-gray-700">
              Signed{signerName.data ? ` by ${signerName.data}` : ''} {report.signed_at ? longDate(new Date(report.signed_at).toLocaleDateString('en-CA')) : ''}
            </span>
            {canUnsign && (
              <button type="button" disabled={sign.isPending} onClick={() => sign.mutate({ id: report.id, unsign: true })} className="text-xs text-gray-500 hover:text-red-700">
                Take the signature off
              </button>
            )}
          </>
        ) : mySig.data?.image ? (
          <button
            type="button"
            disabled={sign.isPending || dirty || !profile}
            title={dirty ? 'Save first' : undefined}
            onClick={() => sign.mutate({ id: report.id, userId: profile!.id, signature: mySig.data!.image })}
            className={primary}
          >
            <PenLine className="h-4 w-4" /> Sign as {profile?.full_name ?? 'me'}, dated today
          </button>
        ) : (
          <span className="text-sm text-gray-600">
            <Link to="/settings/account?tab=profile" className="font-medium text-brand-700 hover:underline">
              Add your signature
            </Link>{' '}
            on My account to sign.
          </span>
        )}
        {sign.error && <span className="text-xs text-red-600">{(sign.error as Error).message}</span>}

        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

function Field(p: { label: string; id: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'decimal' }) {
  return (
    <label htmlFor={p.id} className="text-xs text-gray-600">
      {p.label}
      <input id={p.id} type={p.type ?? 'text'} inputMode={p.inputMode} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} className={input} />
    </label>
  )
}

/* ── The report's bin table ────────────────────────────────────────────── */

function BinTable({ report, bins, binName, style }: { report: SeedReport; bins: SeedReportBin[]; binName: (id: string | null) => string; style: FormStyle }) {
  const allBins = useBins()
  const saveBin = useSaveSeedBin()
  const del = useDeleteSeedBin()
  const [removing, setRemoving] = useState<SeedReportBin | null>(null)
  const binOptions = useMemo(
    () =>
      [...(allBins.data ?? [])]
        .filter((b) => b.active !== false && b.usual_contents !== 'fertilizer')
        .sort((a, b) => (a.site ?? '').localeCompare(b.site ?? '') || binNumber(a.name) - binNumber(b.name))
        .map((b) => ({ value: b.id, label: growerBinLabel(b.name) || b.name, group: b.site ?? undefined })),
    [allBins.data],
  )
  const options = (current: string | null) =>
    current && !binOptions.some((o) => o.value === current) ? [{ value: current, label: growerBinLabel(binName(current)) || 'Bin' }, ...binOptions] : binOptions
  const patch = (b: SeedReportBin, p: Partial<SeedReportBin>) => saveBin.mutate({ id: b.id, report_id: report.id, patch: p })
  const cell = 'w-full rounded border border-gray-300 px-1.5 py-1 text-sm'

  return (
    <section className="overflow-hidden space-y-2 rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('font-medium', CARD_HEAD)}>Bins</h2>
      <div className="p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="py-1 pr-2">Grower bin</th>
              <th className="py-1 pr-2">{style.companyBin(report.company)}</th>
              <th className="py-1 pr-2">Seed (kg)</th>
              <th className="py-1 pr-2">Moisture %</th>
              <th className="py-1 pr-2">Seed temp °C</th>
              {style.asksBinKit && (
                <>
                  <th className="py-1 pr-2">Temp cables</th>
                  <th className="py-1 pr-2">Moisture cables</th>
                  <th className="py-1 pr-2">Aeration</th>
                  <th className="py-1 pr-2">Bottom</th>
                </>
              )}
              <th className="py-1 pr-2">Shipped</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr key={`${b.id}:${b.updated_at}`} className="border-t border-gray-100 align-top">
                <td className="py-1.5 pr-2">
                  <Select value={b.bin_id ?? ''} onChange={(v) => patch(b, { bin_id: v || null })} options={options(b.bin_id)} size="sm" className="w-44" ariaLabel="Grower bin" />
                </td>
                <td className="py-1.5 pr-2">
                  <input defaultValue={str(b.company_bin_id)} placeholder="A1" aria-label={style.companyBin(report.company)} onBlur={(e) => e.target.value !== str(b.company_bin_id) && patch(b, { company_bin_id: e.target.value.trim() || null })} className={`${cell} w-20`} />
                </td>
                <td className="py-1.5 pr-2">
                  <input defaultValue={str(b.quantity_kg)} inputMode="decimal" aria-label="Seed kg" onBlur={(e) => e.target.value !== str(b.quantity_kg) && patch(b, { quantity_kg: num(e.target.value) })} className={`${cell} w-28`} />
                </td>
                <td className="py-1.5 pr-2">
                  <input defaultValue={str(b.moisture_pct)} inputMode="decimal" aria-label="Moisture %" onBlur={(e) => e.target.value !== str(b.moisture_pct) && patch(b, { moisture_pct: num(e.target.value) })} className={`${cell} w-20`} />
                </td>
                <td className="py-1.5 pr-2">
                  <input defaultValue={str(b.seed_temp_c)} inputMode="decimal" aria-label="Seed temperature °C" onBlur={(e) => e.target.value !== str(b.seed_temp_c) && patch(b, { seed_temp_c: num(e.target.value) })} className={`${cell} w-20`} />
                </td>
                {style.asksBinKit && (
                  <>
                    {(['temp_cables', 'moisture_cables', 'aeration'] as const).map((k) => (
                      <td key={k} className="py-1.5 pr-2 text-center">
                        <input type="checkbox" checked={b[k]} aria-label={KIT_LABEL[k]} onChange={(e) => patch(b, { [k]: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                      </td>
                    ))}
                    <td className="py-1.5 pr-2">
                      <Select
                        value={b.bottom}
                        onChange={(v) => patch(b, { bottom: v as SeedReportBin['bottom'] })}
                        options={[
                          { value: 'flat', label: 'Flat' },
                          { value: 'coned', label: 'Coned' },
                        ]}
                        size="sm"
                        className="w-24"
                        ariaLabel="Bottom"
                      />
                    </td>
                  </>
                )}
                <td className="py-1.5 pr-2">
                  <input type="date" defaultValue={str(b.shipped_on)} aria-label="Shipped on" onBlur={(e) => e.target.value !== str(b.shipped_on) && patch(b, { shipped_on: e.target.value || null })} className={`${cell} w-36`} />
                </td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => setRemoving(b)} aria-label="Remove this bin" className="rounded p-1 text-gray-400 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={saveBin.isPending} onClick={() => saveBin.mutate({ report_id: report.id, patch: { sort: bins.length } })} className={btn}>
          <Plus className="h-4 w-4" /> Add a bin
        </button>
        {!style.asksBinKit && <span className="text-xs text-gray-500">Every bin is printed with temperature and moisture cables, aeration, and a coned bottom.</span>}
        {saveBin.error && <span className="text-xs text-red-600">{(saveBin.error as Error).message}</span>}
      </div>
      {removing && (
        <ConfirmDialog
          title="Remove this bin from the report?"
          message={`${removing.company_bin_id || growerBinLabel(binName(removing.bin_id)) || 'The bin'} comes off the report. Its temperature readings stay with the bin.`}
          confirmLabel="Remove"
          busy={del.isPending}
          error={del.error ? (del.error as Error).message : undefined}
          onClose={() => setRemoving(null)}
          onConfirm={() => del.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
        />
      )}

      </div>
    </section>
  )
}

const KIT_LABEL = { temp_cables: 'Temperature cables', moisture_cables: 'Moisture cables', aeration: 'Aeration' } as const

/* ── The bin temperature records ───────────────────────────────────────── */

function BinTemps({ report, bins, fieldName, cropId, style }: { report: SeedReport; bins: SeedReportBin[]; fieldName: string; cropId: string | null; style: FormStyle }) {
  const allBins = useBins()
  const crops = useCrops()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const binName = (id: string | null) => allBins.data?.find((b) => b.id === id)?.name ?? ''

  const download = async (only?: SeedReportBin) => {
    setBusy(only?.id ?? 'bins')
    setError(null)
    try {
      const chosen = only ? [only] : bins
      const ids = chosen.map((b) => b.bin_id).filter((v): v is string => !!v)
      const { data, error: e } = ids.length
        ? await supabase.from('bin_monitor_readings').select('*').in('bin_id', ids).eq('crop_year', report.crop_year).order('read_on')
        : { data: [], error: null }
      if (e) throw e
      const rows = (data ?? []).map((r) => ({ ...r, levels: (Array.isArray(r.levels) ? r.levels : []) as unknown as MonitorRow['levels'] })) as MonitorRow[]
      const cropName = (id: string | null) => crops.data?.find((c) => c.id === id)?.name ?? null
      const blob = await style.binTempPdf({ report, bins: chosen, binName, fieldName, signerName: null, readings: rows, cropName })
      const label = only ? ` - ${only.company_bin_id || growerBinLabel(binName(only.bin_id)) || 'bin'}` : ''
      downloadBlob(blob, `${style.fileLabel(report.company)} bin temperatures - ${safeName(fieldName)}${label} - ${report.crop_year}.pdf`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-gray-800">{style.binTempTitle}</h2>
          <button type="button" onClick={() => void download()} disabled={busy === 'bins' || !bins.length} className={primary}>
            <Download className="h-4 w-4" /> {busy === 'bins' ? 'Making the PDF…' : 'All bins PDF'}
          </button>
        </div>
        {!report.harvest_completed_on && <p className="text-xs text-amber-700">Reminders start once the harvest completed date is filled in.</p>}
        <BinTempHeader key={`${report.id}:${report.updated_at}`} report={report} style={style} />
        {bins.map((b) => (
          <BinRecord
            key={b.id}
            report={report}
            bin={b}
            name={growerBinLabel(binName(b.bin_id))}
            cropId={cropId}
            style={style}
            busy={busy === b.id}
            onDownload={() => void download(b)}
          />
        ))}
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

/* ── What the bin temperature form prints at the top ───────────────────── */

/**
 * Grower, legal land and field number as they print at the top of every bin
 * temperature page (Sam, 26 Oct 2026: they could only be changed on the seed
 * report). They are the seed report's own values, so a change here shows there
 * too: one report per company, field and year, one set of answers.
 */
function BinTempHeader({ report, style }: { report: SeedReport; style: FormStyle }) {
  const save = useSaveSeedReport()
  const start = { grower_name: str(report.grower_name), legal_land: str(report.legal_land), field_number: str(report.field_number) }
  const [d, setD] = useState(start)
  const dirty = d.grower_name !== start.grower_name || d.legal_land !== start.legal_land || d.field_number !== start.field_number
  const set = (k: keyof typeof d) => (v: string) => setD((x) => ({ ...x, [k]: v }))
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Grower" id="bt-grower" value={d.grower_name} onChange={set('grower_name')} />
        <Field label="Legal land location" id="bt-legal" value={d.legal_land} onChange={set('legal_land')} />
        <Field label={style.fieldNumber.label} id="bt-field-number" value={d.field_number} onChange={set('field_number')} placeholder={style.fieldNumber.placeholder} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[11px] text-gray-500">Printed at the top of every bin page. The same as the seed report&apos;s.</p>
        {save.error && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              id: report.id,
              patch: { grower_name: d.grower_name.trim() || null, legal_land: d.legal_land.trim() || null, field_number: d.field_number.trim() || null },
            })
          }
          className={primary}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/* ── A bin's monitoring record ─────────────────────────────────────────── */

function BinRecord(p: { report: SeedReport; bin: SeedReportBin; name: string; cropId: string | null; style: FormStyle; busy: boolean; onDownload: () => void }) {
  const { report, bin, style } = p
  const saveBin = useSaveSeedBin()
  const readings = useBinMonitorReadings(bin.bin_id)
  const [editing, setEditing] = useState<MonitorRow | 'new' | null>(null)
  const rows = (readings.data ?? []).filter((r) => r.crop_year === report.crop_year)
  const due = bin.shipped_on ? null : nextCheck(report.harvest_completed_on, today())
  const title = [bin.company_bin_id, p.name].filter(Boolean).join(' · ') || 'Bin'
  // A company's own form may fix the columns; the generic one has as many as the longest cable read.
  const n = style.sensors.fixedCount ?? Math.max(1, ...rows.map((r) => style.sensors.read(r.levels).length))
  const latestCount = rows[0] ? style.sensors.read(rows[0].levels).length : 0

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Thermometer className="h-4 w-4 text-brand-700" />
        <span className="mr-auto text-sm font-medium text-gray-800">
          {title}
          <span className="ml-2 text-xs font-normal text-gray-500">
            {bin.shipped_on ? `Shipped ${longDate(bin.shipped_on)}` : due ? `Next reading due ${longDate(due)}` : ''}
          </span>
        </span>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          {style.companyBin(report.company)}
          <input
            // Remounted when the saved value changes, so a save elsewhere shows here.
            key={bin.company_bin_id ?? ''}
            defaultValue={str(bin.company_bin_id)}
            placeholder="A1"
            aria-label={style.companyBin(report.company)}
            onBlur={(e) => e.target.value.trim() !== str(bin.company_bin_id) && saveBin.mutate({ id: bin.id, report_id: report.id, patch: { company_bin_id: e.target.value.trim() || null } })}
            className="w-20 rounded border border-gray-300 px-1.5 py-1 text-sm"
          />
        </label>
        <button type="button" disabled={!bin.bin_id} onClick={() => setEditing('new')} className={btn} title={bin.bin_id ? undefined : 'Pick the grower bin first'}>
          <Plus className="h-4 w-4" /> Add a reading
        </button>
        <button type="button" disabled={p.busy} onClick={p.onDownload} className={btn}>
          <Download className="h-4 w-4" /> {p.busy ? 'Making…' : 'PDF'}
        </button>
      </div>
      {saveBin.error && <p className="mx-3 mb-2 text-xs text-red-600">{(saveBin.error as Error).message}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-xs">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_TH}>Date</th>
                {Array.from({ length: n }, (_, i) => (
                  <th key={i} className={TABLE_TH}>
                    {style.sensors.topFirst ? style.sensors.label(i, n) : i === 0 ? '1 (bottom)' : i + 1}
                  </th>
                ))}
                <th className={TABLE_TH}>Aeration on</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.id} onClick={() => setEditing(r)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-1 text-gray-700">{longDate(r.read_on)}</td>
                  {Array.from({ length: n }, (_, i) => style.sensors.read(r.levels)[i]).map((pos, i) => (
                    <td key={i} className="px-3 py-1 tabular-nums text-gray-700">
                      {style.sensors.cell(pos)}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-gray-700">{r.aeration_on ? 'Yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ReadingDialog
          report={report}
          bin={bin}
          title={title}
          cropId={p.cropId}
          style={style}
          defaultCount={latestCount || 6}
          reading={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ReadingDialog(p: {
  report: SeedReport
  bin: SeedReportBin
  title: string
  cropId: string | null
  style: FormStyle
  /** Sensors on a new reading where the form does not fix them: the last reading's count. */
  defaultCount: number
  reading: MonitorRow | null
  onClose: () => void
}) {
  const { profile } = useAuth()
  const save = useSaveBinMonitor()
  const del = useDeleteBinMonitor()
  const r = p.reading
  const sensors = p.style.sensors
  // A reading the form would lose something by retyping (off the cable
  // screenshot, more sensors than the form has, humidity) stays as read:
  // only the aeration box is set here.
  const fixed = !!r && sensors.readOnly(r)
  const [date, setDate] = useState(r?.read_on ?? today())
  const [aeration, setAeration] = useState(r?.aeration_on ?? false)
  const [cells, setCells] = useState<{ t: string; m: string }[]>(() =>
    (r ? sensors.read(r.levels) : Array.from({ length: sensors.fixedCount ?? p.defaultCount }, (): Position => ({ temp_c: null, moisture_pct: null }))).map((x) => ({
      t: str(x.temp_c),
      m: str(x.moisture_pct),
    })),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const initials = (profile?.full_name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  const submit = () => {
    const positions: Position[] = cells.map((c) => ({ temp_c: num(c.t), moisture_pct: num(c.m) }))
    save.mutate(
      {
        id: r?.id,
        bin_id: p.bin.bin_id!,
        crop_year: p.report.crop_year,
        crop_id: r?.crop_id ?? p.cropId,
        read_on: date,
        lot_number: r?.lot_number ?? p.bin.company_bin_id,
        lld: r?.lld ?? p.report.legal_land,
        initials: r?.initials ?? (initials || null),
        levels: fixed ? r!.levels : sensors.write(positions),
        source: r?.source ?? 'manual',
        notes: r?.notes ?? null,
        aeration_on: aeration,
      },
      { onSuccess: p.onClose },
    )
  }

  return (
    <Modal title={`${r ? 'Reading' : 'New reading'}: ${p.title}`} onClose={p.onClose}>
      <div className="space-y-3">
        <label className="block text-xs text-gray-600">
          Date
          <input type="date" value={date} disabled={fixed} onChange={(e) => setDate(e.target.value)} className={`${input} w-44`} />
        </label>
        <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
          <span />
          <span className="text-gray-500">Temp °C</span>
          <span className="text-gray-500">Moisture %</span>
          {(sensors.topFirst ? cells.map((c, i) => ({ c, i })) : cells.map((c, i) => ({ c, i })).reverse()).map(({ c, i }) => (
              <div key={i} className="contents">
                <span className="text-gray-600">{sensors.label(i, cells.length)}</span>
                <input
                  value={c.t}
                  inputMode="decimal"
                  disabled={fixed}
                  aria-label={`Sensor ${i + 1} temperature`}
                  onChange={(e) => setCells((x) => x.map((y, j) => (j === i ? { ...y, t: e.target.value } : y)))}
                  className="rounded border border-gray-300 px-1.5 py-1 text-sm disabled:bg-gray-50"
                />
                <input
                  value={c.m}
                  inputMode="decimal"
                  disabled={fixed}
                  aria-label={`Sensor ${i + 1} moisture`}
                  onChange={(e) => setCells((x) => x.map((y, j) => (j === i ? { ...y, m: e.target.value } : y)))}
                  className="rounded border border-gray-300 px-1.5 py-1 text-sm disabled:bg-gray-50"
                />
              </div>
            ))}
        </div>
        {sensors.fixedCount == null && !fixed && (
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setCells((x) => [...x, { t: '', m: '' }])} className="text-brand-700 hover:underline">
              Add a sensor
            </button>
            {cells.length > 1 && (
              <button type="button" onClick={() => setCells((x) => x.slice(0, -1))} className="text-gray-500 hover:text-red-700">
                Remove the bottom sensor
              </button>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={aeration} onChange={(e) => setAeration(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Aeration was turned on since the last reading
        </label>
        {fixed && <p className="text-xs text-gray-500">Read off the bin&apos;s cable; edit the numbers on the bin&apos;s own page.</p>}
        {(save.error || del.error) && <p className="text-xs text-red-600">{((save.error ?? del.error) as Error).message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {r && !fixed && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="mr-auto text-xs text-gray-500 hover:text-red-700">
              Delete this reading
            </button>
          )}
          <button type="button" onClick={p.onClose} className={btn}>
            Cancel
          </button>
          <button type="button" disabled={save.isPending || !date} onClick={submit} className={primary}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {confirmDelete && r && (
        <ConfirmDialog
          title="Delete this reading?"
          message={`The ${longDate(r.read_on)} reading for ${p.title} goes from the bin's records and from ${p.report.company}'s form.`}
          busy={del.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate(r.id, { onSuccess: p.onClose })}
        />
      )}
    </Modal>
  )
}

