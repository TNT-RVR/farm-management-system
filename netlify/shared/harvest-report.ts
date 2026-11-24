import type { SupabaseClient } from '@supabase/supabase-js'
import { farmName, farmTz } from '../../src/lib/farm-context.ts'

/**
 * The after-harvest report for one field and year (Sam, 23 Nov 2026): what
 * went on the field, what came off it, and which bins it went into — emailed
 * to the field's agronomist once the field is marked finished.
 *
 * Built on the service client because it runs from the daily job. Nothing
 * about money: it goes to people outside the farm, and the app is the farm's
 * own record to check their advice against, not theirs to price it.
 */

type Row = Record<string, unknown>

const n = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (v: number | null, dp = 0) => (v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp }))
const HA_TO_AC = 2.471054

/** A timestamp as the farm's calendar day. */
const farmDay = (ts: unknown): string | null => {
  const t = s(ts)
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: farmTz() })
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "26 Oct 2026". */
export const longDay = (iso: string | null): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
/** "ml1ac-1" → "ml/ac". */
const unitLabel = (u: unknown) => String(u ?? '').replace(/1ac-1$/, '/ac').replace(/^gal\//, 'gal/')

export type ReportApplication = {
  date: string | null
  name: string
  acres: number | null
  /** Each product in the tank, with its rate an acre. */
  products: { name: string; rate: string; kind: 'chemical' | 'fertilizer' }[]
  water: string | null
}

export type ReportBin = {
  bin: string
  loads: number
  bushels: number | null
  tonnes: number | null
  moisture: number | null
  protein: number | null
  first: string | null
  last: string | null
  varieties: string[]
  estimated: number
}

export type HarvestReport = {
  fieldId: string
  field: string
  legal: string | null
  year: number
  acres: number | null
  crops: { crop: string; variety: string | null; acres: number | null }[]
  seeded: string | null
  harvestStarted: string | null
  harvestFinished: string | null
  yields: { crop: string; acres: number | null; perAcre: number | null; unit: string; source: string | null }[]
  sprays: ReportApplication[]
  fertilizer: ReportApplication[]
  /** Retailer blends and fertilizer, one line per product, date and rate (its tickets added up). */
  blends: { date: string | null; description: string; rateLbAc: number | null; acres: number | null; tonnes: number | null }[]
  manure: { date: string | null; source: string | null; tonsAc: number | null; acres: number | null }[]
  irrigation: { mm: number; days: number } | null
  rain: { mm: number; from: string; to: string } | null
  hail: { date: string | null; lossPct: number | null; notes: string | null }[]
  moisture: { tests: number; avg: number | null; min: number | null; max: number | null } | null
  lossChecks: { date: string | null; buAc: number | null; pct: number | null }[]
  bins: ReportBin[]
}

async function all(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as Row[] | null) ?? []
}

