import type { SupabaseClient } from '@supabase/supabase-js'
import { farmToday } from './dates.ts'

/**
 * eShepherd's pregnancy (cycling) model, read from the public Grafana
 * dashboard eShepherd gave us as testers. Grafana answers a public dashboard's
 * panel query without a login: POST /api/public/dashboards/{token}/panels/{id}/query.
 *
 * eShepherd rebuilt the dashboard in November 2026. It no longer returns a
 * frame of one row per animal per day (55,000 rows, 7 MB). The whole series is
 * now one packed JSON string in a single text panel: dictionaries for the
 * animals and the state names, and every per-day column run-length encoded
 * over the same 60,000-odd rows in animal order. About 150 KB. We unpack it
 * here and hand back the same rows as before, so nothing downstream changed.
 */
const BASE = 'https://insights.eshepherd.com'
// The dashboard's public token reads every collared animal's pregnancy data,
// so it lives only in the site environment — never as a fallback here.
function reproToken(): string {
  const t = process.env.ESHEPHERD_REPRO_TOKEN?.trim()
  if (!t) throw new Error('ESHEPHERD_REPRO_TOKEN is not set — add the eShepherd public-dashboard token to the Netlify site environment')
  return t
}

type Frame = { schema: { fields: { name: string }[] }; data: { values: unknown[][] } }
type Panel = { id: number; title?: string; panels?: Panel[]; targets?: { datasource?: { type?: string } }[] }

/**
 * A run-length encoded column: `v[i]` repeated `n[i]` times. Some columns hold
 * the value itself (state, state_start), others hold a day-to-day delta that
 * has to be accumulated (the date, the cycle clock).
 */
type Rle = { v: (number | null)[]; n: number[] }

/** The packed payload. Short keys are eShepherd's; the comments are what they hold. */
export type Packed = {
  n: number // rows in every column below
  aA: string[] // animal tag, one per animal
  aI: string[] // eShepherd's own animal id, one per animal
  aM: string[] // mob name, one per animal
  SD: string[] // state names, indexed by `s`
  PSD: (string | null)[] // previous-state names, indexed by `ps`
  ta: number[] // [epoch day that the accumulated `t` counts from]
  a: Rle // which animal this row belongs to (index into aA/aI/aM)
  s: Rle // state, index into SD
  ps: Rle // previous state, index into PSD
  st: Rle // state_start, as an epoch day
  nc: Rle // not_cycling_since, as an epoch day (null when she is cycling)
  lc: Rle // her last cycle day; null means no cycle has ever been seen
  t: Rle // date, as a delta on the day before
  ck: Rle // days since her last detected heat, as a delta (drops back on a heat)
  ncd: Rle // days not cycling, as a delta
}

const MS_DAY = 86_400_000
const isoDay = (epochDay: number) => new Date(epochDay * MS_DAY).toISOString().slice(0, 10)

/** Expand a run-length column to one value per row. */
function expand(c: Rle, n: number, what: string): (number | null)[] {
  const out = new Array<number | null>(n)
  let k = 0
  for (let i = 0; i < c.v.length; i++) {
    const v = c.v[i]
    for (let j = c.n[i]; j > 0; j--) {
      if (k >= n) throw new Error(`eShepherd: ${what} is longer than the ${n} rows it should cover`)
      out[k++] = v
    }
  }
  if (k !== n) throw new Error(`eShepherd: ${what} covers ${k} rows, not ${n}`)
  return out
}

/** Expand a delta-coded column and accumulate it into the value itself. */
function accumulate(c: Rle, n: number, what: string): number[] {
  const out = new Array<number>(n)
  let k = 0
  let acc = 0
  for (let i = 0; i < c.v.length; i++) {
    const v = c.v[i] ?? 0
    for (let j = c.n[i]; j > 0; j--) {
      if (k >= n) throw new Error(`eShepherd: ${what} is longer than the ${n} rows it should cover`)
      acc += v
      out[k++] = acc
    }
  }
  if (k !== n) throw new Error(`eShepherd: ${what} covers ${k} rows, not ${n}`)
  return out
}

