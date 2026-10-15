import type { SupabaseClient } from '@supabase/supabase-js'
import { WATER_STATIONS, type WaterStation } from '../../src/lib/water-stations.ts'

/**
 * Daily means for each reservoir and snowpack in WATER_STATIONS, into
 * water_supply_daily (for the graphs) and the latest into water_supply (for
 * the Season ahead panel). Alberta's feeds are 5-minute readings; SNOTEL is
 * daily already and comes with its median for the date.
 */
const UA = { 'user-agent': 'RVR Management App (farm planning)' }

async function wiskiDaily(tsId: string, from: string, to: string): Promise<{ day: string; value: number }[]> {
  const r = await fetch(`https://rivers.alberta.ca/WiskiLiveDataService/Download?tsId=${tsId}&from=${from}&to=${to}&filename=x&zip=false&json=true`, { headers: UA })
  if (!r.ok) throw new Error(`Alberta Rivers ${r.status}`)
  const j = (await r.json()) as { data?: [string, number | null][] }[]
  const sums = new Map<string, { s: number; n: number }>()
  for (const [t, v] of j[0]?.data ?? []) {
    if (v == null) continue
    const d = t.slice(0, 10)
    const x = sums.get(d) ?? { s: 0, n: 0 }
    x.s += Number(v)
    x.n++
    sums.set(d, x)
  }
  return [...sums].map(([day, x]) => ({ day, value: x.s / x.n }))
}

async function snotelDaily(triplet: string, from: string, to: string): Promise<{ day: string; value: number | null; median: number | null }[]> {
  const r = await fetch(
    `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=${triplet}&elements=WTEQ&duration=DAILY&beginDate=${from}&endDate=${to}&centralTendencyType=MEDIAN`,
    { headers: UA },
  )
  if (!r.ok) throw new Error(`SNOTEL ${r.status}`)
  const j = (await r.json()) as { data: { values: { date: string; value: number | null; median?: number | null }[] }[] }[]
  // Inches of water → mm.
  return (j[0]?.data?.[0]?.values ?? []).map((v) => ({ day: v.date.slice(0, 10), value: v.value == null ? null : v.value * 25.4, median: v.median == null ? null : v.median * 25.4 }))
}

export async function stationDaily(s: WaterStation, from: string, to: string) {
  if (s.source === 'snotel') return snotelDaily(s.triplet!, from, to)
  return (await wiskiDaily(s.tsId!, from, to)).map((x) => ({ ...x, median: null as number | null }))
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Pull `days` back for every station; returns what failed. */
export async function syncWaterDaily(sb: SupabaseClient, days: number, chunkDays = 120): Promise<{ rows: number; failed: string[] }> {
  const failed: string[] = []
  let rows = 0
  const end = new Date()
  for (const s of WATER_STATIONS) {
    try {
      const out: { station: string; day: string; value: number | null; median: number | null; unit: string }[] = []
      for (let back = days; back > 0; back -= chunkDays) {
        const from = iso(new Date(end.getTime() - back * 86_400_000))
        const to = iso(new Date(end.getTime() - Math.max(0, back - chunkDays) * 86_400_000))
        for (const r of await stationDaily(s, from, to)) out.push({ station: s.key, day: r.day, value: r.value == null ? null : Math.round(r.value * 100) / 100, median: r.median == null ? null : Math.round(r.median * 100) / 100, unit: s.unit })
      }
      const dedup = [...new Map(out.map((r) => [r.day, r])).values()]
      for (let i = 0; i < dedup.length; i += 500) {
        const { error } = await sb.from('water_supply_daily').upsert(dedup.slice(i, i + 500), { onConflict: 'station,day' })
        if (error) throw error
      }
      rows += dedup.length
      // The latest reading, for the Season ahead panel.
      const last = [...dedup].reverse().find((r) => r.value != null)
      if (last) {
        const lastYearDay = iso(new Date(Date.parse(last.day + 'T12:00:00Z') - 365 * 86_400_000))
        const { data: ly } = await sb.from('water_supply_daily').select('value').eq('station', s.key).eq('day', lastYearDay).maybeSingle()
        const row = {
          kind: s.kind,
          station: s.key,
          name: s.name,
          feeds: s.section === 'oldman' ? 'Oldman licences' : 'SMRID',
          observed_on: last.day,
          value: last.value,
          unit: s.kind === 'reservoir' ? '% full' : 'mm SWE',
          pct_full: s.kind === 'reservoir' ? last.value : null,
          pct_full_last_year: s.kind === 'reservoir' && ly?.value != null ? Number(ly.value) : null,
          pct_of_median: s.kind === 'snow' && last.median ? Math.round((Number(last.value) / last.median) * 100) : null,
          url: s.pageUrl,
        }
        await sb.from('water_supply').delete().eq('station', s.key).neq('observed_on', last.day)
        const { error } = await sb.from('water_supply').upsert(row, { onConflict: 'kind,station,observed_on' })
        if (error) throw error
      }
    } catch (e) {
      failed.push(`${s.name}: ${(e as Error).message}`)
    }
  }
  const now = new Date().toISOString()
  if (failed.length === WATER_STATIONS.length) {
    await sb.from('integration_health').update({ status: 'error', detail: failed.join('; ').slice(0, 300), last_checked_at: now, updated_at: now }).eq('source_key', 'water_daily')
  } else {
    await sb.rpc('record_integration_heartbeat', { p_key: 'water_daily', p_detail: failed.length ? `${rows} days; failed: ${failed.join('; ')}`.slice(0, 300) : `${rows} station-days`, p_data_at: now })
  }
  return { rows, failed }
}
