import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { chartToPng } from '@/lib/chart-image'
import type { ReportSection, TableReport } from '@/lib/table-report'
import { groupBalanceByZone, type BalanceSeries } from '@/lib/balance-series'
import { STATUS_LABEL, useCropCoefficients, useFieldBalanceSeries, useFieldSeasons, useSoilProfiles, type SoilProfileRow, type WaterBalanceRow } from '@/lib/irrigation'
import { conv, depthValue, type UnitSystem } from '@/lib/units'
import type { ZoomDomain } from '@/lib/useWheelZoom'
import { aimmCropInfo, fmtDay, graphLabel, inDomain, moistureSummary, tOf, type CropLine, type GraphType } from '@/lib/aimm-chart'
import { fieldLabel, yearParam, type Cell, type ReportData } from '@/lib/reports/framework'
import type { HookRun } from '@/pages/reports/gatherers'
import { useFieldWater, type FieldWater } from './FieldWaterPanel'
import { VERDICT } from './AllocationTab'
import { fieldWaterRights } from './WaterRights'
import { useSoilReadings } from './FieldAimmBlocks'
import { AimmChart } from './AimmCharts'

/**
 * The AIMM field report: one field's graph, what it says, where the soil is
 * today, the water used against what is allowed, the water right, the
 * irrigation applied and the daily balance. The Graph page's "PDF report"
 * makes it from the chart on screen (zoomed as shown); the Reports page
 * makes the same file for a picked field and year, drawing the chart
 * off-screen (drawAimmChart), and its CSV is the season's daily balance.
 */

export type AimmReportInput = {
  image: TableReport['image'] | null
  fieldName: string
  graphLabel: string
  crops: CropLine[]
  modelledAs: string | null
  planted: string | null
  profile: SoilProfileRow | null
  series: BalanceSeries[]
  domain: ZoomDomain
  u: UnitSystem
  w: FieldWater
  fieldId: string
  year: number
}

export const aimmFileName = (fieldName: string, graph: string) => `AIMM ${fieldName} ${graph} ${new Date().toLocaleDateString('en-CA')}`

