import { supabase } from '@/lib/supabase'
import { mobsNow, type ActivationRow } from '@/lib/eshepherd'
import { yearAverage, type CattleSale } from '@/lib/cattleMarkets'
import { fetchAll, longDate, num, pick, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The herd by ranch and class on a date: head, weight, animal units, the
 * eShepherd collars counted in each class's mob, and a value where the app
 * has a price.
 *
 * herd_counts holds today's counts only, so a date in the past is reached by
 * undoing every edit made since, newest first, from the audit log (an edit
 * puts the old values back, an insert takes the row away, a delete brings it
 * back). Before the first recorded count there is nothing to undo to, and the
 * report says so.
 *
 * Value: only calves have a price in the app — what the farm's own calves
 * sold for (Markets → Cattle sales), pound-weighted, in the newest year with
 * sales. Cows, bulls and replacements are left unvalued rather than guessed.
 */

export type HerdRow = {
  id: string
  ranch_id: string
  class_name: string
  head_count: number
  avg_weight_lb: unknown
  au_equivalent: unknown
  feed_class: string | null
  sort_order: number | null
  updated_at: string | null
}
export type HerdAudit = { record_id: string | null; action: string; changed_at: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null }

/** The rows as they stood at `asOf` (ISO instant): today's rows with every later edit undone. */
export function herdAsOf(current: HerdRow[], audit: HerdAudit[], asOf: string): HerdRow[] {
  const rows = new Map(current.map((r) => [r.id, { ...r }]))
  for (const a of [...audit].filter((x) => x.changed_at > asOf).sort((x, y) => y.changed_at.localeCompare(x.changed_at))) {
    const id = a.record_id ?? (a.old_values?.id as string | undefined) ?? (a.new_values?.id as string | undefined)
    if (!id) continue
    if (a.action === 'insert') rows.delete(id)
    else if (a.action === 'update' && a.old_values) rows.set(id, { ...(rows.get(id) ?? ({} as HerdRow)), ...(a.old_values as Partial<HerdRow>), id })
    else if (a.action === 'delete' && a.old_values) rows.set(id, { ...(a.old_values as unknown as HerdRow), id })
  }
  return [...rows.values()]
}

type ClassLike = { class_name: string; feed_class: string | null }

/**
 * The class a mob's name stands for: "Home Ranch Bulls" → Bulls, "… Herd"
 * → Cows, "… Replacement Heifer" → Replacement heifers. Null for a name that
 * says no class (a custom-grazing customer's cattle).
 */
export function mobClass<T extends ClassLike>(mob: string, classes: T[]): T | null {
  const m = mob.toLowerCase()
  const find = (feed: string[], name: RegExp) => classes.find((c) => (c.feed_class && feed.includes(c.feed_class)) || name.test(c.class_name.toLowerCase())) ?? null
  if (/bull/.test(m)) return find(['bull'], /bull/)
  if (/heifer/.test(m)) return find(['bred_heifer', 'heifer'], /heifer/)
  if (/calf|calves|steer|backgr/.test(m)) return find(['backgrounder', 'calf'], /calf|calves|steer/)
  if (/herd|cow/.test(m)) return find(['cow'], /cow/)
  return null
}

/** The ranch a mob is named for, if any. */
export const mobRanchOf = <R extends { id: string; name: string }>(mob: string, ranches: R[]) => ranches.find((r) => mob.toLowerCase().includes(r.name.toLowerCase())) ?? null

// Yearlings share the backgrounder feed class but are not calves: no calf price on them.
export const isCalfClass = (c: ClassLike) => !/yearling/i.test(c.class_name) && (c.feed_class === 'backgrounder' || c.feed_class === 'calf' || /calf|calves|steer/i.test(c.class_name))

export const HERD_COLUMNS = [
  { label: 'Class' },
  { label: 'Head', decimals: 0 },
  { label: 'Avg weight (lb)', decimals: 0 },
  { label: 'Total weight (lb)', decimals: 0 },
  { label: 'AU per head', upTo: 2 },
  { label: 'Animal units', decimals: 1 },
  { label: 'Collared (eShepherd)', decimals: 0 },
  { label: 'Value per head', money: true, decimals: 0 },
  { label: 'Value', money: true, decimals: 0 },
  { label: 'Counted' },
]

export function herdGroups(o: {
  rows: HerdRow[]
  ranches: { id: string; name: string }[]
  /** Collared head by mob, as of the date. */
  mobs: { mob: string; head: number | null }[]
  calfPricePerLb: number | null
}): { groups: ReportGroup[]; head: number; au: number; value: number; unplacedMobs: string[] } {
  const groups: ReportGroup[] = []
  let head = 0
  let au = 0
  let value = 0
  const placed = new Set<string>()
  for (const ranch of o.ranches) {
    const classes = o.rows.filter((r) => r.ranch_id === ranch.id).sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.class_name.localeCompare(b.class_name))
    if (!classes.length) continue
    const collared = new Map<string, number>()
    for (const m of o.mobs) {
      if (mobRanchOf(m.mob, [ranch])?.id !== ranch.id) continue
      const c = mobClass(m.mob, classes)
      if (!c) continue
      placed.add(m.mob)
      collared.set(c.id, (collared.get(c.id) ?? 0) + (m.head ?? 0))
    }
    let gHead = 0
    let gAu = 0
    let gLb = 0
    let gValue = 0
    const rows = classes.map((c): Cell[] => {
      const n = Number(c.head_count) || 0
      const w = num(c.avg_weight_lb)
      const auHead = num(c.au_equivalent)
      const perHead = isCalfClass(c) && w != null && o.calfPricePerLb != null ? w * o.calfPricePerLb : null
      gHead += n
      gAu += auHead != null ? auHead * n : 0
      gLb += w != null ? w * n : 0
      gValue += perHead != null ? perHead * n : 0
      return [c.class_name, n, w, w != null ? w * n : null, auHead, auHead != null ? auHead * n : null, collared.get(c.id) ?? null, perHead, perHead != null ? perHead * n : null, c.updated_at ? c.updated_at.slice(0, 10) : null]
    })
    head += gHead
    au += gAu
    value += gValue
    groups.push({
      title: ranch.name,
      rows,
      totals: [`${ranch.name} total`, gHead, gHead > 0 ? gLb / gHead : null, gLb, null, gAu, [...collared.values()].reduce((s, x) => s + x, 0) || null, null, gValue || null, null],
    })
  }
  return { groups, head, au, value, unplacedMobs: o.mobs.filter((m) => !placed.has(m.mob) && (m.head ?? 0) > 0).map((m) => `${m.mob} (${m.head})`) }
}

