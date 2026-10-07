import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { FileDown, FlaskConical, SlidersHorizontal } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { useCropYear } from '@/lib/crop-year'
import { OfflineMissing } from '@/components/OfflineBanner'
import { useOnline } from '@/lib/useOnline'
import { useWheelZoom } from '@/lib/useWheelZoom'
import { chartToPng } from '@/lib/chart-image'
import { downloadBlob, tableReportToPdf } from '@/lib/table-report'
import { groupBalanceByZone } from '@/lib/balance-series'
import {
  soilCapacities,
  STATUS_LABEL,
  useCropCoefficients,
  useFieldBalanceSeries,
  useFieldSeasons,
  useLatestBalance,
  useSoilProfiles,
} from '@/lib/irrigation'
import { useUnitSystem } from '@/lib/units'
import { aimmCropInfo, graphLabel as labelOf, GRAPH_TYPES, tOf, type GraphType } from '@/lib/aimm-chart'
import { FieldWaterPanel, useFieldWater } from './FieldWaterPanel'
import { useWaterRightsView } from './WaterRights'
import { SoilReadingForm, useSoilReadings } from './FieldAimmBlocks'
import { AimmChart } from './AimmCharts'
import { aimmFileName, aimmReportTable } from './aimm-report'
import { AdjustIrrigation } from './AdjustIrrigation'
import { Modal } from '@/components/Modal'

// MapLibre is large; the map loads only once the Graph page is open.
const FieldSectorMap = lazy(() => import('./FieldSectorMap').then((m) => ({ default: m.FieldSectorMap })))

/**
 * One field in full: its graph, the map of its sectors, and its records.
 * The field is held by the page so the Overview can open a row here.
 */
