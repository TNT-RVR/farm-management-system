import { supabase } from '@/lib/supabase'
import { useAllCropInputs } from '@/lib/forecast-data'
import { resolveCosts } from '@/lib/forecast'
import { isOffTheTop, type LandDeal } from '@/lib/land-deals'
import { isFallow } from '@/lib/agristability-codes'
import { boundariesForYear, useAllBoundaries, type CropInputRow, type CropRow } from '@/lib/queries'
import { farmBrand } from '@/lib/farm-setup'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, fieldLabel, longDate, num, type Cell, type GatherContext, type ParamValues, type ReportData } from './framework'
import { useCropBooks, type BookRow, type CropBooks } from './crop-books'
import { usePlanRows } from './plan'
import { ourSales } from './agristability-form'
import { gatherGrainInventory } from './grain-inventory'
import { isCalfClass, loadHerd, type HerdRow } from './herd'
import { gatherEquipment } from './equipment'
import { gatherLeasePayments, LEASE_COLUMNS } from './lease-payments'
import { gatherTrucking, TRUCKING_COLUMNS } from './trucking'
import { costsFor } from './cow-cost'
import { useReportBooks, type ReportBooks } from './books'
import { fetchedLabel, lenderBooks } from './lender-books'
import {
  blankFlow,
  blankLine,
  calendarShares,
  COST_TIMING,
  DEFAULT_CROP_SHARES,
  expectedCalves,
  flowLine,
  lenderReview,
  LSTATUS,
  naLine,
  restrictedLine,
  saleShares,
  sharesAfter,
  sharesText,
  valued,
  yearPart,
  type FlowLine,
  type LenderParts,
  type Line,
  type Shares,
  type Sheet,
} from './lender-review'

/**
 * Reading the lender review: every figure comes through a read the app
 * already makes — the crop books (the Financials plan and the P&L Map) for
 * the statement year and the plan year, the grain inventory, the herd, the
 * fleet, the leases and the trucking reports — plus a handful of small
 * lists nothing else gathers (pivots, scale-ticket dates, feed on hand,
 * bins, pastures, cow costs). Each is read through the ordinary client, so
 * the database's own access rules apply; a read that is refused shows its
 * lines as restricted rather than stopping the file.
 *
 * With QuickBooks connected and an owner or the accountant asking, the real
 * books come first (lender-books.ts): the fiscal year's income statement,
 * the balance sheet at its year end and their ratios.
 */

type Got<T> = { ok: true; data: T } | { ok: false; empty: boolean; restricted: boolean; message: string }

const RESTRICTED = /permission|denied|not allowed|row-level|42501|jwt|unauthori[sz]ed/i

/** A read that may come back empty ("No grain in any bin…") or refused, without stopping the rest. */
async function attempt<T>(f: () => Promise<T>): Promise<Got<T>> {
  try {
    return { ok: true, data: await f() }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, empty: /^No /.test(message), restricted: RESTRICTED.test(message), message }
  }
}

/** The line to show when a read failed: restricted, or blank saying why. */
const failedLine = (item: string, g: Extract<Got<unknown>, { ok: false }>, ifEmpty: string): Line =>
  g.restricted ? restrictedLine(item, 'Not open to you in the app: ask an owner.') : blankLine(item, g.empty ? ifEmpty : `Could not be read (${g.message}): fill in.`)

const n0 = (v: Cell | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const colOf = (cols: { label: string }[], label: string) => cols.findIndex((c) => c.label === label)
const plural = (k: number, w: string) => `${k.toLocaleString('en-CA')} ${w}${k === 1 ? '' : 's'}`
const isFed = (c: CropRow) => c.own_use || c.category === 'own_use'
/** A crop we sell: not fed on the farm, not fallow, not land rented out for cash (its rent is the lease's). */
const sold = (c: CropRow | null): c is CropRow => !!c && !isFed(c) && !isFallow(c) && !c.land_rent_only

type Extras = {
  pivots: Set<string>
  tickets: { crop_id: string | null; crop_year: number; delivered_on: string; net_lb: unknown; net_units: unknown }[]
  feed: { ranch_id: string; feed_name: string; remaining_lb: unknown; is_bedding: boolean; unweighed_lines: number }[]
  bins: { id: string; name: string; site: string | null; capacity_bu: unknown; active: boolean; usual_contents: string }[]
  pastures: { name: string; legal_description: string | null; area_acres: unknown }[]
  cowCosts: (Record<string, unknown> & { ranch: string; crop_year: number })[]
  setup: { calf_sale_weight_lb: unknown; calf_sale_month: number | null } | null
}

async function readExtras(planYear: number): Promise<Got<Extras>[]> {
  const one = <T>(f: () => Promise<T>) => attempt(f)
  const q = async <T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p
    if (error) throw new Error(error.message)
    return (data ?? []) as T
  }
  const [pivots, tickets, feed, bins, pastures, cowCosts, setup] = await Promise.all([
    one(() => fetchAll<{ field_id: string }>((a, b) => supabase.from('field_pivots').select('field_id').eq('not_used', false).order('id').range(a, b))),
    one(() => fetchAll<Extras['tickets'][number]>((a, b) => supabase.from('scale_tickets').select('crop_id, crop_year, delivered_on, net_lb, net_units').order('id').range(a, b))),
    one(() => q<Extras['feed']>(supabase.from('feed_on_hand').select('ranch_id, feed_name, remaining_lb, is_bedding, unweighed_lines'))),
    one(() => q<Extras['bins']>(supabase.from('bins').select('id, name, site, capacity_bu, active, usual_contents').order('name'))),
    one(() => q<Extras['pastures']>(supabase.from('pastures').select('name, legal_description, area_acres').order('name'))),
    one(() => fetchAll<Extras['cowCosts'][number]>((a, b) => supabase.from('cattle_cost_assumptions').select('*').lte('crop_year', planYear).order('crop_year', { ascending: false }).order('id').range(a, b))),
    one(() => q<Extras['setup'][]>(supabase.from('farm_setup').select('calf_sale_weight_lb, calf_sale_month').limit(1))),
  ])
  return [pivots, tickets, feed, bins, pastures, cowCosts, setup] as unknown as Got<Extras>[]
}

const dataOr = <T>(g: Got<T>, fallback: T): T => (g.ok ? g.data : fallback)

/** Land we rent from its owner in the year, on the field (any crop). */
function rentedIn(deals: LandDeal[], fieldId: string, year: number): LandDeal | null {
  return (
    deals.find(
      (d) => d.direction !== 'out' && d.active && d.field_ids.includes(fieldId) && (!d.start_date || d.start_date <= `${year}-12-31`) && (!d.end_date || d.end_date >= `${year}-01-01`),
    ) ?? null
  )
}

