import { supabase } from '@/lib/supabase'
import { bushelWeightFor, convertMass } from '@/lib/bushels'
import { massUnit } from '@/lib/trucking'
import { netInUnit } from '@/lib/scale-tickets'
import { resolvePrice, type PriceRow } from '@/lib/forecast'
import { farmBrand } from '@/lib/farm-setup'
import { fetchAll, longDate, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData, type ReportGroup } from './framework'

/**
 * Check-off refund requests, prefilled: every grain delivery and calf sale in
 * a commission's refund period, with the check-off the buyer should have taken
 * off the settlement and what can be claimed back.
 *
 * The app keeps scale tickets and loads, not settlement statements, so it
 * never knows what was actually deducted. Every check-off here is an ESTIMATE
 * (tonnes or value × the commission's rate), and the settlement number and
 * "deducted per settlement" columns are left blank to copy off the cheque
 * stubs. Producer identifiers (commission producer numbers, SIN, business or
 * GST number) are never filled.
 *
 * The rates, refund periods and deadlines below were read on 3 October 2026
 * from the commissions' own pages (docs/checkoff-refunds.md has the detail):
 *
 *   Alberta Canola   $1.75/t from 1 Aug 2025 ($1.00 before), fully refundable
 *     https://albertacanola.com/about/
 *     https://kings-printer.alberta.ca/documents/Regs/1998_142.pdf (AR 142/98 s.2, s.5)
 *   Alberta Grains   wheat and durum $1.09/t, barley $1.20/t, fully refundable
 *     https://www.albertagrains.com/check-off-regulations-information
 *     https://www.albertawheatbarley.com/files/2023/07/alberta_grains_commission_regulation.pdf (AR 105/2023)
 *   Alberta Pulse    0.75% of the sale price (peas, dry beans, lentils…), fully refundable
 *     https://albertapulse.com/pulse-service-charges-refunds/
 *     https://kings-printer.alberta.ca/documents/Regs/1999_129.pdf (AR 129/99)
 *   Alberta oats     $0.75/t from 1 Aug 2024, refundable
 *     https://poga.ca/provincial-commissions/alberta-oat-growers-association-aogc/alberta-oat-growers-commission-oat-levy-and-refunds/
 *   Alberta Beef     $4.50/head: $2.00 Alberta service charge (refundable), $2.50 national levy (not)
 *     https://albertabeef.org/checkoff-downloads/
 *     https://albertabeef.org/wp-content/uploads/2025/04/Refund-Request-Form_Updated-2025.xlsm
 *   No Alberta corn check-off; the federal WGRF wheat and barley levy ended 31 Jul 2017
 *     https://wgrf.ca/about/wgrf-revenue-sources/
 *
 * Crop periods are 1 Aug–31 Jan (claim by the end of February) and
 * 1 Feb–31 Jul (claim by 31 August). ABP's are calendar halves: Jan–Jun by
 * 31 July, Jul–Dec by 31 January.
 */

/* ── The commissions ────────────────────────────────────────────────────── */

export type CommissionKey = 'canola' | 'grains' | 'pulse' | 'oats' | 'beef'

export type Rate =
  /** Dollars a net tonne. */
  | { kind: 'per_tonne'; dollars: number }
  /** A percentage of the gross value. */
  | { kind: 'pct_value'; pct: number }
  /** Dollars a head sold. */
  | { kind: 'per_head'; dollars: number }

/** One refund period: the sales in it are claimed together, by the deadline. */
export type Period = { start: string; end: string; deadline: string; label: string }

