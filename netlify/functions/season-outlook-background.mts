import { createClient } from '@supabase/supabase-js'
import { syncWaterDaily } from '../shared/water-daily.ts'
import {
  chuShift,
  fetchCansips,
  fetchHistory,
  fetchSeas5,
  fetchSmridPosts,
  medianMonthDay,
  quantile,
  seasonOf,
} from '../shared/season-outlook-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmFeatureOn } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Refresh the season outlook the rotation advisor reads: heat units and
 * frost-free days per weather cell the fields sit in, next summer's seasonal
 * outlook, reservoir storage, headwater snowpack and SMRID's notices.
 *
 * Run twice a month by season-outlook-cron, or from the Rotation page by a
 * manager. Each source fails on its own; the health row lists what failed.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

const cellOf = (lat: number, lon: number) => {
  const r = (x: number) => Math.round(x * 4) / 4
  return { key: `${r(lat).toFixed(2)},${r(lon).toFixed(2)}`, lat: r(lat), lon: r(lon) }
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  let allowed = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!allowed) {
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (bearer) {
      const { data: au } = await getUserMfa(sb, bearer)
      if (au.user) {
        const { data: prof } = await sb.from('users').select('active, role').eq('id', au.user.id).single()
        allowed = Boolean(prof?.active) && ['manager', 'admin'].includes(String(prof?.role))
      }
    }
  }
  if (!allowed) return new Response('Not authorised', { status: 401 })

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  // From August on, the plan being made is next year's.
  const planYear = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
  const failed: string[] = []
  const done: string[] = []

  // ------------------------------------------------ climate per weather cell
  const { data: pts } = await sb.from('field_centroids').select('field_id, lat, lon, fields!inner(active)').eq('fields.active', true)
  const cells = new Map<string, { key: string; lat: number; lon: number }>()
  for (const p of pts ?? []) if (p.lat != null && p.lon != null) {
    const c = cellOf(Number(p.lat), Number(p.lon))
    cells.set(c.key, c)
  }
  const lastYear = now.getUTCFullYear() - 1
  const fromYear = lastYear - 19
  for (const c of cells.values()) {
    try {
      const days = await fetchHistory(c.lat, c.lon, fromYear, lastYear)
      const seasons = []
      for (let y = fromYear; y <= lastYear; y++) {
        const s = seasonOf(days, y)
        if (s) seasons.push(s)
      }
      // Next summer's outlook: CanSIPS 3-month probabilities, and SEAS5 once it reaches May.
      const cansips: Record<string, unknown> = {}
      for (const start of ['05', '06', '07']) {
        const at = `${planYear}-${start}-01`
        const [ta, tb, pa, pb] = await Promise.all([
          fetchCansips('AirTemp-ProbAboveNormal-2m_PT3M', c.lat, c.lon, at),
          fetchCansips('AirTemp-ProbBelowNormal-2m_PT3M', c.lat, c.lon, at),
          fetchCansips('PrecipAccum-ProbAboveNormal-2m_PT3M', c.lat, c.lon, at),
          fetchCansips('PrecipAccum-ProbBelowNormal-2m_PT3M', c.lat, c.lon, at),
        ])
        if (ta || tb || pa || pb)
          cansips[start] = { temp_above: ta?.value ?? null, temp_below: tb?.value ?? null, precip_above: pa?.value ?? null, precip_below: pb?.value ?? null, issued: ta?.issued ?? tb?.issued ?? null }
      }
      let seas5: { month: string; tempAnomC: number; precipAnomMm: number }[] = []
      try {
        seas5 = await fetchSeas5(c.lat, c.lon)
      } catch (e) {
        failed.push(`SEAS5: ${(e as Error).message}`)
      }
      const shift = chuShift(seas5, planYear)
      const { error } = await sb.from('field_climate').upsert({
        cell_key: c.key,
        lat: c.lat,
        lon: c.lon,
        years_from: seasons[0]?.year ?? null,
        years_to: seasons[seasons.length - 1]?.year ?? null,
        chu_median: quantile(seasons.map((s) => s.chu), 0.5),
        chu_p20: quantile(seasons.map((s) => s.chu), 0.2),
        chu_p80: quantile(seasons.map((s) => s.chu), 0.8),
        ffd_median: quantile(seasons.flatMap((s) => (s.ffd != null ? [s.ffd] : [])), 0.5),
        spring_frost_median: medianMonthDay(seasons.map((s) => s.springFrost)),
        fall_frost_median: medianMonthDay(seasons.map((s) => s.fallFrost)),
        season_precip_mm_median: quantile(seasons.map((s) => s.precipMm), 0.5),
        outlook: { plan_year: planYear, cansips, seas5: seas5.map((m) => ({ month: m.month, temp_anom_c: m.tempAnomC, precip_anom_mm: m.precipAnomMm })), chu_shift: shift },
        outlook_at: now.toISOString(),
        computed_at: now.toISOString(),
      })
      if (error) throw error
      done.push(`climate ${c.key}`)
    } catch (e) {
      failed.push(`climate ${c.key}: ${(e as Error).message}`)
    }
  }

  // ------------------------------------------------ water supply
  // The reservoirs, snowpacks and notices are the original farm's district's
  // (water-daily.ts, season-outlook-core.ts); a farm that has not switched its
  // district on gets the climate outlook alone.
  const district = farmFeatureOn('district_allotment')
  const rows: Record<string, unknown>[] = []
  // Reservoirs and snowpacks: the daily job's list and history (water-daily.ts).
  if (district) try {
    const w = await syncWaterDaily(sb, 14)
    done.push(`${w.rows} water days`)
    failed.push(...w.failed)
  } catch (e) {
    failed.push(`water: ${(e as Error).message}`)
  }
  if (district) try {
    for (const n of await fetchSmridPosts()) rows.push({ kind: 'notice', station: 'smrid', name: n.title, feeds: 'SMRID', observed_on: n.date, url: n.link })
  } catch (e) {
    failed.push(`SMRID notices: ${(e as Error).message}`)
  }
  if (rows.length) {
    const { error } = await sb.from('water_supply').upsert(rows.map((r) => ({ ...r, fetched_at: now.toISOString() })), { onConflict: 'kind,station,observed_on' })
    if (error) failed.push(`water_supply: ${error.message}`)
    else done.push(`${rows.length} water rows`)
  }

  const ok = done.length > 0
  const detail = [done.join(', '), failed.length ? `failed: ${failed.join('; ')}` : ''].filter(Boolean).join(' — ').slice(0, 900)
  await sb
    .from('integration_health')
    .update({
      status: ok ? 'ok' : 'error',
      detail,
      last_checked_at: now.toISOString(),
      updated_at: now.toISOString(),
      ...(ok ? { last_success_at: now.toISOString(), data_at: now.toISOString(), consecutive_fail: 0 } : {}),
    })
    .eq('source_key', 'season_outlook')
  return new Response(detail || 'nothing to do', { status: ok ? 200 : 500 })
}