/** The PDF's layout: the chart as drawn, what it says, and the field's records under it. */
export function aimmReportTable(o: AimmReportInput): TableReport {
  const { u, w } = o
  const unit = conv.depthUnit(u)
  const d = (mm: number | null | undefined, digits = 1) => (mm == null ? '' : conv.depth(Number(mm), u, digits))
  const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))
  const rows = o.series[0]?.rows ?? []
  const s = moistureSummary(rows, o.profile)
  const shown = rows.filter((r) => inDomain(r.date, o.domain))
  const lead = [
    s.crossDate ? `Predicted to reach the irrigation threshold on ${fmtDay(s.crossDate)}.` : 'No irrigation required in the forecast window.',
    `Predicted water use over the forecast: ${d(s.predWaterUse)} ${unit}.${s.predMoisture != null && s.lastDate ? ` Predicted soil moisture on ${fmtDay(s.lastDate)}: ${d(s.predMoisture)} ${unit}.` : ''}`,
    ...(s.fc != null ? [`Field capacity ${d(s.fc, u === 'metric' ? 0 : 1)} ${unit}; irrigation threshold ${d(s.thr, u === 'metric' ? 0 : 1)} ${unit}.`] : []),
  ]

  const sections: ReportSection[] = []
  const b = w.latest
  if (b)
    sections.push({
      title: 'Today',
      head: ['Status', 'As of', `Depletion (${unit})`, `RAW (${unit})`, `TAW (${unit})`, `ETc today (${unit})`, 'Days to irrigate', `Apply gross (${unit})`, 'Forecast needs water', `Season ETc (${unit})`],
      rows: [[
        STATUS_LABEL[b.status ?? 'ok'],
        b.date,
        d(b.dr_mm),
        d(b.raw_mm),
        d(b.taw_mm),
        d(b.etc_mm, 2),
        b.days_to_irrigate,
        b.status === 'now' || b.status === 'stress' ? d(b.rec_gross_mm) : '',
        w.crossing ? `${fmtDay(w.crossing.date)}${w.crossing.recGross ? ` (~${d(Number(w.crossing.recGross), 0)} ${unit})` : ''}` : 'not in the next 7 days',
        d(w.seasonEt, 0),
      ]],
    })
  const a = w.allocRow
  if (a)
    sections.push({
      title: `Water use ${o.year}`,
      head: ['Water', 'Acres', 'Used (in)', 'Allotted (in)', 'Used (ac-ft)', 'Licence share (ac-ft)', 'Pace (in/wk)', `By ${w.seasonEnd} (in)`, 'Verdict'],
      rows: [[a.source, n1(a.acres), n1(a.usedInches), n1(a.allottedInches), n1(a.usedAcreFeet), n1(a.licenceAcreFeet), n1(a.recentRate * 7), n1(a.projectedInches), VERDICT[a.verdict].label]],
    })
  const wr = fieldWaterRights(w.rights, o.fieldId)
  if (wr?.pool) {
    const p = wr.pool
    const room = w.thisSeason ? p.spareAf : p.roomAf
    sections.push({
      title: `Water rights: licence ${p.licence.number}${wr.source ? ` (${wr.source})` : ''}`,
      note: `${p.licence.volumeAf != null ? `${n1(p.licence.volumeAf)} ac-ft` : 'Volume not on file'} over ${n1(p.acres)} ac${p.licence.status ? `, ${p.licence.status}` : ''}${p.licence.holder ? `, ${p.licence.holder}` : ''}. ${room == null ? '' : room >= 0 ? `${n1(room)} ac-ft of room.` : `Short ${n1(-room)} ac-ft.`}`,
      head: ['Field', 'Acres', 'Even share (ac-ft)', 'Crop', 'Needs (ac-ft)', 'vs share', 'Used (ac-ft)', 'Can take up to (ac-ft)'],
      rows: p.fields.map((f) => [`${f.name}${f.fieldId === o.fieldId ? ' (this field)' : ''}`, n1(f.acres), n1(f.shareAf), f.crop ?? '', n1(f.needAf), n1(f.overShareAf), n1(f.usedAf), n1(f.ceilingAf)]),
    })
  } else if (wr?.canal) {
    const c = wr.canal
    sections.push({
      title: `Water rights: ${wr.district} canal`,
      note: `${wr.district} allotment ${n1(wr.smrid.inches)} in${wr.smrid.setFor !== o.year ? ` (${wr.smrid.setFor}'s until ${o.year}'s is set)` : ''}.`,
      head: ['Field', 'Acres', 'Allotment (in)', 'Allotment (ac-ft)', 'Crop', 'Needs (in)', 'Used (ac-ft)'],
      rows: [[c.name, n1(c.acres), n1(c.allotIn), n1(c.allotAf), c.crop ?? '', n1(c.needIn), n1(c.usedAf)]],
    })
  } else if (wr) {
    sections.push({ title: 'Water rights', head: ['Note'], rows: [[wr.pivot ? `${wr.source ?? 'No water source on file'} - no licence on file. ${wr.note ?? ''}` : 'No pivot linked to this field.']] })
  }
  sections.push({
    title: `Irrigation applied ${o.year}`,
    head: ['Date', `Gross (${unit})`, `Net (${unit})`, 'From'],
    rows: w.events.map((e) => [e.date, d(e.gross_mm), d(e.net_mm), e.source === 'fieldnet' ? 'FieldNET' : e.source === 'manual' ? 'logged by hand' : e.source]),
  })
  const multi = o.series.length > 1
  sections.push({
    title: 'Daily balance',
    note: 'Rain from: gauge = the farm gauge, radar = Environment Canada radar blended with its gauges at this field, model / forecast = weather model. Kc includes the dry-soil slowdown.',
    head: ['Date', ...(multi ? ['Zone'] : []), `Rain (${unit})`, 'Rain from', `Effective irrigation (${unit})`, `ETc (${unit})`, 'Kc', `Available moisture (${unit})`, 'Status', ''],
    rows: o.series.flatMap((sr) =>
      sr.rows
        .filter((r) => inDomain(r.date, o.domain))
        .map((r) => [r.date, ...(multi ? [sr.label] : []), d(r.rainfall_mm), (r.rain_source ?? '').replace('_', ' '), d(r.effective_irrigation_mm), d(r.etc_mm, 2), r.kc == null ? '' : Number(r.kc).toFixed(2), d(r.avail_100_mm), STATUS_LABEL[r.status ?? 'ok'] ?? '', r.is_forecast ? 'forecast' : '']),
    ),
  })

  const cropText = o.crops.length ? o.crops.map((c) => `${c.name}${c.variety ? ` (${c.variety})` : ''}${o.crops.length > 1 && c.acres ? ` ${n1(c.acres)} ac` : ''}`).join(', ') : 'not planned'
  return {
    title: `${o.fieldName} - ${o.graphLabel}`,
    subtitle: `AIMM field report · crop year ${o.year}`,
    meta: [
      ['Crop', cropText],
      ['Modelled as', o.modelledAs],
      ['Planted', o.planted],
      ['Soil sample site', o.profile?.sample_site_name ?? null],
      ['Showing', shown.length ? `${shown[0].date} to ${shown.at(-1)!.date}` : null],
      ['Units', unit],
      ['Printed', new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })],
    ],
    image: o.image ?? undefined,
    lead,
    sections,
  }
}