/** The lease report's rows as dated amounts, by direction. */
function leaseCash(r: ReportData): { dir: 'in' | 'out'; due: string | null; amount: number | null; owing: number | null; yearsRent: number | null; landlord: string }[] {
  const due = colOf(LEASE_COLUMNS, 'Due')
  const amount = colOf(LEASE_COLUMNS, 'Amount')
  const owing = colOf(LEASE_COLUMNS, 'Owing')
  const yearsRent = colOf(LEASE_COLUMNS, 'Year’s rent')
  return r.groups.flatMap((g) =>
    g.rows.map((row) => ({
      // Rent on our land rented out comes in; rent on land we rent goes out.
      dir: g.title === 'Our land rented out' ? ('in' as const) : ('out' as const),
      due: typeof row[due] === 'string' ? (row[due] as string) : null,
      amount: n0(row[amount]),
      owing: n0(row[owing]),
      yearsRent: n0(row[yearsRent]),
      landlord: String(row[0] ?? ''),
    })),
  )
}

/* ── The statement ──────────────────────────────────────────────────────── */

type Inv = { crop: string; cropYear: number | null; bin: string; site: string | null; bu: number | null; value: number | null; from: string | null }

function inventoryRows(r: ReportData): Inv[] {
  return r.groups.flatMap((g) =>
    g.rows.map((c) => ({ crop: g.title, cropYear: c[2] != null ? Number(c[2]) : null, bin: String(c[0] ?? 'Bin'), site: (c[1] as string | null) ?? null, bu: n0(c[3]), value: n0(c[8]), from: (c[9] as string | null) ?? null })),
  )
}

const females = (h: HerdRow) => h.feed_class === 'cow' || h.feed_class === 'bred_heifer'
const cowsOnly = (h: HerdRow) => h.feed_class === 'cow' || /\bcows?\b/i.test(h.class_name)

export type LenderReads = {
  ctx: GatherContext
  asOf: string
  planYear: number
  booksNow: CropBooks
  booksPlan: CropBooks
  planRows: ReturnType<typeof usePlanRows>
  nowRows: ReturnType<typeof usePlanRows>
  inputs: CropInputRow[]
  acresByField: Map<string, number>
  /** QuickBooks for the fiscal year ended by the statement date, or why not. */
  books: ReportBooks
}

