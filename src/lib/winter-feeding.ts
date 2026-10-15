import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import {
  BARLEY,
  coldUplift,
  effectiveTemp,
  solveRation,
  stubbleCowDays,
  tdnFromAdf,
  type Coat,
  type Conditions,
  type FeedCategory,
  type FeedValue,
  type GroupInput,
  type GroupRation,
  type RationLine,
} from './cattle-nutrition'

/**
 * Winter feeding for one ranch: the data the calculator reads and writes, and
 * the season plan — day by day from today to turnout, because a cow's need
 * climbs through late pregnancy and the cold comes in months, not on average.
 */

type Tables = Database['public']['Tables']
export type FeedTypeRow = Tables['feed_types']['Row']
export type FeedTestRow = Tables['feed_tests']['Row']
export type GroupRationRow = Tables['feed_group_ration']['Row']
export type StubbleRow = Tables['stubble_grazing']['Row']
export type HerdCountRow = Tables['herd_counts']['Row']
type FeedPlanRow = Tables['feed_plans']['Row']

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useFeedTypesFull() {
  return useQuery({
    queryKey: ['feed_types', 'full'],
    queryFn: async (): Promise<FeedTypeRow[]> => {
      const { data, error } = await supabase.from('feed_types').select('*').eq('archived', false).order('sort_order')
      if (error) throw error
      return (data ?? []) as FeedTypeRow[]
    },
  })
}

export function useFeedTests() {
  return useQuery({
    queryKey: ['feed_tests'],
    queryFn: async (): Promise<FeedTestRow[]> => {
      const { data, error } = await supabase.from('feed_tests').select('*').order('sampled_on', { ascending: false })
      if (error) throw error
      return (data ?? []) as FeedTestRow[]
    },
  })
}

export function useGroupRations(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['feed_group_ration', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<GroupRationRow[]> => {
      const { data: groups, error: e1 } = await supabase.from('herd_counts').select('id').eq('ranch_id', ranchId!)
      if (e1) throw e1
      const ids = (groups ?? []).map((g) => g.id as string)
      if (!ids.length) return []
      const { data, error } = await supabase.from('feed_group_ration').select('*').in('herd_count_id', ids).order('sort_order')
      if (error) throw error
      return (data ?? []) as GroupRationRow[]
    },
  })
}

export function useStubble(ranchId: string | null | undefined) {
  return useQuery({
    queryKey: ['stubble_grazing', ranchId],
    enabled: Boolean(ranchId),
    queryFn: async (): Promise<StubbleRow[]> => {
      const { data, error } = await supabase.from('stubble_grazing').select('*').eq('ranch_id', ranchId!).order('created_at')
      if (error) throw error
      return (data ?? []) as StubbleRow[]
    },
  })
}

export type ColdDay = { date: string; t: number | null; w: number | null; rain: number | null; snow: number | null }

/** The last five winters, daily [°C, km/h] by month — for the season's cold. */
export function useWinterHistory(lat: number | null | undefined, lon: number | null | undefined) {
  return useQuery({
    queryKey: ['winter_cold', 'history', lat, lon],
    enabled: lat != null && lon != null,
    staleTime: 24 * 3_600_000,
    queryFn: async (): Promise<{ winters: string; months: { month: number; days: [number, number][] }[] }> => {
      const r = await fetch(`/api/winter-cold?lat=${lat}&lon=${lon}&kind=history`)
      if (!r.ok) throw new Error('Winter weather unavailable')
      return r.json()
    },
  })
}

/** A week back and a week ahead, daily means. */
export function useColdForecast(lat: number | null | undefined, lon: number | null | undefined) {
  return useQuery({
    queryKey: ['winter_cold', 'forecast', lat, lon],
    enabled: lat != null && lon != null,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<{ days: ColdDay[] }> => {
      const r = await fetch(`/api/winter-cold?lat=${lat}&lon=${lon}&kind=forecast`)
      if (!r.ok) throw new Error('Forecast unavailable')
      return r.json()
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
}

export function useUpdateGroup() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Tables['herd_counts']['Update'] }) => {
      const { error } = await supabase.from('herd_counts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('herd_counts', 'rotation-context'),
  })
}

