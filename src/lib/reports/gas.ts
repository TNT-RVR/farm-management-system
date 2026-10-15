import { supabase } from '@/lib/supabase'
import { gasSiteCost, gasSiteLabel, netGj, usedOn, type GasPlaceRow, type GasSiteRow } from '@/lib/gas-bills-core'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Natural gas by site for a calendar year (Utilities → Gas): every bill of
 * every site, its GJ and what made up its cost, from the Direct Energy bills
 * read out of QuickBooks. A bill is in the year its period ends.
 */

export const GAS_COLUMNS = [
  { label: 'Period' },
  { label: 'GJ', decimals: 2 },
  { label: 'Gas', money: true, decimals: 2 },
  { label: 'Admin fee', money: true, decimals: 2 },
  { label: 'Delivery', money: true, decimals: 2 },
  { label: 'Riders', money: true, decimals: 2 },
  { label: 'Carbon tax', money: true, decimals: 2 },
  { label: 'Other', money: true, decimals: 2 },
  { label: 'Before GST', money: true, decimals: 2 },
  { label: 'GST', money: true, decimals: 2 },
  { label: 'Total', money: true, decimals: 2 },
  { label: '$/GJ', money: true, decimals: 2 },
]

const n = (v: unknown) => num(v) ?? 0

type Sum = { gj: number; gas: number; admin: number; delivery: number; riders: number; carbon: number; other: number; cost: number; gst: number; total: number }
const zero = (): Sum => ({ gj: 0, gas: 0, admin: 0, delivery: 0, riders: 0, carbon: 0, other: 0, cost: 0, gst: 0, total: 0 })
const of = (s: GasSiteRow, gj: number): Sum => ({
  gj,
  gas: n(s.energy_charge),
  admin: n(s.admin_fee),
  delivery: n(s.delivery_fixed) + n(s.delivery_variable),
  riders: n(s.riders),
  carbon: n(s.carbon_levy),
  // Whatever else is in the cost: other charges, anything cancelled from an earlier bill.
  other: gasSiteCost(s) - n(s.energy_charge) - n(s.admin_fee) - n(s.delivery_fixed) - n(s.delivery_variable) - n(s.riders) - n(s.carbon_levy),
  cost: gasSiteCost(s),
  gst: n(s.gst),
  total: n(s.total),
})
const plus = (a: Sum, b: Sum): Sum => Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Sum] + b[k as keyof Sum]])) as Sum
const cells = (label: string, t: Sum): Cell[] => [label, t.gj, t.gas, t.admin, t.delivery, t.riders, t.carbon, t.other, t.cost, t.gst, t.total, t.gj > 0 ? t.cost / t.gj : null]

/** One group per site, its bills in the year, and the year's totals. */
export function gasReportGroups(sites: GasSiteRow[], places: GasPlaceRow[], year: number): { groups: ReportGroup[]; all: Sum } {
  const net = netGj(sites)
  const placeOf = new Map(places.map((p) => [p.site_id, p]))
  const bySite = new Map<string, GasSiteRow[]>()
  for (const s of sites) if (usedOn(s)?.startsWith(String(year))) bySite.set(s.site_id, [...(bySite.get(s.site_id) ?? []), s])
  let all = zero()
  const groups: ReportGroup[] = []
  for (const [siteId, list] of bySite) {
    const p = placeOf.get(siteId)
    let t = zero()
    const rows = list
      .sort((a, b) => String(usedOn(a)).localeCompare(String(usedOn(b))))
      .map((s) => {
        const x = of(s, net.get(s.id) ?? 0)
        t = plus(t, x)
        return cells(s.period_start && s.period_end ? `${s.period_start} – ${s.period_end}` : (usedOn(s) ?? ''), x)
      })
    all = plus(all, t)
    const where = p?.legal_land ?? p?.address ?? list[0].legal_land ?? list[0].address
    groups.push({ title: `${gasSiteLabel(siteId, p?.place ?? null)} · site ${siteId}${where ? ` · ${where}` : ''}`, rows, totals: cells('Site total', t) })
  }
  groups.sort((a, b) => Number(b.totals?.[8] ?? 0) - Number(a.totals?.[8] ?? 0))
  return { groups, all }
}

export async function gatherGas(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [sites, places] = await Promise.all([
    fetchAll<GasSiteRow>((a, b) =>
      supabase
        .from('gas_bill_sites')
        .select('id, bill_id, site_id, address, legal_land, meter_number, period_start, period_end, gj, energy_charge, admin_fee, delivery_fixed, delivery_variable, riders, carbon_levy, other_charges, rebilled_start, rebilled_end, rebilled_charges, gst, total')
        .order('id')
        .range(a, b),
    ),
    fetchAll<GasPlaceRow>((a, b) => supabase.from('gas_sites').select('id, site_id, place, place_kind, address, legal_land, meter_number, place_set_by_hand').order('id').range(a, b)),
  ])
  const r = gasReportGroups(sites, places, year)
  if (!r.groups.length) throw new Error(`No gas bills read for ${year}.`)
  return {
    title: 'Natural gas by site',
    subtitle: String(year),
    meta: [
      ['Used', `${Math.round(r.all.gj).toLocaleString('en-CA')} GJ`],
      ['Cost before GST', `$${Math.round(r.all.cost).toLocaleString('en-CA')}`],
      ['Delivered', r.all.gj > 0 ? `$${(r.all.cost / r.all.gj).toFixed(2)}/GJ` : '—'],
      ['Gas alone', r.all.gj > 0 ? `$${(r.all.gas / r.all.gj).toFixed(2)}/GJ` : '—'],
    ],
    summary: [
      'From the Direct Energy bills attached in QuickBooks, read site by site. A bill is in the year its period ends. Delivered $/GJ is the whole bill before GST over the GJ; gas is the cost of gas alone.',
      'A corrected bill that re-bills days of an earlier one has the earlier days’ GJ taken off, in proportion to the days, and what it cancelled under Other.',
    ],
    columns: GAS_COLUMNS,
    groups: r.groups,
    groupLabel: 'Site',
    totals: cells('All sites', r.all),
    filename: `Natural gas by site ${year}`,
  }
}