/** The CSV: the season's daily balance, a row a day (a row a zone a day on a split field), numbers bare. */
export function aimmBalanceReport(o: { fieldName: string; year: number; series: BalanceSeries[]; u: UnitSystem }): ReportData {
  const unit = conv.depthUnit(o.u)
  const multi = o.series.length > 1
  const v = (mm: number | string | null | undefined) => (mm == null ? null : depthValue(Number(mm), o.u))
  const places = o.u === 'metric' ? 1 : 2
  const rows: Cell[][] = o.series.flatMap((sr) =>
    sr.rows.map((r: WaterBalanceRow) => [
      r.date,
      ...(multi ? [sr.label] : []),
      v(r.rainfall_mm),
      (r.rain_source ?? '').replace('_', ' ') || null,
      v(r.effective_irrigation_mm),
      v(r.etc_mm),
      r.kc == null ? null : Number(r.kc),
      v(r.avail_100_mm),
      STATUS_LABEL[r.status ?? 'ok'] ?? null,
      r.is_forecast ? 'forecast' : null,
    ]),
  )
  const first = o.series[0]?.rows[0]?.date
  const last = o.series[0]?.rows.at(-1)?.date
  return {
    title: `${o.fieldName} - daily water balance`,
    subtitle: `AIMM field report · crop year ${o.year}`,
    meta: [
      ['Days', o.series[0]?.rows.length ?? 0],
      ['From', first ?? null],
      ['To', last ?? null],
      ['Units', unit],
    ],
    columns: [
      { label: 'Date' },
      ...(multi ? [{ label: 'Zone' }] : []),
      { label: `Rain (${unit})`, decimals: places },
      { label: 'Rain from' },
      { label: `Effective irrigation (${unit})`, decimals: places },
      { label: `ETc (${unit})`, decimals: places + 1 },
      { label: 'Kc', decimals: 2 },
      { label: `Available moisture (${unit})`, decimals: places },
      { label: 'Status' },
      { label: 'Forecast' },
    ],
    groups: [{ title: '', rows }],
    filename: `AIMM ${o.fieldName} daily balance ${o.year}`,
  }
}

/* ── Drawing the chart off-screen ───────────────────────────────────────── */

/** As wide as the Graph page draws it on a laptop, so the PDF looks the same. */
export const OFFSCREEN_WIDTH = 960

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Mount a chart where nobody sees it, wait until it has drawn, snapshot it
 * as the Graph page's PDF does (chartToPng), and take it down again.
 *
 * Recharts lays a chart out over a few renders (it measures its axes and
 * legend, then places the plot), so "drawn" is: the surface has axis ticks
 * and its markup has stopped changing for a few checks running. Timers, not
 * animation frames, because a tab in the background gets no frames and the
 * report would wait for ever; it gives up after a few seconds and the PDF
 * goes without its chart rather than not at all.
 */
