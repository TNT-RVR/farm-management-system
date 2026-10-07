/**
 * Provincial grazing leases (grazing dispositions) and the Stewardship Stock
 * Return each one files with Alberta every year: who grazed it, with what,
 * from when to when, the brands, any hay or feed, other land fenced in with
 * it, and the declaration.
 *
 * Pure, so the page, the report and the January reminder agree. No '@/'
 * imports: the reminder job (netlify/shared/lease-reminders.ts) loads this
 * file directly.
 */

export type YesNo = boolean | null

export type LivestockRow = { pasture_unit: string; livestock_class: string; count: number | null; date_in: string; date_out: string }
export type WeightRow = { livestock_class: string; weight: number | null; unit: string }
export type BrandRow = { owner: string; description: string; location: string; livestock: string }
export type OtherLandRow = { land_type: string; acres: number | null; quarter: string; section: string; township: string; range: string; meridian: string }
export type HayRow = { hay_type: string; weight: string; area: string }
export type FeedRow = { feed_type: string; amount: string; date_from: string; date_to: string }
export type LossRow = { livestock_type: string; loss_type: string; number: number | null }

export type Disposition = {
  id: string
  ranch_id: string | null
  disposition_no: string
  holder_name: string | null
  holder_address: string | null
  expiry_date: string | null
  key_land: string | null
  billable_aum: number | null
  capacity_aum: number | null
  return_to: string | null
  return_phone: string | null
  return_fax: string | null
  pasture_unit: string | null
  pasture_ids: string[]
  other_lands: OtherLandRow[]
  brands: BrandRow[]
  calving_months: string | null
  signer_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  active: boolean
  sort_order: number
}

export type ReturnStatus = 'draft' | 'filed'

export type StockReturn = {
  id?: string
  disposition_id: string
  year: number
  grazed: YesNo
  livestock: LivestockRow[]
  weights: WeightRow[]
  owned: YesNo
  owned_explain: string | null
  hay_cut: YesNo
  hay: HayRow[]
  feed_supplied: YesNo
  feed: FeedRow[]
  /** Other land fenced in with it this year; the land itself is the lease's other_lands. */
  other_fenced: YesNo
  had_losses: YesNo
  losses: LossRow[]
  declared: boolean
  signed_on: string | null
  status: ReturnStatus
  filed_on: string | null
  /** Sections the app filled in that nobody has checked: { livestock: 'from the app' }. */
  prefilled: Record<string, string>
  notes: string | null
}

/**
 * The parts of the form a "check this" mark can sit on. The header keys are
 * the lease's own details, offered from another lease when blank.
 */
export type SectionKey = 'holder' | 'return_to' | 'signer' | 'grazed' | 'livestock' | 'weights' | 'calving' | 'brands'

export const FROM_APP = 'from the app'

/** The livestock classes Alberta's return offers, the cattle ones first. */
export const LIVESTOCK_CLASSES = ['Cattle Cow', 'Cattle Bull', 'Cattle Yearling', 'Cattle Calf', 'Horse', 'Sheep', 'Bison']

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/* ── Dates ──────────────────────────────────────────────────────────────── */

/** The return for a grazing year is due 31 January after it. */
export const stockReturnDue = (year: number): string => `${year + 1}-01-31`

/** "2026-01-31" → "January 31, 2026", as the form prints it. */
export function formDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** "2025-06-09" → "2025/06/09", the form's own way of writing a date. */
export const slashDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).replaceAll('-', '/') : '')

/**
 * The grazing year being worked on: up to the end of June it is last
 * season's (the one due in January); from July, this season's.
 */
export function returnYearFor(today: string): number {
  const year = Number(today.slice(0, 4))
  return Number(today.slice(5, 7)) <= 6 ? year - 1 : year
}

/** The same day a number of years on; 29 February lands on the 28th. */
export function shiftYear(iso: string, years: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso
  const y = Number(iso.slice(0, 4)) + years
  const md = iso.slice(5, 10)
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  return `${y}-${md === '02-29' && !leap ? '02-28' : md}`
}

