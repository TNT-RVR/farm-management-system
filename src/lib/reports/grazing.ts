import { supabase } from '@/lib/supabase'
import { isNoFence } from '@/lib/eshepherd'
import { compareFieldNames } from '@/lib/queries'
import { fetchAll, num, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { mobClass, mobRanchOf, type HerdRow } from './herd'

/**
 * Grazing record by pasture for a season: every time a mob went in and came
 * out, the animal units it carried and the AUMs it took, the rest each
 * pasture got before it was grazed again, and how long it has rested since.
 *
 * The events are grazing_events — written by the eShepherd import for every
 * activation that resolves to a pasture on the map, or by hand. eShepherd
 * paddocks that match no pasture (training paddocks, the bull pasture) have
 * no grazing event, so they come from the activations themselves, in a last
 * group, so no grazing goes missing.
 *
 * Animal units a head: the event's own weight ÷ 1,000 lb where it has one,
 * else the AU of the herd class the mob is named for (Herd tab), else 1.
 * An AUM is 30 AU-days. Days are counted inside the season, to today.
 */

export type GrazingEvent = {
  id: string
  pasture_id: string
  head_count: number | null
  avg_animal_weight_lb: unknown
  turned_in_on: string
  moved_out_on: string | null
  notes: string | null
  eshepherd_activation_id: string | null
}
export type Activation = { id: string; mob: string; paddock_name: string; pasture_id: string | null; started_at: string; ended_at: string | null; head_count: number | null }
export type PastureRow = { id: string; name: string; area_acres: unknown; min_rest_days: number | null }

const DAY = 86_400_000
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY))
const clip = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d)

export const GRAZING_COLUMNS = [
  { label: 'Mob' },
  { label: 'Paddock' },
  { label: 'Turned in' },
  { label: 'Moved out' },
  { label: 'Days', decimals: 0 },
  { label: 'Head', decimals: 0 },
  { label: 'AU per head', upTo: 2 },
  { label: 'Animal units', decimals: 1 },
  { label: 'AUMs', decimals: 1 },
  { label: 'Rest after (days)', decimals: 0 },
]

type Stay = { mob: string; paddock: string | null; in: string; out: string | null; head: number; au: number; auNote: boolean }

/** Days of rest after `out`: 0 if another mob is still in, else to the next turn-in, else (still resting) to the cut-off. */
export function restAfter(out: string | null, others: { in: string; out: string | null }[], cutoff: string): { days: number | null; resting: boolean } {
  if (!out) return { days: null, resting: false }
  if (others.some((o) => o.in <= out && (o.out == null || o.out > out))) return { days: 0, resting: false }
  const next = others.filter((o) => o.in >= out).sort((a, b) => a.in.localeCompare(b.in))[0]
  return next ? { days: days(out, next.in), resting: false } : { days: days(out, cutoff), resting: true }
}

/** Days with any mob in, inside [from, to]: the union of the stays. */
export function daysGrazed(stays: { in: string; out: string | null }[], from: string, to: string): number {
  const spans = stays.map((s) => [clip(s.in, from, to), clip(s.out ?? to, from, to)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0].localeCompare(b[0]))
  let total = 0
  let cur: [string, string] | null = null
  for (const [a, b] of spans) {
    if (!cur || a > cur[1]) {
      if (cur) total += days(cur[0], cur[1])
      cur = [a, b]
    } else if (b > cur[1]) cur[1] = b
  }
  if (cur) total += days(cur[0], cur[1])
  return total
}

