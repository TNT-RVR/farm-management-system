import { createHash, createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SOLIS_DEFAULT_API_URL,
  SOLIS_KEY_ENV,
  dateIn,
  monthsToPull,
  normSiteName,
  parseMonthRows,
  parseSolisJson,
  stationListPage,
  tzOffsetHours,
  type SolisStation,
} from '../../src/lib/solar.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

/**
 * SolisCloud Platform API (v2): signed requests, and the sync that stores
 * what the farm's solar plants make.
 *
 * Signing, from the Platform API document §2.2 (and as both Home Assistant
 * integrations do it — hultenvp/solis-sensor and hultenvp/soliscloud_api):
 *
 *   Content-MD5   = base64(md5(body))
 *   Date          = now in GMT, "EEE, d MMM yyyy HH:mm:ss 'GMT'" — within ±15 min of Solis's clock
 *   Authorization = "API " + keyId + ":" + base64(HmacSHA1(keySecret,
 *                     "POST\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + path))
 *
 * Content-Type is "application/json". The document's tables say
 * "application/json;charset=UTF-8" but its own worked example (§2.4) and both
 * integrations sign and send plain "application/json"; what matters is that
 * the header sent is the one signed. The body is hashed exactly as sent.
 *
 * Every call is a POST. The document limits each interface to 2 calls a
 * second (§4.1 "Interface frequency limit 2 times/sec"; the developer guide
 * says 10/s overall), and Solis answers a burst with HTTP 502 — so calls here
 * are spaced 600 ms apart, and a 429/5xx/timeout is tried again with a
 * backoff. stationDetail is known to take 15 s at times (solis-sensor issue
 * #539), so a call gets 30 s.
 *
 * Keys come from Farm setup (SOLIS_KEY_ID, SOLIS_KEY_SECRET, SOLIS_API_URL),
 * loaded into process.env by hydrateSecrets before this runs. They are never
 * logged, and an error never quotes them.
 */

export const SOLIS_CONTENT_TYPE = 'application/json'
export const HEALTH_KEY = 'solar_solis'

export class SolisNotConfigured extends Error {}

export type SolisCreds = { keyId: string; secret: string; apiUrl: string }

/** The keys, or a plain-words error saying which is missing and where to put it. */
export function solisCreds(env: Record<string, string | undefined> = process.env): SolisCreds {
  const keyId = env[SOLIS_KEY_ENV.keyId]?.trim()
  const secret = env[SOLIS_KEY_ENV.secret]?.trim()
  const missing = [!keyId && 'KeyID', !secret && 'KeySecret'].filter(Boolean)
  if (missing.length)
    throw new SolisNotConfigured(
      `SolisCloud ${missing.join(' and ')} not set — paste them on Settings → Farm setup → SolisCloud solar once Solis has turned on API access`,
    )
  const apiUrl = (env[SOLIS_KEY_ENV.apiUrl]?.trim() || SOLIS_DEFAULT_API_URL).replace(/\/+$/, '')
  if (!/^https:\/\/[^/\s]+$/i.test(apiUrl))
    throw new SolisNotConfigured(`SolisCloud API URL should look like ${SOLIS_DEFAULT_API_URL} (https, no path) — check it on Farm setup`)
  return { keyId: keyId!, secret: secret!, apiUrl }
}

/** base64(md5(body)) — §2.2 Content-MD5. */
export const contentMd5 = (body: string) => createHash('md5').update(body, 'utf8').digest('base64')

/** The headers for one signed call. `date` is fixed in tests. */
export function signSolis(o: { keyId: string; secret: string; path: string; body: string; date?: Date; contentType?: string }) {
  const md5 = contentMd5(o.body)
  const contentType = o.contentType ?? SOLIS_CONTENT_TYPE
  // toUTCString is RFC 1123: "Sun, 01 Jan 2023 00:00:00 GMT".
  const date = (o.date ?? new Date()).toUTCString()
  const toSign = `POST\n${md5}\n${contentType}\n${date}\n${o.path}`
  const sign = createHmac('sha1', o.secret).update(toSign, 'utf8').digest('base64')
  return {
    'Content-MD5': md5,
    'Content-Type': contentType,
    Date: date,
    Authorization: `API ${o.keyId}:${sign}`,
  }
}

