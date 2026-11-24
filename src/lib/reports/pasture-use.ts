import { supabase } from '@/lib/supabase'
import { isNoFence } from '@/lib/eshepherd'
import { farmDay } from '@/lib/harvest-date'
import { compareFieldNames } from '@/lib/queries'
import { fetchAll, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData } from './framework'
import { mobRanchOf } from './herd'
import { loadTownshipTable } from '@/lib/geo/atsTownships'
import { formatQuarters, pastureQuarters } from '@/lib/geo/pasture-lld'
import type { Geometry } from 'geojson'

/**
 * Which herd was in which pasture over a year, and for how long (Sam,
 * 23 Nov 2026: "just how long they were in pasture C").
 *
 * The moves are the eShepherd fence activations. Each is one mob in one
 * collar paddock — "C-3 (South West)", "F-7" — and the import has already
 * matched most of them to a pasture on the map. Here they roll up to that
 * pasture, and back-to-back or overlapping strips of the same pasture become
 * one stay. Paddocks that match no pasture (the training paddocks, the bull
 * pasture) roll up by name with the strip number taken off.
 *
 * What the activations look like, which the rules below are for:
 * - Each move appears twice, an hour apart, sometimes with different head
 *   counts. The copies overlap, so they merge.
 * - Some rows never close. A row with no end ends where the mob's next row
 *   starts; the mob's last row is still in.
 * - "(VP Disabled)" is the fence switched off. The cattle are somewhere, but
 *   the collars do not say where. A few days of it between two strips of the
 *   same pasture, with nowhere else in between, is still the one stay; the
 *   rest is counted as "fence off" for the herd.
 *
 * Days are nights: turned in on the 1st and out on the 6th is 5 days, so a
 * herd's days add up to no more than the year. They are counted inside the
 * year, to today for a herd still in.
 */

const DAY = 86_400_000
/** A fence-off gap this long or shorter between two strips of one pasture is still the one stay. */
export const BRIDGE_DAYS = 7

export type UseActivation = {
  id: string
  mob: string
  paddock_name: string
  pasture_id: string | null
  started_at: string
  ended_at: string | null
  head_count: number | null
}
/** A grazing event entered by hand (no eShepherd activation behind it). */
export type UseEvent = {
  pasture_id: string
  head_count: number | null
  turned_in_on: string
  moved_out_on: string | null
  notes: string | null
}
export type UsePasture = { id: string; name: string; area_acres: unknown }

/** One herd in one pasture, from turned in to moved out. `out` null: still in. */
export type Stay = { mob: string; key: string; pasture: string; onMap: boolean; lld: string | null; acres: number | null; in: string; out: string | null; days: number; head: number | null }

export type HerdUse = {
  mob: string
  stays: Stay[]
  /** Nights in a known pasture this year. */
  placedDays: number
  /** Nights with the fence off and no pasture known. */
  fenceOffDays: number
  head: number | null
}

export type PastureHerd = { mob: string; firstIn: string; lastOut: string | null; stays: number; days: number; head: number | null }
export type PastureUseRow = { key: string; pasture: string; onMap: boolean; lld: string | null; acres: number | null; herds: PastureHerd[]; daysWithCattle: number
  /** Every herd's largest count in the pasture, added up: the most head it carried. */
  head: number | null
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
const clip = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d)

/**
 * The pasture an eShepherd paddock with no match on the map belongs to: its
 * name without the strip number. "Bull Pasture- 3" is the Bull Pasture,
 * "Training 11" and "Training Paddock-VP001" are the training paddocks,
 * "Whitfield3" is Whitfield. A paddock named only by when it was drawn is said so.
 */
export function parentPaddock(name: string): string {
  const s = name.trim()
  const drawn = /^(\d{4}-\d{2}-\d{2})[ T]\d{1,2}:\d{2}/.exec(s)
  if (drawn) return `Paddock drawn ${drawn[1]}`
  const bare = s
    .replace(/[\s\-–_]*(?:vp)?\d+$/i, '')
    .replace(/\s*paddock\s*$/i, '')
    .replace(/[\s\-–_]+$/, '')
    .trim()
  return bare || s
}

