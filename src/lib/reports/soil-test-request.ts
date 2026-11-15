import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { cropYearOf } from '@/lib/soil-import'
import { profileTotals, topsoilAverage, type SoilSampleRow } from '@/lib/soilTests'
import type { ManureApplication } from '@/lib/manure-credit'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, fieldLabel, longDate, num, yearParam, type Cell, type GatherContext, type ParamValues, type SectionedReport } from './framework'
import { loadSeasonBasics, yieldText, type SeasonBasics } from './field-season'
import { fieldFertility, loadFertility, loadManure, type FertilityData } from './nutrients'
import { mainArea } from './nutrient-balance'
import { tileUrl } from '@/lib/offline-tiles'

/**
 * Soil test request: what goes to the lab with the samples.
 *
 * The fields ticked on Soil tests → To test for one crop year, each with what
 * the lab needs to write a recommendation: where it is, how big, irrigated or
 * not, a map with the old sample sites, and its last four seasons (crop and
 * yield, fertilizer by nutrient, manure, and the soil tests on file). Next
 * year's crop only when asked for: in the fall there is often no plan yet,
 * and a guessed crop would steer the recommendation.
 */

export const HISTORY_YEARS = 4

/**
 * Page one's columns. Last year's crop is on it because the lab reads the
 * whole run off one sheet: the recommendation it writes depends on what came
 * off the field, and flipping to a field's own page to find out defeats the
 * summary.
 */
export const summaryColumns = (year: number) => ['Field', 'Legal land', 'Acres', 'Water', 'GPS (lat, long)', `${year - 1} crop`]
export const HISTORY_COLUMNS = ['Crop year', 'Crop', 'Yield', 'N lb/ac', 'P2O5 lb/ac', 'K2O lb/ac', 'S lb/ac', 'Fertilizer products', 'Manure']
export const SOIL_COLUMNS = ['Crop year', 'Sampled', 'Lab', 'Nitrate-N 0-24 in (lb/ac)', 'Olsen P (ppm)', 'K (ppm)', 'SO4-S 0-6 in (ppm)', 'pH', 'OM (%)', 'EC (mS/cm)']

type SampleLite = Pick<SoilSampleRow, 'report_id' | 'sample_code' | 'depth_top_in' | 'no3n_lb_ac' | 'p_bicarb_ppm' | 'k_ppm' | 'so4s_ppm' | 'ph' | 'om_pct' | 'ec_ms_cm'>
export type ReportLite = { id: string; field_id: string; crop_year: number; report_date: string | null; lab: string | null }

const round = (v: number | null, places = 0) => (v == null ? null : Math.round(v * 10 ** places) / 10 ** places)

/** The crop year a spread belongs to by its date, on the soil tests' July rule; its own crop_year when undated. */
export function manureYear(m: Pick<ManureApplication, 'applied_on' | 'crop_year'>): number {
  return cropYearOf(m.applied_on) ?? m.crop_year
}

/** "6 Nov 2026: solid beef, straw bedded, 15 t/ac on 39 ac". */
export function manureText(m: Pick<ManureApplication, 'applied_on' | 'source' | 'manure_type' | 'rate_tons_per_acre' | 'acres'>): string {
  const what = [m.source, m.manure_type].filter(Boolean).map((s) => String(s).replace(/_/g, ' ')).join(', ')
  const rate = m.rate_tons_per_acre != null ? `${round(m.rate_tons_per_acre, 1)} t/ac` : 'rate not recorded'
  const area = m.acres != null ? ` on ${round(m.acres, 1)} ac` : ''
  return `${m.applied_on ? longDate(m.applied_on) : 'Undated'}: ${what || 'manure'}, ${rate}${area}`
}