export function useRationMutations() {
  const inv = useInvalidate()
  const done = () => inv('feed_group_ration', 'rotation-context')
  const set = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Tables['feed_group_ration']['Update'] }) => {
      const { error } = await supabase.from('feed_group_ration').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const add = useMutation({
    mutationFn: async (v: Tables['feed_group_ration']['Insert']) => {
      const { error } = await supabase.from('feed_group_ration').insert(v)
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('feed_group_ration').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: done,
  })
  return { set, add, remove }
}

export function useUpdateFeedType() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Tables['feed_types']['Update'] }) => {
      const { error } = await supabase.from('feed_types').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('feed_types', 'feed_on_hand'),
  })
}

export function useFeedTestMutations() {
  const inv = useInvalidate()
  const add = useMutation({
    mutationFn: async (v: Tables['feed_tests']['Insert']) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('feed_tests').insert({ ...v, updated_by: user?.id ?? null })
      if (error) throw error
    },
    onSuccess: () => inv('feed_tests'),
  })
  // A test typed in wrong is corrected, not deleted and entered again (Sam, 7 Oct 2026).
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Tables['feed_tests']['Update'] }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('feed_tests').update({ ...patch, updated_by: user?.id ?? null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('feed_tests'),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('feed_tests').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('feed_tests'),
  })
  return { add, update, remove }
}

/** Where a feed is used, for deciding whether it can be deleted. */
export type FeedTypeUse = { recordLines: number; inventory: number; rations: number; tests: number }

/**
 * What deleting a feed does. A feed on a feed sheet or in the yard ledger
 * cannot go — the database refuses it, and those records are the history — so
 * it is archived instead: off every list, still read by the old records.
 * Otherwise it is deleted, and the rations and tests that hang off it go too,
 * which the confirm says.
 */
export function feedTypeDeletePlan(use: FeedTypeUse): { action: 'archive' | 'delete'; message: string } {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  if (use.recordLines > 0 || use.inventory > 0) {
    const where = [
      use.recordLines > 0 ? plural(use.recordLines, 'feed sheet line') : null,
      use.inventory > 0 ? plural(use.inventory, 'yard entry', 'yard entries') : null,
    ].filter(Boolean)
    return {
      action: 'archive',
      message: `This feed is on ${where.join(' and ')}, so it cannot be deleted. Archive it instead? It leaves every list, and the old records keep reading it.`,
    }
  }
  const goes = [
    use.rations > 0 ? `${plural(use.rations, 'ration line')}` : null,
    use.tests > 0 ? `${plural(use.tests, 'lab test')}` : null,
  ].filter(Boolean)
  return {
    action: 'delete',
    message: goes.length ? `Delete this feed? Its ${goes.join(' and ')} go with it.` : 'Delete this feed? Nothing else uses it.',
  }
}

/** Count where a feed is used, then delete it or archive it per feedTypeDeletePlan. */
export function useDeleteFeedType() {
  const inv = useInvalidate()
  const count = async (table: 'feed_record_lines' | 'feed_inventory' | 'feed_group_ration' | 'feed_tests', id: string) => {
    const { count: n, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('feed_type_id', id)
    if (error) throw error
    return n ?? 0
  }
  const usage = async (id: string): Promise<FeedTypeUse> => {
    const [recordLines, inventory, rations, tests] = await Promise.all([
      count('feed_record_lines', id),
      count('feed_inventory', id),
      count('feed_group_ration', id),
      count('feed_tests', id),
    ])
    return { recordLines, inventory, rations, tests }
  }
  const run = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'archive' | 'delete' }) => {
      const { error } =
        action === 'archive'
          ? await supabase.from('feed_types').update({ archived: true }).eq('id', id)
          : await supabase.from('feed_types').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('feed_types', 'feed_on_hand', 'feed_group_ration', 'feed_tests'),
  })
  return { usage, run }
}

export function useStubbleMutations() {
  const inv = useInvalidate()
  const save = useMutation({
    mutationFn: async (v: { id?: string } & Tables['stubble_grazing']['Insert']) => {
      const { id, ...row } = v
      const { error } = id ? await supabase.from('stubble_grazing').update(row).eq('id', id) : await supabase.from('stubble_grazing').insert(row)
      if (error) throw error
    },
    onSuccess: () => inv('stubble_grazing'),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('stubble_grazing').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => inv('stubble_grazing'),
  })
  return { save, remove }
}