/** The pasture's own name for a lettered one ("Pasture C"), else as stored. */
const pastureName = (p: UsePasture | undefined) => p?.name ?? 'Unknown pasture'

type Spell = { mob: string; key: string | null; pasture: string; onMap: boolean; in: string; out: string | null; head: number | null }

/**
 * Activations and hand-entered events as spells in farm days: a place (null
 * for the fence off), a first day and a last.
 */
export function spellsOf(o: {
  activations: UseActivation[]
  events: UseEvent[]
  pastures: UsePasture[]
  nowIso: string
  dayOf?: (iso: string) => string
}): Spell[] {
  const dayOf = o.dayOf ?? ((iso: string) => farmDay(iso))
  const byId = new Map(o.pastures.map((p) => [p.id, p]))
  const out: Spell[] = []
  const byMob = new Map<string, UseActivation[]>()
  for (const a of o.activations) {
    // A mob of nobody is a fact about the mob, not grazing.
    if (a.head_count === 0) continue
    byMob.set(a.mob, [...(byMob.get(a.mob) ?? []), a])
  }
  for (const [mob, rows] of byMob) {
    rows.sort((a, b) => a.started_at.localeCompare(b.started_at))
    rows.forEach((a, i) => {
      // An open row ends where the mob's next row starts; the last one is still in.
      const next = rows.slice(i + 1).find((r) => r.started_at > a.started_at)
      const end = a.ended_at ?? next?.started_at ?? null
      const off = isNoFence(a.paddock_name)
      const p = a.pasture_id ? byId.get(a.pasture_id) : undefined
      const pasture = off ? 'Fence off' : p ? pastureName(p) : parentPaddock(a.paddock_name)
      out.push({
        mob,
        key: off ? null : p ? `p:${p.id}` : `n:${pasture.toLowerCase()}`,
        pasture,
        onMap: !!p,
        in: dayOf(a.started_at),
        out: end ? dayOf(end < o.nowIso ? end : o.nowIso) : null,
        head: a.head_count,
      })
    })
  }
  for (const e of o.events) {
    const p = byId.get(e.pasture_id)
    out.push({
      mob: e.notes?.trim().split('\n')[0].slice(0, 40) || 'Entered by hand',
      key: `p:${e.pasture_id}`,
      pasture: pastureName(p),
      onMap: !!p,
      in: e.turned_in_on,
      out: e.moved_out_on,
      head: e.head_count,
    })
  }
  return out
}

/**
 * One mob's spells as stays. Spells of the same place merge when they overlap
 * or touch, or when the gap between them is short and the mob was nowhere
 * else in it (the fence off for a move or a check).
 */
export function staysOf(spells: Spell[]): Stay[] {
  const placed = spells.filter((s) => s.key).sort((a, b) => a.in.localeCompare(b.in) || (a.out ?? '9').localeCompare(b.out ?? '9'))
  const stays: Omit<Stay, 'days' | 'lld' | 'acres'>[] = []
  for (const s of placed) {
    const last = [...stays].reverse().find((x) => x.key === s.key)
    const joins =
      last &&
      (last.out == null ||
        s.in <= addDays(last.out, 1) ||
        (between(last.out, s.in) <= BRIDGE_DAYS && !placed.some((o) => o.key !== s.key && o.in >= last.out! && o.in <= s.in)))
    if (last && joins) {
      last.out = last.out == null || s.out == null ? null : s.out > last.out ? s.out : last.out
      if (s.head != null) last.head = Math.max(last.head ?? 0, s.head)
    } else stays.push({ mob: s.mob, key: s.key!, pasture: s.pasture, onMap: s.onMap, in: s.in, out: s.out, head: s.head })
  }
  return stays.map((s) => ({ ...s, lld: null, acres: null, days: 0 }))
}