/** One crop year's soil test on a field, its parts (East Ranch's halves) read as one. */
export function soilTestRow(year: number, reports: ReportLite[], samples: SampleLite[]): Cell[] {
  const ids = new Set(reports.map((r) => r.id))
  const rows = samples
    .filter((s) => ids.has(s.report_id))
    .map((s) => ({
      ...s,
      depth_top_in: num(s.depth_top_in),
      no3n_lb_ac: num(s.no3n_lb_ac),
      p_bicarb_ppm: num(s.p_bicarb_ppm),
      k_ppm: num(s.k_ppm),
      so4s_ppm: num(s.so4s_ppm),
      ph: num(s.ph),
      om_pct: num(s.om_pct),
      ec_ms_cm: num(s.ec_ms_cm),
    })) as SoilSampleRow[]
  const totals = profileTotals(rows)
  const dates = reports.map((r) => r.report_date).filter((d): d is string => Boolean(d)).sort()
  const labs = [...new Set(reports.map((r) => r.lab).filter(Boolean))].join(', ')
  return [
    String(year),
    dates[0] ? longDate(dates[0]) : null,
    labs || null,
    round(totals.avgNo3nLbAc),
    round(topsoilAverage(rows, 'p_bicarb_ppm')),
    round(topsoilAverage(rows, 'k_ppm')),
    round(totals.so4sTopPpm),
    round(topsoilAverage(rows, 'ph'), 1),
    round(topsoilAverage(rows, 'om_pct'), 1),
    round(topsoilAverage(rows, 'ec_ms_cm'), 2),
  ]
}

/** A season's crop and yield on a field: the plan's main crop, else whatever the yield record says. */
export function cropAndYield(fieldId: string, b: SeasonBasics): { crop: string | null; yield: string | null } {
  const area = mainArea(b.areas.filter((a) => a.fieldId === fieldId))
  const mine = b.history.filter((h) => h.field_id === fieldId)
  const rec = (area && mine.find((h) => h.crop_id === area.cropId && num(h.yield_per_acre) != null)) ?? mine.find((h) => num(h.yield_per_acre) != null) ?? null
  const crop = area?.crop ?? (rec?.crop_id ? (b.crops.find((c) => c.id === rec.crop_id)?.name ?? null) : null)
  const unit = rec?.yield_unit ?? b.crops.find((c) => c.id === (area?.cropId ?? rec?.crop_id))?.yield_unit ?? null
  return { crop, yield: rec ? yieldText(num(rec.yield_per_acre), unit) : null }
}

/** One crop year's row of the field's history. */
export function historyRow(
  year: number,
  label: string,
  fieldId: string,
  basics: SeasonBasics | null,
  fertility: FertilityData,
  acres: number | null,
  manure: ManureApplication[],
): Cell[] {
  const { crop, yield: y } = basics ? cropAndYield(fieldId, basics) : { crop: null, yield: null }
  // The farm's own fertilizer only; manure has its own column, as spread, not as a credit.
  const fert = fieldFertility(fieldId, year, { ...fertility, manure: [] }, acres)
  const lines = fert.lines.filter((l) => l.source !== 'manure')
  const t = fert.total
  const has = lines.length > 0
  const products = [...new Set(lines.map((l) => l.product))].join('; ')
  return [
    label,
    crop,
    y,
    has ? round(t.n) : null,
    has ? round(t.p2o5) : null,
    has ? round(t.k2o) : null,
    has ? round(t.s) : null,
    products || null,
    manure.length ? manure.map(manureText).join('; ') : null,
  ]
}

/* ── The map ─────────────────────────────────────────────────────────────── */

type Ring = [number, number][]

function rings(geometry: unknown): Ring[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (!g?.coordinates) return []
  if (g.type === 'Polygon') return g.coordinates as Ring[]
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).flat()
  return []
}

/**
 * Where to send someone to the field: the centre of its largest piece, as
 * "52.46523, -113.20494" (five places is about a metre). The area-weighted
 * centre rather than the middle of the box, so an L-shaped field's point
 * still lands on the field more often than not.
 */
export function fieldGps(geometry: unknown): string | null {
  const outers = (() => {
    const g = geometry as { type?: string; coordinates?: unknown } | null
    if (!g?.coordinates) return [] as Ring[]
    if (g.type === 'Polygon') return [(g.coordinates as Ring[])[0]]
    if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).map((p) => p[0])
    return [] as Ring[]
  })().filter((r) => r && r.length >= 3)
  if (!outers.length) return null
  let best: { a: number; x: number; y: number } | null = null
  for (const r of outers) {
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]
      a += f
      cx += (r[j][0] + r[i][0]) * f
      cy += (r[j][1] + r[i][1]) * f
    }
    if (Math.abs(a) < 1e-12) continue
    const c = { a: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) }
    if (!best || c.a > best.a) best = c
  }
  if (!best) return null
  return `${best.y.toFixed(5)}, ${best.x.toFixed(5)}`
}