/** A calving start month as the form asks for it: that month and the next ("March - April"). */
export function calvingMonths(startMonth: number | null | undefined): string | null {
  if (!startMonth || startMonth < 1 || startMonth > 12) return null
  return `${MONTHS[startMonth - 1]} - ${MONTHS[startMonth % 12]}`
}

/* ── Reading rows from the database ─────────────────────────────────────── */

const str = (v: unknown): string => (v == null ? '' : String(v))
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const rows = <T>(v: unknown, map: (r: Record<string, unknown>) => T): T[] => (Array.isArray(v) ? v.filter((r) => r && typeof r === 'object').map((r) => map(r as Record<string, unknown>)) : [])

export const livestockRow = (r: Record<string, unknown> = {}): LivestockRow => ({
  pasture_unit: str(r.pasture_unit),
  livestock_class: str(r.livestock_class),
  count: numOrNull(r.count),
  date_in: str(r.date_in),
  date_out: str(r.date_out),
})
export const weightRow = (r: Record<string, unknown> = {}): WeightRow => ({ livestock_class: str(r.livestock_class), weight: numOrNull(r.weight), unit: str(r.unit) || 'Pounds' })
export const brandRow = (r: Record<string, unknown> = {}): BrandRow => ({ owner: str(r.owner), description: str(r.description), location: str(r.location), livestock: str(r.livestock) })
export const otherLandRow = (r: Record<string, unknown> = {}): OtherLandRow => ({
  land_type: str(r.land_type),
  acres: numOrNull(r.acres),
  quarter: str(r.quarter),
  section: str(r.section),
  township: str(r.township),
  range: str(r.range),
  meridian: str(r.meridian),
})
export const hayRow = (r: Record<string, unknown> = {}): HayRow => ({ hay_type: str(r.hay_type), weight: str(r.weight), area: str(r.area) })
export const feedRow = (r: Record<string, unknown> = {}): FeedRow => ({ feed_type: str(r.feed_type), amount: str(r.amount), date_from: str(r.date_from), date_to: str(r.date_to) })
export const lossRow = (r: Record<string, unknown> = {}): LossRow => ({ livestock_type: str(r.livestock_type), loss_type: str(r.loss_type), number: numOrNull(r.number) })

const yesNo = (v: unknown): YesNo => (v === true || v === false ? v : null)
const textOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

/** A grazing_dispositions row as the app uses it: numbers as numbers, the jsonb lists as typed rows. */
export function toDisposition(r: Record<string, unknown>): Disposition {
  return {
    id: str(r.id),
    ranch_id: textOrNull(r.ranch_id),
    disposition_no: str(r.disposition_no),
    holder_name: textOrNull(r.holder_name),
    holder_address: textOrNull(r.holder_address),
    expiry_date: textOrNull(r.expiry_date),
    key_land: textOrNull(r.key_land),
    billable_aum: numOrNull(r.billable_aum),
    capacity_aum: numOrNull(r.capacity_aum),
    return_to: textOrNull(r.return_to),
    return_phone: textOrNull(r.return_phone),
    return_fax: textOrNull(r.return_fax),
    pasture_unit: textOrNull(r.pasture_unit),
    pasture_ids: Array.isArray(r.pasture_ids) ? r.pasture_ids.map(String) : [],
    other_lands: rows(r.other_lands, otherLandRow),
    brands: rows(r.brands, brandRow),
    calving_months: textOrNull(r.calving_months),
    signer_name: textOrNull(r.signer_name),
    phone: textOrNull(r.phone),
    email: textOrNull(r.email),
    notes: textOrNull(r.notes),
    active: r.active !== false,
    sort_order: numOrNull(r.sort_order) ?? 0,
  }
}

