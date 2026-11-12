import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { SETUP_LINKS } from './setup-links'
import { isCalfGroup, MAX_PLAUSIBLE_CALF_CROP } from './cow-herd-measures'

/**
 * What the cattle numbers stand on that nobody has measured.
 *
 * Every figure on the cattle side is only as good as its inputs, and several
 * inputs today are stand-ins: a benchmark cost, a body condition of 3 for every
 * group, a ration copied from another ranch. This reads the live rows and lists
 * each one, with where to fix it — so the list shrinks on its own as the gaps
 * are filled, and nothing here is a hard-coded "known issue".
 */

export type Assumption = {
  key: string
  /** The ranch it is about; null for the whole farm. */
  ranch: string | null
  label: string
  /** Where to fix it. */
  to: string
  /** missing: nothing recorded at all. guess: a stand-in, default or benchmark. */
  kind: 'missing' | 'guess'
}

export type AssumptionRanch = {
  id: string
  name: string
  latitude: number | string | null
  longitude: number | string | null
  precip_auto: boolean | null
  grazing_utilization_rate: number | string | null
  weaning_date: string | null
  calf_sale_month: number | null
  steer_sale_weight_lb: number | null
  heifer_sale_weight_lb: number | null
}

export type AssumptionData = {
  ranches: AssumptionRanch[]
  herd: {
    id: string
    ranch_id: string
    class_name: string
    head_count: number
    bcs: number | string | null
    ration_note: string | null
    notes: string | null
    graze_start: string | null
    graze_end: string | null
    feed_class: string | null
    background_head: number | null
  }[]
  /** The newest cost row per ranch, at or before this year. */
  costs: {
    ranch: string
    crop_year: number
    notes: string | null
    cull_cow_price_cwt: number | string | null
    weaning_rate_pct: number | string | null
    cow_yardage_per_day: number | string | null
  }[]
  inventory: { ranch_id: string; kind: string; weight_basis: string | null }[]
  baleDefaults: { bale_type: string; lb_per_bale: number | string | null }[]
  feedTests: number
  grazingPastures: { ranch_id: string | null }[]
  mapPastures: { ranch: string | null }[]
  rations: { herd_count_id: string; feed_type_id: string }[]
  feedTypes: { id: string; name: string; price_per_tonne: number | string | null }[]
  year: number
}

/** Alberta's usual planning figure: take half, leave half. */
export const ALBERTA_USUAL_UTILISATION = 0.5

const n = (v: number | string | null | undefined) => (v == null || v === '' ? null : Number(v))
const list = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more`)
const money = (v: number) => `$${v.toLocaleString('en-CA', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })

const grazing = (id: string) => `/cattle?tab=grazing&ranch=${id}`
const feedRecords = (id?: string) => `/feed?tab=records${id ? `&ranch=${id}` : ''}`

/** Notes that mark a ration or weight as somebody's placeholder. */
const GUESS_NOTE = /guess|set what|copied|rescaled|stand[- ]?in/i
const WEIGHT_GUESS = /not given|weigh a few/i

/**
 * Every guessed or defaulted input for one ranch, or every ranch when
 * `ranchId` is empty. Missing things first, then stand-ins; farm-wide last.
 */