// ---------------------------------------------------------------------------
// Feed values: book, or the latest test
// ---------------------------------------------------------------------------

/** What the calculator uses for each feed: its newest lab test where there is one, else the book value. */
export function feedValues(types: FeedTypeRow[], tests: FeedTestRow[]): Map<string, FeedValue & { test: FeedTestRow | null; bookNote: string | null; storageLossPct: number }> {
  const latest = new Map<string, FeedTestRow>()
  for (const t of tests) if (!latest.has(t.feed_type_id)) latest.set(t.feed_type_id, t)
  const out = new Map<string, FeedValue & { test: FeedTestRow | null; bookNote: string | null; storageLossPct: number }>()
  for (const ft of types) {
    const t = latest.get(ft.id) ?? null
    const cat = ft.category as FeedCategory
    const dm = num(t?.dm_pct) ?? num(ft.dm_pct) ?? 88
    const cp = num(t?.cp_pct) ?? num(ft.cp_pct) ?? 0
    let tdn = num(t?.tdn_pct)
    if (tdn == null && t && num(t.adf_pct) != null) tdn = tdnFromAdf(cat, num(t.adf_pct)!, num(t.cp_pct), ft.legume)
    tdn = tdn ?? num(ft.tdn_pct) ?? 0
    out.set(ft.id, {
      id: ft.id,
      name: ft.name,
      category: cat,
      dmPct: dm,
      tdnPct: tdn,
      cpPct: cp,
      nitratePct: num(t?.nitrate_pct),
      source: t ? 'test' : 'book',
      lbPerBale: num(ft.default_lb_per_bale),
      unit: ft.default_unit,
      test: t,
      bookNote: ft.book_note,
      storageLossPct: Number(ft.storage_loss_pct ?? 0),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The season
// ---------------------------------------------------------------------------

export type Settings = {
  calvingMonth: number
  calvingDay: number
  coat: Coat
  sheltered: boolean
  muddy: boolean
  reservePct: number
}

/** Average extra energy for cold in each month, from the ranch's own last five winters. */
export function monthlyCold(history: { month: number; days: [number, number][] }[] | undefined, coat: Coat, sheltered: boolean): Map<number, number> {
  const m = new Map<number, number>()
  for (const h of history ?? []) {
    if (!h.days.length) continue
    m.set(h.month, h.days.reduce((s, [t, w]) => s + coldUplift(t, w, coat, sheltered), 0) / h.days.length)
  }
  return m
}

export type PlanGroup = {
  id: string
  name: string
  group: GroupInput
  lines: RationLine[]
  /** First day this group is fed (ISO): the weaning day for the calves kept to background. */
  from?: string | null
}

export type PlanStubble = { id: string; name: string; groupId: string | null; start: string | null; cowDays: number; state: 'open' | 'snow' | 'crust' }

export type SeasonResult = {
  days: number
  /** As fed, offered (waste included), per feed id, from `from` to `to`. */
  needLb: Map<string, number>
  /** Grain the plan has to add where a ration can't carry the energy (not in any ration). */
  extraGrainLb: number
  /** Dry matter eaten, lb — the whole herd, the whole season. */
  dmLb: number
  /** Cow-days of stubble grazed, and the stored feed (as fed, waste included) it replaced. */
  stubbleCowDays: number
  stubbleSavedLb: Map<string, number>
  /** When each feed runs out at this rate, if it does before turnout. */
  runsOut: Map<string, string>
  /** Days the ration's scarcest feed lasts. */
  bindingDays: number | null
  bindingFeed: string | null
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function seasonPlan(o: {
  groups: PlanGroup[]
  settings: Settings
  from: Date
  to: Date
  coldByMonth: Map<number, number>
  stubble: PlanStubble[]
  /** Usable lb as fed on hand now, per feed id (after storage loss still to come). */
  onHand: Map<string, number>
}): SeasonResult {
  const needLb = new Map<string, number>()
  const saved = new Map<string, number>()
  const cumulative = new Map<string, number>()
  const runsOut = new Map<string, string>()
  let extraGrainLb = 0
  let dmLb = 0
  let stubbleCowDays = 0
  const left = new Map(o.stubble.map((s) => [s.id, s.cowDays]))
  const days = Math.max(0, Math.round((o.to.getTime() - o.from.getTime()) / 86_400_000))
  for (let i = 0; i < days; i++) {
    const d = new Date(o.from.getFullYear(), o.from.getMonth(), o.from.getDate() + i)
    const cond: Conditions = {
      onDate: d,
      calvingMonth: o.settings.calvingMonth,
      calvingDay: o.settings.calvingDay,
      daysToTurnout: days - i,
      cold: o.coldByMonth.get(d.getMonth() + 1) ?? 0,
      muddy: o.settings.muddy,
    }
    for (const g of o.groups) {
      if (g.group.head <= 0) continue
      // Calves at side until weaning are fed through the cows (the cow need carries a calf's share).
      if (g.from && iso(d) < g.from) continue
      const r = solveRation(g.group, cond, g.lines)
      // On stalks today? A field in use, started, with grazing left and not crusted.
      const st = o.stubble.find((s) => s.groupId === g.id && (!s.start || s.start <= iso(d)) && (left.get(s.id) ?? 0) > 0 && s.state !== 'crust')
      const grazeShare = st ? (st.state === 'snow' ? 0.5 : 1) : 0
      if (st) {
        const used = g.group.head * grazeShare
        left.set(st.id, (left.get(st.id) ?? 0) - used)
        stubbleCowDays += used
      }
      for (const l of r.lines) {
        const lb = l.groupOfferedLb * (1 - grazeShare)
        needLb.set(l.feed.id, (needLb.get(l.feed.id) ?? 0) + lb)
        if (grazeShare > 0) saved.set(l.feed.id, (saved.get(l.feed.id) ?? 0) + l.groupOfferedLb * grazeShare)
        const c = (cumulative.get(l.feed.id) ?? 0) + lb
        cumulative.set(l.feed.id, c)
        const have = o.onHand.get(l.feed.id)
        if (have != null && c > have && !runsOut.has(l.feed.id)) runsOut.set(l.feed.id, iso(d))
      }
      const grain = r.lines.find((l) => l.feed.category === 'grain')?.feed ?? BARLEY
      const addLb = r.addGrainLb * g.group.head * (1 - grazeShare)
      if (grain.id === BARLEY.id) extraGrainLb += addLb
      else needLb.set(grain.id, (needLb.get(grain.id) ?? 0) + addLb)
      dmLb += r.dmLb * g.group.head * (1 - grazeShare)
    }
  }
  // The scarcest feed: days its usable stock lasts at the season's average rate.
  let bindingDays: number | null = null
  let bindingFeed: string | null = null
  for (const [id, need] of needLb) {
    if (need <= 0 || days <= 0) continue
    const have = o.onHand.get(id) ?? 0
    const lasts = have / (need / days)
    if (bindingDays == null || lasts < bindingDays) {
      bindingDays = lasts
      bindingFeed = id
    }
  }
  return { days, needLb, extraGrainLb, dmLb, stubbleCowDays, stubbleSavedLb: saved, runsOut, bindingDays, bindingFeed }
}

/**
 * How many of a group are on winter feed. For the calves, the ones kept after
 * weaning to background (Sam, 5 Oct 2026: 320 at side at Home Ranch, 300
 * kept); the rest are sold at weaning.
 */
export const fedHead = (h: Pick<HerdCountRow, 'head_count' | 'background_head'>) => h.background_head ?? h.head_count

/** A group's calculator input from its herd_counts row. */
export function groupInput(h: HerdCountRow): GroupInput {
  return {
    feedClass: h.feed_class,
    head: fedHead(h),
    weightLb: Number(h.avg_weight_lb) || 1300,
    bcs: Number(h.bcs ?? 3),
    targetBcs: Number(h.target_bcs ?? 3),
    targetGainLb: h.target_gain_lb == null ? null : Number(h.target_gain_lb),
  }
}

export function rationLines(groupId: string, rows: GroupRationRow[], values: Map<string, FeedValue>): RationLine[] {
  return rows
    .filter((r) => r.herd_count_id === groupId)
    .flatMap((r) => {
      const feed = values.get(r.feed_type_id)
      return feed ? [{ feed, sharePct: Number(r.dm_share_pct), wastePct: Number(r.waste_pct) }] : []
    })
}

/** A ranch's feed plan as the calculator's settings. */
export function planSettings(plan: Pick<FeedPlanRow, 'calving_month' | 'calving_day' | 'coat' | 'sheltered' | 'muddy' | 'reserve_pct'>): Settings {
  return { calvingMonth: plan.calving_month, calvingDay: plan.calving_day, coat: plan.coat as Coat, sheltered: plan.sheltered, muddy: plan.muddy, reservePct: Number(plan.reserve_pct) }
}

/**
 * What is in the yard, usable: left × (1 − storage loss still to come). Only
 * feeds with something recorded as put up — a feed never counted is "not
 * counted", not "none left".
 */
export function usableInYard(onHand: { feed_type_id: string; put_up_lb: number; remaining_lb: number }[], values: Map<string, { storageLossPct: number }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of onHand) {
    if (f.put_up_lb <= 0) continue
    const loss = values.get(f.feed_type_id)?.storageLossPct ?? 0
    m.set(f.feed_type_id, Math.max(0, f.remaining_lb) * (1 - loss / 100))
  }
  return m
}

/**
 * The groups and corn stalks the season is walked with, as the Feed tab sets
 * them up: groups left out of the plan or with nobody in them are not fed.
 */
export function seasonInputs(
  counts: HerdCountRow[],
  excluded: Set<string>,
  rations: GroupRationRow[],
  values: Map<string, FeedValue>,
  stubble: StubbleRow[],
  /** The ranch's weaning day: the calves kept to background are fed from it. */
  weaningDate?: string | null,
): { groups: PlanGroup[]; stubble: PlanStubble[] } {
  const groups = counts
    .filter((g) => !excluded.has(g.id) && fedHead(g) > 0)
    .map((g) => ({
      id: g.id,
      name: g.class_name,
      group: groupInput(g),
      lines: rationLines(g.id, rations, values),
      from: g.background_head != null ? (weaningDate ?? null) : null,
    }))
  const st = stubble.map((s) => {
    const g = counts.find((c) => c.id === s.herd_count_id)
    return {
      id: s.id,
      name: s.name,
      groupId: s.herd_count_id,
      start: s.start_date,
      state: s.snow_state,
      cowDays: stubbleCowDays(Number(s.acres), Number(s.yield_bu), Number(s.weather_loss_pct), g ? Number(g.avg_weight_lb) : 1300).cowDays,
    }
  })
  return { groups, stubble: st }
}

/** Today's conditions for the calculator, from the forecast day and the ranch's settings. */
export function todayConditions(settings: Settings, day: ColdDay | undefined, daysToTurnout: number, onDate = new Date()): Conditions & { airC: number | null; windKmh: number | null } {
  const t = day?.t ?? null
  const w = day?.w ?? null
  return {
    onDate,
    calvingMonth: settings.calvingMonth,
    calvingDay: settings.calvingDay,
    daysToTurnout,
    cold: t != null && w != null ? coldUplift(t, w, settings.coat, settings.sheltered) : 0,
    muddy: settings.muddy,
    effTempC: t != null && w != null ? effectiveTemp(t, w, settings.sheltered) : null,
    airC: t,
    windKmh: w,
  }
}

export { stubbleCowDays }
export type { GroupRation }

/**
 * The winter this plan is about. Inside the feeding period: today to turnout.
 * Before it: the whole coming period. With no dates set: today plus 150 days.
 */
export function feedingWindow(
  p: { start_month: number | null; start_day: number | null; end_month: number | null; end_day: number | null },
  today = new Date(),
): { from: Date; to: Date; feeding: boolean } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!p.start_month || !p.start_day || !p.end_month || !p.end_day) {
    return { from: t, to: new Date(t.getFullYear(), t.getMonth(), t.getDate() + 150), feeding: true }
  }
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)
  // The period that is running now, or the next one to start.
  for (const y of [t.getFullYear() - 1, t.getFullYear()]) {
    const s = at(y, p.start_month, p.start_day)
    let e = at(y, p.end_month, p.end_day)
    if (e <= s) e = at(y + 1, p.end_month, p.end_day)
    if (t >= s && t < e) return { from: t, to: e, feeding: true }
    if (t < s) return { from: s, to: e, feeding: false }
  }
  const s = at(t.getFullYear() + 1, p.start_month, p.start_day)
  let e = at(t.getFullYear() + 1, p.end_month, p.end_day)
  if (e <= s) e = at(t.getFullYear() + 2, p.end_month, p.end_day)
  return { from: s, to: e, feeding: false }
}