const RLE_KEYS = ['a', 's', 'ps', 'st', 'nc', 'lc', 't', 'ck', 'ncd'] as const

/** Does this look like the packed payload, rather than some other panel's text? */
export function isPacked(x: unknown): x is Packed {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  if (!Number.isFinite(p.n) || (p.n as number) <= 0) return false
  for (const k of ['aA', 'aI', 'aM', 'SD', 'ta'] as const) if (!Array.isArray(p[k]) || !(p[k] as unknown[]).length) return false
  for (const k of RLE_KEYS) {
    const c = p[k] as Rle | undefined
    if (!c || !Array.isArray(c.v) || !Array.isArray(c.n)) return false
  }
  return true
}

/** Every panel on the dashboard, including the ones nested inside collapsible rows. */
function flatten(panels: Panel[] | undefined): Panel[] {
  const out: Panel[] = []
  for (const p of panels ?? []) {
    out.push(p)
    if (p.panels) out.push(...flatten(p.panels))
  }
  return out
}

/** The one text value a panel of this kind returns, parsed. */
function payloadOf(j: unknown): unknown {
  const results = (j as { results?: Record<string, { error?: string; frames?: Frame[] }> }).results ?? {}
  for (const res of Object.values(results)) {
    if (res.error) continue
    const raw = res.frames?.[0]?.data?.values?.[0]?.[0]
    if (typeof raw !== 'string' || raw.length < 2) continue
    try {
      return JSON.parse(raw)
    } catch {
      /* not this panel */
    }
  }
  return null
}

