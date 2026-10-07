import type { SupabaseClient } from '@supabase/supabase-js'
import {
  NRCAN_CITIES,
  NRCAN_FEED,
  NRCAN_PRODUCTS,
  farmCode,
  farmFromRetail,
  parseNrcanFeed,
  retailCode,
  type FuelKind,
} from '../../src/lib/fuel-market.ts'

/**
 * Read NRCan's weekly pump prices and store them, with the marked-farm figure
 * worked out from Lethbridge's. See src/lib/fuel-market.ts for the source and
 * the tax arithmetic; this is only the fetching and the writing.
 *
 * Four requests (two fuels × two cities), each bringing the last 100 weeks, so
 * every run is also a backfill and a missed week heals itself next run.
 */

const FUEL_NAME: Record<FuelKind, string> = { diesel: 'Diesel', gasoline: 'Regular gasoline' }

async function upsertSeries(
  sb: SupabaseClient,
  row: { code: string; name: string; commodity: string; region: string; derived: boolean; notes: string },
): Promise<string> {
  const { data, error } = await sb
    .from('market_series')
    .upsert({ ...row, kind: 'fuel', unit: '$/L', source: 'nrcan' }, { onConflict: 'code' })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'series upsert returned nothing')
  return data.id as string
}

/**
 * One feed, with two retries. The government server drops the odd connection
 * outright ("fetch failed", no status) on back-to-back requests — seen on the
 * first test run, three of four in a row — and a second try a moment later
 * gets it.
 */
async function fetchFeed(url: string): Promise<string> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RVR Management price reader)' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  const e = last as Error & { cause?: { code?: string } }
  throw new Error(`${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`)
}

export async function runFuelMarketSync(
  sb: SupabaseClient,
): Promise<{ ok: boolean; points: number; latest: string | null; detail: string }> {
  const failures: string[] = []
  let points = 0
  let latest: string | null = null
  const latestBits: string[] = []

  for (const fuel of Object.keys(NRCAN_PRODUCTS) as FuelKind[]) {
    for (const city of NRCAN_CITIES) {
      const url = `${NRCAN_FEED}?productID=${NRCAN_PRODUCTS[fuel]}&locationID=${city.id}&frequency=W`
      try {
        // The feed answers for whatever cities it is asked; keep only the one asked for.
        const items = parseNrcanFeed(await fetchFeed(url)).filter((i) => i.city.toLowerCase() === city.key)
        if (!items.length) throw new Error('no prices in the feed')

        const retailId = await upsertSeries(sb, {
          code: retailCode(fuel, city.key),
          name: `${FUEL_NAME[fuel]} — ${city.name} pump`,
          commodity: FUEL_NAME[fuel],
          region: city.name,
          derived: false,
          notes:
            'Natural Resources Canada weekly average retail price (Wednesday to Tuesday, dated by the Tuesday), self-serve, all taxes and GST in. Collected by Kalibrate.',
        })
        const rows = items.map((i) => ({ series_id: retailId, observed_on: i.on, value: i.perL, source_url: url }))
        const { error } = await sb.from('market_prices').upsert(rows, { onConflict: 'series_id,observed_on' })
        if (error) throw new Error(error.message)
        points += rows.length

        if (city.key === 'lethbridge') {
          const farmId = await upsertSeries(sb, {
            code: farmCode(fuel),
            name: `${fuel === 'diesel' ? 'Farm (marked) diesel' : 'Farm (marked) gasoline'} — Lethbridge, worked out`,
            commodity: fuel === 'diesel' ? 'Farm diesel' : 'Farm gasoline',
            region: 'Lethbridge',
            derived: true,
            notes:
              'Lethbridge pump price before GST, less the Alberta fuel tax marked fuel does not pay and (before April 2025) the federal fuel charge farm fuel was exempt from. Worked out by the app (src/lib/fuel-market.ts); nobody publishes a marked price.',
          })
          const farm = items.map((i) => ({ series_id: farmId, observed_on: i.on, value: farmFromRetail(i.perL, i.on, fuel), source_url: url }))
          const { error: e2 } = await sb.from('market_prices').upsert(farm, { onConflict: 'series_id,observed_on' })
          if (e2) throw new Error(e2.message)
          points += farm.length
          const newest = items.reduce((a, b) => (b.on > a.on ? b : a))
          latestBits.push(`${fuel} $${newest.perL.toFixed(3)}`)
          if (!latest || newest.on > latest) latest = newest.on
        }
      } catch (e) {
        failures.push(`${fuel}/${city.key}: ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }

  const ok = failures.length === 0 && points > 0
  const detail =
    `${points} prices` +
    (latest ? ` · Lethbridge week to ${latest}: ${latestBits.join(', ')}` : '') +
    (failures.length ? ` · ${failures.join('; ')}` : '')

  // A heartbeat only when something was stored; a run that read nothing is
  // left to go stale, which is what raises the alert.
  if (points > 0) {
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'nrcan_fuel',
      p_detail: detail,
      p_data_at: latest ? `${latest}T00:00:00Z` : null,
    })
  }

  return { ok, points, latest, detail }
}