/** What SolisCloud's error codes mean (Appendix 1), in words a person can act on. */
const CODE_HELP: Record<string, string> = {
  R0000: 'no authority — the keys are not allowed to read this (is API access activated on SolisCloud?)',
  I0000: 'a required field was empty',
  B0011: 'the account does not exist',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A SolisCloud client: spaced, retried, signed calls. `fetchImpl` and `wait` are swapped in tests. */
export function solisClient(creds: SolisCreds, opts: { fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void>; gapMs?: number } = {}) {
  const doFetch = opts.fetchImpl ?? fetch
  const wait = opts.wait ?? sleep
  const gap = opts.gapMs ?? 600
  let last = 0
  let calls = 0

  async function call(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify(payload)
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await wait(attempt === 1 ? 2000 : 6000)
      const since = Date.now() - last
      if (since < gap) await wait(gap - since)
      last = Date.now()
      calls++
      let res: Response
      try {
        res = await doFetch(creds.apiUrl + path, {
          method: 'POST',
          headers: signSolis({ keyId: creds.keyId, secret: creds.secret, path, body }),
          body,
          signal: AbortSignal.timeout(30_000),
        })
      } catch (e) {
        lastErr = `${path}: no answer (${(e as Error).name === 'TimeoutError' ? 'timed out after 30 s' : (e as Error).message})`
        continue
      }
      const text = await res.text()
      if (res.status === 429 || res.status >= 500) {
        lastErr = `${path}: SolisCloud answered HTTP ${res.status}`
        continue
      }
      if (res.status === 401 || res.status === 403)
        throw new Error(`SolisCloud refused the keys (HTTP ${res.status} on ${path}) — check the KeyID and KeySecret on Farm setup, and the computer clock`)
      if (!res.ok) throw new Error(`${path}: SolisCloud answered HTTP ${res.status}: ${text.slice(0, 160)}`)
      let j: { code?: unknown; msg?: unknown; success?: unknown; data?: unknown }
      try {
        j = parseSolisJson(text) as typeof j
      } catch {
        throw new Error(`${path}: SolisCloud sent something that is not JSON: ${text.slice(0, 120)}`)
      }
      const code = j?.code == null ? '' : String(j.code)
      if (code !== '0') {
        const help = CODE_HELP[code]
        throw new Error(`${path}: SolisCloud error ${code || '(none)'}${j?.msg ? ` "${String(j.msg)}"` : ''}${help ? ` — ${help}` : ''}`)
      }
      return j.data
    }
    throw new Error(`${lastErr} — tried 3 times`)
  }

  return {
    call,
    get calls() {
      return calls
    },
    /** Every plant on the account (§4.1), all pages. */
    async stations(): Promise<SolisStation[]> {
      const out: SolisStation[] = []
      for (let page = 1; page <= 20; page++) {
        const { stations, pages } = stationListPage(await call('/v1/api/userStationList', { pageNo: page, pageSize: 100 }))
        out.push(...stations)
        if (page >= pages) break
      }
      return out
    },
    /** A plant's days for one month, "yyyy-MM" (§4.8). */
    async month(stationId: string, month: string, timeZone: number, capacityKwp: number | null) {
      const data = await call('/v1/api/stationMonth', { id: stationId, money: 'CAD', month, timeZone })
      return parseMonthRows(data, capacityKwp)
    },
  }
}

type SiteRow = {
  id: string
  solis_station_id: string | null
  name: string
  address: string | null
  capacity_kwp: number | string | null
  time_zone: number | string | null
  first_generation_on: string | null
}

export type SolarSyncResult = {
  ok: boolean
  sites: number
  added: number
  days: number
  months: number
  calls: number
  todayKwh: number
  error?: string
  /** Months still to read when the run ran out of time. */
  remaining?: number
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
const same = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && String(a) === String(b))