export async function pullRepro(): Promise<Record<string, unknown>[]> {
  const token = reproToken()
  const dash = await fetch(`${BASE}/api/public/dashboards/${token}`)
  if (!dash.ok) throw new Error(`eShepherd dashboard ${dash.status}`)
  const d = (await dash.json()) as { dashboard?: { time?: { from?: string }; panels?: Panel[] } }

  // Panels that query the cattle database, the one whose title names the
  // per-cow series first. Title alone is too fragile to trust — eShepherd
  // renames these — so we check the shape of what comes back and keep looking.
  const candidates = flatten(d.dashboard?.panels)
    .filter((p) => p.targets?.some((t) => /duckdb|sql/i.test(t.datasource?.type ?? '')))
    .sort((a, b) => Number(/per cow/i.test(b.title ?? '')) - Number(/per cow/i.test(a.title ?? '')))
  if (!candidates.length) throw new Error('eShepherd dashboard has no data panel')

  // The model works from the query's own window — its last heat and "in this
  // state since" are only as old as the window lets them be — so ask for the
  // dashboard's full window, not a recent slice.
  const body = JSON.stringify({
    intervalMs: 86_400_000,
    maxDataPoints: 1000,
    timeRange: { from: d.dashboard?.time?.from ?? 'now-180d', to: 'now', timezone: 'browser' },
  })
  let packed: Packed | null = null
  const tried: number[] = []
  for (const panel of candidates) {
    tried.push(panel.id)
    const r = await fetch(`${BASE}/api/public/dashboards/${token}/panels/${panel.id}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    if (!r.ok) continue
    const p = payloadOf(await r.json())
    if (isPacked(p)) {
      packed = p
      break
    }
  }
  if (!packed) throw new Error(`eShepherd: no panel returned the per-cow series (tried ${tried.join(', ')}). The dashboard's shape has changed again.`)
  return unpackRepro(packed)
}

/**
 * Unpack the payload into one row per animal: where she stands now, and every
 * heat the model saw along the way. Pure, so a fixture can hold it to this.
 */
export function unpackRepro(packed: Packed): Record<string, unknown>[] {
  const n = packed.n
  const animal = expand(packed.a, n, 'animal')
  const state = expand(packed.s, n, 'state')
  const prev = expand(packed.ps, n, 'prev_state')
  const stateStart = expand(packed.st, n, 'state_start')
  const notCycling = expand(packed.nc, n, 'not_cycling_since')
  const cycleDay = expand(packed.lc, n, 'last_cycle_day')
  const dayOf = accumulate(packed.t, n, 'date')
  const clock = accumulate(packed.ck, n, 'days_since_heat')
  const ncDays = accumulate(packed.ncd, n, 'nc_days')
  const base = packed.ta[0]

  // Each animal's rows, oldest first. The last one is where she stands now.
  const byAnimal = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const a = animal[i]
    if (a == null) continue
    const list = byAnimal.get(a)
    if (list) list.push(i)
    else byAnimal.set(a, [i])
  }

  const synced = new Date().toISOString()
  const out: Record<string, unknown>[] = []
  for (const [a, list] of byAnimal) {
    list.sort((x, y) => dayOf[x] - dayOf[y])
    const last = list[list.length - 1]
    // Her last detected heat. The clock counts the days since it, and drops
    // back to nothing each time another heat is seen. With no cycle day there
    // is no heat to count from, so she gets no heat date and no due date.
    const heatAt = (i: number) => (cycleDay[i] == null || clock[i] < 0 ? null : isoDay(base + dayOf[i] - clock[i]))
    const heats: string[] = []
    let before: number | null = null
    for (const i of list) {
      if (before != null && clock[i] < before) {
        const h = heatAt(i)
        if (h && !heats.includes(h)) heats.push(h)
      }
      before = clock[i]
    }
    const lastHeat = heatAt(last)
    if (lastHeat && !heats.includes(lastHeat)) heats.push(lastHeat)
    out.push({
      heats: heats.sort(),
      animal_id: packed.aI[a] ?? String(a),
      tag: packed.aA[a] ?? packed.aI[a] ?? String(a),
      mob: packed.aM[a] ?? 'NO MOB',
      state: packed.SD[state[last] ?? -1] ?? 'NO_DATA',
      prev_state: prev[last] == null ? null : (packed.PSD[prev[last] as number] ?? null),
      state_start: stateStart[last] == null ? null : isoDay(stateStart[last] as number),
      last_heat: lastHeat,
      days_since_heat: clock[last] < 0 ? null : clock[last],
      not_cycling_since: notCycling[last] == null ? null : isoDay(notCycling[last] as number),
      nc_days: ncDays[last],
      observed_on: Number.isFinite(dayOf[last]) ? isoDay(base + dayOf[last]) : farmToday(),
      synced_at: synced,
    })
  }
  return out
}

/** Pull, store the latest state per animal and a weekly snapshot, and report to the health monitor. */
export async function syncRepro(sb: SupabaseClient): Promise<{ animals: number; observedOn: string | null }> {
  const now = new Date().toISOString()
  try {
    const rows = await pullRepro()
    if (!rows.length) throw new Error('eShepherd returned no animals')
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('eshepherd_repro').upsert(rows.slice(i, i + 500), { onConflict: 'animal_id' })
      if (error) throw error
    }
    const snap = rows.map((r) => ({ animal_id: r.animal_id, observed_on: r.observed_on, state: r.state, mob: r.mob }))
    for (let i = 0; i < snap.length; i += 500) {
      const { error } = await sb.from('eshepherd_repro_history').upsert(snap.slice(i, i + 500), { onConflict: 'animal_id,observed_on' })
      if (error) throw error
    }
    const observedOn = rows.map((r) => String(r.observed_on)).sort().pop() ?? null
    await sb.rpc('record_integration_heartbeat', { p_key: 'eshepherd_repro', p_detail: `${rows.length} animals, as of ${observedOn}`, p_data_at: observedOn ? `${observedOn}T12:00:00Z` : now })
    return { animals: rows.length, observedOn }
  } catch (e) {
    await sb.from('integration_health').update({ status: 'error', detail: (e as Error).message.slice(0, 300), last_checked_at: now, updated_at: now }).eq('source_key', 'eshepherd_repro')
    throw e
  }
}