/** A grazing_disposition_returns row as the app uses it. */
export function toStockReturn(r: Record<string, unknown>): StockReturn {
  const pre = r.prefilled && typeof r.prefilled === 'object' && !Array.isArray(r.prefilled) ? (r.prefilled as Record<string, unknown>) : {}
  return {
    id: textOrNull(r.id) ?? undefined,
    disposition_id: str(r.disposition_id),
    year: numOrNull(r.year) ?? 0,
    grazed: yesNo(r.grazed),
    livestock: rows(r.livestock, livestockRow),
    weights: rows(r.weights, weightRow),
    owned: yesNo(r.owned),
    owned_explain: textOrNull(r.owned_explain),
    hay_cut: yesNo(r.hay_cut),
    hay: rows(r.hay, hayRow),
    feed_supplied: yesNo(r.feed_supplied),
    feed: rows(r.feed, feedRow),
    other_fenced: yesNo(r.other_fenced),
    had_losses: yesNo(r.had_losses),
    losses: rows(r.losses, lossRow),
    declared: r.declared === true,
    signed_on: textOrNull(r.signed_on),
    status: r.status === 'filed' ? 'filed' : 'draft',
    filed_on: textOrNull(r.filed_on),
    prefilled: Object.fromEntries(Object.entries(pre).map(([k, v]) => [k, String(v)])),
    notes: textOrNull(r.notes),
  }
}

export function blankReturn(dispositionId: string, year: number): StockReturn {
  return {
    disposition_id: dispositionId,
    year,
    grazed: null,
    livestock: [],
    weights: [],
    owned: null,
    owned_explain: null,
    hay_cut: null,
    hay: [],
    feed_supplied: null,
    feed: [],
    other_fenced: null,
    had_losses: null,
    losses: [],
    declared: false,
    signed_on: null,
    status: 'draft',
    filed_on: null,
    prefilled: {},
    notes: null,
  }
}

/* ── Prefill from the app ───────────────────────────────────────────────── */

/** A Herd tab row (herd_counts). */
export type HerdLike = {
  class_name: string
  head_count: number
  avg_weight_lb: unknown
  feed_class: string | null
  graze_start: string | null
  graze_end: string | null
}

/** A grazing event on one of the lease's pastures, with the mob it was made from where known. */
export type EventLike = {
  pasture_id: string
  head_count: number | null
  avg_animal_weight_lb: unknown
  turned_in_on: string
  moved_out_on: string | null
  mob: string | null
}

/**
 * Alberta's livestock class for a Herd tab class. Calves at side go with
 * their cows (a cow-calf pair is grazed as the cow), so they get none.
 * Replacement heifers and yearlings are both yearlings to the province.
 */
export function albertaClass(className: string, feedClass: string | null = null): string | null {
  const c = className.toLowerCase()
  if (feedClass === 'bull' || /bull/.test(c)) return 'Cattle Bull'
  if (/calf|calves/.test(c) || feedClass === 'heifer_calf') return null
  if (feedClass === 'bred_heifer' || feedClass === 'backgrounder' || /heifer|yearling|steer|backgr/.test(c)) return 'Cattle Yearling'
  if (feedClass === 'cow' || /cow|herd/.test(c)) return 'Cattle Cow'
  return null
}

/** Alberta's class for an eShepherd mob's name ("East Ranch Main Herd", "… Bulls"); null for calves. */
export function mobAlbertaClass(mob: string | null): string | null {
  const m = (mob ?? '').toLowerCase()
  if (/bull/.test(m)) return 'Cattle Bull'
  if (/calf|calves/.test(m)) return null
  if (/heifer|yearling|steer|backgr/.test(m)) return 'Cattle Yearling'
  return 'Cattle Cow'
}

const classOrder = (c: string) => {
  const i = LIVESTOCK_CLASSES.indexOf(c)
  return i < 0 ? LIVESTOCK_CLASSES.length : i
}

export type LivestockPrefill = {
  livestock: LivestockRow[]
  weights: WeightRow[]
  /** Where it came from: the lease's own pastures' grazing, the ranch's Herd tab, or nothing found. */
  source: 'grazing' | 'herd' | null
}

/**
 * The year's livestock on a lease, from what the app knows.
 *
 * Best: the grazing events on the pastures marked as inside the lease (the
 * eShepherd import writes one for every fence a mob is put in). Each class
 * gets its largest mob as the count, its first day in and last day out in
 * the year; a mob still in leaves the day out blank.
 *
 * Otherwise: the ranch's Herd tab, every class that grazes (calves go with
 * their cows), with the herd's grazing dates where they are for this year.
 * That is the whole ranch's herd, not this lease's share of it, so it is
 * marked to check either way.
 */