export function IrrigationGraph({ fieldId: chosen, onFieldChange }: { fieldId?: string; onFieldChange?: (id: string) => void } = {}) {
  const u = useUnitSystem()
  const { cropYear: year } = useCropYear()
  const [params] = useSearchParams()
  const { data: fields } = useFields()
  const { data: profiles } = useSoilProfiles()
  const { data: plans } = useCropPlans(year)
  const { data: crops } = useCrops()
  const { data: seasons } = useFieldSeasons(year)
  const { data: coefs } = useCropCoefficients()
  const { data: latest } = useLatestBalance()
  const { view: rights } = useWaterRightsView(year)
  const [ownField, setOwnField] = useState<string>(() => params.get('field') ?? '')
  const fieldId = chosen ?? ownField
  const setFieldId = (id: string) => (onFieldChange ? onFieldChange(id) : setOwnField(id))
  const [dialog, setDialog] = useState<'soil' | 'adjust' | null>(null)
  const [graph, setGraph] = useState<GraphType>('moist100')
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'error'>('idle')
  const chartRef = useRef<HTMLDivElement | null>(null)

  const activeFields = useMemo(() => (fields ?? []).filter((f) => f.active), [fields])
  // The SMRID allotment reminder links here with ?view=allocation; it lands on
  // a canal field, which is where the allotment is set.
  const canalFirst = params.get('view') === 'allocation' ? rights?.canal[0]?.fieldId : undefined
  const selectedId = fieldId || canalFirst || activeFields[0]?.id || ''
  const { data: series, isLoading } = useFieldBalanceSeries(selectedId || undefined)
  const online = useOnline()
  const w = useFieldWater(selectedId, year)
  const { data: soilReadings } = useSoilReadings(selectedId, year)
  const readingMap = useMemo(() => new Map((soilReadings ?? []).map((r) => [r.read_on, Number(r.avail_mm)])), [soilReadings])

  // The season on show: the crop year picked in the app, the same year the
  // crop and the water records below come from.
  const seasonRows = useMemo(() => (series ?? []).filter((r) => r.date.startsWith(String(year))), [series, year])

  const { data: allZones } = useAllCropZones()
  // One line per crop zone, or a single line when the field is not split.
  // Colour follows the crop so the Graph, the map overlay and the Setup badge
  // all say "carrots" in the same colour.
  const balanceSeries = useMemo(
    () =>
      groupBalanceByZone(
        seasonRows,
        (allZones ?? []).filter((z) => z.geojson).map((z) => ({ id: z.id, crop_id: z.crop_id })),
        (crops ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color })),
      ),
    [seasonRows, allZones, crops],
  )

  const range = useMemo<[number, number]>(
    () => (seasonRows.length ? [tOf(seasonRows[0].date), tOf(seasonRows.at(-1)!.date)] : [0, 0]),
    [seasonRows],
  )
  const zoom = useWheelZoom(range[0], range[1], { requireCtrl: true })

  const field = activeFields.find((f) => f.id === selectedId)
  const profile = profiles?.find((p) => p.field_id === selectedId) ?? null

  // What is growing: the Crop Plan's crops on the field (a split field has
  // more than one), and what AIMM is modelling when Setup overrides it.
  const cropInfo = useMemo(() => aimmCropInfo(selectedId, plans ?? [], crops ?? [], seasons ?? [], coefs ?? []), [plans, crops, seasons, coefs, selectedId])

  const statusOf = useMemo(() => new Map((latest ?? []).map((b) => [b.field_id, b.status])), [latest])
  const graphLabel = labelOf(graph)

  // The chart as drawn, zoom and all; the Reports page makes the same file
  // for a field by drawing it off-screen (aimm-report.tsx).
  const exportPdf = async () => {
    setExporting('busy')
    try {
      const fieldName = field?.name ?? 'Field'
      const image = chartRef.current ? await chartToPng(chartRef.current) : null
      const report = aimmReportTable({
        image,
        fieldName,
        graphLabel,
        crops: cropInfo.planned,
        modelledAs: cropInfo.modelledAs,
        planted: cropInfo.planted,
        profile,
        series: balanceSeries,
        domain: zoom.domain,
        u,
        w,
        fieldId: selectedId,
        year,
      })
      downloadBlob(await tableReportToPdf(report), `${aimmFileName(fieldName, graphLabel)}.pdf`)
      setExporting('idle')
    } catch {
      setExporting('error')
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={selectedId}
          onChange={(v) => {
            setFieldId(v)
            zoom.reset()
          }}
          ariaLabel="Field"
          className="w-full sm:w-64"
          options={activeFields.map((f) => {
            const st = statusOf.get(f.id)
            return { value: f.id, label: st && st !== 'ok' ? `${f.name} · ${STATUS_LABEL[st]}` : f.name }
          })}
        />
        <Select
          value={graph}
          onChange={(v) => setGraph(v as GraphType)}
          ariaLabel="Graph type"
          className="w-full flex-1 sm:min-w-64"
          options={GRAPH_TYPES.map((g) => ({ value: g.id, label: g.label }))}
        />
        {zoom.zoomed && (
          <button type="button" onClick={zoom.reset} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            Reset zoom
          </button>
        )}
        <button
          type="button"
          onClick={() => void exportPdf()}
          disabled={exporting === 'busy' || !seasonRows.length}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <FileDown className="h-3.5 w-3.5" /> {exporting === 'busy' ? 'Making PDF…' : 'PDF report'}
        </button>
        {exporting === 'error' && <span className="text-xs text-red-700">The PDF could not be made.</span>}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {cropInfo.planned.length ? (
          cropInfo.planned.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-800">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              {c.name}
              {c.variety && <span className="text-gray-400">{c.variety}</span>}
              {cropInfo.planned.length > 1 && c.acres != null && <span className="text-gray-400">{Math.round(c.acres)} ac</span>}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">no crop planned for {year}</span>
        )}
        {cropInfo.modelledAs && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800" title="Setup overrides the crop the model uses for this field">
            Modelled as {cropInfo.modelledAs}
          </span>
        )}
        {cropInfo.planted && <span className="text-xs text-gray-500">planted {cropInfo.planted}</span>}
        {selectedId && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDialog('soil')}
              className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              <FlaskConical className="h-3.5 w-3.5" /> Submit soil moisture
            </button>
            <button
              type="button"
              onClick={() => setDialog('adjust')}
              className="flex items-center gap-1.5 rounded-md border border-sky-700 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust irrigation amounts
            </button>
          </span>
        )}
      </div>
      {dialog === 'soil' && selectedId && (
        <Modal title={`Soil moisture — ${field?.name ?? ''}`} onClose={() => setDialog(null)} wide>
          <SoilReadingForm fieldId={selectedId} u={u} fc={soilCapacities(profile)?.fc100 ?? null} onSaved={() => setDialog(null)} />
        </Modal>
      )}
      {dialog === 'adjust' && selectedId && (
        <Modal title={`Irrigation amounts — ${field?.name ?? ''}`} onClose={() => setDialog(null)} wide>
          <AdjustIrrigation fieldId={selectedId} year={year} u={u} />
        </Modal>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-1 text-center">
          <h2 className="text-sm font-semibold text-gray-900">{graphLabel}</h2>
          <p className="text-xs text-gray-500">
            {profile?.sample_site_name ? `Sample Site: ${profile.sample_site_name}` : ''}
            {balanceSeries.length > 1
              ? `${profile?.sample_site_name ? ' · ' : ''}${balanceSeries.length} zones: ${balanceSeries.map((b) => b.label).join(', ')}`
              : ''}
            <span className="text-gray-400">{profile?.sample_site_name || balanceSeries.length > 1 ? ' · ' : ''}Ctrl + scroll on the graph to zoom</span>
          </p>
        </div>
        {isLoading ? (
          <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
        ) : !seasonRows.length ? (
          // The empty state below would be a lie with no signal: the model data
          // exists, it is simply not on this device. Sending somebody to set a
          // planting date they have already set is worse than saying nothing.
          !online ? (
            <div className="py-12">
              <OfflineMissing what="The moisture balance for this field" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-gray-400">
              <p>No {year} model data for this field yet. It needs a planting date, then Sync.</p>
              <SetupLink to={SETUP_LINKS.plantingDate(selectedId)}>Set the planting date</SetupLink>
            </div>
          )
        ) : (
          <div
            ref={(el) => {
              chartRef.current = el
              zoom.attach(el)
            }}
          >
            <AimmChart graph={graph} series={balanceSeries} seasonRows={seasonRows} profile={profile} u={u} domain={zoom.domain} range={range} readings={readingMap} />
          </div>
        )}
      </div>

      {selectedId && (
        <Suspense fallback={<p className="mt-3 py-8 text-center text-xs text-gray-400">Loading the field map…</p>}>
          <div className="mt-3">
            <FieldSectorMap fieldId={selectedId} year={year} />
          </div>
        </Suspense>
      )}

      {selectedId && <FieldWaterPanel fieldId={selectedId} w={w} u={u} year={year} fc={soilCapacities(profile)?.fc100 ?? null} />}
    </div>
  )
}
