/**
 * Power bills by pump (Utilities → Power): what each pump's site actually
 * cost, from the bills read site by site (power_bills, power_bill_sites).
 * Pure, so it can be tested; the hooks are in power-bills.ts.
 */

export type BillSiteRow = {
  id: string
  bill_id: string
  site_id: string | null
  meter_number: string | null
  site_name: string | null
  legal_land: string | null
  rate_class: string | null
  period_start: string | null
  period_end: string | null
  kwh: number | null
  demand_kw: number | null
  energy_charge: number | null
  delivery_charge: number | null
  demand_charge: number | null
  other_charges: number | null
  gst: number | null
  total: number | null
  pump_id: string | null
  pump_set_by_hand: boolean
  /** On this pump by a guess (its size), not a meter or a person: shown with an asterisk until confirmed. */
  pump_unconfirmed?: boolean
}

export type PumpPower = {
  /** The pump's id, or the site's own key (siteKey) when no pump is matched. */
  key: string
  pumpId: string | null
  /** Sites on the bills with no pump: one row each, by meter or site id. */
  label: string | null
  bills: number
  kwh: number
  /** Before GST: what the farm pays for the power (GST comes back as an input tax credit). */
  cost: number
  demandCharges: number
  peakKw: number | null
  /** cost / kwh, the effective price; null when no kWh were billed. */
  perKwh: number | null
  first: string | null
  last: string | null
  /** Some of its sites are on it by a guess still to be confirmed. */
  unconfirmed: boolean
}

/** What groups a site's bills together when it has no pump: its meter, else its site id or name. */
export const siteKey = (s: Pick<BillSiteRow, 'pump_id' | 'meter_number' | 'site_id' | 'site_name' | 'id'>) =>
  s.pump_id ?? `site:${s.meter_number ?? s.site_id ?? s.site_name ?? s.id}`

const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))

/** A site's cost before GST: its total less the GST, or its parts added up when there is no total. */
export function siteCost(s: Pick<BillSiteRow, 'total' | 'gst' | 'energy_charge' | 'delivery_charge' | 'demand_charge' | 'other_charges'>): number {
  if (s.total != null) return n(s.total) - n(s.gst)
  return n(s.energy_charge) + n(s.delivery_charge) + n(s.demand_charge) + n(s.other_charges)
}

/** Each pump's (or unmatched site's) bills since `from` (YYYY-MM-DD, by the period's end). */
export function powerByPump(sites: BillSiteRow[], from: string | null): PumpPower[] {
  const by = new Map<string, PumpPower>()
  for (const s of sites) {
    const end = s.period_end ?? s.period_start
    if (from && end && end < from) continue
    const key = siteKey(s)
    const p = by.get(key) ?? {
      key,
      pumpId: s.pump_id,
      label: s.pump_id ? null : (s.site_name ?? (s.meter_number ? `Meter ${s.meter_number}` : s.site_id ? `Site ${s.site_id}` : 'Unknown site')),
      bills: 0,
      kwh: 0,
      cost: 0,
      demandCharges: 0,
      peakKw: null,
      perKwh: null,
      first: null,
      last: null,
      unconfirmed: false,
    }
    p.bills += 1
    if (s.pump_id && s.pump_unconfirmed) p.unconfirmed = true
    p.kwh += n(s.kwh)
    p.cost += siteCost(s)
    p.demandCharges += n(s.demand_charge)
    if (s.demand_kw != null) p.peakKw = Math.max(p.peakKw ?? 0, n(s.demand_kw))
    if (end && (!p.last || end > p.last)) p.last = end
    const start = s.period_start ?? end
    if (start && (!p.first || start < p.first)) p.first = start
    by.set(key, p)
  }
  for (const p of by.values()) p.perKwh = p.kwh > 0 ? p.cost / p.kwh : null
  return [...by.values()].sort((a, b) => b.cost - a.cost)
}

/** The farm's grid price from the bills: all matched pumps' cost over their kWh. */
export function billedPricePerKwh(rows: PumpPower[]): { perKwh: number; kwh: number; cost: number } | null {
  const pumps = rows.filter((r) => r.pumpId && r.kwh > 0)
  const kwh = pumps.reduce((s, r) => s + r.kwh, 0)
  const cost = pumps.reduce((s, r) => s + r.cost, 0)
  return kwh > 0 ? { perKwh: cost / kwh, kwh, cost } : null
}
