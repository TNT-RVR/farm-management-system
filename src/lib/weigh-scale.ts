/**
 * The farm scale's figures (Sam, 23 Oct 2026: "stats on each truck such as
 * # of loads, total kgs, etc."): the loads weighed in, grouped by truck,
 * trailer or driver. Pure, so the Weigh scale tab and its test share it.
 *
 * A load waiting for its empty weight has no net yet and is counted only as
 * waiting. A bin total over several loads counts each of them; its weight is
 * the whole.
 */

export type ScaleLoad = {
  truck: string | null
  trailer: string | null
  driver: string | null
  loaded_on: string
  entry_kind: 'weighed' | 'net' | 'bin_total'
  load_count: number | null
  gross_kg: number | string | null
  tare_kg: number | string | null
  net_kg: number | string | null
  bushels: number | string | null
  estimated: boolean
}

export type GroupBy = 'truck' | 'trailer' | 'driver'

/**
 * The driver to show: the account's name as it reads today, else the name the
 * load stored. A load keeps the name it was saved with, so an account renamed
 * since (lhansen → Lane Hansen, 24 Oct 2026) would otherwise read twice over.
 */
export function driverName(l: { driver: string | null; driver_id?: string | null }, nameOf: (id: string) => string | null | undefined): string | null {
  return (l.driver_id ? nameOf(l.driver_id) : null) ?? l.driver
}

export type ScaleStat = {
  key: string
  loads: number
  waiting: number
  netKg: number
  bushels: number
  /** Net a load, kg. */
  avgNetKg: number | null
  /** Empty weight, averaged over loads weighed full and empty. */
  avgTareKg: number | null
  /** Heaviest full weight. */
  maxGrossKg: number | null
  lastOn: string | null
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v))

export const NONE: Record<GroupBy, string> = { truck: 'No truck recorded', trailer: 'No trailer recorded', driver: 'No driver recorded' }

/** The loads by truck (or trailer, or driver), most loads first, nobody last. */
export function scaleStats(loads: ScaleLoad[], by: GroupBy): ScaleStat[] {
  const groups = new Map<string, ScaleLoad[]>()
  for (const l of loads) {
    const key = l[by]?.trim() || NONE[by]
    groups.set(key, [...(groups.get(key) ?? []), l])
  }
  return [...groups.entries()]
    .map(([key, ls]) => {
      const done = ls.filter((l) => n(l.net_kg) != null)
      const weighed = done.filter((l) => l.entry_kind === 'weighed')
      const loadsN = done.reduce((s, l) => s + (l.entry_kind === 'bin_total' ? Math.max(1, l.load_count ?? 1) : 1), 0)
      const netKg = done.reduce((s, l) => s + (n(l.net_kg) ?? 0), 0)
      const tares = weighed.map((l) => n(l.tare_kg)).filter((t): t is number => t != null && t > 0)
      const grosses = weighed.map((l) => n(l.gross_kg)).filter((g): g is number => g != null)
      return {
        key,
        loads: loadsN,
        waiting: ls.length - done.length,
        netKg,
        bushels: done.reduce((s, l) => s + (n(l.bushels) ?? 0), 0),
        avgNetKg: loadsN ? netKg / loadsN : null,
        avgTareKg: tares.length ? tares.reduce((s, t) => s + t, 0) / tares.length : null,
        maxGrossKg: grosses.length ? Math.max(...grosses) : null,
        lastOn: ls.map((l) => l.loaded_on).sort().at(-1) ?? null,
      }
    })
    .sort((a, b) => Number(a.key === NONE[by]) - Number(b.key === NONE[by]) || b.loads - a.loads || a.key.localeCompare(b.key))
}

/* ── Scale tickets: filters and sorting ─────────────────────────────────── */

export type TicketRow = {
  id: string
  /** Weighed in: the full weight's time, else its day. */
  when: string
  /** Weighed out: the empty weight's time; null for a net, a bin total, or one still waiting. */
  out: string | null
  /** The load's own day on the farm's clock: what the date filters read. */
  day: string
  field: string
  crop: string
  netKg: number | null
  driver: string
  truck: string
  to: string
}

export type TicketSort = 'when' | 'out' | 'field' | 'crop' | 'netKg' | 'driver' | 'truck'
export type TicketFilters = { field?: string; crop?: string; driver?: string; truck?: string; from?: string; to?: string; q?: string }

/** The tickets that pass the filters, sorted; ties fall back to newest first. */
export function filterTickets(rows: TicketRow[], f: TicketFilters, sort: TicketSort, desc: boolean): TicketRow[] {
  const q = f.q?.trim().toLowerCase()
  const kept = rows.filter(
    (r) =>
      (!f.field || r.field === f.field) &&
      (!f.crop || r.crop === f.crop) &&
      (!f.driver || r.driver === f.driver) &&
      (!f.truck || r.truck === f.truck) &&
      (!f.from || r.day >= f.from) &&
      (!f.to || r.day <= f.to) &&
      (!q || [r.when, r.field, r.crop, r.driver, r.truck, r.to].join(' ').toLowerCase().includes(q)),
  )
  const dir = desc ? -1 : 1
  return kept.sort((a, b) => {
    const x = a[sort]
    const y = b[sort]
    // A ticket with no net yet (waiting to weigh out) sorts last either way.
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
    return c * dir || b.when.localeCompare(a.when)
  })
}