export async function buildLenderReview(r: LenderReads): Promise<ReturnType<typeof lenderReview>> {
  const { ctx, asOf, planYear, booksNow, booksPlan } = r
  const asOfYear = Number(asOf.slice(0, 4))
  const currentYear = Number(ctx.today.slice(0, 4))
  const [inv, herd, fleet, leasesNow, leasesPlan, trucking, extras] = await Promise.all([
    attempt(() => gatherGrainInventory({ asOf }, ctx)),
    attempt(() => loadHerd(asOf)),
    attempt(() => gatherEquipment({ year: String(asOfYear) }, ctx)),
    attempt(() => gatherLeasePayments({ year: String(asOfYear) }, ctx)),
    attempt(() => gatherLeasePayments({ year: String(planYear) }, ctx)),
    attempt(() => gatherTrucking({ year: String(planYear) }, ctx)),
    readExtras(planYear),
  ])
  const [pivotsG, ticketsG, feedG, binsG, pasturesG, cowCostsG, setupG] = extras as [Got<{ field_id: string }[]>, Got<Extras['tickets']>, Got<Extras['feed']>, Got<Extras['bins']>, Got<Extras['pastures']>, Got<Extras['cowCosts']>, Got<Extras['setup'][]>]
  const irrigated = new Set(dataOr(pivotsG, []).map((p) => p.field_id))
  const setup = dataOr(setupG, [])[0] ?? null
  const crops = r.planRows.crops ?? []
  const cropByName = new Map(crops.map((c) => [c.name, c]))
  const ranchName = new Map((herd.ok ? herd.data.ranches : []).map((x) => [x.id, x.name]))
  const lead: string[] = []
  const qb = r.books.ok ? lenderBooks({ pl: r.books.pl, plFetched: r.books.plFetched, bs: r.books.bs, bsFetched: r.books.bsFetched, overrides: r.books.overrides, fyLabel: r.books.fy.label }) : null
  if (r.books.ok && r.books.bsNote) lead.push(r.books.bsNote)
  // The books' balance sheet on the statement date itself fills cash and payables; on another date it stands on its own.
  const sameDay = qb?.balance?.asOf === asOf ? qb.balance : null
  const bookLine = (key: string) => (sameDay ? (sameDay.groups.find((g) => g.key === key)?.total ?? null) : null)
  const fromBooks = r.books.ok ? `From QuickBooks, ${fetchedLabel(r.books.bsFetched)}: the balance sheet on the same date, at book value.` : ''
  if (qb?.balance && !sameDay) lead.push(`The books’ balance sheet is at the fiscal year end (${longDate(qb.balance.asOf)}); the app’s statement is on ${longDate(asOf)}. Set the statement date to the year end to fill cash and payables from the books.`)

  // How each crop sells, from its deliveries in finished crop years.
  const tickets = dataOr(ticketsG, [])
  const sharesFor = new Map<string, { shares: Shares; basis: string }>()
  const shareOf = (cropId: string | null | undefined): { shares: Shares; basis: string } => {
    const k = cropId ?? ''
    if (sharesFor.has(k)) return sharesFor.get(k)!
    const mine = tickets.filter((t) => t.crop_id === cropId && t.crop_year < currentYear)
    const s = saleShares(mine.map((t) => ({ cropYear: t.crop_year, on: t.delivered_on, qty: num(t.net_lb) ?? num(t.net_units) ?? 0 })))
    const years = [...new Set(mine.map((t) => t.crop_year))].sort()
    const out = s
      ? { shares: s, basis: `the farm’s own deliveries: ${plural(mine.length, 'scale ticket')}, crop years ${years[0]}${years.length > 1 ? `-${years[years.length - 1]}` : ''}` }
      : { shares: DEFAULT_CROP_SHARES, basis: ticketsG.ok ? 'no delivery history: the stated default' : 'scale tickets could not be read: the stated default' }
    sharesFor.set(k, out)
    return out
  }

  /* Current assets */
  const ca: Line[] = [
    bookLine('BankAccounts') != null
      ? { item: 'Cash and bank accounts', value: Math.round(bookLine('BankAccounts')!), status: LSTATUS.filled, note: fromBooks }
      : blankLine('Cash and bank accounts', 'Balances on the statement date, from the bank statements. Never kept in the app.'),
  ]
  ca.push(blankLine('AgriInvest and other savings', 'The AgriInvest balance and any farm savings or investments, from the statements.'))
  const invRows = inv.ok ? inventoryRows(inv.data) : []
  if (inv.ok) {
    for (const g of inv.data.groups) {
      const rows = invRows.filter((x) => x.crop === g.title)
      const bu = rows.reduce((s, x) => s + (x.bu ?? 0), 0)
      const value = n0(g.totals?.[8])
      const missing = rows.filter((x) => x.bu == null || x.value == null).length
      const from = [...new Set(rows.map((x) => x.from).filter(Boolean))].slice(0, 2).join('; ')
      ca.push(
        valued(`Grain in the bins: ${g.title}`, value, LSTATUS.estimate, `The bins’ ledger on the date (Year-end grain inventory), at market: ${from}.`, 'In the bins but no bushels or no price: measure it and price it.', {
          detail: plural(rows.length, 'bin'),
          qty: bu || null,
          unit: 'bu',
          partial: missing > 0 && value != null,
        }),
      )
    }
  } else if (inv.empty) {
    ca.push({ item: 'Grain in the bins', value: 0, status: LSTATUS.filled, note: `No grain in any bin on ${longDate(asOf)} (the bins’ ledger).` })
  } else ca.push(failedLine('Grain in the bins', inv, ''))

  // The statement year's crop not yet off the scale: an estimate, apart.
  const inField = booksNow.year === asOfYear ? booksNow.rows.filter((x) => sold(x.crop) && x.yieldFrom !== 'actual' && x.acres > 0) : []
  const fieldCrops = new Map<string, BookRow[]>()
  for (const x of inField) fieldCrops.set(x.crop!.name, [...(fieldCrops.get(x.crop!.name) ?? []), x])
  for (const [name, rows] of fieldCrops) {
    const known = rows.filter((x) => ourSales(x) != null)
    const v = known.length ? known.reduce((s, x) => s + ourSales(x)!, 0) : null
    ca.push(
      valued(
        `Crop still in the field: ${name}`,
        v,
        LSTATUS.estimate,
        `An estimate: the ${asOfYear} plan’s expected yield × price, our share after land deals, for fields not yet off the scale. Lenders often want it apart; replace with the harvest.`,
        'No yield or price in the plan for these fields: estimate it.',
        { detail: `${plural(rows.length, 'field')}, ${Math.round(rows.reduce((s, x) => s + x.acres, 0)).toLocaleString('en-CA')} ac`, partial: known.length < rows.length && v != null },
      ),
    )
  }
  if (!fieldCrops.size) ca.push(naLine('Crop still in the field', booksNow.year === asOfYear ? `Every field of ours for ${asOfYear} is off the scale, or nothing is planned.` : 'Not worked out for this date.'))

  const feedRows = dataOr(feedG, []).filter((f) => (num(f.remaining_lb) ?? 0) > 0)
  const feedByRanch = new Map<string, number>()
  for (const f of feedRows) feedByRanch.set(f.ranch_id, (feedByRanch.get(f.ranch_id) ?? 0) + (num(f.remaining_lb) ?? 0))
  if (!feedG.ok) ca.push(failedLine('Feed and bedding on hand', feedG, ''))
  else if (feedByRanch.size)
    for (const [ranch, lb] of feedByRanch)
      ca.push(blankLine(`Feed and bedding on hand: ${ranchName.get(ranch) ?? 'a ranch'}`, 'Counted on the Feed tab but not valued: price it at what it would sell for.', { qty: Math.round((lb / 2204.62) * 10) / 10, unit: 't' }))
  else ca.push(blankLine('Feed and bedding on hand', 'Nothing counted on the Feed tab: count it and value it.'))
  ca.push(blankLine('Inputs on hand and prepaid', 'Seed, fertilizer, chemical and supplies on hand or paid ahead for next year, at cost: supplier statements. The app counts fertilizer and chemical, it does not value them.'))

  const nowCash = leasesNow.ok ? leaseCash(leasesNow.data) : []
  const owedBy = (dir: 'in' | 'out') => nowCash.filter((x) => x.dir === dir && x.due && x.due <= asOf && (x.owing ?? 0) > 0)
  if (nowCash.some((x) => x.dir === 'in')) {
    const list = owedBy('in')
    ca.push({ item: 'Rent receivable', value: Math.round(list.reduce((s, x) => s + (x.owing ?? 0), 0)), status: LSTATUS.filled, note: list.length ? `Due by the date and not recorded as paid: ${[...new Set(list.map((x) => x.landlord))].join(', ')} (Leases).` : 'Every rent payment due to us by the date is recorded as paid (Leases).' })
  }
  ca.push(blankLine('Other accounts receivable', 'Grain and cattle cheques not yet received, deferred grain tickets, insurance claims and program payments owed to the farm.'))

  const herdRows = herd.ok ? herd.data.rows.filter((h) => Number(h.head_count) > 0) : []
  const calfPrice = herd.ok ? herd.data.calfPrice : null
  if (!herd.ok) ca.push(failedLine('Market cattle', herd, 'No herd counts are entered (Herd).'))
  for (const h of herdRows.filter(isCalfClass)) {
    const w = num(h.avg_weight_lb)
    const head = Number(h.head_count)
    const v = w != null && calfPrice != null ? head * w * calfPrice : null
    ca.push(
      valued(
        `Market cattle: ${h.class_name}`,
        v,
        LSTATUS.estimate,
        `At what the farm’s own calves sold for in ${herd.ok ? herd.data.saleYear : ''}, $${calfPrice?.toFixed(2)}/lb (pound-weighted, no weight slide).`,
        calfPrice == null ? 'No cattle sales on file to price them: value per head.' : 'No average weight on the Herd tab: value per head.',
        { detail: ranchName.get(h.ranch_id) ?? null, qty: head, unit: 'head' },
      ),
    )
  }

  /* Intermediate assets */
  const ia: Line[] = []
  for (const h of herdRows.filter((x) => !isCalfClass(x)))
    ia.push(blankLine(`Breeding stock: ${h.class_name}`, 'Value per head at market: not kept in the app (it values calves only, from their sales).', { detail: ranchName.get(h.ranch_id) ?? null, qty: Number(h.head_count), unit: 'head' }))
  if (herd.ok && !herdRows.length) ia.push(blankLine('Breeding stock', 'No herd counts on the date: count and value them.'))
  const units = fleet.ok ? fleet.data.groups.flatMap((g) => g.rows.map((row) => ({ kind: g.title, name: String(row[0] ?? 'Unnamed'), model: (row[1] as string | null) ?? null, hours: n0(row[2]) }))) : []
  ia.push(
    fleet.ok
      ? blankLine('Machinery and equipment', 'Market value of each unit: not kept in the app. Every unit is listed in the machinery schedule below.', { qty: units.length, unit: 'units', detail: [...new Set(units.map((u) => u.kind))].join(', ') })
      : failedLine('Machinery and equipment', fleet, 'No machines in the fleet yet: list each unit and its value.'),
  )
  ia.push(
    pivotsG.ok
      ? blankLine('Irrigation pivots and pumps', 'Value not kept in the app; pivots on file under Pivots & pumps.', { qty: irrigated.size || null, unit: irrigated.size ? 'fields with a pivot' : null })
      : failedLine('Irrigation pivots and pumps', pivotsG, ''),
  )
  ia.push(blankLine('Trucks, trailers and vehicles', 'Not kept apart in the app; some may be in the fleet list.'))
  ia.push(blankLine('Shares, quota and co-op equity', 'Irrigation district, co-op and other shares or equity, from their statements.'))

  /* Long-term assets */
  const la: Line[] = []
  const fields = (r.nowRows.rows ?? []).map((x) => x.field).filter((f, i, a) => a.findIndex((g) => g.id === f.id) === i)
  const deals = r.nowRows.deals ?? []
  const owned = fields.filter((f) => !rentedIn(deals, f.id, asOfYear))
  const landAcres = (id: string, rentedOut: number | null) => (r.acresByField.get(id) ?? 0) + (rentedOut ?? 0)
  const ownedAcres = owned.reduce((s, f) => s + landAcres(f.id, num(f.rented_out_acres)), 0)
  la.push(
    blankLine('Land owned', 'Market value: not kept in the app (an appraisal or recent sales). Taken as owned because no lease of land we rent covers it on the Leases page: confirm each field in the land schedule below.', {
      detail: plural(owned.length, 'field'),
      qty: Math.round(ownedAcres) || null,
      unit: 'ac',
    }),
  )
  const pastures = dataOr(pasturesG, [])
  if (pastures.length) {
    const ac = pastures.reduce((s, x) => s + (num(x.area_acres) ?? 0), 0)
    la.push(blankLine('Pasture and ranch land', 'Whether each pasture is owned or leased is not recorded: confirm, and value the owned.', { detail: plural(pastures.length, 'pasture'), qty: Math.round(ac) || null, unit: 'ac' }))
  } else la.push(blankLine('Pasture and ranch land', "Each ranch's land: acres and market value."))
  const bins = dataOr(binsG, []).filter((b) => b.active)
  la.push(
    binsG.ok
      ? blankLine('Grain bins and storage', 'Value not kept in the app. Listed in the bins schedule below.', { qty: bins.length || null, unit: 'bins', detail: `${Math.round(bins.reduce((s, b) => s + (num(b.capacity_bu) ?? 0), 0)).toLocaleString('en-CA')} bu capacity` })
      : failedLine('Grain bins and storage', binsG, ''),
  )
  la.push(blankLine('Buildings and yard sites', 'Houses, shops, barns, corrals and water systems: not kept in the app.'))

  /* Liabilities: only rent owed is held */
  const cl: Line[] = [
    blankLine('Operating line', 'Balance owing on the date, from the bank statement.'),
    bookLine('AP') != null
      ? { item: 'Accounts payable', value: Math.round(bookLine('AP')!), status: LSTATUS.filled, note: fromBooks }
      : blankLine('Accounts payable', 'Unpaid supplier invoices: the app prices what was applied, not what was billed or owed. Supplier statements.'),
  ]
  if (nowCash.some((x) => x.dir === 'out')) {
    const list = owedBy('out')
    cl.push({ item: 'Rent owed', value: Math.round(list.reduce((s, x) => s + (x.owing ?? 0), 0)), status: LSTATUS.filled, note: list.length ? `Due by the date and not recorded as paid: ${[...new Set(list.map((x) => x.landlord))].join(', ')} (Leases). Only ${asOfYear}’s payments are read.` : `Every rent payment due by the date is recorded as paid (Leases, ${asOfYear}).` })
  } else if (!leasesNow.ok && !leasesNow.empty) cl.push(failedLine('Rent owed', leasesNow, ''))
  cl.push(
    blankLine('Accrued interest', 'Interest built up but not yet paid on every loan.'),
    blankLine('Cash advances (Advance Payments Program)', 'Balance owing on any cash advance.'),
    blankLine('Current portion of term debt', 'Principal due in the next twelve months on every term loan and lease.'),
    blankLine('Taxes and other payables', 'Income tax, GST, wages and anything else owing.'),
  )
  const il: Line[] = [
    blankLine('Equipment loans and leases (one to ten years)', 'Balance on each, less the current portion: lender, rate, payment and maturity.'),
    blankLine('Other term loans (one to ten years)', 'Balance, less the current portion.'),
  ]
  const ll: Line[] = [
    blankLine('Mortgages and land loans (over ten years)', 'Balance on each, less the current portion.'),
    blankLine('Family and vendor loans', 'Any owed to family or to a seller of land.'),
  ]
  const sheet: Sheet = { currentAssets: ca, intermediateAssets: ia, longAssets: la, currentLiabilities: cl, intermediateLiabilities: il, longLiabilities: ll }

  /* Schedules */
  const schedules: ReportSection[] = [
    {
      title: 'Machinery and equipment schedule',
      note: 'The fleet (Equipment), each unit to be valued at market. Engine hours are Deere’s modem reading where it has one.',
      head: ['Kind', 'Unit', 'Make and model', 'Engine hours', 'Value ($)', 'Status'],
      rows: units.map((u) => [u.kind, u.name, u.model, u.hours, null, LSTATUS.blank]),
      empty: 'No machines in the fleet in the app.',
    },
    {
      title: 'Land schedule',
      note: `Active fields with no lease of land we rent on them in ${asOfYear}, taken as owned: confirm each. Acres are the drawn boundary (what we farm) plus any part rented out.`,
      head: ['Field', 'Legal land', 'Acres', 'Rented out (ac)', 'Irrigated', 'Value ($)', 'Status'],
      rows: owned
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((f) => [fieldLabel(f.name), f.legal_land_description, Math.round(landAcres(f.id, num(f.rented_out_acres)) * 10) / 10 || null, num(f.rented_out_acres), irrigated.has(f.id) ? 'Pivot' : 'Dryland', null, LSTATUS.blank]),
      empty: 'No field is taken as owned.',
    },
    ...(pastures.length
      ? [{ title: 'Pasture schedule', note: 'Owned or leased is not recorded: confirm.', head: ['Pasture', 'Legal land', 'Acres', 'Value ($)', 'Status'], rows: pastures.map((x) => [x.name, x.legal_description, num(x.area_acres), null, LSTATUS.blank]) }]
      : []),
    {
      title: 'Bins schedule',
      head: ['Site', 'Bin', 'Holds', 'Capacity (bu)', 'Value ($)', 'Status'],
      rows: bins.sort((a, b) => (a.site ?? '').localeCompare(b.site ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true })).map((b) => [b.site, b.name, b.usual_contents, num(b.capacity_bu), null, LSTATUS.blank]),
      empty: 'No bins in the app.',
    },
  ]

  /* Production plan */
  const planBooks = booksPlan.rows.filter((x) => x.crop && x.acres > 0)
  const byCropWater = new Map<string, BookRow[]>()
  for (const x of planBooks) {
    const k = `${x.crop!.name}|${irrigated.has(x.fieldId) ? 'Irrigated' : 'Dryland'}`
    byCropWater.set(k, [...(byCropWater.get(k) ?? []), x])
  }
  const cropRows: Cell[][] = [...byCropWater]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, rows]) => {
      const [name, water] = k.split('|')
      const c = rows[0].crop!
      const acres = rows.reduce((s, x) => s + x.acres, 0)
      const wy = rows.filter((x) => x.yieldPerAcre != null)
      const production = wy.length ? wy.reduce((s, x) => s + x.yieldPerAcre! * x.acres, 0) : null
      const yAc = wy.reduce((s, x) => s + x.acres, 0)
      const gross = rows.filter((x) => x.gross != null)
      const grossV = gross.length ? gross.reduce((s, x) => s + x.gross!, 0) : null
      const ours = rows.filter((x) => ourSales(x) != null)
      const oursV = ours.length ? ours.reduce((s, x) => s + ourSales(x)!, 0) : null
      const fallow = isFallow(c) || Boolean(c.land_rent_only)
      const fed = isFed(c)
      const missing = rows.length - ours.length
      const from = [...new Set(rows.map((x) => `${x.yieldFrom} · ${x.priceFrom}`))].join('; ')
      return [
        name,
        water,
        new Set(rows.map((x) => x.fieldId)).size,
        Math.round(acres * 10) / 10,
        yAc > 0 && production != null ? Math.round((production / yAc) * 10) / 10 : null,
        c.yield_unit,
        production != null ? Math.round(production) : null,
        rows.find((x) => x.price != null)?.price ?? null,
        fallow ? null : grossV != null ? Math.round(grossV) : null,
        fallow || fed ? null : oursV != null ? Math.round(oursV) : null,
        fallow ? LSTATUS.na : oursV == null ? LSTATUS.blank : LSTATUS.estimate,
        c.land_rent_only ? 'Rented out for cash: the rent is in the cash flow (Leases).' : fallow ? 'Fallow: nothing to sell.' : fed ? `Fed on the farm: not sold. ${from}` : `${from}${missing ? `. ${plural(missing, 'field')} with no yield or price: fill in.` : ''}`,
      ]
    })
  const noPlan = (r.planRows.rows ?? []).filter((x) => !x.plan && !x.isZone)
  const planned = (r.planRows.rows ?? []).some((x) => x.plan || x.isZone)
  const others: ReportSection[] = [
    {
      title: `Fields with nothing planned for ${planYear}`,
      note: planned ? 'Plan them on Financials, or say what they will be.' : `Nothing is planned for ${planYear} yet: every active field is listed.`,
      head: ['Field', 'Legal land', 'Map acres', 'Irrigated', 'State'],
      rows: noPlan.map((x) => [fieldLabel(x.field.name), x.field.legal_land_description, x.acres != null ? Math.round(x.acres * 10) / 10 : null, irrigated.has(x.field.id) ? 'Pivot' : 'Dryland', `Nothing planned for ${planYear}`]),
      empty: `Every active field has a crop planned for ${planYear}.`,
    },
  ]
  if (booksPlan.offBooks.length)
    others.push({
      title: 'Grown by somebody else, not on our books',
      head: ['Field', 'Crop', 'Acres', 'Why'],
      rows: booksPlan.offBooks.map((o) => [fieldLabel(o.field), o.crop, o.acres != null ? Math.round(o.acres) : null, o.why]),
    })

  // The herd and the calves it should sell.
  const cowCosts = dataOr(cowCostsG, [])
  const saleWeight = num(setup?.calf_sale_weight_lb) ?? (herd.ok ? herd.data.soldAt : null)
  const herdPlan: Cell[][] = []
  const calfLines: { ranch: string; calves: number | null; revenue: number | null; note: string }[] = []
  for (const ranch of herd.ok ? herd.data.ranches : []) {
    const rows = herdRows.filter((h) => h.ranch_id === ranch.id)
    if (!rows.length) continue
    for (const h of rows) herdPlan.push([ranch.name, h.class_name, Number(h.head_count), num(h.avg_weight_lb), null, null, null, LSTATUS.filled, 'Herd counts on the statement date.'])
    const fem = rows.filter(females).reduce((s, h) => s + Number(h.head_count), 0)
    const costs = costsFor(cowCosts, ranch.name, planYear)
    const calves = expectedCalves(fem, costs?.weaning_rate_pct ?? null, costs?.death_loss_pct ?? null)
    const revenue = calves != null && saleWeight != null && calfPrice != null ? calves * saleWeight * calfPrice : null
    const note = [
      `${plural(fem, 'cow')} and bred heifers`,
      costs?.weaning_rate_pct != null ? `× ${costs.weaning_rate_pct}% weaned × ${100 - (costs.death_loss_pct ?? 0)}% after death loss${costs.death_loss_pct == null ? ' (none entered)' : ''}` : 'no weaning rate on Cattle settings → Costs',
      saleWeight != null ? `at ${Math.round(saleWeight)} lb` : 'no sale weight on Farm setup',
      calfPrice != null ? `× $${calfPrice.toFixed(2)}/lb (own ${herd.ok ? herd.data.saleYear : ''} sales)` : 'no calf sales to price them',
      'before keeping replacement heifers: take those off',
    ].join(', ')
    calfLines.push({ ranch: ranch.name, calves, revenue, note })
    herdPlan.push([ranch.name, `Calves to sell in ${planYear}`, calves != null ? Math.round(calves) : null, saleWeight, calfPrice != null ? Math.round(calfPrice * 100) / 100 : null, revenue != null ? Math.round(revenue) : null, null, calves == null || revenue == null ? LSTATUS.blank : LSTATUS.estimate, note])
  }
  others.push({
    title: `Herd and calf sales for ${planYear}`,
    head: ['Ranch', 'Class', 'Head', 'Weight (lb)', 'Price ($/lb)', 'Revenue ($)', 'Detail', 'Status', 'How'],
    rows: herdPlan,
    empty: herd.ok ? 'No herd counts on the statement date.' : herd.restricted ? 'Restricted: the herd is not open to you.' : 'The herd could not be read.',
  })

  /* Cash flow */
  const flow: FlowLine[] = []
  const timing: Cell[][] = []
  const after = (s: Shares, hy: number) => yearPart(s, hy, planYear)
  const outsideNote = (fr: number[], amount: number) => {
    const inside = fr.reduce((a, b) => a + b, 0)
    return inside < 0.995 ? ` $${Math.round(amount * (1 - inside)).toLocaleString('en-CA')} of it sells outside ${planYear} and is left out.` : ''
  }
  // Grain on hand on the statement date, sold through the year.
  const invGroups = new Map<string, Inv[]>()
  for (const x of invRows) invGroups.set(`${x.crop}|${x.cropYear ?? asOfYear}`, [...(invGroups.get(`${x.crop}|${x.cropYear ?? asOfYear}`) ?? []), x])
  for (const [k, rows] of invGroups) {
    const [crop, y] = k.split('|')
    const hy = Number(y)
    const v = rows.filter((x) => x.value != null).reduce((s, x) => s + x.value!, 0)
    const sh = shareOf(cropByName.get(crop)?.id)
    const fr = after(sharesAfter(sh.shares, hy, asOf), hy)
    flow.push(flowLine('in', `Grain on hand sold: ${crop} (${hy} crop)`, v || null, fr, LSTATUS.estimate, `In the bins on ${longDate(asOf)} at market, sold as ${sh.basis}.${outsideNote(fr, v)}`, 'No value on the grain in the bins.'))
  }
  for (const [name, rows] of fieldCrops) {
    const v = rows.filter((x) => ourSales(x) != null).reduce((s, x) => s + ourSales(x)!, 0)
    const sh = shareOf(rows[0].crop!.id)
    const fr = after(sharesAfter(sh.shares, asOfYear, asOf), asOfYear)
    flow.push(flowLine('in', `${asOfYear} crop still in the field sold: ${name}`, v || null, fr, LSTATUS.estimate, `Expected value, sold as ${sh.basis}.${outsideNote(fr, v)}`, 'No yield or price for the fields.'))
  }
  // The plan year's crop, at our share.
  const planCrops = new Map<string, BookRow[]>()
  for (const x of planBooks) if (sold(x.crop)) planCrops.set(x.crop.name, [...(planCrops.get(x.crop.name) ?? []), x])
  for (const [name, rows] of [...planCrops].sort((a, b) => a[0].localeCompare(b[0]))) {
    const known = rows.filter((x) => ourSales(x) != null)
    const v = known.reduce((s, x) => s + ourSales(x)!, 0)
    const sh = shareOf(rows[0].crop!.id)
    const fr = after(sh.shares, planYear)
    const line = flowLine('in', `${planYear} crop sold: ${name}`, known.length ? v : null, fr, LSTATUS.estimate, `The plan’s yield × price, our share after land deals, sold as ${sh.basis}.${outsideNote(fr, v)}`, `No yield or price for ${name} in the ${planYear} plan.`)
    if (known.length < rows.length && line.value != null) line.partial = true
    flow.push(line)
    timing.push([`${name} sales`, sharesText(sh.shares), sh.basis])
  }
  for (const [k, v] of sharesFor) if (![...planCrops.values()].some((rows) => rows[0].crop!.id === k)) timing.push([`${crops.find((c) => c.id === k)?.name ?? 'Grain'} sales`, sharesText(v.shares), v.basis])

  // Calves.
  const sales = herd.ok ? herd.data.sales : []
  const calfMonth = setup?.calf_sale_month ?? null
  const fromHistory = calendarShares(sales.map((s) => ({ on: s.delivery_date ?? s.sale_date, qty: s.head ?? 0 })))
  const calfQ: [number, number, number, number] = calfMonth ? ([0, 1, 2, 3].map((q) => (Math.floor((calfMonth - 1) / 3) === q ? 1 : 0)) as [number, number, number, number]) : (fromHistory ?? [0, 0, 0, 1])
  const calfBasis = calfMonth ? `Farm setup’s calf sale month (${calfMonth})` : fromHistory ? 'the farm’s own calf sales by delivery date' : 'no sales history: Q4, the fall run'
  for (const c of calfLines) flow.push(flowLine('in', `Calf sales: ${c.ranch}`, c.revenue, calfQ, LSTATUS.estimate, `${c.note}. Sold ${calfBasis}.`, `Expected calves not worked out: ${c.note}.`))
  timing.push(['Calf sales', calfQ.map((x, i) => (x ? `Q${i + 1} ${Math.round(x * 100)}%` : null)).filter(Boolean).join(', '), calfBasis])
  if (!herd.ok) flow.push(blankFlow('in', 'Calf sales', herd.restricted ? 'Restricted: the herd is not open to you.' : 'The herd could not be read: fill in.'))
  flow.push(blankFlow('in', 'Cull cow and bull sales', 'Head and price expected: not planned in the app.'))

  // Rent, on the leases' payment dates.
  const planCash = leasesPlan.ok ? leaseCash(leasesPlan.data) : []
  const rentFlow = (dir: 'in' | 'out', item: string) => {
    const dated = planCash.filter((x) => x.dir === dir && x.due && x.amount != null)
    const undated = planCash.filter((x) => x.dir === dir && !x.due && x.yearsRent != null)
    if (!dated.length && !undated.length) return
    const total = dated.reduce((s, x) => s + x.amount!, 0)
    const q = [0, 1, 2, 3].map((i) => dated.filter((x) => Math.floor((Number(x.due!.slice(5, 7)) - 1) / 3) === i).reduce((s, x) => s + x.amount!, 0) / (total || 1))
    if (dated.length) flow.push(flowLine(dir, item, total, q, LSTATUS.filled, `The leases’ payment dates for ${planYear} (Leases).`, ''))
    if (undated.length) flow.push(flowLine(dir, `${item}, no payment dates`, undated.reduce((s, x) => s + x.yearsRent!, 0), null, LSTATUS.filled, `${[...new Set(undated.map((x) => x.landlord))].join(', ')}: the year’s rent with no payment dates on the lease.`, ''))
  }
  rentFlow('in', 'Rent received')
  if (!leasesPlan.ok && !leasesPlan.empty) flow.push(blankFlow('in', 'Rent received', leasesPlan.restricted ? 'Restricted: the leases are not open to you.' : `The leases could not be read (${leasesPlan.message}).`))
  flow.push(
    blankFlow('in', 'Program payments', 'AgriStability, AgriInvest withdrawals, crop and hail insurance claims expected.'),
    blankFlow('in', 'Other farm and off-farm income', 'Custom work, GST refunds, wages and other income.'),
  )

  // Costs from the plan year's input budgets, by kind.
  const kinds = { seed: 0, fertilizer: 0, chemical: 0, custom: 0, other: 0, fuel: 0, insurance: 0 }
  const carried = new Set<number>()
  let planAcres = 0
  for (const x of r.planRows.rows ?? []) {
    if (!x.crop || (!x.plan && !x.isZone) || x.crop.land_rent_only || x.crop.renter_only || !x.acres) continue
    planAcres += x.acres
    const c = resolveCosts(x.crop.id, planYear, r.inputs, currentYear)
    if (c.basis === 'carried' && c.fromYear) carried.add(c.fromYear)
    for (const l of c.lines) {
      if (l.farm_fixed) continue
      const v = (Number(l.cost_per_acre) || 0) * x.acres
      if (isOffTheTop(l.name)) kinds.insurance += v
      else if (l.category === 'seed') kinds.seed += v
      else if (l.category === 'fert') kinds.fertilizer += v
      else if (l.category === 'chem') kinds.chemical += v
      else if (l.category === 'fuel') kinds.fuel += v
      else if (l.category === 'custom') kinds.custom += v
      else kinds.other += v
    }
  }
  const budgetNote = `The ${planYear} crops’ input budgets (Crop settings) × planned acres${carried.size ? `; ${[...carried].sort().join(', ')} budgets carried where ${planYear} has none` : ''}.`
  const cost = (key: keyof typeof COST_TIMING, item: string, v: number, note: string, ifBlank: string) => flow.push(flowLine('out', item, v || null, COST_TIMING[key].q, LSTATUS.estimate, `${note} ${COST_TIMING[key].why}`, ifBlank))
  // Seed, fertilizer, chemical and fuel: the plan year's budgets; where a kind
  // has none, this year's an acre off the Crop P&L (as applied) carried to the
  // planned acres, so a cash flow is never sent with no inputs in it.
  const nowAcres = booksNow.rows.filter((x) => x.crop).reduce((s, x) => s + x.acres, 0)
  const perAcreNow = (k: 'seed' | 'fertilizer' | 'chemical' | 'fuel' | 'trucking') => (nowAcres > 0 ? booksNow.rows.reduce((s, x) => s + x.costs[k], 0) / nowAcres : 0)
  const planOurAcres = planBooks.reduce((s, x) => s + x.acres, 0) || planAcres
  const input = (key: 'seed' | 'fertilizer' | 'chemical', item: string) => {
    if (kinds[key]) {
      cost(key, item, kinds[key], budgetNote, '')
      return
    }
    const pa = perAcreNow(key)
    cost(key, item, pa * planOurAcres, `An estimate: no ${planYear} budget, so ${booksNow.year}’s ${item.toLowerCase()} on the Crop P&L, $${pa.toFixed(2)}/ac, × ${Math.round(planOurAcres).toLocaleString('en-CA')} planned acres. Set the ${planYear} input budgets on Crop settings for a better figure.`, `No ${item.toLowerCase()} in the ${planYear} budgets or ${booksNow.year}’s books: fill in.`)
  }
  input('seed', 'Seed')
  input('fertilizer', 'Fertilizer')
  input('chemical', 'Chemical')
  if (kinds.custom) cost('custom', 'Custom work', kinds.custom, budgetNote, '')
  if (kinds.other) cost('other', 'Other inputs', kinds.other, budgetNote, '')
  // Fuel and trucking: the budget's, else this year's an acre carried to next year's acres.
  if (kinds.fuel) cost('fuel', 'Fuel', kinds.fuel, budgetNote, '')
  else {
    const pa = perAcreNow('fuel')
    cost('fuel', 'Fuel', pa * planOurAcres, `An estimate: ${booksNow.year}’s fuel on the Crop P&L, $${pa.toFixed(2)}/ac, × ${Math.round(planOurAcres).toLocaleString('en-CA')} planned acres.`, 'No fuel in the budgets or this year’s books: fill in.')
  }
  const cropIn = flow.filter((l) => l.side === 'in' && l.value != null && /crop|Grain on hand/.test(l.item))
  const cropQ = [0, 1, 2, 3].map((i) => cropIn.reduce((s, l) => s + (l.q[i] ?? 0), 0))
  const cropQSum = cropQ.reduce((a, b) => a + b, 0)
  const truckQ = cropQSum > 0 ? cropQ.map((v) => v / cropQSum) : COST_TIMING.fuel.q
  const truckTotal = trucking.ok ? n0(trucking.data.totals?.[colOf(TRUCKING_COLUMNS, 'Total')]) : null
  if (truckTotal) flow.push(flowLine('out', 'Trucking', truckTotal, truckQ, LSTATUS.estimate, `Travel & trucking’s haul plans for ${planYear}, paid as the crop is sold.`, ''))
  else {
    const pa = perAcreNow('trucking')
    flow.push(flowLine('out', 'Trucking', pa * planOurAcres, truckQ, LSTATUS.estimate, `An estimate: ${booksNow.year}’s trucking on the Crop P&L, $${pa.toFixed(2)}/ac, × planned acres, paid as the crop is sold.`, 'No haul plans and no trucking on this year’s books: fill in.'))
  }
  cost('insurance', 'Crop and hail insurance', kinds.insurance, budgetNote, 'No insurance in the input budgets: AFSC’s and the hail company’s premiums.')
  rentFlow('out', 'Cash rent paid')
  if (!leasesPlan.ok && !leasesPlan.empty) flow.push(blankFlow('out', 'Cash rent paid', leasesPlan.restricted ? 'Restricted: the leases are not open to you.' : `The leases could not be read (${leasesPlan.message}).`))
  // Cattle: the ranch's cost a cow, less the cow cost (replacement and interest), × cows.
  let cattle = 0
  const cattleFrom: string[] = []
  for (const ranch of herd.ok ? herd.data.ranches : []) {
    const c = costsFor(cowCosts, ranch.name, planYear)
    const cows = herdRows.filter((h) => h.ranch_id === ranch.id && cowsOnly(h)).reduce((s, h) => s + Number(h.head_count), 0)
    if (!c || !cows) continue
    const per = (c.feed_cost_per_head ?? 0) + (c.pasture_cost_per_head ?? 0) + (c.vet_cost_per_head ?? 0) + (c.other_cost_per_head ?? 0)
    cattle += per * cows
    cattleFrom.push(`${ranch.name} $${Math.round(per)} a cow × ${cows}${c.carriedFrom ? ` (${c.carriedFrom} costs)` : ''}`)
  }
  cost('cattle', 'Cattle costs', cattle, `Cattle settings → Costs: feed, pasture, vet and other a cow (${cattleFrom.join('; ')}). The cow cost line (replacement, interest) is left out; check it does not overlap the fixed costs.`, 'No cow costs on Cattle settings: fill in.')
  const fixed = booksPlan.rows.reduce((s, x) => s + x.costs.fixed, 0)
  cost(
    'fixed',
    'Fixed costs',
    fixed,
    booksPlan.fixedPerAcre != null
      ? `The farm’s one fixed figure, $${booksPlan.fixedPerAcre.toFixed(2)}/ac${booksPlan.fixedFrom ? ` (${booksPlan.fixedFrom}’s, carried)` : ''}, × our acres it applies to. Land, machinery, labour and overhead together: any depreciation in it is not cash, and any land cost may overlap rent paid — split it from the books.`
      : '',
    'No fixed $/ac set (Financials → Farm costs): fill in.',
  )
  flow.push(
    blankFlow('out', 'Operating line interest', 'The lender’s figure.'),
    blankFlow('out', 'Term loan payments (principal and interest)', 'Every loan’s payments in the year.'),
    blankFlow('out', 'Equipment lease payments', 'Every lease’s payments in the year.'),
    blankFlow('out', 'Capital purchases', 'Land, machinery or buildings to be bought.'),
    blankFlow('out', 'Family living and drawings', 'What the owners draw.'),
    blankFlow('out', 'Income tax', 'Instalments and balances due.'),
  )
  for (const [k, v] of Object.entries(COST_TIMING)) if (k !== 'other' && k !== 'custom') timing.push([k[0].toUpperCase() + k.slice(1), v.q.map((x, i) => (x ? `Q${i + 1} ${Math.round(x * 100)}%` : null)).filter(Boolean).join(', '), `Stated default: ${v.why}`])
  timing.push(['Trucking', 'With the crop sales', 'Paid in the quarters the crop is sold.'], ['Rent', 'On the lease’s payment dates', 'Leases page; a lease with no dates is put in the year only.'])

  /* Inventory listing */
  const inventory: ReportSection[] = [
    {
      title: `Inventory listing, ${longDate(asOf)}: grain by bin and crop`,
      note: 'The bins’ ledger on the date (Year-end grain inventory), valued at the newest market quote, else the plan’s price.',
      head: ['Crop', 'Bin', 'Site', 'Crop year', 'Bushels', 'Value ($)', 'Priced from'],
      rows: invRows.map((x) => [x.crop, x.bin, x.site, x.cropYear != null ? String(x.cropYear) : null, x.bu != null ? Math.round(x.bu) : null, x.value != null ? Math.round(x.value) : null, x.bu == null ? 'bushels not measured: fill in' : (x.from ?? 'no price: fill in')]),
      foot: invRows.length ? ['All grain', null, null, null, Math.round(invRows.reduce((s, x) => s + (x.bu ?? 0), 0)), Math.round(invRows.reduce((s, x) => s + (x.value ?? 0), 0)), null] : undefined,
      empty: inv.ok || inv.empty ? 'No grain in any bin on the date.' : inv.restricted ? 'Restricted: not open to you.' : 'The bins could not be read.',
    },
    {
      title: 'Cattle by ranch and class',
      note: 'The Herd tab’s counts on the date. Only calves are valued, at the farm’s own sale price; breeding stock is to be valued.',
      head: ['Ranch', 'Class', 'Head', 'Avg weight (lb)', 'Value per head ($)', 'Value ($)', 'Counted'],
      rows: herdRows.map((h) => {
        const w = num(h.avg_weight_lb)
        const per = isCalfClass(h) && w != null && calfPrice != null ? w * calfPrice : null
        return [ranchName.get(h.ranch_id) ?? '', h.class_name, Number(h.head_count), w, per != null ? Math.round(per) : null, per != null ? Math.round(per * Number(h.head_count)) : null, h.updated_at ? h.updated_at.slice(0, 10) : null]
      }),
      empty: herd.ok ? 'No herd counts on the date.' : herd.restricted ? 'Restricted: not open to you.' : 'The herd could not be read.',
    },
    {
      title: 'Feed and bedding on hand',
      note: 'The Feed tab: put up less fed. Not valued.',
      head: ['Ranch', 'Feed', 'Tonnes', 'Bales not weighed'],
      rows: feedRows.map((f) => [ranchName.get(f.ranch_id) ?? '', `${f.feed_name}${f.is_bedding ? ' (bedding)' : ''}`, Math.round(((num(f.remaining_lb) ?? 0) / 2204.62) * 10) / 10, f.unweighed_lines || null]),
      empty: 'Nothing counted on the Feed tab.',
    },
  ]

  if (Number(asOf.slice(0, 4)) + 1 !== planYear) lead.push(`The statement date (${longDate(asOf)}) is not the end of the year before the plan (${planYear}): grain on hand may sell before ${planYear}, and is left out of its cash flow where it does.`)
  lead.push(
    'To confirm: the fields taken as owned; the fixed $/ac (whether it holds depreciation or land costs already in rent); the stated timing of costs; the calf price and the replacement heifers kept back.',
    `The ${planYear} figures are estimates from the Financials plan: yields are each field’s expected yield, prices the plan’s (contract first), costs the crops’ input budgets.`,
  )

  const parts: LenderParts = {
    farmName: farmBrand().farmName,
    today: ctx.today,
    asOf,
    planYear,
    sheet,
    schedules,
    plan: {
      crops: {
        title: `Production plan for ${planYear}`,
        note: 'Acres by crop, irrigated (a pivot on the field) and dryland apart, with the plan’s expected yield and price. Gross is the whole crop; our share is after land deals.',
        head: ['Crop', 'Land', 'Fields', 'Acres', 'Yield /ac', 'Unit', 'Production', 'Price', 'Gross ($)', 'Our share ($)', 'Status', 'Yield and price from'],
        rows: cropRows,
        empty: `Nothing is planned for ${planYear} yet (Financials).`,
      },
      others,
    },
    flow: {
      lines: flow,
      timing: [{ title: 'Timing assumptions', note: 'When each line is taken to be paid. A crop sells the way its own deliveries went in past crop years; with no history, half in Q4 and half the next Q1.', head: ['What', 'When', 'Why'], rows: timing }],
      note: `Plan year ${planYear}, by calendar quarter. Grain on hand on the statement date sells first, then the ${planYear} crop; what sells after ${planYear} is left out. Financing lines are blank: the lender’s and the owners’ to fill.`,
    },
    inventory,
    lead,
    books: qb ? { sections: qb.sections, meta: qb.meta } : { sections: [], meta: [], note: r.books.ok ? undefined : r.books.note },
  }
  return lenderReview(parts)
}