export function prefillLivestock(o: {
  year: number
  pastureUnit: string | null
  herd: HerdLike[]
  events: EventLike[]
  /** The lease's pastures by id, for the pasture unit when the lease has none written. */
  pastureNames?: Map<string, string>
}): LivestockPrefill {
  const from = `${o.year}-01-01`
  const to = `${o.year}-12-31`
  const herdWeight = new Map<string, number>()
  for (const h of o.herd) {
    const c = albertaClass(h.class_name, h.feed_class)
    const w = numOrNull(h.avg_weight_lb)
    if (c && w && h.head_count > 0 && !herdWeight.has(c)) herdWeight.set(c, w)
  }

  const events = o.events.filter((e) => e.turned_in_on <= to && (e.moved_out_on == null || e.moved_out_on >= from))
  if (events.length) {
    type Acc = { count: number; in: string; out: string | null; open: boolean; weights: number[]; pastures: Set<string> }
    const by = new Map<string, Acc>()
    for (const e of events) {
      const c = mobAlbertaClass(e.mob)
      if (!c) continue
      const a = by.get(c) ?? { count: 0, in: to, out: null, open: false, weights: [], pastures: new Set<string>() }
      a.count = Math.max(a.count, e.head_count ?? 0)
      const din = e.turned_in_on < from ? from : e.turned_in_on
      if (din < a.in) a.in = din
      if (e.moved_out_on == null) a.open = true
      else {
        const dout = e.moved_out_on > to ? to : e.moved_out_on
        if (!a.out || dout > a.out) a.out = dout
      }
      const w = numOrNull(e.avg_animal_weight_lb)
      if (w) a.weights.push(w)
      a.pastures.add(e.pasture_id)
      by.set(c, a)
    }
    const classes = [...by.keys()].sort((x, y) => classOrder(x) - classOrder(y))
    if (classes.length) {
      const unit = (a: Acc) =>
        o.pastureUnit?.trim() ||
        [...a.pastures]
          .map((id) => o.pastureNames?.get(id))
          .filter(Boolean)
          .join(', ')
      return {
        livestock: classes.map((c) => {
          const a = by.get(c)!
          return { pasture_unit: unit(a), livestock_class: c, count: a.count || null, date_in: a.in, date_out: a.open ? '' : (a.out ?? '') }
        }),
        weights: classes.map((c) => {
          const a = by.get(c)!
          const w = a.weights.length ? a.weights.reduce((s, x) => s + x, 0) / a.weights.length : herdWeight.get(c)
          return { livestock_class: c, weight: w ? Math.round(w) : null, unit: 'Pounds' }
        }),
        source: 'grazing',
      }
    }
  }

  // The Herd tab: classes merged into Alberta's, head summed, weight by head.
  type HerdAcc = { head: number; lbHead: number; withLb: number; start: string | null; end: string | null }
  const by = new Map<string, HerdAcc>()
  const inYear = (d: string | null) => (d && d.slice(0, 4) === String(o.year) ? d.slice(0, 10) : null)
  for (const h of o.herd) {
    const c = albertaClass(h.class_name, h.feed_class)
    if (!c || !(h.head_count > 0)) continue
    const a = by.get(c) ?? { head: 0, lbHead: 0, withLb: 0, start: null, end: null }
    a.head += h.head_count
    const w = numOrNull(h.avg_weight_lb)
    if (w) {
      a.lbHead += w * h.head_count
      a.withLb += h.head_count
    }
    const s = inYear(h.graze_start)
    const e = inYear(h.graze_end)
    if (s && (!a.start || s < a.start)) a.start = s
    if (e && (!a.end || e > a.end)) a.end = e
    by.set(c, a)
  }
  const classes = [...by.keys()].sort((x, y) => classOrder(x) - classOrder(y))
  if (!classes.length) return { livestock: [], weights: [], source: null }
  return {
    livestock: classes.map((c) => {
      const a = by.get(c)!
      return { pasture_unit: o.pastureUnit?.trim() ?? '', livestock_class: c, count: a.head, date_in: a.start ?? '', date_out: a.end ?? '' }
    }),
    weights: classes.map((c) => {
      const a = by.get(c)!
      return { livestock_class: c, weight: a.withLb ? Math.round(a.lbHead / a.withLb) : null, unit: 'Pounds' }
    }),
    source: 'herd',
  }
}