/** Nights of [in, out) inside [from, to); out null runs to `to`. */
export function nightsIn(s: { in: string; out: string | null }, from: string, to: string): number {
  const a = clip(s.in, from, to)
  const b = clip(s.out ?? to, from, to)
  return Math.max(0, between(a, b))
}

/** Nights covered by any of the spans, inside [from, to). */
function nightSet(spans: { in: string; out: string | null }[], from: string, to: string): Set<string> {
  const set = new Set<string>()
  for (const s of spans) {
    let d = clip(s.in, from, to)
    const end = clip(s.out ?? to, from, to)
    while (d < end) {
      set.add(d)
      d = addDays(d, 1)
    }
  }
  return set
}

export function pastureUse(o: {
  year: number
  today: string
  nowIso: string
  activations: UseActivation[]
  events: UseEvent[]
  pastures: UsePasture[]
  /** pasture id → ranch id, from grazing_pastures. */
  pastureRanch: Map<string, string>
  ranches: { id: string; name: string }[]
  ranchId: string | null
  /** pasture id → its quarter sections, worked out from the map shape. */
  lld?: Map<string, string>
  dayOf?: (iso: string) => string
}): { herds: HerdUse[]; pastures: PastureUseRow[]; from: string; to: string } {
  const from = `${o.year}-01-01`
  // Nights up to today: today's own night has not happened yet.
  const to = o.today < `${o.year + 1}-01-01` ? o.today : `${o.year + 1}-01-01`
  const spells = spellsOf(o)
  const inYear = (s: { in: string; out: string | null }) => s.in < to && (s.out == null || s.out > from)
  const keep = (s: { mob: string; key: string | null }) => {
    if (!o.ranchId) return true
    const id = s.key?.startsWith('p:') ? s.key.slice(2) : null
    const pr = id ? o.pastureRanch.get(id) : undefined
    if (pr) return pr === o.ranchId
    // Off the map or the fence off: the ranch the mob is named for, or any
    // ranch for a mob that names none (a custom-grazing customer's cattle).
    const mr = mobRanchOf(s.mob, o.ranches)
    return !mr || mr.id === o.ranchId
  }

  const acresOf = new Map(o.pastures.map((p) => [p.id, num(p.area_acres)]))
  const byMob = new Map<string, Spell[]>()
  for (const s of spells) byMob.set(s.mob, [...(byMob.get(s.mob) ?? []), s])
  const herds: HerdUse[] = []
  for (const [mob, list] of byMob) {
    // A stay of under a night (a paddock switched on and off again within the
    // day) is a passing-through, not grazing; one turned in today still shows.
    const stays = staysOf(list)
      .filter((s) => inYear(s) && keep(s))
      .map((s) => {
        const id = s.key.startsWith('p:') ? s.key.slice(2) : null
        return { ...s, lld: (id && o.lld?.get(id)) || null, acres: id ? (acresOf.get(id) ?? null) : null, days: nightsIn(s, from, to) }
      })
      .filter((s) => s.days > 0 || s.out == null)
    if (!stays.length) continue
    const placed = nightSet(stays, from, to)
    const off = nightSet(list.filter((s) => !s.key && inYear(s)), from, to)
    for (const d of placed) off.delete(d)
    const heads = stays.map((s) => s.head).filter((h): h is number => h != null)
    herds.push({ mob, stays, placedDays: placed.size, fenceOffDays: off.size, head: heads.length ? Math.max(...heads) : null })
  }
  herds.sort((a, b) => a.mob.localeCompare(b.mob))

  const byPasture = new Map<string, Stay[]>()
  for (const h of herds) for (const s of h.stays) byPasture.set(s.key, [...(byPasture.get(s.key) ?? []), s])
  const pastures: PastureUseRow[] = [...byPasture].map(([key, stays]) => {
    const mobs = new Map<string, Stay[]>()
    for (const s of stays) mobs.set(s.mob, [...(mobs.get(s.mob) ?? []), s])
    const herdsIn: PastureHerd[] = [...mobs].map(([mob, ss]) => {
      const heads = ss.map((s) => s.head).filter((h): h is number => h != null)
      return {
        mob,
        firstIn: ss.map((s) => s.in).sort()[0],
        lastOut: ss.some((s) => s.out == null) ? null : ss.map((s) => s.out!).sort().pop()!,
        stays: ss.length,
        days: ss.reduce((t, s) => t + s.days, 0),
        head: heads.length ? Math.max(...heads) : null,
      }
    })
    herdsIn.sort((a, b) => a.firstIn.localeCompare(b.firstIn) || a.mob.localeCompare(b.mob))
    return {
      key,
      pasture: stays[0].pasture,
      onMap: stays[0].onMap,
      lld: stays[0].lld,
      acres: key.startsWith('p:') ? (acresOf.get(key.slice(2)) ?? null) : null,
      herds: herdsIn,
      daysWithCattle: nightSet(stays, from, to).size,
      head: herdsIn.some((h) => h.head != null) ? herdsIn.reduce((t, h) => t + (h.head ?? 0), 0) : null,
    }
  })
  // The map's pastures first, in letter order; the eShepherd-only ones after.
  pastures.sort((a, b) => Number(b.onMap) - Number(a.onMap) || compareFieldNames(a.pasture, b.pasture))
  return { herds, pastures, from, to }
}