export type Commission = {
  key: CommissionKey
  name: string
  /** Which of our crops it collects on, by name. The beef service charge takes the calf sales instead. */
  matches: (cropName: string) => boolean
  /** What the buyer takes off for it on a sale that day: rates change on 1 August, and wheat and barley differ. Null before it existed. */
  rateFor: (cropName: string, date: string) => Rate | null
  /** The part of that which can be claimed back. Left out, all of it. */
  refundFor?: (cropName: string, date: string) => Rate | null
  /** The refund periods that END in a calendar year. */
  periods: (year: number) => Period[]
  /** How to file, in a sentence or two. */
  howToFile: string
  link: string
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** The crop commissions' two periods: Aug–Jan, claimed by the end of February; Feb–Jul, by 31 August. */
export function cropPeriods(year: number): Period[] {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return [
    { start: iso(year - 1, 8, 1), end: iso(year, 1, 31), deadline: iso(year, 2, leap ? 29 : 28), label: `1 Aug ${year - 1} to 31 Jan ${year}` },
    { start: iso(year, 2, 1), end: iso(year, 7, 31), deadline: iso(year, 8, 31), label: `1 Feb to 31 Jul ${year}` },
  ]
}

/** Alberta Beef Producers' calendar halves: Jan–Jun, claimed by 31 July; Jul–Dec, by 31 January. */
export function beefPeriods(year: number): Period[] {
  return [
    { start: iso(year, 1, 1), end: iso(year, 6, 30), deadline: iso(year, 7, 31), label: `1 Jan to 30 Jun ${year}` },
    { start: iso(year, 7, 1), end: iso(year, 12, 31), deadline: iso(year + 1, 1, 31), label: `1 Jul to 31 Dec ${year}` },
  ]
}

const CANOLA = /canola|rapeseed/i
const WHEAT = /wheat|durum/i
const BARLEY = /barley/i
const OATS = /\boats?\b/i
const PULSE = /\bpeas?\b|bean|lentil|faba|chickpea|soy|lupin/i
const tonne = (dollars: number): Rate => ({ kind: 'per_tonne', dollars })

export const COMMISSIONS: Commission[] = [
  {
    key: 'canola',
    name: 'Alberta Canola',
    matches: (n) => CANOLA.test(n),
    // $1.75/t from 1 Aug 2025 (AR 142/98 s.2, voted at the Jan 2025 AGM); $1.00 before.
    rateFor: (_n, d) => tonne(d >= '2025-08-01' ? 1.75 : 1.0),
    periods: cropPeriods,
    howToFile:
      'No online form: ask Alberta Canola for its refund request form (780-454-0844, user-0627@albertacanola.com). It wants the quantity sold and the name and address of each buyer that took the charge. A refunded check-off cannot also be claimed as a research (SR&ED) tax credit.',
    link: 'https://albertacanola.com/about/',
  },
  {
    key: 'grains',
    name: 'Alberta Grains (wheat and barley)',
    matches: (n) => WHEAT.test(n) || BARLEY.test(n),
    // AR 105/2023 s.2: wheat (durum, spring, winter) $1.09/t, barley $1.20/t.
    rateFor: (n) => tonne(BARLEY.test(n) && !WHEAT.test(n) ? 1.2 : 1.09),
    periods: cropPeriods,
    howToFile:
      'No online form: ask Alberta Grains’ dealer and producer levies administrator for the refund form (user-1c2d@albertagrains.com, 403-219-6251). Send a cheque stub or settlement showing each deduction.',
    link: 'https://www.albertagrains.com/check-off-regulations-information',
  },
  {
    key: 'pulse',
    name: 'Alberta Pulse Growers (peas and dry beans)',
    matches: (n) => PULSE.test(n),
    // AR 129/99 s.2: 0.75% of the sale price since 1 Aug 2018, every pulse.
    rateFor: () => ({ kind: 'pct_value', pct: 0.75 }),
    periods: cropPeriods,
    howToFile:
      'Paper form only, from Alberta Pulse Growers (780-986-9398 ext. 110). Send a copy of each original cash ticket and the legal land where the crop was grown.',
    link: 'https://albertapulse.com/pulse-service-charges-refunds/',
  },
  {
    key: 'oats',
    name: 'Alberta Oat Growers Commission',
    matches: (n) => OATS.test(n),
    // $0.75/t on Alberta oats since 1 Aug 2024; nothing before.
    rateFor: (_n, d) => (d >= '2024-08-01' ? tonne(0.75) : null),
    periods: cropPeriods,
    howToFile: 'Email user-0627@poga.ca for the Alberta refund form. Use the name on the sales tickets: they match it to what the buyers sent in, so no ticket copies are needed.',
    link: 'https://poga.ca/provincial-commissions/alberta-oat-growers-association-aogc/alberta-oat-growers-commission-oat-levy-and-refunds/',
  },
  {
    key: 'beef',
    name: 'Alberta Beef Producers',
    matches: () => false,
    // $4.50 a head comes off: the $2.00 Alberta service charge (refundable) and the $2.50 national levy (not).
    rateFor: () => ({ kind: 'per_head', dollars: 4.5 }),
    refundFor: () => ({ kind: 'per_head', dollars: 2.0 }),
    periods: beefPeriods,
    howToFile:
      'Fill in ABP’s Excel refund form and email it; post a copy of every settlement to ABP, 165, 6815 8 St NE, Calgary T2E 7H7 (attn. Controller). Up to $2.00 a head is refundable, on cattle sold in Alberta; the form may take dealer, CCA and ABP contributions off it. The $2.50 national levy is not refundable.',
    link: 'https://albertabeef.org/wp-content/uploads/2025/04/Refund-Request-Form_Updated-2025.xlsm',
  },
]

export const commissionByKey = (k: string) => COMMISSIONS.find((c) => c.key === k) ?? null

/** The commission that collects on a crop, or null (corn, potatoes, carrots: no Alberta check-off to claim). */
export function commissionFor(cropName: string): Commission | null {
  return COMMISSIONS.find((c) => c.key !== 'beef' && c.matches(cropName)) ?? null
}

/* ── Periods ────────────────────────────────────────────────────────────── */

/** The period a date falls in, or null. */
export function periodOf(c: Commission, date: string): Period | null {
  const y = Number(date.slice(0, 4))
  for (const p of [...c.periods(y), ...c.periods(y + 1)]) if (date >= p.start && date <= p.end) return p
  return null
}

/** The newest period that has closed by today. */
export function latestClosed(c: Commission, today: string): Period {
  const y = Number(today.slice(0, 4))
  const all = [...c.periods(y - 1), ...c.periods(y)].filter((p) => p.end < today).sort((a, b) => a.end.localeCompare(b.end))
  return all[all.length - 1]
}

export type PeriodPick = 'latest' | 'current' | 'year'

/** The periods a pick covers for one commission. */
export function periodsFor(c: Commission, pick: PeriodPick, year: number, today: string): Period[] {
  if (pick === 'year') return c.periods(year)
  if (pick === 'current') {
    const p = periodOf(c, today)
    return p ? [p] : []
  }
  return [latestClosed(c, today)]
}

/* ── Rate maths ─────────────────────────────────────────────────────────── */

const cents = (v: number) => Math.round(v * 100) / 100

/** The check-off on one sale: by tonne, by value or by head. Null when what it is levied on is not known. */
export function checkoffOn(rate: Rate, s: { tonnes: number | null; gross: number | null; head: number | null }): number | null {
  if (rate.kind === 'per_tonne') return s.tonnes == null ? null : cents(s.tonnes * rate.dollars)
  if (rate.kind === 'pct_value') return s.gross == null ? null : cents((s.gross * rate.pct) / 100)
  return s.head == null ? null : cents(s.head * rate.dollars)
}

/** What can be claimed back on a sale: the refundable part's rate where there is one, else the whole check-off. */
export function refundOn(c: Commission, cropName: string, s: { date: string; tonnes: number | null; gross: number | null; head: number | null }): number | null {
  const r = c.refundFor ? c.refundFor(cropName, s.date) : c.rateFor(cropName, s.date)
  return r ? checkoffOn(r, s) : null
}

export function rateLabel(r: Rate): string {
  if (r.kind === 'per_tonne') return `$${r.dollars.toFixed(2)}/t`
  if (r.kind === 'pct_value') return `${r.pct}% of value`
  return `$${r.dollars.toFixed(2)}/head`
}

/* ── Units ──────────────────────────────────────────────────────────────── */

export type SCrop = { id: string; name: string; yield_unit: string | null; test_weight_lb_per_bu: unknown }

const lbPerBuOf = (crop: SCrop) => bushelWeightFor(crop.name, num(crop.test_weight_lb_per_bu))?.lbPerBu ?? null

/** An amount in a unit (bu, lbs, cwt, kg, t…) as tonnes, at the crop's bushel weight. Null when it cannot be weighed. */
export function toTonnes(qty: number | null, unit: string | null, crop: SCrop): number | null {
  if (qty == null) return null
  const m = massUnit(unit)
  return m ? convertMass(qty, m, 't', lbPerBuOf(crop)) : null
}

/** Tonnes in the crop's own unit, for pricing at a $/bu or $/lb price. */
export function fromTonnes(tonnes: number | null, crop: SCrop): number | null {
  if (tonnes == null) return null
  const m = massUnit(crop.yield_unit ?? 'bu')
  return m ? convertMass(tonnes, 't', m, lbPerBuOf(crop)) : null
}

/* ── Deliveries, as the commissions see them ────────────────────────────── */

export type STicket = { id: string; crop_year: number; crop_id: string | null; contract_id: string | null; buyer: string | null; ticket_no: string | null; delivered_on: string; net_lb: unknown; dockage_pct: unknown; net_units: unknown; unit: string | null; bin_load_id: string | null }
export type SLoad = { id: string; crop_year: number; crop_id: string | null; contract_id: string | null; delivery_site_id: string | null; loaded_on: string; net_kg: unknown; bushels: unknown }
export type SMove = { crop_year: number; crop_id: string | null; contract_id: string | null; bushels: unknown; moved_at: string; ticket_number: string | null }
export type SContract = { id: string; buyer_contact_id: string | null; contract_number: string | null; price_per_unit: unknown }
export type SSale = { id: string; ranch: string; animal_class: string; head: unknown; sale_date: string | null; delivery_date: string | null; total_lb: unknown; total_price: unknown; buyer: string | null }

/** One sale a commission levies on: a delivery of grain, or a lot of calves. */
export type Sale = {
  date: string
  buyer: string | null
  ticket: string | null
  commodity: string
  /** Net tonnes after dockage, as the check-off is levied. Null for cattle, or a load that cannot be weighed. */
  tonnes: number | null
  head: number | null
  gross: number | null
  /** How the tonnes and the value were arrived at. */
  basis: string
}

const fmtPrice = (v: number) => `$${v.toLocaleString('en-CA', { maximumFractionDigits: 4 })}`

/**
 * Every grain delivery as the commissions levy it: the scale tickets (the
 * buyer's net, after dockage where the ticket gives no settlement figure),
 * farm loads weighed straight to a buyer with no ticket matched, and bin
 * deliveries with no ticket — counted once each, as the deliveries report
 * does. Valued at the contract's price, else the crop's price for its year.
 */
export function grainSales(
  d: { tickets: STicket[]; loads: SLoad[]; moves: SMove[]; contracts: SContract[]; crops: SCrop[]; prices: PriceRow[] },
  n: { buyer: (contactId: string | null) => string | null; site: (id: string | null) => string | null; currentYear: number },
): (Sale & { cropName: string })[] {
  const cropById = new Map(d.crops.map((c) => [c.id, c]))
  const contractById = new Map(d.contracts.map((c) => [c.id, c]))
  const out: (Sale & { cropName: string })[] = []

  const priced = (crop: SCrop, cropYear: number, contractId: string | null, tonnes: number | null): { gross: number | null; basis: string } => {
    const c = contractId ? contractById.get(contractId) : undefined
    const unit = crop.yield_unit ?? 'bu'
    const qty = fromTonnes(tonnes, crop)
    const cp = num(c?.price_per_unit)
    if (cp != null && qty != null) return { gross: cents(qty * cp), basis: `contract ${c?.contract_number ?? ''} price ${fmtPrice(cp)}/${unit}`.replace('  ', ' ') }
    const r = resolvePrice(crop.id, cropYear, d.prices, { currentYear: n.currentYear })
    if (r.value != null && qty != null) return { gross: cents(qty * r.value), basis: `${r.label} ${fmtPrice(r.value)}/${unit}` }
    return { gross: null, basis: 'no price to value it at' }
  }
  const contractBuyer = (contractId: string | null) => {
    const c = contractId ? contractById.get(contractId) : undefined
    return c ? n.buyer(c.buyer_contact_id) : null
  }
  const push = (crop: SCrop | undefined, o: { date: string; buyer: string | null; ticket: string | null; cropYear: number; contractId: string | null; tonnes: number | null; how: string }) => {
    if (!crop) return
    const p = priced(crop, o.cropYear, o.contractId, o.tonnes)
    out.push({ date: o.date.slice(0, 10), buyer: o.buyer, ticket: o.ticket, commodity: crop.name, cropName: crop.name, tonnes: o.tonnes == null ? null : Math.round(o.tonnes * 1000) / 1000, head: null, gross: p.gross, basis: `${o.how}; ${p.basis}` })
  }

  const settled = new Set(d.tickets.map((t) => t.bin_load_id).filter(Boolean))
  const ticketNos = new Set(d.tickets.map((t) => (t.ticket_no ?? '').trim()).filter(Boolean))
  for (const t of d.tickets) {
    const crop = t.crop_id ? cropById.get(t.crop_id) : undefined
    if (!crop) continue
    const stated = num(t.net_units)
    const netLb = num(t.net_lb)
    const dockage = num(t.dockage_pct)
    let tonnes: number | null = null
    let how = 'ticket has no weight'
    if (stated != null && t.unit) {
      // The ticket's own settlement quantity: shrink and dockage already off.
      const bu = crop.yield_unit === 'bu'
      const inUnit = netInUnit({ net_lb: netLb, net_stated: stated, net_stated_unit: t.unit }, bu ? 'bu' : 'lbs', crop.name)
      tonnes = toTonnes(inUnit, bu ? 'bu' : 'lb', crop)
      if (tonnes != null) how = 'ticket’s settlement net'
    }
    if (tonnes == null && netLb != null) {
      tonnes = convertMass(netLb, 'lb', 't', null)! * (1 - (dockage ?? 0) / 100)
      how = dockage ? `ticket weight less ${dockage}% dockage` : 'ticket weight'
    }
    push(crop, { date: t.delivered_on, buyer: t.buyer ?? contractBuyer(t.contract_id), ticket: t.ticket_no, cropYear: t.crop_year, contractId: t.contract_id, tonnes, how })
  }
  for (const l of d.loads) {
    if (settled.has(l.id)) continue
    const crop = l.crop_id ? cropById.get(l.crop_id) : undefined
    if (!crop) continue
    const kg = num(l.net_kg)
    const tonnes = kg != null ? kg / 1000 : toTonnes(num(l.bushels), 'bu', crop)
    push(crop, { date: l.loaded_on, buyer: contractBuyer(l.contract_id) ?? n.site(l.delivery_site_id), ticket: null, cropYear: l.crop_year, contractId: l.contract_id, tonnes, how: 'our scale, no buyer ticket matched' })
  }
  for (const m of d.moves) {
    if (m.ticket_number && ticketNos.has(m.ticket_number.trim())) continue
    const crop = m.crop_id ? cropById.get(m.crop_id) : undefined
    if (!crop) continue
    const ticket = m.ticket_number && !m.ticket_number.startsWith('load:') ? m.ticket_number : null
    push(crop, { date: m.moved_at, buyer: contractBuyer(m.contract_id), ticket, cropYear: m.crop_year, contractId: m.contract_id, tonnes: toTonnes(num(m.bushels), 'bu', crop), how: 'bin delivery, bushels at the crop’s bushel weight' })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Calf sales as the beef service charge sees them: a lot a row, on the day the cattle were delivered (when it is taken). */
export function cattleSales(sales: SSale[]): Sale[] {
  return sales
    .filter((s) => s.delivery_date || s.sale_date)
    .map((s) => {
      const head = num(s.head)
      const gross = num(s.total_price)
      return {
        date: (s.delivery_date ?? s.sale_date)!,
        buyer: s.buyer,
        ticket: null,
        commodity: `${s.ranch} ${s.animal_class}`,
        tonnes: null,
        head,
        gross,
        basis: s.delivery_date ? 'delivered' : 'sale date; no delivery date recorded',
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/* ── The report ─────────────────────────────────────────────────────────── */

export const STATUS_ESTIMATE = 'Estimate'

export const REFUND_COLUMNS: ReportColumn[] = [
  { label: 'Date' },
  { label: 'Buyer' },
  { label: 'Ticket no.' },
  { label: 'Settlement no.' },
  { label: 'Commodity' },
  { label: 'Net tonnes', decimals: 3 },
  { label: 'Head', decimals: 0 },
  { label: 'Gross value', decimals: 2, money: true },
  { label: 'Check-off', decimals: 2, money: true },
  { label: 'Deducted per settlement', decimals: 2, money: true },
  { label: 'Refund claimable', decimals: 2, money: true },
  { label: 'Status' },
  { label: 'How it was worked out' },
]

export type Section = { commission: Commission; period: Period; rows: Cell[][]; totals: Cell[]; checkoff: number; refund: number; count: number; unknown: number }

/** One commission's sales in one period, as rows with their check-off and refund, and the period's totals. */
export function refundSection(c: Commission, period: Period, sales: (Sale & { cropName?: string })[]): Section {
  const mine = sales.filter((s) => s.date >= period.start && s.date <= period.end)
  let tonnes = 0
  let head = 0
  let gross = 0
  let checkoff = 0
  let refund = 0
  let unknown = 0
  const rows = mine.map((s) => {
    const crop = s.cropName ?? s.commodity
    const rate = c.rateFor(crop, s.date)
    const co = rate ? checkoffOn(rate, s) : null
    const rf = rate ? refundOn(c, crop, s) : null
    const refundRate = c.refundFor?.(crop, s.date)
    tonnes += s.tonnes ?? 0
    head += s.head ?? 0
    gross += s.gross ?? 0
    checkoff += co ?? 0
    refund += rf ?? 0
    if (rate && co == null) unknown++
    // Settlement no. and what the settlement deducted: never held, left to fill in.
    return [s.date, s.buyer, s.ticket, null, s.commodity, s.tonnes, s.head, s.gross, co, null, rf, STATUS_ESTIMATE, [rate ? `${rateLabel(rate)}${refundRate ? `, ${rateLabel(refundRate)} refundable` : ''}` : 'no check-off on this date', s.basis].join('; ')] as Cell[]
  })
  const totals: Cell[] = ['Total', null, `${mine.length} sale${mine.length === 1 ? '' : 's'}`, null, null, tonnes || null, head || null, gross || null, cents(checkoff) || null, null, cents(refund) || null, mine.length ? STATUS_ESTIMATE : null, unknown ? `${unknown} not worked out` : null]
  return { commission: c, period, rows, totals, checkoff: cents(checkoff), refund: cents(refund), count: mine.length, unknown }
}

/** The filing note under a section: the deadline, whether it has passed, how to file and the link. */
export function filingNote(c: Commission, p: Period, today: string): string {
  const past = p.deadline < today
  return [
    `Refund period ${p.label}. ${past ? 'Deadline passed' : 'File by'} ${longDate(p.deadline)}.`,
    c.howToFile,
    c.link,
    'Your producer number, SIN or business number and GST number: fill in on the form.',
  ]
    .filter(Boolean)
    .join(' ')
}

export async function gatherCheckoffRefunds(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const pick: PeriodPick = p.period === 'latest' || p.period === 'year' ? p.period : 'current'
  const year = yearParam(p, ctx)
  const which = p.commission && p.commission !== 'all' ? commissionByKey(p.commission) : null
  const commissions = which ? [which] : COMMISSIONS
  const plan = commissions.map((c) => ({ c, periods: periodsFor(c, pick, year, ctx.today) }))
  const all = plan.flatMap((x) => x.periods)
  if (!all.length) throw new Error('No refund period covers today.')
  const from = all.reduce((m, x) => (x.start < m ? x.start : m), all[0].start)
  const to = all.reduce((m, x) => (x.end > m ? x.end : m), all[0].end)
  const wantGrain = commissions.some((c) => c.key !== 'beef')
  const wantCattle = commissions.some((c) => c.key === 'beef')

  const none = Promise.resolve([] as never[])
  const [tickets, loads, moves, contracts, crops, prices, sites, contacts, sales] = await Promise.all([
    wantGrain
      ? fetchAll<STicket>((a, b) => supabase.from('scale_tickets').select('id, crop_year, crop_id, contract_id, buyer, ticket_no, delivered_on, net_lb, dockage_pct, net_units, unit, bin_load_id').gte('delivered_on', from).lte('delivered_on', to).order('id').range(a, b))
      : none,
    wantGrain
      ? fetchAll<SLoad>((a, b) =>
          supabase.from('bin_loads').select('id, crop_year, crop_id, contract_id, delivery_site_id, loaded_on, net_kg, bushels').not('delivery_site_id', 'is', null).gte('loaded_on', from).lte('loaded_on', to).order('id').range(a, b),
        )
      : none,
    wantGrain
      ? fetchAll<SMove>((a, b) =>
          supabase
            .from('grain_movements')
            .select('crop_year, crop_id, contract_id, bushels, moved_at, ticket_number')
            .eq('movement_type', 'delivery_out')
            .gte('moved_at', from)
            .lte('moved_at', `${to}T23:59:59`)
            .order('id')
            .range(a, b),
        )
      : none,
    wantGrain ? fetchAll<SContract>((a, b) => supabase.from('contracts').select('id, buyer_contact_id, contract_number, price_per_unit').order('id').range(a, b)) : none,
    wantGrain ? fetchAll<SCrop>((a, b) => supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu').order('id').range(a, b)) : none,
    wantGrain ? fetchAll<PriceRow>((a, b) => supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit').order('id').range(a, b)) : none,
    wantGrain ? fetchAll<{ id: string; name: string }>((a, b) => supabase.from('delivery_sites').select('id, name').order('id').range(a, b)) : none,
    wantGrain ? fetchAll<{ id: string; company: string | null; contact_name: string | null }>((a, b) => supabase.from('contacts').select('id, company, contact_name').order('id').range(a, b)) : none,
    wantCattle ? fetchAll<SSale>((a, b) => supabase.from('cattle_sales').select('id, ranch, animal_class, head, sale_date, delivery_date, total_lb, total_price, buyer').order('id').range(a, b)) : none,
  ])
  const siteById = new Map(sites.map((s) => [s.id, s.name]))
  const contactById = new Map(contacts.map((c) => [c.id, c.company ?? c.contact_name]))
  const grain = grainSales(
    { tickets, loads, moves, contracts, crops, prices },
    { buyer: (id) => (id ? (contactById.get(id) ?? null) : null), site: (id) => (id ? (siteById.get(id) ?? null) : null), currentYear: ctx.cropYear },
  )
  const calves = cattleSales(sales)
  const noCheckoff = [...new Set(grain.filter((g) => !commissionFor(g.cropName)).map((g) => g.cropName))].sort()

  const sections = plan.flatMap(({ c, periods }) => periods.map((per) => refundSection(c, per, c.key === 'beef' ? calves : grain.filter((g) => commissionFor(g.cropName)?.key === c.key))))
  const groups: ReportGroup[] = sections.map((s) => ({
    title: `${s.commission.name} · ${s.period.label}`,
    note: filingNote(s.commission, s.period, ctx.today),
    rows: s.rows,
    totals: s.count ? s.totals : undefined,
    empty: 'No deliveries or sales recorded in this period.',
  }))
  const refund = cents(sections.reduce((t, s) => t + s.refund, 0))
  const checkoff = cents(sections.reduce((t, s) => t + s.checkoff, 0))

  const summary = [
    'Each commission’s refund period, with every delivery or sale in it and the check-off on it. The app keeps scale tickets and loads, not settlement statements, so every check-off is an estimate: net tonnes (or the gross value, or head) times the commission’s rate. Copy the settlement number and what was actually deducted off each settlement before filing, and claim what the settlements show.',
    'Gross value is at the contract’s price where the load went on a contract, else the crop’s price for its year: an estimate of the settlement, before freight and other deductions.',
    'Producer number, SIN or business number and GST number are never filled in: add them on each commission’s form.',
  ]
  if (noCheckoff.length) summary.push(`Also delivered, with no Alberta check-off to claim: ${noCheckoff.join(', ')}.`)
  summary.push(
    'Not refundable, and so not claimed here: the $2.50 a head national beef levy (Canadian Beef Check-Off) inside ABP’s $4.50. The federal wheat and barley levy ended on 31 July 2017; nothing else national comes off Alberta grain settlements.',
  )

  const label = pick === 'year' ? `Refund periods closing in ${year}` : pick === 'current' ? 'The period open now' : 'Latest closed refund period'
  return {
    title: 'Check-off refund requests',
    subtitle: `${label} · ${which ? which.name : 'All commissions'}`,
    meta: [
      ['Producer', farmBrand().farmName],
      ['Producer number', ''],
      ['SIN or business number', ''],
      ['GST number', ''],
      ['Sales', sections.reduce((t, s) => t + s.count, 0)],
      ['Check-off (estimate)', `$${checkoff.toLocaleString('en-CA', { minimumFractionDigits: 2 })}`],
      ['Refund claimable (estimate)', `$${refund.toLocaleString('en-CA', { minimumFractionDigits: 2 })}`],
    ],
    summary,
    columns: REFUND_COLUMNS,
    groups,
    groupLabel: 'Commission · period',
    orientation: 'landscape',
    filename: `Check-off refunds ${which?.key ?? 'all'} ${pick === 'year' ? year : (all[0]?.end ?? ctx.today)}`,
  }
}