/** Everything the app can offer a blank return, read by the page and the report alike. */
export type PrefillSource = {
  herd: HerdLike[]
  events: EventLike[]
  pastureNames: Map<string, string>
  /** Cattle settings: the month calving starts (feed_plans.calving_month). */
  calvingMonth: number | null
  /** The ranch's brand, as Cattle settings → Brands holds it. */
  ranchBrand: { brand: string | null; location: string | null; owner: string | null } | null
  /** The other leases, for a holder, office and signer when this one has none. */
  others: Disposition[]
}

/**
 * A lease with its blanks offered from elsewhere in the app: the calving
 * months from Cattle settings, the brand from the ranch, and the holder,
 * district office and signer from another lease that has them. Each offered
 * section is listed in `marks`, to be shown as "from the app — check".
 */
export function prefillDisposition(d: Disposition, src: Pick<PrefillSource, 'calvingMonth' | 'ranchBrand' | 'others'>): { disposition: Disposition; marks: Partial<Record<SectionKey, string>> } {
  const out: Disposition = { ...d }
  const marks: Partial<Record<SectionKey, string>> = {}
  // Same ranch first: its leases are most likely held and returned alike.
  const donors = [...src.others].filter((x) => x.id !== d.id).sort((a, b) => Number(b.ranch_id === d.ranch_id) - Number(a.ranch_id === d.ranch_id) || a.sort_order - b.sort_order)
  const holder = donors.find((x) => x.holder_name)
  if (!out.holder_name && holder) {
    out.holder_name = holder.holder_name
    out.holder_address = out.holder_address ?? holder.holder_address
    marks.holder = `from ${holder.disposition_no}`
  }
  const office = donors.find((x) => x.return_to)
  if (!out.return_to && office) {
    out.return_to = office.return_to
    out.return_phone = out.return_phone ?? office.return_phone
    out.return_fax = out.return_fax ?? office.return_fax
    marks.return_to = `from ${office.disposition_no}`
  }
  const signer = donors.find((x) => x.signer_name)
  if (!out.signer_name && signer) {
    out.signer_name = signer.signer_name
    out.phone = out.phone ?? signer.phone
    out.email = out.email ?? signer.email
    marks.signer = `from ${signer.disposition_no}`
  }
  const months = calvingMonths(src.calvingMonth)
  if (!out.calving_months && months) {
    out.calving_months = months
    marks.calving = FROM_APP
  }
  if (!out.brands.length) {
    if (src.ranchBrand?.brand) {
      out.brands = [{ owner: src.ranchBrand.owner ?? out.holder_name ?? '', description: src.ranchBrand.brand, location: src.ranchBrand.location ?? '', livestock: 'Cattle' }]
      marks.brands = FROM_APP
    } else {
      const b = donors.find((x) => x.brands.length && x.ranch_id === d.ranch_id) ?? donors.find((x) => x.brands.length)
      if (b) {
        out.brands = b.brands.map((x) => ({ ...x }))
        marks.brands = `from ${b.disposition_no}`
      }
    }
  }
  return { disposition: out, marks }
}

/** A new return for the year, filled from the app and marked to check. */
export function prefillReturn(d: Disposition, year: number, src: PrefillSource): { disposition: Disposition; ret: StockReturn } {
  const { disposition, marks } = prefillDisposition(d, src)
  const ret = blankReturn(d.id, year)
  const live = prefillLivestock({ year, pastureUnit: d.pasture_unit, herd: src.herd, events: src.events, pastureNames: src.pastureNames })
  if (live.source) {
    ret.livestock = live.livestock
    ret.weights = live.weights
    marks.livestock = live.source === 'grazing' ? 'from the grazing on its pastures' : 'from the Herd tab (whole ranch)'
    marks.weights = 'from the Herd tab'
    if (live.source === 'grazing') {
      ret.grazed = true
      marks.grazed = FROM_APP
    }
  }
  // The land fenced in with it is the lease's; whether it still is, is the year's answer.
  if (disposition.other_lands.length) ret.other_fenced = true
  ret.prefilled = marks as Record<string, string>
  return { disposition, ret }
}