/* ── The report ─────────────────────────────────────────────────────────── */

export type PastureUseView = 'herd' | 'pasture'

export const HERD_COLUMNS: ReportColumn[] = [{ label: 'Pasture' }, { label: 'LLD' }, { label: 'Acres', decimals: 0 }, { label: 'In' }, { label: 'Out' }, { label: 'Days', decimals: 0 }, { label: 'Head', decimals: 0 }]
// LLD and acres are the pasture's, repeated on each herd's row in the page,
// the PDF and the CSV alike (Sam, 23 Nov 2026).
export const PASTURE_COLUMNS: ReportColumn[] = [
  { label: 'Herd' },
  { label: 'LLD' },
  { label: 'Acres', decimals: 0 },
  { label: 'First in' },
  { label: 'Last out' },
  { label: 'Stays', decimals: 0 },
  { label: 'Days', decimals: 0 },
  { label: 'Head', decimals: 0 },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "May 04, 2026" — how Sam wants this report's dates (23 Nov 2026). Null is a herd still in. */
export function longDay(iso: string | null): string {
  if (!iso) return 'still in'
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(iso)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[3]}, ${m[1]}` : iso
}

const offMap = (s: { onMap: boolean; pasture: string }) => (s.onMap ? s.pasture : `${s.pasture} (eShepherd only)`)
/** "1 day", "36 days". */
export const daysWord = (n: number) => `${n.toLocaleString('en-CA')} day${n === 1 ? '' : 's'}`

export function pastureUseReport(r: ReturnType<typeof pastureUse>, o: { view: PastureUseView; year: number; ranchName: string }): ReportData {
  const counted = r.to > `${o.year}-12-31` ? `${o.year}-12-31` : r.to
  const common = {
    subtitle: `${o.year} · ${o.ranchName}`,
    orientation: 'portrait' as const,
    meta: [
      ['Herds', r.herds.length],
      ['Pastures used', r.pastures.length],
      ['Counted to', longDay(counted)],
    ] as [string, Cell][],
    summary: [
      'From the eShepherd fence moves. Strips of one pasture (C-1 to C-7) are one stay; a few days with the fence off between them, and nowhere else, does not break it.',
      'LLD is the quarter sections each pasture’s fence takes in (10 acres or more), worked out from its shape on the map.',
      'Days are nights inside the year, to today for a herd still in; a stay of under a night is left out. Head is the most counted in the stay; a pasture’s total adds up each herd’s.',
    ],
  }
  if (o.view === 'herd') {
    return {
      ...common,
      title: 'Pasture use by herd',
      columns: HERD_COLUMNS,
      groupLabel: 'Herd',
      groups: r.herds.map((h) => ({
        title: h.mob,
        note: [`${daysWord(h.placedDays)} in a pasture`, h.fenceOffDays ? `${h.fenceOffDays} with the fence off` : null].filter(Boolean).join(' · '),
        rows: h.stays.map((s) => [offMap(s), s.lld, s.acres, longDay(s.in), longDay(s.out), s.days, s.head]),
        totals: [`${h.stays.length} stay${h.stays.length === 1 ? '' : 's'}`, null, null, null, null, h.placedDays, null],
      })),
      filename: `Pasture use by herd ${o.year}`,
    }
  }
  return {
    ...common,
    title: 'Pasture use by pasture',
    columns: PASTURE_COLUMNS,
    groupLabel: 'Pasture',
    groups: r.pastures.map((p) => ({
      title: offMap(p),
      note: `cattle in ${daysWord(p.daysWithCattle)}`,
      rows: p.herds.map((h) => [h.mob, p.lld, p.acres, longDay(h.firstIn), longDay(h.lastOut), h.stays, h.days, h.head]),
      totals: [`${p.herds.length} herd${p.herds.length === 1 ? '' : 's'}`, null, null, null, null, null, null, p.head],
    })),
    filename: `Pasture use by pasture ${o.year}`,
  }
}

/** Everything the report reads, for the page and the Reports row alike. */
export async function fetchPastureUse() {
  const [activations, events, pastures, shapes, table, links, ranches] = await Promise.all([
    fetchAll<UseActivation>((a, b) =>
      supabase.from('eshepherd_activations').select('id, mob, paddock_name, pasture_id, started_at, ended_at, head_count').order('started_at').order('id').range(a, b),
    ),
    // Hand-entered only: the import writes an event for every activation it
    // placed, which the activations above already carry.
    fetchAll<UseEvent>((a, b) =>
      supabase.from('grazing_events').select('pasture_id, head_count, turned_in_on, moved_out_on, notes').is('eshepherd_activation_id', null).order('turned_in_on').order('id').range(a, b),
    ),
    fetchAll<UsePasture>((a, b) => supabase.from('pastures').select('id, name, area_acres').order('id').range(a, b)),
    fetchAll<{ id: string; geojson: Geometry | null }>((a, b) => supabase.from('pasture_map').select('id, geojson').order('id').range(a, b)),
    loadTownshipTable(),
    fetchAll<{ pasture_id: string | null; ranch_id: string | null }>((a, b) => supabase.from('grazing_pastures').select('pasture_id, ranch_id').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('ranches').select('id, name').order('id').range(a, b)),
  ])
  const pastureRanch = new Map(links.filter((l) => l.pasture_id && l.ranch_id).map((l) => [l.pasture_id as string, l.ranch_id as string]))
  // No pasture has its legal land typed in; it is read off the shape on the map.
  const lld = new Map(shapes.map((p) => [p.id, formatQuarters(pastureQuarters(p.geojson, table))] as const).filter(([, t]) => t))
  return { activations, events, pastures, pastureRanch, ranches, lld }
}

export type PastureUseData = Awaited<ReturnType<typeof fetchPastureUse>>

export async function gatherPastureUse(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const ranchId = pick(p, 'ranch')
  const view: PastureUseView = p.view === 'pasture' ? 'pasture' : 'herd'
  const d = await fetchPastureUse()
  const r = pastureUse({ ...d, year, today: ctx.today, nowIso: new Date().toISOString(), ranchId })
  const ranchName = ranchId ? (d.ranches.find((x) => x.id === ranchId)?.name ?? 'one ranch') : 'All ranches'
  if (!r.herds.length) throw new Error(`No herd moves recorded in ${year}${ranchId ? ` at ${ranchName}` : ''}.`)
  return pastureUseReport(r, { view, year, ranchName })
}