export type HerdRead = {
  /** The herd counts as they stood at the end of the day. */
  rows: HerdRow[]
  ranches: { id: string; name: string; sort_order: number | null }[]
  /** Collared head by mob on the day. */
  mobs: { mob: string; head: number | null }[]
  /** Every cattle sale on file, numbers parsed. */
  sales: CattleSale[]
  /** What the farm's own calves sold for, pound-weighted, in the newest year with sales; null with none. */
  calfPrice: number | null
  saleYear: number
  /** The weight those calves sold at, about. */
  soldAt: number | null
  asOfIso: string
}

/**
 * The herd on a day and what the farm's calves sell for: the read behind the
 * herd inventory, shared with the lender review (lender-review-data.ts).
 */
export async function loadHerd(asOf: string): Promise<HerdRead> {
  // The end of the chosen day on the browser's clock, which is the farm's.
  const asOfIso = new Date(`${asOf}T23:59:59.999`).toISOString()
  const [current, audit, ranches, activations, sales] = await Promise.all([
    fetchAll<HerdRow>((a, b) => supabase.from('herd_counts').select('id, ranch_id, class_name, head_count, avg_weight_lb, au_equivalent, feed_class, sort_order, updated_at').order('id').range(a, b)),
    fetchAll<HerdAudit>((a, b) =>
      supabase.from('audit_log').select('record_id, action, changed_at, old_values, new_values').eq('table_name', 'herd_counts').gt('changed_at', asOfIso).order('changed_at').order('id').range(a, b),
    ),
    fetchAll<{ id: string; name: string; sort_order: number | null }>((a, b) => supabase.from('ranches').select('id, name, sort_order').order('sort_order').order('id').range(a, b)),
    fetchAll<ActivationRow>((a, b) =>
      supabase.from('eshepherd_activations').select('id, mob, paddock_name, pasture_id, status, started_at, ended_at, head_count, imported_at').lte('started_at', asOfIso).order('started_at').order('id').range(a, b),
    ),
    fetchAll<CattleSale>((a, b) => supabase.from('cattle_sales').select('*').order('id').range(a, b)),
  ])
  const rows = herdAsOf(current, audit, asOfIso)
  // The newest year the farm's calves sold, pound-weighted across classes.
  const priced = sales.map((s) => ({ ...s, avg_weight_lb: num(s.avg_weight_lb), total_lb: num(s.total_lb), price_per_lb: num(s.price_per_lb), total_price: num(s.total_price) }))
  const saleYear = Math.max(0, ...priced.filter((s) => s.price_per_lb != null).map((s) => s.crop_year))
  const yearSales = priced.filter((s) => s.crop_year === saleYear)
  const calfPrice = saleYear ? yearAverage(yearSales) : null
  // The weight those calves sold at: a heavier calf fetches less a pound, so the price only fits near it.
  const soldLb = yearSales.reduce((s, x) => s + (x.total_lb ?? (x.head ?? 0) * (x.avg_weight_lb ?? 0)), 0)
  const soldHead = yearSales.reduce((s, x) => s + (x.head ?? 0), 0)
  const soldAt = soldHead > 0 && soldLb > 0 ? Math.round(soldLb / soldHead) : null
  const mobs = mobsNow(activations, Date.parse(asOfIso)).map((m) => ({ mob: m.mob, head: m.head_count }))
  return { rows, ranches, mobs, sales: priced as CattleSale[], calfPrice, saleYear, soldAt, asOfIso }
}