/**
 * Last year's return as a start on this year's: the same livestock, weights,
 * hay and feed, with the dates moved on a year. The year's own facts are not
 * carried: losses, the declaration, the signature date and the filing.
 */
export function copyLastYear(prev: StockReturn, year: number): StockReturn {
  const by = year - prev.year
  const shift = (d: string) => (d ? shiftYear(d, by) : d)
  const from = `copied from ${prev.year}`
  const marks: Record<string, string> = {}
  if (prev.grazed != null) marks.grazed = from
  if (prev.livestock.length) marks.livestock = from
  if (prev.weights.length) marks.weights = from
  return {
    ...blankReturn(prev.disposition_id, year),
    grazed: prev.grazed,
    livestock: prev.livestock.map((r) => ({ ...r, date_in: shift(r.date_in), date_out: shift(r.date_out) })),
    weights: prev.weights.map((r) => ({ ...r })),
    owned: prev.owned,
    owned_explain: prev.owned_explain,
    hay_cut: prev.hay_cut,
    hay: prev.hay.map((r) => ({ ...r })),
    feed_supplied: prev.feed_supplied,
    feed: prev.feed.map((r) => ({ ...r, date_from: shift(r.date_from), date_to: shift(r.date_to) })),
    other_fenced: prev.other_fenced,
    prefilled: marks,
  }
}

/* ── What is still to answer ────────────────────────────────────────────── */

/** The questions a return cannot be filed without, in the form's order. */
export function missingAnswers(d: Disposition, r: StockReturn): string[] {
  const out: string[] = []
  if (!d.holder_name) out.push('holder name')
  if (!d.expiry_date) out.push('expiry date')
  if (!d.key_land) out.push('key land')
  if (r.grazed == null) out.push('1. grazed this year')
  if (r.grazed && !r.livestock.some((x) => x.livestock_class && x.count)) out.push('1. livestock and counts')
  if (r.grazed && r.livestock.some((x) => x.livestock_class && (!x.date_in || !x.date_out))) out.push('1. dates in and out')
  if (r.grazed && !r.weights.some((x) => x.weight)) out.push('2. weights')
  if (r.owned == null) out.push('3. own livestock')
  if (r.owned === false && !r.owned_explain) out.push('3. explanation')
  if (!d.calving_months) out.push('4. calving months')
  if (!d.brands.length) out.push('5. brands')
  if (r.hay_cut == null) out.push('6. hay')
  if (r.feed_supplied == null) out.push('7. feed')
  if (r.other_fenced == null) out.push('8. other land fenced in')
  if (r.other_fenced && !d.other_lands.length) out.push('8. the other land')
  if (!r.declared) out.push('10. declaration')
  return out
}

/* ── The January reminder ───────────────────────────────────────────────── */

export type ReminderPlan = { key: string; year: number; title: string; body: string; pending: string[] }

/**
 * Early January: the returns for the grazing year just ended are due on the
 * 31st. From 2 January, once a year (the key goes in reminder_log), listing
 * the active leases with no filed return for that year. Nothing when every
 * one is filed or the farm has no leases.
 */
export function stockReturnReminder(
  today: string,
  dispositions: Pick<Disposition, 'id' | 'disposition_no' | 'active'>[],
  returns: Pick<StockReturn, 'disposition_id' | 'year' | 'status'>[],
): ReminderPlan | null {
  const md = today.slice(5, 10)
  if (md < '01-02' || md > '01-31') return null
  const year = Number(today.slice(0, 4)) - 1
  const filed = new Set(returns.filter((r) => r.year === year && r.status === 'filed').map((r) => r.disposition_id))
  const pending = dispositions
    .filter((d) => d.active && !filed.has(d.id))
    .map((d) => d.disposition_no)
    .sort()
  if (!pending.length) return null
  const n = pending.length
  return {
    key: `stock_return_${year}`,
    year,
    pending,
    title: `File the ${year} grazing lease stock return${n === 1 ? '' : 's'}`,
    body: `Due ${formDate(stockReturnDue(year))}. Not filed yet: ${pending.join(', ')}. Fill each one on Cattle → Grazing leases, download it and send it to the district office, then mark it filed.`,
  }
}