async function writeHealth(sb: SupabaseClient, status: 'error' | 'unknown', detail: string) {
  const now = new Date().toISOString()
  const { error } = await sb
    .from('integration_health')
    .update({ status, detail: detail.slice(0, 300), last_checked_at: now, updated_at: now })
    .eq('source_key', HEALTH_KEY)
  if (error) console.error('[solar] could not record health:', error.message)
}

/**
 * Pull the plant list and daily energy, and store them.
 *
 *  1. userStationList → solar_sites (matched by station id, else by name to
 *     a placeholder seeded before the keys existed) and solar_latest (the
 *     power right now, today's running total).
 *  2. stationMonth per plant → solar_daily. The current year from January on
 *     a plant's first run, then this month (and last month for the first
 *     three days) on every run after. `year` reads a whole past year.
 *
 * Reports to the integration health monitor either way.
 */
export async function runSolarSync(
  sb: SupabaseClient,
  opts: { deadline?: number; year?: number; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<SolarSyncResult> {
  const result: SolarSyncResult = { ok: false, sites: 0, added: 0, days: 0, months: 0, calls: 0, todayKwh: 0 }
  const deadline = opts.deadline ?? Date.now() + 10 * 60_000
  const now = opts.now ?? new Date()
  let client: ReturnType<typeof solisClient> | null = null
  try {
    const creds = solisCreds()
    client = solisClient(creds, { fetchImpl: opts.fetchImpl })
    const stations = await client.stations()
    if (!stations.length) throw new Error('SolisCloud answered, but lists no plants on this account')

    const { data: existing, error: exErr } = await sb
      .from('solar_sites')
      .select('id, solis_station_id, name, address, capacity_kwp, time_zone, first_generation_on')
    if (exErr) throw new Error(`reading solar_sites: ${exErr.message}`)
    const rows = (existing ?? []) as SiteRow[]
    const tz = farmTz()
    const today = dateIn(tz, now)
    const nowIso = now.toISOString()

    const sites: { row: SiteRow; st: SolisStation }[] = []
    for (const st of stations) {
      let row =
        rows.find((r) => r.solis_station_id === st.stationId) ??
        rows.find((r) => r.solis_station_id == null && normSiteName(r.name) === normSiteName(st.name))
      const patch = {
        solis_station_id: st.stationId,
        name: st.name,
        address: st.address,
        capacity_kwp: st.capacityKwp,
        time_zone: st.timeZone,
        first_generation_on: st.firstGenerationOn,
      }
      if (!row) {
        const { data, error } = await sb.from('solar_sites').insert(patch).select('id, solis_station_id, name, address, capacity_kwp, time_zone, first_generation_on').single()
        if (error) throw new Error(`adding plant ${st.name}: ${error.message}`)
        row = data as SiteRow
        result.added++
      } else if (
        // solar_sites is audited (people edit its label and field), so it is
        // written only when SolisCloud says something new about the plant.
        !same(row.solis_station_id, patch.solis_station_id) ||
        !same(row.name, patch.name) ||
        !same(row.address, patch.address) ||
        !same(n(row.capacity_kwp), patch.capacity_kwp) ||
        !same(n(row.time_zone), patch.time_zone) ||
        !same(row.first_generation_on, patch.first_generation_on)
      ) {
        const { error } = await sb.from('solar_sites').update({ ...patch, updated_at: nowIso }).eq('id', row.id)
        if (error) throw new Error(`updating plant ${st.name}: ${error.message}`)
        row = { ...row, ...patch }
      }
      sites.push({ row, st })
    }
    result.sites = sites.length

    // The reading right now. Not audited: it changes every run.
    const latest = sites.map(({ row, st }) => ({
      site_id: row.id,
      power_kw: st.powerKw,
      today_kwh: st.dayKwh,
      month_kwh: st.monthKwh,
      year_kwh: st.yearKwh,
      total_kwh: st.totalKwh,
      state: st.state,
      reading_at: st.readingAt,
      updated_at: nowIso,
    }))
    const { error: lErr } = await sb.from('solar_latest').upsert(latest, { onConflict: 'site_id' })
    if (lErr) throw new Error(`writing solar_latest: ${lErr.message}`)

    // Today's running total, so the day exists before stationMonth has it.
    // Only from a reading taken today — a plant offline since yesterday still
    // reports yesterday's total as "dayEnergy".
    const live = sites
      .filter(({ st }) => st.dayKwh != null && st.readingAt != null && dateIn(tz, new Date(st.readingAt)) === today)
      .map(({ row, st }) => ({ site_id: row.id, day: today, produced_kwh: st.dayKwh, source: 'live', synced_at: nowIso }))
    result.todayKwh = Math.round(live.reduce((s, r) => s + (r.produced_kwh ?? 0), 0) * 10) / 10
    if (live.length) {
      const { error } = await sb.from('solar_daily').upsert(live, { onConflict: 'site_id,day' })
      if (error) throw new Error(`writing today's totals: ${error.message}`)
    }

    // The days, month by month.
    const year = Number(today.slice(0, 4))
    let remaining = 0
    for (const { row, st } of sites) {
      // "Has this year been read" = is its FIRST month stored. Months are
      // read newest first, so a backfill cut short leaves January missing
      // and the next run starts it again rather than leaving a hole.
      const firstMonth = st.firstGenerationOn && st.firstGenerationOn > `${year}-01-01` ? st.firstGenerationOn.slice(0, 7) : `${year}-01`
      const [fy, fm] = firstMonth.split('-').map(Number)
      const afterFirst = fm === 12 ? `${fy + 1}-01-01` : `${fy}-${String(fm + 1).padStart(2, '0')}-01`
      const { count, error: cErr } = await sb
        .from('solar_daily')
        .select('day', { count: 'exact', head: true })
        .eq('site_id', row.id)
        .eq('source', 'month')
        .gte('day', `${firstMonth}-01`)
        .lt('day', afterFirst)
      if (cErr) throw new Error(`reading solar_daily: ${cErr.message}`)
      const months = monthsToPull(today, { haveYear: (count ?? 0) > 0, firstGenerationOn: st.firstGenerationOn, year: opts.year }).reverse()
      const offset = Math.round(st.timeZone ?? tzOffsetHours(tz, now))
      for (let i = 0; i < months.length; i++) {
        if (Date.now() > deadline) {
          remaining += months.length - i
          break
        }
        const days = (await client.month(st.stationId, months[i], offset, st.capacityKwp)).filter(
          (d) => d.day <= today && (!st.firstGenerationOn || d.day >= st.firstGenerationOn),
        )
        result.months++
        if (!days.length) continue
        const upsert = days.map((d) => ({
          site_id: row.id,
          day: d.day,
          produced_kwh: d.producedKwh,
          grid_export_kwh: d.gridExportKwh,
          grid_import_kwh: d.gridImportKwh,
          home_load_kwh: d.homeLoadKwh,
          source: 'month',
          synced_at: nowIso,
        }))
        const { error } = await sb.from('solar_daily').upsert(upsert, { onConflict: 'site_id,day' })
        if (error) throw new Error(`writing solar_daily: ${error.message}`)
        result.days += upsert.length
      }
    }
    if (remaining) result.remaining = remaining

    result.calls = client.calls
    result.ok = true
    const newest = sites.map(({ st }) => st.readingAt).filter((t): t is string => !!t).sort().pop() ?? null
    const detail = `${sites.length} plants, ${result.todayKwh.toLocaleString('en-CA')} kWh so far today${remaining ? `; ${remaining} months still to read` : ''}`
    const { error: hErr } = await sb.rpc('record_integration_heartbeat', { p_key: HEALTH_KEY, p_detail: detail, p_data_at: newest })
    if (hErr) console.error('[solar] heartbeat failed:', hErr.message)
    return result
  } catch (e) {
    result.calls = client?.calls ?? 0
    result.error = (e as Error).message
    // Waiting on keys is not a failure: the row stays switched off (it was
    // seeded disabled) until the first good run, so this alerts nobody.
    await writeHealth(sb, e instanceof SolisNotConfigured ? 'unknown' : 'error', result.error)
    return result
  }
}
