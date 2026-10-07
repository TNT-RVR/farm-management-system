import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * eShepherd's pregnancy (cycling) model, read from the public Grafana
 * dashboard eShepherd gave us as testers. Grafana answers a public dashboard's
 * panel query without a login: POST /api/public/dashboards/{token}/panels/{id}/query.
 * The panel returns one row per animal per day over the dashboard's window
 * (about 55,000 rows, 7 MB); the latest row per animal carries her last heat
 * and how long she has held the state.
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

const day = (v: unknown) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null)
const int = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)))

export async function pullRepro(): Promise<Record<string, unknown>[]> {
  const token = reproToken()
  // The panel that holds the model's data: the one querying the cattle database.
  const dash = await fetch(`${BASE}/api/public/dashboards/${token}`)
  if (!dash.ok) throw new Error(`eShepherd dashboard ${dash.status}`)
  const d = (await dash.json()) as { dashboard?: { time?: { from?: string }; panels?: { id: number; targets?: { datasource?: { type?: string } }[] }[] } }
  const panel = d.dashboard?.panels?.find((p) => p.targets?.some((t) => /duckdb|sql/i.test(t.datasource?.type ?? '')))
  if (!panel) throw new Error('eShepherd dashboard has no data panel')

  const r = await fetch(`${BASE}/api/public/dashboards/${token}/panels/${panel.id}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The model works from the query's own window — its last heat and "in this
    // state since" are only as old as the window lets them be — so ask for the
    // dashboard's full window (from the start of monitoring), not a recent slice.
    body: JSON.stringify({ intervalMs: 86_400_000, maxDataPoints: 1000, timeRange: { from: d.dashboard?.time?.from ?? 'now-365d', to: 'now', timezone: 'browser' } }),
  })
  if (!r.ok) throw new Error(`eShepherd query ${r.status}`)
  const j = (await r.json()) as { results?: Record<string, { error?: string; frames?: Frame[] }> }
  const res = Object.values(j.results ?? {})[0]
  if (res?.error) throw new Error(`eShepherd: ${res.error}`)
  const fr = res?.frames?.[0]
  if (!fr) return []
  const names = fr.schema.fields.map((f) => f.name)
  const col = (n: string) => names.indexOf(n)
  const v = fr.data.values
  const n = v[0]?.length ?? 0
  // Each animal's rows in date order; the latest is her current state.
  const byAnimal = new Map<string, number[]>()
  const ti = col('time')
  const ai = col('animal_id')
  for (let i = 0; i < n; i++) {
    const id = String(v[ai][i])
    const list = byAnimal.get(id) ?? []
    list.push(i)
    byAnimal.set(id, list)
  }
  const latest = new Map<string, number>()
  for (const [id, list] of byAnimal) {
    list.sort((a, b) => String(v[ti][a]).localeCompare(String(v[ti][b])))
    latest.set(id, list[list.length - 1])
  }
  const at = (name: string, i: number) => (col(name) >= 0 ? v[col(name)][i] : null)
  // Her last detected heat. The model's clock (ds_clock) counts days since it;
  // last_cycle_day is NOT the heat — it is the last day she still read as
  // cycling (about 23 days after the heat, when "Overdue" begins). With no
  // cycle ever seen, the clock runs from when monitoring began, so there is no
  // heat to date from.
  const heatOf = (i: number) => {
    const obs = day(at('time', i))
    const clock = int(at('ds_clock', i))
    if (!obs || clock == null || at('last_cycle_day', i) == null) return null
    const d = new Date(obs + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - clock)
    return d.toISOString().slice(0, 10)
  }
  // Every heat she showed: the model's clock drops back each time one is seen.
  const heatsOf = (list: number[]) => {
    const out: string[] = []
    let prev: number | null = null
    for (const i of list) {
      const clock = int(at('ds_clock', i))
      if (prev != null && clock != null && clock < prev) {
        const h = heatOf(i)
        if (h && !out.includes(h)) out.push(h)
      }
      prev = clock
    }
    const last = heatOf(list[list.length - 1])
    if (last && !out.includes(last)) out.push(last)
    return out.sort()
  }
  return [...latest.entries()].map(([id, i]) => ({
    heats: heatsOf(byAnimal.get(id)!),
    animal_id: id,
    tag: String(at('Animal', i) ?? id),
    mob: String(at('Mob', i) ?? 'NO MOB'),
    state: String(at('state', i) ?? 'NO_DATA'),
    prev_state: at('prev_state', i) == null ? null : String(at('prev_state', i)),
    state_start: day(at('state_start', i)),
    last_heat: heatOf(i),
    days_since_heat: int(at('ds_clock', i)),
    not_cycling_since: day(at('not_cycling_since', i)),
    nc_days: int(at('nc_days', i)),
    observed_on: day(at('time', i)) ?? new Date().toISOString().slice(0, 10),
    synced_at: new Date().toISOString(),
  }))
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
