import { supabase } from '@/lib/supabase'
import { feedOnHandQuery, type FeedOnHand } from '@/lib/feed-inventory'
import { LB_PER_TONNE } from '@/lib/feed'
import {
  feedValues,
  feedingWindow,
  monthlyCold,
  planSettings,
  seasonInputs,
  seasonPlan,
  usableInYard,
  type FeedTestRow,
  type FeedTypeRow,
  type GroupRationRow,
  type HerdCountRow,
  type SeasonResult,
  type StubbleRow,
} from '@/lib/winter-feeding'
import type { Database } from '@/lib/database.types'
import { fetchAll, longDate, pick, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The winter's feed budget against what is in the yard, ranch by ranch —
 * the Feed tab's season, worked the same way (winter-feeding.ts seasonPlan):
 * day by day from the start of feeding (or today, once it has started) to
 * turnout, each group at its stage and this month's average cold from the
 * ranch's last five winters, fed the ration on file.
 *
 * Against it, the feed counted in the yard (Feed records → Feed put up),
 * less the storage loss still to come. A feed never counted is "not
 * counted", not "none": the budget stands, and the report says so.
 */

type FeedPlan = Database['public']['Tables']['feed_plans']['Row']
type ColdHistory = { winters?: string; months: { month: number; days: [number, number][] }[] }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const t = (lb: number | null | undefined) => (lb == null ? null : lb / LB_PER_TONNE)

export const FEED_COLUMNS = [
  { label: 'Feed' },
  { label: 'Needed (t)', decimals: 1 },
  { label: 'With reserve (t)', decimals: 1 },
  { label: 'Bales' },
  { label: 'Usable in yard (t)', decimals: 1 },
  { label: 'Short (−) / spare (t)', decimals: 1 },
  { label: 'Runs out' },
]

/** The winter asked for: the one the Feed tab is on now, or the one after it. */
export function winterWindow(plan: Parameters<typeof feedingWindow>[0], today: Date, which: 'current' | 'next') {
  const w = feedingWindow(plan, today)
  if (which === 'current') return w
  const after = feedingWindow(plan, new Date(w.to.getFullYear(), w.to.getMonth(), w.to.getDate() + 1))
  return { ...after, feeding: false }
}

/** One ranch's budget table from its season. */
export function budgetRows(o: {
  season: SeasonResult
  usable: Map<string, number>
  reservePct: number
  feedName: (id: string) => string
  bale: (id: string) => { unit: string | null; lb: number | null }
}): { rows: Cell[][]; neededLb: number; short: string[] } {
  const rows: Cell[][] = []
  const short: string[] = []
  let neededLb = 0
  for (const [id, need] of [...o.season.needLb].filter(([, lb]) => lb > 0).sort((a, b) => b[1] - a[1])) {
    neededLb += need
    const withReserve = need * (1 + o.reservePct / 100)
    const have = o.usable.get(id)
    const b = o.bale(id)
    const bales = b.unit && b.unit !== 'lb' && b.lb ? `${Math.round(need / b.lb).toLocaleString('en-CA')} ${b.unit === 'round' ? 'rounds' : 'big squares'}` : null
    const diff = have == null ? null : have - withReserve
    if (diff != null && diff < 0) short.push(o.feedName(id))
    const out = o.season.runsOut.get(id)
    rows.push([o.feedName(id), t(need), t(withReserve), bales, have == null ? 'not counted' : t(have), t(diff), out ? longDate(out) : have == null ? null : 'lasts'])
  }
  if (o.season.extraGrainLb > 1) {
    neededLb += o.season.extraGrainLb
    rows.push(['Grain to add where a ration falls short', t(o.season.extraGrainLb), t(o.season.extraGrainLb * (1 + o.reservePct / 100)), null, null, null, null])
  }
  return { rows, neededLb, short }
}

async function coldHistory(lat: number, lon: number): Promise<ColdHistory | null> {
  // The Feed tab's own feed (Open-Meteo through the app's function); without
  // it the budget carries no cold allowance, and the note says so.
  try {
    const r = await fetch(`/api/winter-cold?lat=${lat}&lon=${lon}&kind=history`)
    return r.ok ? ((await r.json()) as ColdHistory) : null
  } catch {
    return null
  }
}

export async function gatherFeedBudget(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const ranchId = pick(p, 'ranch')
  const which = p.winter === 'next' ? 'next' : 'current'
  const [plans, ranches, counts, types, tests, rations, stubble, onHand] = await Promise.all([
    fetchAll<FeedPlan>((a, b) => supabase.from('feed_plans').select('*').order('id').range(a, b)),
    fetchAll<{ id: string; name: string; latitude: unknown; longitude: unknown; sort_order: number | null; weaning_date: string | null }>((a, b) =>
      supabase.from('ranches').select('id, name, latitude, longitude, sort_order, weaning_date').order('sort_order').order('id').range(a, b),
    ),
    fetchAll<HerdCountRow>((a, b) => supabase.from('herd_counts').select('*').order('sort_order').order('id').range(a, b)),
    fetchAll<FeedTypeRow>((a, b) => supabase.from('feed_types').select('*').eq('archived', false).order('sort_order').order('id').range(a, b)),
    fetchAll<FeedTestRow>((a, b) => supabase.from('feed_tests').select('*').order('sampled_on', { ascending: false }).order('id').range(a, b)),
    fetchAll<GroupRationRow>((a, b) => supabase.from('feed_group_ration').select('*').order('sort_order').order('id').range(a, b)),
    fetchAll<StubbleRow>((a, b) => supabase.from('stubble_grazing').select('*').order('created_at').order('id').range(a, b)),
    feedOnHandQuery(null).queryFn() as Promise<FeedOnHand[]>,
  ])
  const values = feedValues(types, tests)
  const [y, m, d] = ctx.today.split('-').map(Number)
  const today = new Date(y, m - 1, d)
  const shown = ranches.filter((r) => (!ranchId || r.id === ranchId) && plans.some((pl) => pl.ranch_id === r.id))
  if (!shown.length) throw new Error('No ranch has a winter feed plan (Feed).')

  const groups: ReportGroup[] = []
  const meta: [string, Cell][] = []
  const notes: string[] = []
  let anyCounted = false
  let coldMissing = false
  let window: ReturnType<typeof winterWindow> | null = null
  for (const ranch of shown) {
    const plan = plans.find((pl) => pl.ranch_id === ranch.id)!
    const settings = planSettings(plan)
    const w = winterWindow(plan, today, which)
    window = w
    const lat = ranch.latitude == null ? null : Number(ranch.latitude)
    const lon = ranch.longitude == null ? null : Number(ranch.longitude)
    const history = lat != null && lon != null ? await coldHistory(lat, lon) : null
    if (!history) coldMissing = true
    const herd = counts.filter((c) => c.ranch_id === ranch.id)
    const ids = new Set(herd.map((h) => h.id))
    const inputs = seasonInputs(herd, new Set(plan.excluded_group_ids ?? []), rations.filter((r) => ids.has(r.herd_count_id)), values, stubble.filter((s) => s.ranch_id === ranch.id), ranch.weaning_date)
    const yard = onHand.filter((f) => f.ranch_id === ranch.id)
    const usable = usableInYard(yard, values)
    if (usable.size) anyCounted = true
    const season = seasonPlan({ groups: inputs.groups, settings, from: w.from, to: w.to, coldByMonth: monthlyCold(history?.months, settings.coat, settings.sheltered), stubble: inputs.stubble, onHand: usable })
    const b = budgetRows({
      season,
      usable,
      reservePct: settings.reservePct,
      feedName: (id) => values.get(id)?.name ?? 'Feed',
      bale: (id) => ({ unit: values.get(id)?.unit ?? null, lb: values.get(id)?.lbPerBale ?? null }),
    })
    const head = inputs.groups.reduce((s, g) => s + g.group.head, 0)
    const noRation = inputs.groups.filter((g) => !g.lines.length).map((g) => g.name)
    groups.push({
      title: ranch.name,
      note: [
        `${ymd(w.from)} to ${ymd(w.to)}, ${season.days} days`,
        `${head.toLocaleString('en-CA')} head in ${inputs.groups.length} group${inputs.groups.length === 1 ? '' : 's'}`,
        `${Math.round(season.dmLb / LB_PER_TONNE).toLocaleString('en-CA')} t of dry matter eaten`,
        `${settings.reservePct}% reserve`,
        season.stubbleCowDays > 0 ? `stalks carry ${Math.round(season.stubbleCowDays).toLocaleString('en-CA')} cow-days` : null,
        usable.size ? (b.short.length ? `short of ${b.short.join(', ')}` : 'the yard covers it') : 'nothing counted in the yard yet',
        noRation.length ? `no ration on file for ${noRation.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      rows: b.rows.length ? b.rows : [['No ration on file — set one on the Feed tab', null, null, null, null, null, null]],
      totals: b.rows.length ? ['All feed', t(b.neededLb), t(b.neededLb * (1 + settings.reservePct / 100)), null, null, null, null] : undefined,
    })
    meta.push([ranch.name, `${Math.round(b.neededLb / LB_PER_TONNE).toLocaleString('en-CA')} t needed`])
  }
  if (!anyCounted) notes.push('Nothing is counted in the yard yet, so this is the budget — what is needed — not whether you have it. Record what was put up under Feed records → Feed put up (“Counted on hand”).')
  if (coldMissing) notes.push('The last five winters’ weather could not be read, so no cold allowance is in the budget; it will be low for a cold winter.')
  return {
    title: 'Winter feed budget against inventory',
    subtitle: `${which === 'current' ? 'This winter' : 'Next winter'}${window ? ` · ${longDate(ymd(window.from))} to ${longDate(ymd(window.to))}` : ''}`,
    meta,
    summary: [
      `The Feed tab’s season, day by day${which === 'current' && window?.feeding ? ' from today (feeding has started)' : ' from the start of feeding'} to turnout: each group at its stage that day, this month’s average cold from the ranch’s last five winters, fed the ration on file. As fed, waste included.`,
      'Usable in the yard is what is left × (1 − storage loss still to come). Short or spare is against the need with the reserve on top.',
      ...notes,
    ],
    columns: FEED_COLUMNS,
    groups,
    groupLabel: 'Ranch',
    filename: `Winter feed budget ${which === 'current' ? 'this winter' : 'next winter'}${ranchId ? ` ${shown[0].name}` : ''}`,
  }
}