/** The day each part of the season happened, and the field finished. */
export async function gatherHarvestReport(sb: SupabaseClient, fieldId: string, year: number): Promise<HarvestReport> {
  const [fieldRows, bounds, plans, zones, crops, seasons, finishes, yields, ops, blends, manure, irrigation, hail, moisture, losses, loads] = await Promise.all([
    all(sb.from('fields').select('id, name, legal_land_description, assigned_station_id').eq('id', fieldId)),
    all(sb.from('field_boundaries').select('acres, valid_from, valid_to').eq('field_id', fieldId)),
    all(sb.from('crop_plans').select('crop_id, variety, planned_acres').eq('field_id', fieldId).eq('crop_year', year)),
    all(sb.from('field_crop_zones').select('crop_id, acres').eq('field_id', fieldId).eq('crop_year', year)),
    all(sb.from('crops').select('id, name, yield_unit')),
    all(sb.from('field_crop_seasons').select('zone_id, planting_date, harvest_date').eq('field_id', fieldId).eq('crop_year', year)),
    all(
      sb
        .from('field_work_records')
        .select('zone_id, started_at, finished_at')
        .eq('field_id', fieldId)
        .eq('crop_year', year)
        .eq('field_finished', true),
    ),
    all(sb.from('crop_yields_v').select('crop_id, acres, yield_per_acre, yield_unit, source').eq('field_id', fieldId).eq('crop_year', year)),
    all(
      sb
        .from('jd_field_operations')
        .select('operation_type, started_at, applied_area_ha, products')
        .eq('field_id', fieldId)
        .eq('crop_season', year)
        .in('operation_type', ['application', 'seeding', 'harvest'])
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('started_at'),
    ),
    all(
      sb
        .from('ici_field_lines')
        .select('invoice_date, description, rate_lb_ac, kind, quantity, unit, ticket_acres')
        .eq('field_id', fieldId)
        .eq('crop_year', year)
        .in('kind', ['blend', 'fertilizer'])
        .order('invoice_date'),
    ),
    all(sb.from('manure_applications').select('applied_on, source, rate_tons_per_acre, acres').eq('field_id', fieldId).eq('crop_year', year).order('applied_on')),
    all(
      sb
        .from('irrigation_events')
        .select('date, gross_mm, adjusted_gross_mm')
        .eq('field_id', fieldId)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`),
    ),
    all(sb.from('field_hail_events').select('event_date, loss_pct, notes').eq('field_id', fieldId).eq('crop_year', year).order('event_date')),
    all(sb.from('field_harvest_moisture').select('tests, avg_pct, min_pct, max_pct').eq('field_id', fieldId).eq('crop_year', year)),
    all(sb.from('combine_loss_checks').select('checked_at, loss_bu_per_acre, loss_pct').eq('field_id', fieldId).eq('crop_year', year).order('checked_at')),
    all(
      sb
        .from('bin_loads')
        .select('bin_id, variety, loaded_on, net_kg, bushels, moisture_pct, protein_pct, estimated, direction')
        .eq('field_id', fieldId)
        .eq('crop_year', year),
    ),
  ])
  const field = fieldRows[0]
  if (!field) throw new Error('Field not found')

  const cropById = new Map(crops.map((c) => [String(c.id), c]))
  const cropName = (id: unknown) => s(cropById.get(String(id))?.name) ?? 'Unknown crop'

  // Acres: the boundary in effect at the end of the year.
  const yearEnd = `${year}-12-31`
  const bound = bounds
    .filter((b) => (!b.valid_from || String(b.valid_from) <= yearEnd) && (!b.valid_to || String(b.valid_to) > yearEnd))
    .sort((a, b) => String(b.valid_from ?? '').localeCompare(String(a.valid_from ?? '')))[0]

  const cropsOut = zones.length
    ? zones.map((z) => ({
        crop: cropName(z.crop_id),
        variety: plans.find((p) => p.crop_id === z.crop_id)?.variety ? s(plans.find((p) => p.crop_id === z.crop_id)!.variety) : null,
        acres: n(z.acres),
      }))
    : plans.map((p) => ({ crop: cropName(p.crop_id), variety: s(p.variety), acres: n(p.planned_acres) ?? n(bound?.acres) }))

  const whole = seasons.find((x) => x.zone_id == null)
  const firstOp = (type: string) => farmDay(ops.find((o) => o.operation_type === type && o.started_at)?.started_at)
  const loadDays = loads.map((l) => s(l.loaded_on)).filter((d): d is string => !!d).sort()
  const seeded = s(whole?.planting_date) ?? firstOp('seeding')
  const finishStarted = finishes.map((f) => farmDay(f.started_at)).filter((d): d is string => !!d).sort()[0]
  const harvestStarted =
    finishStarted ?? s(whole?.harvest_date) ?? [firstOp('harvest'), loadDays[0]].filter((d): d is string => !!d).sort()[0] ?? null
  const harvestFinished = finishes.map((f) => farmDay(f.finished_at)).filter((d): d is string => !!d).sort().pop() ?? null

  const sprays: ReportApplication[] = []
  const fertilizer: ReportApplication[] = []
  for (const o of ops) {
    if (o.operation_type !== 'application') continue
    for (const p of (Array.isArray(o.products) ? o.products : []) as Row[]) {
      const comps = (Array.isArray(p.components) ? p.components : []) as Row[]
      const rate = (r: unknown) => {
        const rr = r as Row | null
        return rr && n(rr.value) != null ? `${fmt(n(rr.value), n(rr.value)! < 10 ? 2 : 0)} ${unitLabel(rr.unitId)}` : ''
      }
      const products = comps.length
        ? comps.map((c) => ({ name: String(c.name ?? ''), rate: rate(c.rate), kind: c.productType === 'FERTILIZER' ? ('fertilizer' as const) : ('chemical' as const) }))
        : [{ name: String(p.name ?? ''), rate: rate(p.rate), kind: /\d+-\d+-\d+/.test(String(p.name ?? '')) ? ('fertilizer' as const) : ('chemical' as const) }]
      const carrier = p.carrier as Row | undefined
      const app: ReportApplication = {
        date: farmDay(o.started_at),
        name: String(p.name ?? 'Application'),
        acres: n(o.applied_area_ha) != null ? n(o.applied_area_ha)! * HA_TO_AC : null,
        products,
        water: carrier && /water/i.test(String(carrier.name ?? '')) && rate(carrier.rate) ? rate(carrier.rate) : null,
      }
      ;(products.every((x) => x.kind === 'fertilizer') ? fertilizer : sprays).push(app)
    }
  }

  const irrMm = irrigation.reduce((t, e) => t + (n(e.adjusted_gross_mm) ?? n(e.gross_mm) ?? 0), 0)
  const irrDays = new Set(irrigation.filter((e) => (n(e.adjusted_gross_mm) ?? n(e.gross_mm) ?? 0) > 0).map((e) => String(e.date))).size

  // Rain at the field's weather station from seeding (else 1 April) to the
  // finish (else the last load, else 31 October).
  let rain: HarvestReport['rain'] = null
  const station = s(field.assigned_station_id)
  if (station) {
    const from = seeded ?? `${year}-04-01`
    const to = harvestFinished ?? loadDays[loadDays.length - 1] ?? `${year}-10-31`
    const days = await all(sb.from('weather_daily').select('precip_mm').eq('station_id', station).gte('date', from).lte('date', to))
    if (days.length) rain = { mm: days.reduce((t, d) => t + (n(d.precip_mm) ?? 0), 0), from, to }
  }

  const binIds = [...new Set(loads.map((l) => s(l.bin_id)).filter((x): x is string => !!x))]
  const binRows = binIds.length ? await all(sb.from('bins').select('id, name').in('id', binIds)) : []
  const binName = new Map(binRows.map((b) => [String(b.id), String(b.name)]))
  const byBin = new Map<string, Row[]>()
  for (const l of loads) {
    if (l.direction && l.direction !== 'in') continue
    const k = s(l.bin_id) ?? ''
    byBin.set(k, [...(byBin.get(k) ?? []), l])
  }
  const weighted = (rows: Row[], col: string) => {
    let w = 0
    let t = 0
    for (const r of rows) {
      const v = n(r[col])
      const kg = n(r.net_kg) ?? n(r.bushels) ?? 1
      if (v != null) {
        w += kg
        t += v * kg
      }
    }
    return w ? t / w : null
  }
  const bins: ReportBin[] = [...byBin.entries()]
    .map(([id, rows]) => {
      const days = rows.map((r) => s(r.loaded_on)).filter((d): d is string => !!d).sort()
      const bu = rows.reduce((t, r) => t + (n(r.bushels) ?? 0), 0)
      const kg = rows.reduce((t, r) => t + (n(r.net_kg) ?? 0), 0)
      return {
        bin: id ? (binName.get(id) ?? 'Unknown bin') : 'No bin recorded',
        loads: rows.length,
        bushels: bu || null,
        tonnes: kg ? kg / 1000 : null,
        moisture: weighted(rows, 'moisture_pct'),
        protein: weighted(rows, 'protein_pct'),
        first: days[0] ?? null,
        last: days[days.length - 1] ?? null,
        varieties: [...new Set(rows.map((r) => s(r.variety)).filter((v): v is string => !!v))],
        estimated: rows.filter((r) => r.estimated === true).length,
      }
    })
    .sort((a, b) => (b.bushels ?? 0) - (a.bushels ?? 0))

  const m = moisture[0]
  return {
    fieldId,
    field: String(field.name),
    legal: s(field.legal_land_description),
    year,
    acres: n(bound?.acres),
    crops: cropsOut,
    seeded,
    harvestStarted,
    harvestFinished,
    yields: yields.map((y) => ({
      crop: cropName(y.crop_id),
      acres: n(y.acres),
      perAcre: n(y.yield_per_acre),
      unit: s(y.yield_unit) ?? s(cropById.get(String(y.crop_id))?.yield_unit) ?? 'bu',
      source: s(y.source),
    })),
    sprays,
    fertilizer,
    blends: [
      ...blends
        .reduce((m, b) => {
          const k = `${b.invoice_date}|${b.description}|${b.rate_lb_ac}`
          const cur = m.get(k) ?? { date: s(b.invoice_date), description: String(b.description ?? ''), rateLbAc: n(b.rate_lb_ac), acres: null, tonnes: null }
          const ac = n(b.ticket_acres)
          const t = /metric|tonne/i.test(String(b.unit ?? '')) ? n(b.quantity) : null
          if (ac != null) cur.acres = (cur.acres ?? 0) + ac
          if (t != null) cur.tonnes = (cur.tonnes ?? 0) + t
          return m.set(k, cur)
        }, new Map<string, HarvestReport['blends'][number]>())
        .values(),
    ],
    manure: manure.map((x) => ({ date: s(x.applied_on), source: s(x.source), tonsAc: n(x.rate_tons_per_acre), acres: n(x.acres) })),
    irrigation: irrigation.length ? { mm: irrMm, days: irrDays } : null,
    rain,
    hail: hail.map((h) => ({ date: s(h.event_date), lossPct: n(h.loss_pct), notes: s(h.notes) })),
    moisture: m && n(m.tests) ? { tests: n(m.tests)!, avg: n(m.avg_pct), min: n(m.min_pct), max: n(m.max_pct) } : null,
    lossChecks: losses.map((l) => ({ date: farmDay(l.checked_at), buAc: n(l.loss_bu_per_acre), pct: n(l.loss_pct) })),
    bins,
  }
}

/** "Field 0" for a bare number, the name as is otherwise. */
export const fieldLabel = (name: string) => (/^\d+$/.test(name) ? `Field ${name}` : name)

export function reportSubject(r: HarvestReport): string {
  const crop = r.crops.map((c) => c.crop).join(' / ')
  return `${farmName()} — ${fieldLabel(r.field)} ${r.year} harvest report${crop ? ` (${crop})` : ''}`
}

const productLine = (a: ReportApplication) =>
  a.products.map((p) => `${p.name}${p.rate ? ` ${p.rate}` : ''}`).join(', ') + (a.water ? ` · water ${a.water}` : '')

/** The report as an email: HTML with a plain-text twin. */
export function renderHarvestReport(r: HarvestReport, intro?: string): { subject: string; html: string; text: string } {
  const subject = reportSubject(r)
  const H: string[] = []
  const T: string[] = []
  const th = 'style="text-align:left;padding:4px 8px;border-bottom:1px solid #d1d5db;font-weight:600;font-size:12px;color:#374151"'
  const td = 'style="padding:4px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:top"'
  const tdr = 'style="padding:4px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;white-space:nowrap"'
  const table = (head: string[], rows: string[][], right: number[] = []) =>
    `<table style="border-collapse:collapse;width:100%;margin:4px 0 12px">` +
    `<tr>${head.map((h) => `<th ${th}>${esc(h)}</th>`).join('')}</tr>` +
    rows.map((row) => `<tr>${row.map((c, i) => `<td ${right.includes(i) ? tdr : td}>${esc(c)}</td>`).join('')}</tr>`).join('') +
    `</table>`
  const h2 = (t: string) => {
    H.push(`<h3 style="margin:18px 0 4px;font-size:15px;color:#14532d">${esc(t)}</h3>`)
    T.push('', t.toUpperCase())
  }
  const para = (t: string) => {
    H.push(`<p style="margin:2px 0;font-size:13px">${esc(t)}</p>`)
    T.push(t)
  }

  H.push(`<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:720px">`)
  H.push(`<h2 style="margin:0 0 2px;font-size:18px">${esc(fieldLabel(r.field))} — ${r.year} season</h2>`)
  const sub = [r.legal, r.acres != null ? `${fmt(r.acres, 1)} mapped acres` : null].filter(Boolean).join(' · ')
  if (sub) H.push(`<p style="margin:0 0 10px;color:#6b7280;font-size:12px">${esc(sub)}</p>`)
  T.push(`${fieldLabel(r.field)} — ${r.year} season`, sub)
  if (intro) {
    H.push(`<p style="font-size:13px">${esc(intro)}</p>`)
    T.push('', intro)
  }

  h2('Crop')
  for (const c of r.crops) para(`${c.crop}${c.variety ? ` — ${c.variety}` : ''}${c.acres != null ? `, ${fmt(c.acres, 1)} ac` : ''}`)
  if (!r.crops.length) para('No crop on the plan.')
  para(`Seeded ${longDay(r.seeded)} · harvest started ${longDay(r.harvestStarted)} · finished ${longDay(r.harvestFinished)}`)

  h2('Yield')
  if (r.yields.length) {
    const rows = r.yields.map((y) => [y.crop, fmt(y.acres, 1), y.perAcre != null ? `${fmt(y.perAcre, 1)} ${y.unit}/ac` : '—', y.source ?? ''])
    H.push(table(['Crop', 'Acres', 'Yield', 'From'], rows, [1, 2]))
    for (const row of rows) T.push(`${row[0]}: ${row[2]} on ${row[1]} ac (${row[3]})`)
  } else para('No yield recorded yet.')

  h2('Into the bins')
  if (r.bins.length) {
    const rows = r.bins.map((b) => [
      b.bin,
      String(b.loads),
      b.bushels != null ? fmt(b.bushels) : '—',
      b.tonnes != null ? fmt(b.tonnes, 1) : '—',
      b.moisture != null ? `${fmt(b.moisture, 1)} %` : '—',
      b.protein != null ? `${fmt(b.protein, 1)} %` : '—',
      b.first ? (b.first === b.last ? longDay(b.first) : `${longDay(b.first)} – ${longDay(b.last)}`) : '—',
      b.varieties.join(', '),
    ])
    H.push(table(['Bin', 'Loads', 'Bushels', 'Tonnes', 'Moisture', 'Protein', 'Dates', 'Variety'], rows, [1, 2, 3, 4, 5]))
    for (const row of rows) T.push(`${row[0]}: ${row[1]} loads, ${row[2]} bu, ${row[3]} t, moisture ${row[4]}, protein ${row[5]}, ${row[6]}${row[7] ? `, ${row[7]}` : ''}`)
    const est = r.bins.reduce((t, b) => t + b.estimated, 0)
    if (est) para(`${est} load${est === 1 ? ' was' : 's were'} estimated rather than weighed.`)
  } else para('No loads recorded off this field.')

  if (r.moisture || r.lossChecks.length) {
    h2('Harvest checks')
    if (r.moisture) para(`Moisture: ${r.moisture.tests} test${r.moisture.tests === 1 ? '' : 's'}, average ${fmt(r.moisture.avg, 1)} % (${fmt(r.moisture.min, 1)}–${fmt(r.moisture.max, 1)} %)`)
    for (const l of r.lossChecks) para(`Combine loss check ${longDay(l.date)}: ${fmt(l.buAc, 2)} bu/ac${l.pct != null ? ` (${fmt(l.pct, 1)} %)` : ''}`)
  }

  const apps = (title: string, list: ReportApplication[]) => {
    if (!list.length) return
    h2(title)
    const rows = list.map((a) => [longDay(a.date), a.name, a.acres != null ? fmt(a.acres) : '—', productLine(a)])
    H.push(table(['Date', 'Pass', 'Acres', 'Products and rates'], rows, [2]))
    for (const row of rows) T.push(`${row[0]} — ${row[1]} (${row[2]} ac): ${row[3]}`)
  }
  apps('Sprays', r.sprays)
  apps('Fertilizer applied through the sprayer', r.fertilizer)
  if (r.blends.length) {
    h2('Fertilizer blends from the retailer')
    const rows = r.blends.map((b) => [
      longDay(b.date),
      b.description,
      b.rateLbAc != null ? `${fmt(b.rateLbAc)} lb/ac` : '—',
      b.acres != null ? fmt(b.acres) : '—',
      b.tonnes != null ? fmt(b.tonnes, 1) : '—',
    ])
    H.push(table(['Date', 'Product', 'Rate', 'Acres', 'Tonnes'], rows, [2, 3, 4]))
    for (const row of rows) T.push(`${row[0]} — ${row[1]}: ${row[2]} on ${row[3]} ac (${row[4]} t)`)
  }
  if (r.manure.length) {
    h2('Manure')
    for (const x of r.manure) para(`${longDay(x.date)}: ${x.source ?? 'manure'}${x.tonsAc != null ? `, ${fmt(x.tonsAc, 1)} t/ac` : ''}${x.acres != null ? ` on ${fmt(x.acres)} ac` : ''}`)
  }

  h2('Water and weather')
  if (r.irrigation) para(`Irrigation: ${fmt(r.irrigation.mm)} mm (${fmt(r.irrigation.mm / 25.4, 1)} in) over ${r.irrigation.days} day${r.irrigation.days === 1 ? '' : 's'}`)
  else para('No irrigation recorded.')
  if (r.rain) para(`Rain at the field's weather station, ${longDay(r.rain.from)} – ${longDay(r.rain.to)}: ${fmt(r.rain.mm)} mm (${fmt(r.rain.mm / 25.4, 1)} in)`)
  for (const h of r.hail) para(`Hail ${longDay(h.date)}${h.lossPct != null ? `: ${fmt(h.lossPct)} % loss` : ''}${h.notes ? ` — ${h.notes}` : ''}`)

  H.push(`<p style="margin-top:20px;color:#6b7280;font-size:11px">Sent by ${esc(farmName())}'s farm records once the field was marked finished. Reply to this email to reach the farm.</p></div>`)
  T.push('', `Sent by ${farmName()}'s farm records once the field was marked finished. Reply to this email to reach the farm.`)
  return { subject, html: H.join('\n'), text: T.join('\n') }
}

export type Recipient = { contactId: string; name: string; email: string }

/** Send one report through Resend. */
export async function sendReportEmail(
  mail: { subject: string; html: string; text: string },
  to: string,
  opts: { cc?: string[]; replyTo?: string[] },
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  const domain = process.env.RESEND_DOMAIN?.trim().replace(/^@/, '').toLowerCase()
  if (!key || !domain) return { ok: false, error: 'No Resend key and domain in Settings → Connections → Email sender (Resend).' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${farmName()} <noreply@${domain}>`,
      to: [to],
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      ...(opts.replyTo?.length ? { reply_to: opts.replyTo } : {}),
      subject: mail.subject.slice(0, 300),
      html: mail.html,
      text: mail.text,
    }),
  })
  const body = await res.text()
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` }
  try {
    return { ok: true, id: (JSON.parse(body) as { id?: string }).id ?? null }
  } catch {
    return { ok: true, id: null }
  }
}

/** The owners, copied on every report and the address replies go to. */
export async function ownerEmails(sb: SupabaseClient): Promise<string[]> {
  const rows = await all(sb.from('users').select('email').eq('is_owner', true).eq('active', true))
  return rows.map((r) => s(r.email)).filter((e): e is string => !!e && /@/.test(e))
}

/** The field's contacts who take the report and have an email. */
export async function reportRecipients(sb: SupabaseClient, fieldId: string): Promise<(Recipient & { linkedAt: string })[]> {
  const rows = await all(
    sb
      .from('field_contacts')
      .select('created_at, contact:contacts(id, contact_name, company, email, active)')
      .eq('field_id', fieldId)
      .eq('send_harvest_report', true),
  )
  return rows.flatMap((r) => {
    const c = r.contact as Row | null
    const email = s(c?.email)?.trim()
    if (!c || c.active === false || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return []
    return [{ contactId: String(c.id), name: s(c.contact_name) ?? s(c.company) ?? email, email, linkedAt: String(r.created_at) }]
  })
}

/**
 * The daily run: every field marked finished at least two days ago (time for
 * the last loads and moisture tests to be entered) whose contacts have not had
 * the year's report. Only finishes recorded after the contact was linked are
 * sent on their own; an earlier year goes out by hand from the field page.
 */
export async function runHarvestReports(sb: SupabaseClient, now = new Date()): Promise<{ sent: number; failed: number; checked: number }> {
  const links = await all(sb.from('field_contacts').select('field_id, created_at').eq('send_harvest_report', true))
  const fieldIds = [...new Set(links.map((l) => String(l.field_id)))]
  if (!fieldIds.length) return { sent: 0, failed: 0, checked: 0 }
  const settle = new Date(now.getTime() - 2 * 86_400_000).toISOString()
  const finishes = await all(
    sb
      .from('field_work_records')
      .select('field_id, crop_year, zone_id, finished_at')
      .in('field_id', fieldIds)
      .eq('field_finished', true)
      .not('finished_at', 'is', null),
  )
  // A field is finished when its whole-field record is in, or every crop area's is.
  const byFieldYear = new Map<string, Row[]>()
  for (const f of finishes) {
    const k = `${f.field_id}|${f.crop_year}`
    byFieldYear.set(k, [...(byFieldYear.get(k) ?? []), f])
  }
  const owners = await ownerEmails(sb)
  let sent = 0
  let failed = 0
  let checked = 0
  for (const [k, rows] of byFieldYear) {
    const [fieldId, y] = k.split('|')
    const year = Number(y)
    let done: string | null = null
    const wholeRow = rows.filter((r) => r.zone_id == null).map((r) => String(r.finished_at)).sort().pop()
    if (wholeRow) done = wholeRow
    else {
      const zones = await all(sb.from('field_crop_zones').select('id').eq('field_id', fieldId).eq('crop_year', year))
      const doneZones = new Set(rows.map((r) => String(r.zone_id)))
      if (zones.length && zones.every((z) => doneZones.has(String(z.id)))) done = rows.map((r) => String(r.finished_at)).sort().pop() ?? null
    }
    if (!done || new Date(done) > new Date(settle)) continue
    const recipients = (await reportRecipients(sb, fieldId)).filter((r) => new Date(r.linkedAt) <= new Date(done!))
    if (!recipients.length) continue
    const already = await all(
      sb.from('harvest_report_sends').select('contact_id').eq('field_id', fieldId).eq('crop_year', year).eq('kind', 'auto').eq('ok', true),
    )
    const had = new Set(already.map((a) => String(a.contact_id)))
    const todo = recipients.filter((r) => !had.has(r.contactId))
    if (!todo.length) continue
    checked++
    const mail = renderHarvestReport(await gatherHarvestReport(sb, fieldId, year))
    for (const r of todo) {
      const res = await sendReportEmail(mail, r.email, { cc: owners, replyTo: owners })
      await sb.from('harvest_report_sends').insert({
        field_id: fieldId,
        crop_year: year,
        contact_id: r.contactId,
        email: r.email,
        kind: 'auto',
        ok: res.ok,
        error: res.ok ? null : res.error,
        resend_id: res.ok ? res.id : null,
      })
      if (res.ok) sent++
      else failed++
    }
  }
  return { sent, failed, checked }
}
