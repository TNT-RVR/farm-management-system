import type { SupabaseClient } from '@supabase/supabase-js'

// Rain at each field, from Environment Canada's precipitation analyses: radar
// blended with every gauge in the network (CaPA). Measured, not modelled.
//
// Until 1 Oct 2026 the balance took Open-Meteo's modelled rain at two station
// points 16-35 km from most fields. Against Sam's AIMM site rainfall it ran
// 254 mm to AIMM's 216 over 13 May - 17 Aug on field 0, mostly by inventing
// drizzle days; the RDPA at the field came to 194 and caught the same storms
// on the same days (10 Jun 19 v 17 mm, 28 Jun 37 v 32 mm).
//
// RDPA is 10 km with an archive back to 2012, so it backfills a season.
// HRDPA is 2.5 km but GeoMet keeps only 30 days of it, so it has to be taken
// each morning or it is gone. Where both exist the balance prefers HRDPA.
//
// Each layer is a 24-hour total ending 12Z — 6 am MDT — so the value stamped
// 12Z on the 16th is the rain of the 15th (6 am to 6 am), the day a farmer
// reading a gauge at breakfast on the 16th would write it against.

const GEOMET = 'https://geo.weather.gc.ca/geomet'
const LAYERS = {
  rdpa: ['RDPA.24F_PR'],
  // Final first; the preliminary run covers the day or two before it lands.
  hrdpa: ['HRDPA_2.5km_Precip-Accum24h-T12Z', 'HRDPA-Prelim_2.5km_Precip-Accum24h-T12Z'],
} as const
type Product = keyof typeof LAYERS

/** A PostGIS point as PostgREST returns it: hex EWKB, SRID 4326. */
export function pointFromEwkb(hex: string | null | undefined): { lon: number; lat: number } | null {
  if (!hex || hex.length < 50) return null
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)))
  const view = new DataView(bytes.buffer)
  const little = bytes[0] === 1
  const type = view.getUint32(1, little)
  const hasSrid = (type & 0x20000000) !== 0
  const at = 5 + (hasSrid ? 4 : 0)
  const lon = view.getFloat64(at, little)
  const lat = view.getFloat64(at + 8, little)
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The analysis value at a point, mm, or null when the layer has no data for that time. */
async function sample(layer: string, lon: number, lat: number, validDate: string): Promise<number | null> {
  const d = 0.02
  const url =
    `${GEOMET}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${layer}&query_layers=${layer}` +
    `&crs=EPSG:4326&bbox=${lat - d},${lon - d},${lat + d},${lon + d}&width=3&height=3&i=1&j=1` +
    `&info_format=application/json&time=${validDate}T12:00:00Z`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const j = (await res.json()) as { features?: { properties?: { value?: number | null } }[] }
      const v = j.features?.[0]?.properties?.value
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v * 10) / 10) : null
    } catch {
      // one retry; GeoMet occasionally drops a request under load
    }
  }
  return null
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

export type FieldRainResult = { fields: number; days: number; samples: number; written: number; missing: number; errors: string[] }

/**
 * Rain for every field with a season this year, `from`..`to` inclusive (local
 * days). `products` picks which analyses to read; HRDPA is skipped for days
 * older than its 30-day window.
 */
export async function syncFieldRain(
  sb: SupabaseClient,
  opts: { from: string; to: string; products?: Product[] },
): Promise<FieldRainResult> {
  const result: FieldRainResult = { fields: 0, days: 0, samples: 0, written: 0, missing: 0, errors: [] }
  const year = Number(opts.to.slice(0, 4))
  const { data: seasons } = await sb.from('field_crop_seasons').select('field_id').eq('crop_year', year)
  const ids = [...new Set((seasons ?? []).map((s) => s.field_id as string))]
  if (!ids.length) return result
  const { data: fields, error } = await sb.from('fields').select('id, name, centroid').in('id', ids)
  if (error) throw new Error(error.message)
  const points = (fields ?? [])
    .map((f) => ({ id: f.id as string, name: f.name as string, p: pointFromEwkb(f.centroid as string | null) }))
    .filter((f): f is { id: string; name: string; p: { lon: number; lat: number } } => f.p != null)
  result.fields = points.length

  const days: string[] = []
  for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) days.push(d)
  result.days = days.length
  const hrdpaFrom = addDays(new Date().toISOString().slice(0, 10), -29)
  const products = opts.products ?? ['rdpa', 'hrdpa']

  const rows = new Map<string, { field_id: string; date: string; rdpa_mm?: number | null; hrdpa_mm?: number | null }>()
  const jobs: { field: (typeof points)[number]; day: string; product: Product }[] = []
  for (const field of points)
    for (const day of days)
      for (const product of products) if (product === 'rdpa' || day >= hrdpaFrom) jobs.push({ field, day, product })

  await pool(jobs, 12, async ({ field, day, product }) => {
    const valid = addDays(day, 1) // the 12Z total that ends the morning after
    let mm: number | null = null
    for (const layer of LAYERS[product]) {
      mm = await sample(layer, field.p.lon, field.p.lat, valid)
      result.samples++
      if (mm != null) break
    }
    if (mm == null) {
      result.missing++
      return
    }
    const key = `${field.id}:${day}`
    const row = rows.get(key) ?? { field_id: field.id, date: day }
    row[product === 'rdpa' ? 'rdpa_mm' : 'hrdpa_mm'] = mm
    rows.set(key, row)
  })

  // Upsert per product so a run of one never blanks the other's column.
  const all = [...rows.values()]
  for (const product of products) {
    const col = product === 'rdpa' ? 'rdpa_mm' : 'hrdpa_mm'
    const batch = all
      .filter((r) => r[col] !== undefined)
      .map((r) => ({ field_id: r.field_id, date: r.date, [col]: r[col], updated_at: new Date().toISOString() }))
    for (let i = 0; i < batch.length; i += 500) {
      const { error: upErr } = await sb.from('field_rain_daily').upsert(batch.slice(i, i + 500), { onConflict: 'field_id,date' })
      if (upErr) result.errors.push(`${product}: ${upErr.message.slice(0, 120)}`)
      else result.written += Math.min(500, batch.length - i)
    }
  }
  return result
}