/* ── The hook ───────────────────────────────────────────────────────────── */

/**
 * The lender review's reads: the crop books for the statement year and the
 * plan year (through the Financials and P&L Map hooks, so it waits on the
 * same cache), the plan rows for both, every input budget, and the map acres.
 */
export function useLenderReviewRun(p: ParamValues, ctx: GatherContext) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(p.asOf ?? '') ? p.asOf : ctx.today
  const asOfYear = Number(asOf.slice(0, 4))
  const planYear = Number(p.planYear) > 1900 ? Number(p.planYear) : asOfYear + 1
  const booksNow = useCropBooks(asOfYear)
  const booksPlan = useCropBooks(planYear)
  const planRows = usePlanRows(planYear)
  const nowRows = usePlanRows(asOfYear)
  const inputs = useAllCropInputs()
  const bounds = useAllBoundaries()
  // The fiscal year (September to August) ended on or before the statement date.
  const qb = useReportBooks(asOf.slice(5) >= '08-31' ? asOfYear : asOfYear - 1, { balanceSheet: true })
  const ready = booksNow.ready && booksPlan.ready && planRows.settled && nowRows.settled && !!inputs.data && !!bounds.data && qb.ready
  const error = booksNow.error ?? booksPlan.error ?? ((inputs.error ?? bounds.error) as Error | null) ?? null
  return {
    ready,
    error,
    build: () =>
      buildLenderReview({
        ctx,
        asOf,
        planYear,
        booksNow: booksNow.build(),
        booksPlan: booksPlan.build(),
        planRows,
        nowRows,
        inputs: inputs.data ?? [],
        acresByField: new Map(boundariesForYear(bounds.data ?? [], asOfYear).map((b) => [b.field_id as string, Number(b.acres) || 0])),
        books: qb.books,
      }),
  }
}