export async function snapshotOffscreen(node: ReactNode, width = OFFSCREEN_WIDTH, timeoutMs = 5000): Promise<TableReport['image'] | null> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // Off the left edge rather than display:none, which has no size to lay out in.
  Object.assign(host.style, { position: 'fixed', left: `-${width + 2000}px`, top: '0', width: `${width}px`, background: '#fff', pointerEvents: 'none' })
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(node)
    let last = ''
    let steady = 0
    for (const end = Date.now() + timeoutMs; Date.now() < end && steady < 3; ) {
      await pause(50)
      const svg = host.querySelector('.recharts-wrapper > svg.recharts-surface')
      const now = svg && host.querySelector('.recharts-cartesian-axis-tick') ? svg.innerHTML : ''
      steady = now && now === last ? steady + 1 : 0
      last = now
    }
    if (steady < 3) return null
    return await chartToPng(host)
  } finally {
    root.unmount()
    host.remove()
  }
}

/* ── From the Reports page ──────────────────────────────────────────────── */

export const useAimmRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const fieldId = p.field ?? ''
  const graph = (['moist100', 'dailyet', 'accumet', 'precip'].includes(p.graph) ? p.graph : 'moist100') as GraphType
  const fields = useFields()
  const profiles = useSoilProfiles()
  const plans = useCropPlans(year)
  const crops = useCrops()
  const seasons = useFieldSeasons(year)
  const coefs = useCropCoefficients()
  const zones = useAllCropZones()
  const series = useFieldBalanceSeries(fieldId || undefined)
  const readings = useSoilReadings(fieldId, year)
  const w = useFieldWater(fieldId, year)
  const qs = [fields, profiles, plans, crops, seasons, coefs, zones, series, readings]
  return {
    ready: Boolean(fieldId) && qs.every((q) => !q.isLoading) && w.ready,
    error: !fieldId ? new Error('Choose a field.') : ((qs.find((q) => q.error)?.error as Error | undefined) ?? null),
    build: async () => {
      const field = (fields.data ?? []).find((f) => f.id === fieldId)
      const fieldName = field?.name ?? 'Field'
      const seasonRows = (series.data ?? []).filter((r) => r.date.startsWith(String(year)))
      if (!seasonRows.length) throw new Error(`No ${year} model data for ${fieldLabel(fieldName)}. Set a planting date on Soil moisture → Setup and run Sync.`)
      const balance = groupBalanceByZone(
        seasonRows,
        (zones.data ?? []).filter((z) => z.geojson).map((z) => ({ id: z.id, crop_id: z.crop_id })),
        (crops.data ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color })),
      )
      if (ctx.format === 'CSV') return aimmBalanceReport({ fieldName, year, series: balance, u: ctx.units })

      const profile = (profiles.data ?? []).find((x) => x.field_id === fieldId) ?? null
      const info = aimmCropInfo(fieldId, plans.data ?? [], crops.data ?? [], seasons.data ?? [], coefs.data ?? [])
      const readingMap = new Map((readings.data ?? []).map((r) => [r.read_on, Number(r.avail_mm)]))
      const range: [number, number] = [tOf(seasonRows[0].date), tOf(seasonRows.at(-1)!.date)]
      const image = await snapshotOffscreen(
        <AimmChart graph={graph} series={balance} seasonRows={seasonRows} profile={profile} u={ctx.units} domain={null} range={range} readings={readingMap} still={{ width: OFFSCREEN_WIDTH }} />,
      )
      const label = graphLabel(graph)
      const table = aimmReportTable({ image, fieldName, graphLabel: label, crops: info.planned, modelledAs: info.modelledAs, planted: info.planted, profile, series: balance, domain: null, u: ctx.units, w, fieldId, year })
      // Said rather than left to be noticed: the tables are still worth having.
      if (!image) table.lead = ['The graph could not be drawn here; the PDF report on the Soil moisture → Graph page carries it.', ...(table.lead ?? [])]
      return { ...table, filename: aimmFileName(fieldName, label) }
    },
  }
}
