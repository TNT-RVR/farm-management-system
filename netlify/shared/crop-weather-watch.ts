import type { SupabaseClient } from '@supabase/supabase-js'
import { cropAlerts, type CropAlert } from '../../src/lib/crop-weather.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

/**
 * Frost and heat by crop stage, every morning.
 *
 * Every planted field this season, its crop and planting date, and a seven-day
 * forecast at the field itself (Open-Meteo, one request for all fields). A
 * warning goes to the managers once per field, kind and day — the table
 * crop_weather_alerts remembers what was sent, so a cold snap forecast for
 * five days running is one message, not five.
 */
export async function runCropWeatherWatch(sb: SupabaseClient): Promise<{ fields: number; sent: number; detail: string }> {
  const year = new Date().getFullYear()
  const [seasons, plans, points, harvests, loads] = await Promise.all([
    sb.from('field_crop_seasons').select('field_id, planting_date').eq('crop_year', year).not('planting_date', 'is', null),
    sb.from('crop_plans').select('field_id, crops(name)').eq('crop_year', year),
    sb.from('field_centroids').select('field_id, lat, lon'),
    sb.from('jd_field_operations').select('field_id').eq('crop_season', year).eq('operation_type', 'harvest'),
    sb.from('bin_loads').select('field_id').eq('crop_year', year).not('field_id', 'is', null),
  ])
  for (const r of [seasons, plans, points]) if (r.error) throw new Error(r.error.message)
  const { data: fieldRows } = await sb.from('fields').select('id, name')
  const nameOf = new Map((fieldRows ?? []).map((f) => [f.id as string, f.name as string]))
  const cropOf = new Map(((plans.data ?? []) as unknown as { field_id: string; crops: { name: string } | null }[]).map((p) => [p.field_id, p.crops?.name ?? null]))
  const pointOf = new Map((points.data ?? []).map((p) => [p.field_id as string, { lat: Number(p.lat), lon: Number(p.lon) }]))
  const harvested = new Set([...(harvests.data ?? []), ...(loads.data ?? [])].map((r) => r.field_id as string))

  const fields = (seasons.data ?? [])
    .map((s) => ({ id: s.field_id as string, plantedOn: String(s.planting_date).slice(0, 10), crop: cropOf.get(s.field_id as string) ?? null, pt: pointOf.get(s.field_id as string) }))
    .filter((f) => f.pt && f.crop && !harvested.has(f.id))
  if (!fields.length) return { fields: 0, sent: 0, detail: 'no standing crops with a planting date' }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${fields.map((f) => f.pt!.lat).join(',')}` +
    `&longitude=${fields.map((f) => f.pt!.lon).join(',')}` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=${encodeURIComponent(farmTz())}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const body = (await res.json()) as unknown
  const series = (Array.isArray(body) ? body : [body]) as { daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] } }[]

  const found: { fieldId: string; a: CropAlert }[] = []
  fields.forEach((f, i) => {
    const d = series[i]?.daily
    if (!d) return
    const forecast = d.time.map((date, k) => ({ date, tmax: d.temperature_2m_max[k], tmin: d.temperature_2m_min[k] }))
    for (const a of cropAlerts({ crop: f.crop, plantedOn: f.plantedOn, harvestStarted: false, forecast })) found.push({ fieldId: f.id, a })
  })

  // Only what has not been sent before.
  const fresh: typeof found = []
  for (const x of found) {
    const { data, error } = await sb
      .from('crop_weather_alerts')
      .insert({ field_id: x.fieldId, crop_year: year, kind: x.a.kind, for_date: x.a.date, temp_c: x.a.temp, dap: x.a.dap, detail: x.a.why })
      .select('id')
    if (!error && data?.length) fresh.push(x)
  }

  if (fresh.length) {
    const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
    const frost = fresh.filter((x) => x.a.kind === 'frost')
    const heat = fresh.filter((x) => x.a.kind === 'heat')
    const lines = [
      ...frost.map((x) => `Frost ${Math.round(x.a.temp)}° ${fmt(x.a.date)} — ${nameOf.get(x.fieldId)} (${cropOf.get(x.fieldId)}): ${x.a.why}.`),
      ...heat.map((x) => `Heat ${Math.round(x.a.temp)}° ${fmt(x.a.date)} — ${nameOf.get(x.fieldId)} (${cropOf.get(x.fieldId)}, day ${x.a.dap}): ${x.a.why}.`),
    ]
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'crop_weather',
      p_title: frost.length ? `Frost forecast on ${new Set(frost.map((x) => x.fieldId)).size} standing crop${frost.length === 1 ? '' : 's'}` : `Heat forecast at a sensitive stage`,
      p_body: lines.slice(0, 8).join('\n') + (lines.length > 8 ? `\n…and ${lines.length - 8} more` : ''),
      p_link: '/weather',
    })
    if (error) console.warn('[crop-weather] notify failed: ' + error.message)
  }
  const detail = `${fields.length} standing crops checked, ${found.length} warnings in the forecast, ${fresh.length} new`
  await sb.rpc('record_integration_heartbeat', { p_key: 'crop_weather', p_detail: detail, p_data_at: null })
  return { fields: fields.length, sent: fresh.length, detail }
}