/** Web Mercator pixels at zoom z (256-pixel tiles). */
const mercX = (lng: number, z: number) => ((lng + 180) / 360) * 256 * 2 ** z
const mercY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z
}

/** One imagery tile as something a canvas can draw, or null if it would not load. */
async function loadTile(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await createImageBitmap(await res.blob())
  } catch {
    return null
  }
}

/**
 * The field on satellite imagery, outlined, with its earlier sample sites, as
 * a JPEG for the PDF. The same Esri imagery the app's map draws, so the lab
 * sees what the person ticking the field saw. If the imagery will not load
 * (offline), the outline is still drawn on white rather than leaving no map.
 * Null outside a browser or with no boundary.
 */
export async function fieldMapImage(
  geometry: unknown,
  sites: { code: string; lat: number; lng: number }[],
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const all = rings(geometry)
  if (!all.length || typeof document === 'undefined') return null
  const pts = [...all.flat(), ...sites.map((s) => [s.lng, s.lat] as [number, number])]
  const minLng = Math.min(...pts.map((p) => p[0]))
  const maxLng = Math.max(...pts.map((p) => p[0]))
  const minLat = Math.min(...pts.map((p) => p[1]))
  const maxLat = Math.max(...pts.map((p) => p[1]))
  const W = 900
  const H = 520
  const pad = 50
  // The closest zoom that still fits the field with a margin.
  let z = 18
  while (z > 3 && (mercX(maxLng, z) - mercX(minLng, z) > W - 2 * pad || mercY(minLat, z) - mercY(maxLat, z) > H - 2 * pad)) z--
  const cx = (mercX(minLng, z) + mercX(maxLng, z)) / 2
  const cy = (mercY(minLat, z) + mercY(maxLat, z)) / 2
  const ox = cx - W / 2
  const oy = cy - H / 2
  const at = (lng: number, lat: number): [number, number] => [mercX(lng, z) - ox, mercY(lat, z) - oy]

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const tiles: { x: number; y: number }[] = []
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) tiles.push({ x: tx, y: ty })
  const images = await Promise.all(tiles.map((t) => loadTile(tileUrl(z, t.x, t.y))))
  const imagery = images.some(Boolean)
  images.forEach((img, i) => {
    if (img) ctx.drawImage(img, tiles[i].x * 256 - ox, tiles[i].y * 256 - oy, 256, 256)
  })

  ctx.beginPath()
  for (const r of all) {
    r.forEach(([lng, lat], i) => {
      const [x, y] = at(lng, lat)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.closePath()
  }
  if (!imagery) {
    ctx.fillStyle = '#e8f3e4'
    ctx.fill('evenodd')
  }
  // A dark halo under a bright line reads on both crop and bare soil.
  ctx.lineJoin = 'round'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()
  ctx.lineWidth = 3.5
  ctx.strokeStyle = imagery ? '#facc15' : '#2f6b2a'
  ctx.stroke()

  ctx.font = 'bold 20px sans-serif'
  ctx.lineWidth = 4
  for (const s of sites) {
    const [x, y] = at(s.lng, s.lat)
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.fillStyle = '#dc2626'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'
    ctx.strokeText(s.code, x + 12, y + 7)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(s.code, x + 12, y + 7)
  }

  // North is up.
  ctx.beginPath()
  ctx.moveTo(W - 30, 14)
  ctx.lineTo(W - 41, 42)
  ctx.lineTo(W - 19, 42)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fill()
  ctx.font = 'bold 18px sans-serif'
  ctx.lineWidth = 4
  ctx.strokeText('N', W - 37, 64)
  ctx.fillText('N', W - 37, 64)
  if (imagery) {
    ctx.font = '13px sans-serif'
    ctx.lineWidth = 3
    ctx.strokeText('Imagery © Esri', W - 112, H - 10)
    ctx.fillText('Imagery © Esri', W - 112, H - 10)
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: W, height: H }
}

/* ── Gather ──────────────────────────────────────────────────────────────── */

export async function gatherSoilTestRequest(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const year = yearParam(p, ctx)
  const withNext = p.next === 'yes'
  const pdf = (ctx.format ?? 'PDF') === 'PDF'
  const years = Array.from({ length: HISTORY_YEARS }, (_, i) => year - HISTORY_YEARS + i)

  const { data: requests, error } = await supabase.from('soil_test_requests').select('field_id, notes').eq('crop_year', year)
  if (error) throw new Error(error.message)
  if (!requests?.length) throw new Error(`No fields are ticked for the ${year} crop. Tick them on Soil tests → To test.`)

  const [basicsByYear, fertByYear, manure, reports, samples, bounds, sites] = await Promise.all([
    Promise.all([...years, ...(withNext ? [year] : [])].map((y) => loadSeasonBasics(y))),
    Promise.all([...years, year].map((y) => loadFertility(y, null))),
    loadManure(),
    fetchAll<ReportLite>((a, b) => supabase.from('soil_test_reports').select('id, field_id, crop_year, report_date, lab').gte('crop_year', years[0]).lt('crop_year', year).order('id').range(a, b)),
    fetchAll<SampleLite>((a, b) =>
      supabase.from('soil_test_samples').select('report_id, sample_code, depth_top_in, no3n_lb_ac, p_bicarb_ppm, k_ppm, so4s_ppm, ph, om_pct, ec_ms_cm').order('id').range(a, b),
    ),
    // Every file needs the boundaries: the summary's GPS point comes off them.
    fetchAll<{ field_id: string; geometry: unknown; valid_from: string; valid_to: string | null }>((a, b) =>
      supabase.from('field_boundaries_geojson').select('field_id, geometry, valid_from, valid_to').order('id').range(a, b),
    ),
    pdf
      ? fetchAll<{ field_id: string; code: string; lat: number; lng: number; crop_year: number | null }>((a, b) =>
          supabase.from('soil_sample_sites').select('field_id, code, lat, lng, crop_year').eq('active', true).order('id').range(a, b),
        )
      : Promise.resolve([]),
  ])
  const basics = new Map(basicsByYear.map((b) => [b.year, b]))
  const latest = basicsByYear.find((b) => b.year === year - 1) ?? basicsByYear[basicsByYear.length - 1]
  const fieldById = new Map(latest.fields.map((f) => [f.id, f]))
  const notes = new Map(requests.map((r) => [r.field_id, r.notes as string | null]))
  const ids = requests.map((r) => r.field_id).filter((id) => fieldById.has(id))
  ids.sort((a, b) => compareFieldNames(fieldById.get(a)!.name, fieldById.get(b)!.name))

  const eoy = `${year - 1}-12-31`
  const boundaryOf = (id: string) => {
    const mine = bounds.filter((b) => b.field_id === id)
    return (mine.find((b) => b.valid_from <= eoy && (b.valid_to == null || b.valid_to > eoy)) ?? mine.find((b) => b.valid_to == null) ?? mine[0])?.geometry
  }

  const factsHead = ['Legal land', 'Acres', 'Water', 'Last soil test', ...(withNext ? [`${year} crop`] : []), 'Note']
  const water = (id: string) => (latest.irrigated.has(id) ? 'Irrigated' : 'Dryland')

  // Page one: every field on one sheet, for the lab to plan the run from.
  const lastSeason = basics.get(year - 1) ?? null
  const summaryRows: Cell[][] = ids.map((id) => {
    const f = fieldById.get(id)!
    const lastCrop = lastSeason ? cropAndYield(id, lastSeason).crop : null
    return [fieldLabel(f.name), f.legal_land_description, round(latest.acresOf.get(id) ?? null, 1), water(id), fieldGps(boundaryOf(id)), lastCrop]
  })
  const acresTotal = ids.reduce((t, id) => t + (latest.acresOf.get(id) ?? 0), 0)
  const sections: ReportSection[] = [
    {
      title: 'Fields to test',
      note: 'GPS is the centre of the field, latitude then longitude, in decimal degrees.',
      head: summaryColumns(year),
      rows: summaryRows,
      foot: ['Total', null, round(acresTotal, 1), null, null, null],
      align: ['left', 'left', 'right', 'left', 'left', 'left'],
      // A dozen fields fit page one at the usual row height; past that the
      // rows are squeezed rather than letting the list run onto a second page.
      compact: ids.length > 12,
    },
  ]
  for (const id of ids) {
    const f = fieldById.get(id)!
    const acres = latest.acresOf.get(id) ?? null
    const mineReports = reports.filter((r) => r.field_id === id)
    const lastTest = mineReports.reduce((m, r) => Math.max(m, r.crop_year), 0)
    let next: string | null = null
    if (withNext) {
      const area = mainArea((basics.get(year)?.areas ?? []).filter((a) => a.fieldId === id))
      next = area ? [area.crop, area.variety, area.expectedYield != null ? `target ${yieldText(area.expectedYield, null)}` : null].filter(Boolean).join(', ') : 'Not planned yet'
    }
    const title = fieldLabel(f.name)
    sections.push({
      title,
      head: factsHead,
      rows: [[f.legal_land_description, round(acres, 1), water(id), lastTest ? String(lastTest) : 'None on file', ...(withNext ? [next] : []), notes.get(id) ?? null]],
      pageBreakBefore: true,
    })

    if (pdf) {
      const fieldSites = sites.filter((s) => s.field_id === id && (s.crop_year == null || s.crop_year >= years[0]))
      const image = await fieldMapImage(boundaryOf(id), fieldSites)
      if (image) {
        sections.push({
          title: 'Map',
          note: fieldSites.length ? 'Red points are where earlier cores were pulled.' : undefined,
          head: [''],
          rows: [['']],
          minRowHeight: 230,
          cellImages: [{ row: 0, col: 0, image }],
        })
      }
    }

    const spreads = manure.filter((m) => m.field_id === id)
    const rows: Cell[][] = years.map((y, yi) =>
      historyRow(y, String(y), id, basics.get(y) ?? null, fertByYear[yi], acres, spreads.filter((m) => manureYear(m) === y)),
    )
    // Anything already on for the year being tested for: a fall spread, fall fertilizer.
    const now = historyRow(year, `${year} so far`, id, null, fertByYear[years.length], acres, spreads.filter((m) => manureYear(m) === year))
    if (now.slice(3).some((c) => c != null)) rows.push(now)
    sections.push({ title: `Crops, fertilizer and manure, ${years[0]}–${year - 1}`, head: HISTORY_COLUMNS, rows, align: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left', 'left'] })

    const soilRows = years.flatMap((y) => {
      const rs = mineReports.filter((r) => r.crop_year === y)
      return rs.length ? [soilTestRow(y, rs, samples)] : []
    })
    sections.push({ title: `Soil tests on file, ${years[0]}–${year - 1}`, head: SOIL_COLUMNS, rows: soilRows, empty: 'No soil test on file in these years.' })
  }
  if (!ids.length) throw new Error('The ticked fields could not be found. They may have been archived.')

  return {
    title: 'Soil test request',
    subtitle: `For the ${year} crop · ${ids.length} field${ids.length === 1 ? '' : 's'}`,
    meta: [
      ['Crop year', String(year)],
      ['Fields', ids.length],
      ['Acres', Math.round(acresTotal)],
      ['History', `${years[0]}–${year - 1}`],
    ],
    lead: [
      'Page one lists every field with its legal land, acres, GPS point and last year’s crop. Then a page a field: a satellite map, its last four seasons and the soil tests on file. Fertilizer is actual nutrient in lb/ac over the whole field, from the application records and the retailer’s floated blends; manure is listed as spread.',
      'Soil test figures are field averages: nitrate-N over 0–24 in, the rest from the topsoil cores.',
    ],
    orientation: 'landscape',
    sections,
    filename: `Soil test request ${year}`,
  }
}

/** The same report as an Excel sheet, for the lab's own system. */
export async function soilTestRequestXlsx(p: ParamValues, ctx: GatherContext): Promise<{ blob: Blob; filename: string }> {
  const r = await gatherSoilTestRequest(p, { ...ctx, format: 'XLSX' })
  const { tableReportToXlsx } = await import('@/lib/table-report-xlsx')
  return { blob: await tableReportToXlsx(r, { sheetName: 'Soil test request' }), filename: `${r.filename}.xlsx` }
}