export function listAssumptions(d: AssumptionData, ranchId: string): Assumption[] {
  const out: Assumption[] = []
  const ranches = ranchId ? d.ranches.filter((r) => r.id === ranchId) : d.ranches

  for (const r of ranches) {
    const add = (key: string, label: string, to: string, kind: Assumption['kind']) =>
      out.push({ key: `${r.id}:${key}`, ranch: r.name, label, to, kind })
    const herd = d.herd.filter((h) => h.ranch_id === r.id && h.head_count > 0)
    const herdIds = new Set(d.herd.filter((h) => h.ranch_id === r.id).map((h) => h.id))
    const cost = d.costs.find((c) => c.ranch === r.name)

    // ── Feed ──
    const counted = d.inventory.some((i) => i.ranch_id === r.id && ['opening', 'harvested', 'purchased'].includes(i.kind))
    if (!counted) add('feed-counted', 'No feed counted in the yard — feed days left can’t be worked out', feedRecords(r.id), 'missing')
    const guessed = herd.filter((h) => h.ration_note && GUESS_NOTE.test(h.ration_note)).map((h) => h.class_name)
    if (guessed.length) add('ration', `Ration is a starting guess for ${list(guessed)}`, SETUP_LINKS.cattleFeed(r.id), 'guess')
    if (herd.length && herd.every((h) => n(h.bcs) === 3)) add('bcs', 'Body condition 3 for every group — not scored', SETUP_LINKS.cattleFeed(r.id), 'guess')
    const weightGuess = herd.filter((h) => h.notes && WEIGHT_GUESS.test(h.notes)).map((h) => h.class_name)
    const cows = herd.filter((h) => h.feed_class === 'cow').reduce((s, h) => s + h.head_count, 0)
    const calves = herd.filter(isCalfGroup).reduce((s, h) => s + h.head_count, 0)
    if (cows > 0 && calves > cows * MAX_PLAUSIBLE_CALF_CROP)
      add('calf-count', `Head count has more calves (${calves}) than cows (${cows}) — calf crop uses the typed weaning rate`, SETUP_LINKS.cattleHerd(r.id), 'guess')
    if (weightGuess.length) add('weight', `Weight not weighed for ${list(weightGuess)}`, SETUP_LINKS.cattleFeed(r.id), 'guess')
    const usedFeeds = new Set(d.rations.filter((x) => herdIds.has(x.herd_count_id)).map((x) => x.feed_type_id))
    const unpriced = d.feedTypes.filter((f) => usedFeeds.has(f.id) && !(n(f.price_per_tonne)! > 0)).map((f) => f.name)
    if (unpriced.length) add('feed-price', `No price a tonne for ${list(unpriced)}`, SETUP_LINKS.cattleFeed(r.id), 'missing')

    // ── Costs and sales ──
    if (!cost) {
      add('costs', `No cow costs entered for ${d.year}`, SETUP_LINKS.cattleCosts(r.id), 'missing')
    } else {
      if (cost.notes && /benchmark/i.test(cost.notes)) add('costs', 'Cow costs are the Alberta benchmark, not this ranch’s own', SETUP_LINKS.cattleCosts(r.id), 'guess')
      if (cost.crop_year < d.year) add('costs-year', `Cow costs carried over from ${cost.crop_year}`, SETUP_LINKS.cattleCosts(r.id), 'guess')
      const wean = n(cost.weaning_rate_pct)
      if (wean != null) add('weaning-rate', `Weaning rate ${wean}% is typed — the break-even divides by it`, SETUP_LINKS.cattleCosts(r.id), 'guess')
      const cull = n(cost.cull_cow_price_cwt)
      if (cull != null) add('cull', `Cull cow price ${money(cull)}/cwt typed — used when no market sold cows`, SETUP_LINKS.cattleCosts(r.id), 'guess')
      const yardage = n(cost.cow_yardage_per_day)
      if (yardage != null) add('yardage', `Yardage ${money(yardage)} a cow a day typed`, SETUP_LINKS.cattleCosts(r.id), 'guess')
    }
    if (!r.weaning_date) add('weaning', 'No weaning date set', SETUP_LINKS.cattleCosts(r.id), 'missing')
    else if (r.calf_sale_month != null && r.weaning_date.slice(5) === `${String(r.calf_sale_month).padStart(2, '0')}-01`)
      add('weaning', `Weaning date ${dayMonth(r.weaning_date)} is a stand-in — the 1st of the sale month`, SETUP_LINKS.cattleCosts(r.id), 'guess')
    const blankWeights = [r.steer_sale_weight_lb == null && 'steer', r.heifer_sale_weight_lb == null && 'heifer'].filter(Boolean) as string[]
    if (blankWeights.length) add('sale-weight', `${blankWeights.join(' and ')} sale weight not typed — averaged from past sales`.replace(/^./, (c) => c.toUpperCase()), SETUP_LINKS.cattleCosts(r.id), 'guess')

    // ── Grass ──
    const pastures = d.grazingPastures.filter((p) => p.ranch_id === r.id).length + d.mapPastures.filter((p) => p.ranch === r.name).length
    if (pastures === 0) add('pastures', 'No pastures drawn — no grass figures', `/cattle?tab=map&ranch=${r.id}`, 'missing')
    const util = n(r.grazing_utilization_rate)
    if (util != null && util > ALBERTA_USUAL_UTILISATION)
      add('utilisation', `Grazing takes ${Math.round(util * 100)}% of the forage — above Alberta’s usual ${ALBERTA_USUAL_UTILISATION * 100}%`, grazing(r.id), 'guess')
    const noDates = herd.filter((h) => !h.graze_start || !h.graze_end).map((h) => h.class_name)
    if (noDates.length) add('graze-dates', `No grazing dates for ${list(noDates)}`, grazing(r.id), 'missing')
    if (r.latitude == null || r.longitude == null) add('location', 'No ranch location — rain and cold are typed, not measured', grazing(r.id), 'missing')
    else if (r.precip_auto === false) add('rain', 'Season rain is typed, not measured', grazing(r.id), 'guess')
  }

  // ── The whole farm ──
  const farm = (key: string, label: string, to: string, kind: Assumption['kind']) => out.push({ key: `farm:${key}`, ranch: null, label, to, kind })
  if (d.feedTests === 0) farm('feed-tests', 'No feed tests — every feed uses book values', SETUP_LINKS.cattleFeed(ranchId || null), 'missing')
  if (!d.inventory.some((i) => i.weight_basis === 'weighed')) farm('bales-weighed', 'No bales weighed — bale weights are estimates', feedRecords(ranchId || undefined), 'missing')
  if (d.baleDefaults.length && d.baleDefaults.every((b) => n(b.lb_per_bale) == null))
    farm('bale-defaults', 'Usual round and big-square weights are blank', feedRecords(ranchId || undefined), 'missing')

  const rank = (a: Assumption) => (a.ranch == null ? 2 : 0) + (a.kind === 'missing' ? 0 : 1)
  return out.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a)
}