export async function gatherHerdInventory(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const ranchId = pick(p, 'ranch')
  const asOf = p.asOf || ctx.today
  const { rows, ranches, mobs, calfPrice, saleYear, soldAt, asOfIso } = await loadHerd(asOf)
  const shown = ranchId ? ranches.filter((r) => r.id === ranchId) : ranches
  const r = herdGroups({ rows, ranches: shown, mobs, calfPricePerLb: calfPrice })
  if (!r.groups.length) {
    const first = await firstHerdCount()
    throw new Error(first && asOfIso < first ? `No herd counts were recorded before ${longDate(first)}.` : 'No herd counts are entered (Herd).')
  }
  const ranchName = ranchId ? (ranches.find((x) => x.id === ranchId)?.name ?? 'one ranch') : 'All ranches'
  return {
    title: 'Year-end herd inventory',
    subtitle: `As of ${longDate(asOf)} · ${ranchName}`,
    meta: [
      ['Head', r.head.toLocaleString('en-CA')],
      ['Animal units', Math.round(r.au).toLocaleString('en-CA')],
      ['Calves valued at', calfPrice != null ? `$${calfPrice.toFixed(2)}/lb (${saleYear} sales${soldAt ? `, sold at about ${soldAt} lb` : ''})` : 'no sales on file'],
      ['Value of calves', r.value ? `$${Math.round(r.value).toLocaleString('en-CA')}` : '—'],
    ],
    summary: [
      `Head and weights are the Herd tab’s counts${asOf < ctx.today ? `, as they stood at the end of ${longDate(asOf)} — every change since is undone from the audit log` : ''}. Animal units are each class’s AU per head × head.`,
      'Collared is the head count of the eShepherd mob named for that ranch and class on the date — a check on the count, not a second count.',
      calfPrice != null
        ? `Only calves are valued, at what the farm’s own calves sold for in ${saleYear} (pound-weighted${soldAt ? `, at about ${soldAt} lb` : ''}). There is no weight slide, and a heavier calf fetches less a pound, so a class weighing more than that is valued high. Cows, bulls and replacements have no price in the app and are left blank.`
        : 'No cattle sales are on file, so nothing is valued.',
      ...(r.unplacedMobs.length ? [`Collared mobs not counted under a ranch class: ${r.unplacedMobs.join(', ')}.`] : []),
    ],
    columns: HERD_COLUMNS,
    groups: r.groups,
    groupLabel: 'Ranch',
    totals: r.groups.length > 1 ? ['All ranches', r.head, null, null, null, r.au, null, null, r.value || null, null] : undefined,
    filename: `Herd inventory ${asOf}${ranchId ? ` ${ranchName}` : ''}`,
  }
}

/** When the first herd count was recorded, from the audit log. */
async function firstHerdCount(): Promise<string | null> {
  const { data } = await supabase.from('audit_log').select('changed_at').eq('table_name', 'herd_counts').order('changed_at').limit(1).maybeSingle()
  return (data?.changed_at as string | undefined) ?? null
}
