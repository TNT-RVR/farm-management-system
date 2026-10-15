import type { SupabaseClient } from '@supabase/supabase-js'

// Alberta farm-gate prices from Statistics Canada, monthly back to January 1980.
//
// Table 32-10-0077-01, "Farm product prices, crops and livestock". Free, no key,
// no rate limit worth worrying about. This is the LONG history — forty-six years
// of it — against which a weekly elevator bid is a single dot.
//
// It is a farm-gate average for the whole province and a month at a time, so it
// is not the number anyone sells into. It is the number that says whether this
// autumn is dear or cheap by the standards of the last four decades, which is a
// question no elevator bid can answer.

const WDS = 'https://www150.statcan.gc.ca/t1/wds/rest'
const PRODUCT_ID = 32100077
/** Alberta is the ninth geography member in this cube. */
const ALBERTA = 9

/**
 * The Alberta series worth carrying, by StatCan member id.
 *
 * `crop` matches a crop name in our own table where one exists, so the price
 * lands on the right chart. Dry beans are deliberately absent: StatCan has no
 * dry bean series at all, and beans here are contracted rather than traded.
 */
export const STATCAN_SERIES: {
  member: number
  code: string
  name: string
  commodity: string
  crop?: string
}[] = [
  { member: 18, code: 'statcan.canola.ab', name: 'Canola — Alberta farm gate', commodity: 'Canola', crop: 'Canola' },
  { member: 3, code: 'statcan.wheat.ab', name: 'Wheat (except durum) — Alberta farm gate', commodity: 'Wheat', crop: 'Wheat' },
  { member: 44, code: 'statcan.durum.ab', name: 'Durum wheat — Alberta farm gate', commodity: 'Durum wheat', crop: 'Durum Wheat' },
  { member: 14, code: 'statcan.barley.ab', name: 'Barley — Alberta farm gate', commodity: 'Barley', crop: 'Barley' },
  { member: 45, code: 'statcan.barley-feed.ab', name: 'Barley for feed — Alberta farm gate', commodity: 'Feed barley' },
  { member: 46, code: 'statcan.barley-malt.ab', name: 'Malt barley — Alberta farm gate', commodity: 'Malt barley' },
  { member: 13, code: 'statcan.oats.ab', name: 'Oats — Alberta farm gate', commodity: 'Oats', crop: 'Oats' },
  { member: 16, code: 'statcan.corn.ab', name: 'Corn for grain — Alberta farm gate', commodity: 'Corn', crop: 'Grain Corn' },
  { member: 21, code: 'statcan.peas.ab', name: 'Dry peas — Alberta farm gate', commodity: 'Dry peas' },
  { member: 20, code: 'statcan.lentils.ab', name: 'Lentils — Alberta farm gate', commodity: 'Lentils' },
  { member: 17, code: 'statcan.flax.ab', name: 'Flaxseed — Alberta farm gate', commodity: 'Flaxseed' },
  { member: 25, code: 'statcan.potato.ab', name: 'Table potatoes — Alberta farm gate', commodity: 'Potatoes', crop: 'Potato' },
]

/** StatCan wants a ten-part coordinate; only the first two dimensions are used. */
const coordinate = (member: number) => `${ALBERTA}.${member}.0.0.0.0.0.0.0.0`

type VectorReply = {
  status?: string
  object?: {
    vectorId?: number
    vectorDataPoint?: { refPer: string; value: number | null }[]
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${WDS}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`StatCan ${path} failed (${res.status})`)
  return (await res.json()) as T
}

/**
 * Every observation StatCan holds for one series.
 *
 * `latestN` is asked for in one big number rather than a date range: the cube
 * starts in 1980 and a range request needs a start date we would otherwise have
 * to hard-code and keep right. 700 months covers 1968 onward, which is more
 * history than exists.
 */
export async function fetchSeries(
  member: number,
): Promise<{ vectorId: number | null; points: { on: string; value: number }[] }> {
  const reply = await post<VectorReply[]>('getDataFromCubePidCoordAndLatestNPeriods', [
    { productId: PRODUCT_ID, coordinate: coordinate(member), latestN: 700 },
  ])
  const o = reply?.[0]?.object
  if (!o) return { vectorId: null, points: [] }
  const points = (o.vectorDataPoint ?? [])
    // A null value is a month StatCan did not publish. Skipped, not zeroed —
    // a zero would draw a line to the floor and back.
    .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
    .map((p) => ({ on: p.refPer, value: p.value as number }))
  return { vectorId: o.vectorId ?? null, points }
}

/** Insert or update the series row, returning its id. */
async function upsertSeries(
  sb: SupabaseClient,
  s: (typeof STATCAN_SERIES)[number],
  cropIds: Map<string, string>,
): Promise<string | null> {
  const row = {
    code: s.code,
    kind: 'crop' as const,
    name: s.name,
    commodity: s.commodity,
    // The cube publishes crop prices in dollars per tonne.
    unit: '$/tonne',
    region: 'Alberta',
    source: 'statcan' as const,
    crop_id: s.crop ? (cropIds.get(s.crop.toLowerCase()) ?? null) : null,
    notes: 'Statistics Canada table 32-10-0077-01, monthly provincial farm-gate average.',
  }
  const { data, error } = await sb
    .from('market_series')
    .upsert(row, { onConflict: 'code' })
    .select('id')
    .single()
  if (error) return null
  return data?.id as string
}

export async function runStatcanSync(
  sb: SupabaseClient,
): Promise<{ ok: boolean; series: number; points: number; detail: string }> {
  const { data: crops } = await sb.from('crops').select('id, name')
  const cropIds = new Map<string, string>(
    (crops ?? []).map((c) => [String(c.name).toLowerCase(), c.id as string]),
  )

  let series = 0
  let points = 0
  const failures: string[] = []
  for (const s of STATCAN_SERIES) {
    try {
      const id = await upsertSeries(sb, s, cropIds)
      if (!id) {
        failures.push(s.code)
        continue
      }
      const { points: pts } = await fetchSeries(s.member)
      if (pts.length === 0) {
        failures.push(`${s.code} (no data)`)
        continue
      }
      // Chunked: forty-six years of monthly data is ~550 rows per series, and a
      // single statement with every series at once is a needlessly large request.
      for (let i = 0; i < pts.length; i += 500) {
        const chunk = pts.slice(i, i + 500).map((p) => ({
          series_id: id,
          observed_on: p.on,
          value: p.value,
        }))
        const { error } = await sb
          .from('market_prices')
          .upsert(chunk, { onConflict: 'series_id,observed_on' })
        if (error) throw new Error(error.message)
        points += chunk.length
      }
      series += 1
    } catch (e) {
      failures.push(`${s.code}: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  const detail =
    `${series}/${STATCAN_SERIES.length} series, ${points} observations` +
    (failures.length ? ` · failed: ${failures.join(', ')}` : '')
  return { ok: failures.length < STATCAN_SERIES.length, series, points, detail }
}