export function grazingGroups(o: {
  year: number
  today: string
  events: GrazingEvent[]
  activations: Activation[]
  pastures: PastureRow[]
  pastureRanch: Map<string, string>
  ranches: { id: string; name: string }[]
  herd: HerdRow[]
  ranchId: string | null
}): { groups: ReportGroup[]; aums: number; stays: number } {
  const from = `${o.year}-01-01`
  const cutoff = o.today < `${o.year}-12-31` ? o.today : `${o.year}-12-31`
  const actById = new Map(o.activations.map((a) => [a.id, a]))
  const ranchName = new Map(o.ranches.map((r) => [r.id, r.name]))
  const auFor = (mob: string, weight: number | null, ranchId: string | null): { au: number; guessed: boolean } => {
    if (weight && weight > 0) return { au: weight / 1000, guessed: false }
    const ranch = ranchId ?? mobRanchOf(mob, o.ranches)?.id ?? null
    const c = mobClass(mob, o.herd.filter((h) => !ranch || h.ranch_id === ranch))
    const au = num(c?.au_equivalent)
    return au ? { au, guessed: false } : { au: 1, guessed: true }
  }
  const row = (s: Stay, rest: ReturnType<typeof restAfter>): Cell[] => {
    const inSeason = days(clip(s.in, from, cutoff), clip(s.out ?? cutoff, from, cutoff))
    return [s.mob, s.paddock, s.in, s.out ?? 'still in', inSeason, s.head, s.au, s.au * s.head, (s.au * s.head * inSeason) / 30, rest.days]
  }
  const aumsOf = (ss: Stay[]) => ss.reduce((t, s) => t + (s.au * s.head * days(clip(s.in, from, cutoff), clip(s.out ?? cutoff, from, cutoff))) / 30, 0)

  let aums = 0
  let count = 0
  const groups: ReportGroup[] = []
  const byPasture = new Map<string, GrazingEvent[]>()
  for (const e of o.events) byPasture.set(e.pasture_id, [...(byPasture.get(e.pasture_id) ?? []), e])
  const pastures = o.pastures
    .filter((p) => byPasture.has(p.id) && (!o.ranchId || o.pastureRanch.get(p.id) === o.ranchId))
    .sort((a, b) => (ranchName.get(o.pastureRanch.get(a.id) ?? '') ?? '').localeCompare(ranchName.get(o.pastureRanch.get(b.id) ?? '') ?? '') || compareFieldNames(a.name, b.name))
  for (const p of pastures) {
    const ranch = o.pastureRanch.get(p.id) ?? null
    const stays: Stay[] = byPasture
      .get(p.id)!
      .map((e) => {
        const act = e.eshepherd_activation_id ? actById.get(e.eshepherd_activation_id) : undefined
        const mob = act?.mob ?? e.notes?.replace(/^eShepherd · /, '') ?? 'Cattle'
        const a = auFor(mob, num(e.avg_animal_weight_lb), ranch)
        return { mob, paddock: act?.paddock_name ?? null, in: e.turned_in_on, out: e.moved_out_on, head: e.head_count ?? 0, au: a.au, auNote: a.guessed }
      })
      .sort((a, b) => a.in.localeCompare(b.in) || a.mob.localeCompare(b.mob))
    const rows = stays.map((s, i) => row(s, restAfter(s.out, stays.filter((_, j) => j !== i), cutoff)))
    const lastOut = stays.every((s) => s.out) ? stays.map((s) => s.out!).sort().pop()! : null
    const resting = lastOut ? days(lastOut, cutoff) : null
    const grazed = daysGrazed(stays, from, cutoff)
    const total = aumsOf(stays)
    aums += total
    count += stays.length
    const acres = num(p.area_acres)
    groups.push({
      title: `${ranch ? `${ranchName.get(ranch)} · ` : ''}${p.name}`,
      note: [
        acres ? `${Math.round(acres).toLocaleString('en-CA')} ac` : null,
        `grazed ${grazed} day${grazed === 1 ? '' : 's'}`,
        `${total.toFixed(0)} AUMs${acres ? ` (${(total / acres).toFixed(2)} an acre)` : ''}`,
        lastOut ? `resting ${resting} days since ${lastOut}${p.min_rest_days ? ` (needs ${p.min_rest_days})` : ''}` : 'cattle in now',
        stays.some((s) => s.auNote) ? 'a mob with no class or weight is counted at 1 AU a head' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      rows,
      totals: [`${stays.length} stays`, null, null, null, grazed, null, null, null, total, resting],
    })
  }

  // eShepherd paddocks with no pasture on the map: their grazing straight from the activations.
  const loose = o.activations
    .filter((a) => !a.pasture_id && !isNoFence(a.paddock_name) && (a.ended_at ?? `${cutoff}T23:59`).slice(0, 10) >= from && a.started_at.slice(0, 10) <= cutoff)
    .filter((a) => !o.ranchId || mobRanchOf(a.mob, o.ranches)?.id === o.ranchId)
    .map((a): Stay => {
      const u = auFor(a.mob, null, null)
      return { mob: a.mob, paddock: a.paddock_name, in: a.started_at.slice(0, 10), out: a.ended_at?.slice(0, 10) ?? null, head: a.head_count ?? 0, au: u.au, auNote: u.guessed }
    })
    .sort((a, b) => a.in.localeCompare(b.in) || a.mob.localeCompare(b.mob))
  if (loose.length) {
    const total = aumsOf(loose)
    aums += total
    count += loose.length
    groups.push({
      title: 'eShepherd paddocks not on the pasture map',
      note: 'Draw these on the map (Grazing) to give them a pasture, rest days and a share of the forage.',
      rows: loose.map((s) => row(s, { days: null, resting: false })),
      totals: [`${loose.length} stays`, null, null, null, null, null, null, null, total, null],
    })
  }
  return { groups, aums, stays: count }
}

export async function gatherGrazing(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const ranchId = pick(p, 'ranch')
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const [events, activations, pastures, links, ranches, herd] = await Promise.all([
    fetchAll<GrazingEvent>((a, b) =>
      supabase
        .from('grazing_events')
        .select('id, pasture_id, head_count, avg_animal_weight_lb, turned_in_on, moved_out_on, notes, eshepherd_activation_id')
        .lte('turned_in_on', to)
        .or(`moved_out_on.is.null,moved_out_on.gte.${from}`)
        .order('turned_in_on')
        .order('id')
        .range(a, b),
    ),
    fetchAll<Activation>((a, b) =>
      supabase.from('eshepherd_activations').select('id, mob, paddock_name, pasture_id, started_at, ended_at, head_count').lte('started_at', `${to}T23:59:59`).order('started_at').order('id').range(a, b),
    ),
    fetchAll<PastureRow>((a, b) => supabase.from('pastures').select('id, name, area_acres, min_rest_days').order('id').range(a, b)),
    fetchAll<{ pasture_id: string | null; ranch_id: string | null }>((a, b) => supabase.from('grazing_pastures').select('pasture_id, ranch_id').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('ranches').select('id, name').order('id').range(a, b)),
    fetchAll<HerdRow>((a, b) => supabase.from('herd_counts').select('id, ranch_id, class_name, head_count, avg_weight_lb, au_equivalent, feed_class, sort_order, updated_at').order('id').range(a, b)),
  ])
  const pastureRanch = new Map(links.filter((l) => l.pasture_id && l.ranch_id).map((l) => [l.pasture_id as string, l.ranch_id as string]))
  const r = grazingGroups({ year, today: ctx.today, events, activations, pastures, pastureRanch, ranches, herd, ranchId })
  const ranchName = ranchId ? (ranches.find((x) => x.id === ranchId)?.name ?? 'one ranch') : 'All ranches'
  if (!r.groups.length) throw new Error(`No grazing recorded in ${year}${ranchId ? ` at ${ranchName}` : ''}.`)
  return {
    title: 'Grazing record by pasture',
    subtitle: `${year} season · ${ranchName}`,
    meta: [
      ['Pastures grazed', r.groups.filter((g) => !g.title.startsWith('eShepherd')).length],
      ['Stays', r.stays],
      ['AUMs taken', Math.round(r.aums).toLocaleString('en-CA')],
      ['Counted to', cutoffLabel(year, ctx.today)],
    ],
    summary: [
      'A stay is one mob in one pasture, from turned in to moved out (eShepherd’s fence activations, or entered by hand). Days count inside the season, to today for cattle still in.',
      'Animal units a head come from the stay’s weight ÷ 1,000 lb, else the Herd tab’s AU for the class the mob is named for. An AUM is 30 animal-unit days.',
      'Rest after is the days from moving out to the next mob turned in; 0 when another mob was still in. The pasture line says how long it has rested since cattle last left, against the rest it is set to need.',
    ],
    columns: GRAZING_COLUMNS,
    groups: r.groups,
    groupLabel: 'Pasture',
    totals: ['All pastures', null, null, null, null, null, null, null, r.aums, null],
    orientation: 'landscape',
    filename: `Grazing record ${year}${ranchId ? ` ${ranchName}` : ''}`,
  }
}

const cutoffLabel = (year: number, today: string) => (today < `${year}-12-31` ? today : `${year}-12-31`)
