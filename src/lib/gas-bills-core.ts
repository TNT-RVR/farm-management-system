/**
 * Natural gas by site, month and year (Utilities → Gas), from the bills read
 * site by site (gas_bills, gas_bill_sites; netlify/shared/gas-bills-qb-read.ts).
 * Pure, so it can be tested; the hooks are in gas-bills.ts.
 *
 * Cost is before GST (it comes back as an input tax credit), and a site's
 * bill is counted in the month its period ends. "Delivered" $/GJ is the whole
 * bill over the GJ — gas, delivery, riders, carbon tax and fees; the gas
 * $/GJ is the cost of gas alone.
 */

export type GasSiteRow = {
  id: string
  bill_id: string
  site_id: string
  address: string | null
  legal_land: string | null
  meter_number: string | null
  period_start: string | null
  period_end: string | null
  gj: number | null
  energy_charge: number | null
  admin_fee: number | null
  delivery_fixed: number | null
  delivery_variable: number | null
  riders: number | null
  carbon_levy: number | null
  other_charges: number | null
  rebilled_start: string | null
  rebilled_end: string | null
  rebilled_charges: number | null
  gst: number | null
  total: number | null
}

export type GasBillRow = {
  id: string
  source: 'quickbooks' | 'hand'
  status: 'read' | 'notice'
  file_name: string | null
  account_number: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  total: number | null
  budget_plan: boolean
  adjusted: boolean
  error: string | null
  notes: string | null
  qb_txn_ref: string | null
}

export type PlaceKind = 'shop' | 'house' | 'yard' | 'dryer' | 'bins' | 'other'

export type GasPlaceRow = {
  id: string
  site_id: string
  place: string | null
  place_kind: PlaceKind | null
  address: string | null
  legal_land: string | null
  meter_number: string | null
  place_set_by_hand: boolean
}

export const PLACE_KINDS: { value: PlaceKind; label: string }[] = [
  { value: 'shop', label: 'Shop' },
  { value: 'house', label: 'House' },
  { value: 'yard', label: 'Yard' },
  { value: 'dryer', label: 'Grain dryer' },
  { value: 'bins', label: 'Bins' },
  { value: 'other', label: 'Other' },
]

export type GasSum = {
  bills: number
  gj: number
  /** Before GST. */
  cost: number
  /** The cost of gas alone (the commodity). */
  gas: number
  carbon: number
  /** cost / gj: what a GJ costs delivered; null with no GJ. */
  perGj: number | null
  /** gas / gj: the commodity price. */
  gasPerGj: number | null
}

const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))
const DAY = 86_400_000
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

/** A site's cost before GST: its total less the GST, or its parts added up when there is no total. */
export function gasSiteCost(s: Pick<GasSiteRow, 'total' | 'gst' | 'energy_charge' | 'admin_fee' | 'delivery_fixed' | 'delivery_variable' | 'riders' | 'carbon_levy' | 'other_charges' | 'rebilled_charges'>): number {
  if (s.total != null) return n(s.total) - n(s.gst)
  return n(s.energy_charge) + n(s.admin_fee) + n(s.delivery_fixed) + n(s.delivery_variable) + n(s.riders) + n(s.carbon_levy) + n(s.other_charges) + n(s.rebilled_charges)
}

/** The day a site's bill is counted on: the end of its period. */
export const usedOn = (s: Pick<GasSiteRow, 'period_end' | 'period_start'>) => s.period_end ?? s.period_start

/**
 * Each site row's GJ, net of days it bills again. A classic "corrected bill"
 * cancels days an earlier bill charged on an estimate (its dollars come off
 * as rebilled_charges) and counts their GJ again; the earlier bill's GJ for
 * those days is taken off this one, in proportion to the days, so the GJ and
 * the dollars are both "this bill less what it reverses".
 */
export function netGj(rows: GasSiteRow[]): Map<string, number> {
  const out = new Map(rows.map((r) => [r.id, n(r.gj)]))
  for (const r of rows) {
    if (!r.rebilled_start || !r.rebilled_end) continue
    let off = 0
    for (const e of rows) {
      if (e.id === r.id || e.site_id !== r.site_id || !e.period_start || !e.period_end || e.gj == null) continue
      // An earlier bill: it ends no later than this one, and before this one's own new days.
      if (r.period_end && e.period_end > r.period_end) continue
      if (e.bill_id === r.bill_id) continue
      const from = e.period_start > r.rebilled_start ? e.period_start : r.rebilled_start
      const to = e.period_end < r.rebilled_end ? e.period_end : r.rebilled_end
      const overlap = days(from, to)
      const span = days(e.period_start, e.period_end)
      if (overlap > 0 && span > 0) off += (n(e.gj) * overlap) / span
    }
    out.set(r.id, Math.max(0, n(r.gj) - off))
  }
  return out
}