/** Read everything listAssumptions needs. */
export async function loadAssumptionData(sb: SupabaseClient, year = new Date().getFullYear()): Promise<AssumptionData> {
  const pick = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> => {
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data ?? []) as T
  }
  const [ranches, herd, costRows, inventory, baleDefaults, tests, grazingPastures, mapPastures, rations, feedTypes] = await Promise.all([
    pick<AssumptionData['ranches']>(
      sb.from('ranches').select('id, name, latitude, longitude, precip_auto, grazing_utilization_rate, weaning_date, calf_sale_month, steer_sale_weight_lb, heifer_sale_weight_lb').order('sort_order'),
    ),
    pick<AssumptionData['herd']>(sb.from('herd_counts').select('id, ranch_id, class_name, head_count, bcs, ration_note, notes, graze_start, graze_end, feed_class, background_head').order('sort_order')),
    pick<AssumptionData['costs']>(
      sb
        .from('cattle_cost_assumptions')
        .select('ranch, crop_year, notes, cull_cow_price_cwt, weaning_rate_pct, cow_yardage_per_day')
        .lte('crop_year', year)
        .order('crop_year', { ascending: false }),
    ),
    pick<AssumptionData['inventory']>(sb.from('feed_inventory').select('ranch_id, kind, weight_basis')),
    pick<AssumptionData['baleDefaults']>(sb.from('bale_weight_defaults').select('bale_type, lb_per_bale')),
    sb.from('feed_tests').select('id', { count: 'exact', head: true }),
    pick<AssumptionData['grazingPastures']>(sb.from('grazing_pastures').select('ranch_id')),
    pick<AssumptionData['mapPastures']>(sb.from('pasture_map').select('ranch')),
    pick<AssumptionData['rations']>(sb.from('feed_group_ration').select('herd_count_id, feed_type_id')),
    pick<AssumptionData['feedTypes']>(sb.from('feed_types').select('id, name, price_per_tonne').eq('archived', false)),
  ])
  if (tests.error) throw new Error(tests.error.message)
  // Newest first, so the first row per ranch is the one in force.
  const costs = costRows.filter((c, i) => costRows.findIndex((x) => x.ranch === c.ranch) === i)
  return { ranches, herd, costs, inventory, baleDefaults, feedTests: tests.count ?? 0, grazingPastures, mapPastures, rations, feedTypes, year }
}

/** The guessed inputs behind the cattle numbers for one ranch, or all ('' = every ranch). */
export async function cattleAssumptions(ranchId: string, sb: SupabaseClient = supabase as unknown as SupabaseClient): Promise<Assumption[]> {
  return listAssumptions(await loadAssumptionData(sb), ranchId)
}

export function useCattleAssumptions(ranchId: string | undefined) {
  return useQuery({
    queryKey: ['cattle-assumptions', ranchId ?? 'unset'],
    enabled: ranchId !== undefined,
    queryFn: () => cattleAssumptions(ranchId!),
    staleTime: 60_000,
  })
}
