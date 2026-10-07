import type { SupabaseClient } from '@supabase/supabase-js'

// What fertilizer has cost Alberta farmers, quarterly, back to 2002.
//
// The tab shipped blank, and it was going to stay blank: it had only manual
// quote entry, so until somebody typed a number there was nothing to draw.
// That is a fair way to track YOUR price and a useless way to answer "is this a
// good time to buy", which needs a history nobody has typed in.
//
// Statistics Canada table 18-10-0258-01, the Farm Input Price Index. Free, no
// key, twenty-four years deep, and provincial for everything except the
// phosphate/potash split, which StatCan publishes nationally only. It is an index rather than a price:
// it says fertilizer costs 23% more than it did eighteen months ago, not that
// urea is $780/t. Those are different questions and the tab now asks them
// separately — the index for whether the market is dear, the typed quotes for
// what you are actually being charged.
//
// The catch, stated on the page rather than buried here: it is quarterly and
// released about six months in arrears. It will not tell you about this week.

const WDS = 'https://www150.statcan.gc.ca/t1/wds/rest'
const PRODUCT_ID = 18100258
/** Geography members in this cube. */
const ALBERTA = 12
const CANADA = 1

/**
 * The index base is 2012 = 100 — confirmed against the cube rather than assumed,
 * because the documentation for this table quotes several different base years
 * and the Canada-wide farm input total averages exactly 100.0 in 2012 and
 * nothing like it in 2017.
 */
export const INDEX_BASE = '2012 = 100'

export const FERT_INDEX_SERIES: {
  geo: number
  member: number
  code: string
  name: string
  region: string
  commodity: string
  notes: string
}[] = [
  {
    geo: ALBERTA,
    member: 12,
    code: 'fipi.fert.ab',
    name: 'Fertilizer — Alberta',
    region: 'Alberta',
    commodity: 'Fertilizer (all)',
    notes: `Statistics Canada 18-10-0258-01, quarterly, ${INDEX_BASE}. All fertilizer bought by Alberta farms.`,
  },
  {
    geo: ALBERTA,
    member: 13,
    code: 'fipi.fert-n.ab',
    name: 'Nitrogen fertilizer — Alberta',
    region: 'Alberta',
    commodity: 'Nitrogen fertilizers',
    notes: `Statistics Canada 18-10-0258-01, quarterly, ${INDEX_BASE}. Urea, UAN, anhydrous — the biggest line on this farm's order.`,
  },
  {
    // Canada, not Alberta, and the name says so. StatCan publishes the
    // fertilizer total and the nitrogen split provincially but breaks out
    // "other fertilizers" nationally only: the Alberta coordinate exists and
    // returns a full column of nulls, which is how the first sync run reported
    // it. The national series is a fair read on which way phosphate and potash
    // are moving, and MAP is this farm's second-biggest order line, so it earns
    // its place — mislabelled as Alberta it would not.
    geo: CANADA,
    member: 14,
    code: 'fipi.fert-other.ca',
    name: 'Phosphate, potash & other — Canada',
    region: 'Canada',
    commodity: 'Other fertilizers',
    notes: `Statistics Canada 18-10-0258-01, quarterly, ${INDEX_BASE}. Everything that is not nitrogen: MAP, potash, sulphur, micros. National — StatCan does not publish this split by province.`,
  },
]

/** StatCan wants a ten-part coordinate; only the first two dimensions are used. */
const coordinate = (geo: number, member: number) => `${geo}.${member}.0.0.0.0.0.0.0.0`

type VectorReply = {
  status?: string
  object?: { vectorId?: number; vectorDataPoint?: { refPer: string; value: number | null }[] }
}

/**
 * One coordinate per request, deliberately.
 *
 * The reply carries a vectorId and no coordinate, so a batched request cannot
 * be matched back to what was asked for except by trusting the order — and it
 * does not hold. Batching Alberta and Canada in one call returned them the
 * other way round, which is exactly how a chart ends up labelled Alberta while
 * drawing the national number.
 */
async function fetchSeries(geo: number, member: number): Promise<{ on: string; value: number }[]> {
  const res = await fetch(`${WDS}/getDataFromCubePidCoordAndLatestNPeriods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 200 quarters is fifty years, comfortably more than the cube holds, so
    // there is no start date to hard-code and keep right.
    body: JSON.stringify([
      { productId: PRODUCT_ID, coordinate: coordinate(geo, member), latestN: 200 },
    ]),
  })
  if (!res.ok) throw new Error(`StatCan returned ${res.status}`)
  const reply = (await res.json()) as VectorReply[]
  return (reply?.[0]?.object?.vectorDataPoint ?? [])
    // A null is a quarter StatCan did not publish. Skipped, not zeroed — a zero
    // would draw the line to the floor and back.
    .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value))
    .map((p) => ({ on: p.refPer, value: p.value as number }))
}

export async function runFertilizerMarketSync(
  sb: SupabaseClient,
): Promise<{ ok: boolean; series: number; points: number; latest: string | null; detail: string }> {
  let series = 0
  let points = 0
  let latest: string | null = null
  const failures: string[] = []

  for (const s of FERT_INDEX_SERIES) {
    try {
      const { data: row, error: upErr } = await sb
        .from('market_series')
        .upsert(
          {
            code: s.code,
            kind: 'fertilizer',
            name: s.name,
            commodity: s.commodity,
            unit: 'index',
            region: s.region,
            source: 'statcan',
            notes: s.notes,
          },
          { onConflict: 'code' },
        )
        .select('id')
        .single()
      if (upErr || !row) throw new Error(upErr?.message ?? 'series upsert returned nothing')

      const pts = await fetchSeries(s.geo, s.member)
      if (!pts.length) {
        failures.push(`${s.code} (no data)`)
        continue
      }
      for (let i = 0; i < pts.length; i += 500) {
        const chunk = pts.slice(i, i + 500).map((p) => ({
          series_id: row.id as string,
          observed_on: p.on,
          value: p.value,
        }))
        const { error } = await sb
          .from('market_prices')
          .upsert(chunk, { onConflict: 'series_id,observed_on' })
        if (error) throw new Error(error.message)
        points += chunk.length
      }
      const newest = pts[pts.length - 1].on
      if (!latest || newest > latest) latest = newest
      series += 1
    } catch (e) {
      failures.push(`${s.code}: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  const ok = failures.length === 0
  const detail =
    `${series}/${FERT_INDEX_SERIES.length} series, ${points} quarters` +
    (latest ? ` · latest ${latest}` : '') +
    (failures.length ? ` · failed: ${failures.join(', ')}` : '')

  // Registered with the watchdog: a blank market tab is exactly the kind of
  // quiet failure it exists to catch. p_data_at is the newest observation, so a
  // feed that keeps answering with stale quarters still reads as stale.
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'fertilizer_market',
    p_detail: detail,
    p_data_at: latest ? `${latest}T00:00:00Z` : null,
  })

  return { ok, series, points, latest, detail }
}