const empty = (): GasSum & { billIds: Set<string> } => ({ bills: 0, gj: 0, cost: 0, gas: 0, carbon: 0, perGj: null, gasPerGj: null, billIds: new Set() })
const add = (t: ReturnType<typeof empty>, s: GasSiteRow, gj: number) => {
  t.billIds.add(s.bill_id)
  t.gj += gj
  t.cost += gasSiteCost(s)
  t.gas += n(s.energy_charge)
  t.carbon += n(s.carbon_levy)
}
const done = ({ billIds, ...t }: ReturnType<typeof empty>): GasSum => ({ ...t, bills: billIds.size, perGj: t.gj > 0 ? t.cost / t.gj : null, gasPerGj: t.gj > 0 ? t.gas / t.gj : null })

function groupBy(rows: GasSiteRow[], key: (s: GasSiteRow) => string | null): Map<string, GasSum> {
  const net = netGj(rows)
  const by = new Map<string, ReturnType<typeof empty>>()
  for (const s of rows) {
    const k = key(s)
    if (k == null) continue
    const t = by.get(k) ?? empty()
    add(t, s, net.get(s.id) ?? 0)
    by.set(k, t)
  }
  return new Map([...by].map(([k, t]) => [k, done(t)]))
}

/** By calendar year of use, newest first. */
export function gasByYear(rows: GasSiteRow[]): ({ year: string } & GasSum)[] {
  return [...groupBy(rows, (s) => usedOn(s)?.slice(0, 4) ?? null)].map(([year, t]) => ({ year, ...t })).sort((a, b) => b.year.localeCompare(a.year))
}

/** By month of use (YYYY-MM), newest first; from `from` (YYYY-MM-DD) on when given. */
export function gasByMonth(rows: GasSiteRow[], from: string | null = null): ({ month: string } & GasSum)[] {
  return [...groupBy(rows, (s) => {
    const d = usedOn(s)
    return d && (!from || d >= from) ? d.slice(0, 7) : null
  })]
    .map(([month, t]) => ({ month, ...t }))
    .sort((a, b) => b.month.localeCompare(a.month))
}

export type GasSiteSum = GasSum & {
  siteId: string
  place: string | null
  kind: PlaceKind | null
  address: string | null
  legalLand: string | null
  meter: string | null
  last: string | null
}

/** By site, the costliest first; from `from` (YYYY-MM-DD) on when given. */
export function gasBySite(rows: GasSiteRow[], places: GasPlaceRow[], from: string | null = null): GasSiteSum[] {
  const kept = rows.filter((s) => !from || (usedOn(s) ?? '') >= from)
  // The GJ net of re-billed days is worked out over every bill, not just those in the period.
  const net = netGj(rows)
  const placeOf = new Map(places.map((p) => [p.site_id, p]))
  const by = new Map<string, ReturnType<typeof empty> & { latest: GasSiteRow }>()
  for (const s of kept) {
    const t = by.get(s.site_id) ?? { ...empty(), latest: s }
    add(t, s, net.get(s.id) ?? 0)
    if ((usedOn(s) ?? '') >= (usedOn(t.latest) ?? '')) t.latest = s
    by.set(s.site_id, t)
  }
  return [...by]
    .map(([siteId, { latest, ...t }]) => {
      const p = placeOf.get(siteId)
      return {
        siteId,
        ...done(t),
        place: p?.place ?? null,
        kind: p?.place_kind ?? null,
        address: latest.address ?? p?.address ?? null,
        legalLand: latest.legal_land ?? p?.legal_land ?? null,
        meter: latest.meter_number ?? p?.meter_number ?? null,
        last: usedOn(latest),
      }
    })
    .sort((a, b) => b.cost - a.cost)
}

/** The farm's delivered price of a GJ: every site's cost over its GJ, from `from` on. */
export function deliveredPricePerGj(rows: GasSiteRow[], from: string | null): { perGj: number; gasPerGj: number; gj: number; cost: number } | null {
  const net = netGj(rows)
  let gj = 0
  let cost = 0
  let gas = 0
  for (const s of rows) {
    if (from && (usedOn(s) ?? '') < from) continue
    gj += net.get(s.id) ?? 0
    cost += gasSiteCost(s)
    gas += n(s.energy_charge)
  }
  return gj > 0 ? { perGj: cost / gj, gasPerGj: gas / gj, gj, cost } : null
}

/** The emailed notices whose bill is not read in full: dollars with no GJ. */
export function noticesWithoutBill(bills: GasBillRow[]): GasBillRow[] {
  const read = new Set(bills.filter((b) => b.status === 'read' && b.account_number && b.bill_date).map((b) => `${b.account_number}:${b.bill_date}`))
  return bills.filter((b) => b.status === 'notice' && !read.has(`${b.account_number}:${b.bill_date}`))
}

/** What a site is called: its place, else the end of its site ID. */
export const gasSiteLabel = (siteId: string, place: string | null) => place ?? `Site …${siteId.slice(-4)}`
