import { siteCost, type BillSiteRow } from './power-bills-core'

/**
 * Irrigation power, kept apart from the rest of the farm's power (Sam, 7 Oct
 * 2026: "keep irrigation separate from the rest of the power and have the
 * rest of the power part of the overhead costs").
 *
 *   - A bill site on a pump is irrigation: its cost goes to the fields that
 *     pump waters, split by their irrigated acres, as a field cost line.
 *   - Every other site (shops, yards, houses, incubators, a yard's dugout
 *     pump) is overhead.
 *   - A solar site is neither: its credits are solar income.
 *
 * Costs are before GST. Pure; the hooks live in irrigation-power.ts.
 */

export const IRRIGATION_POWER_LINE = 'Irrigation power'

const SOLAR = /micro ?gen|solar/i
export const isSolarSite = (s: Pick<BillSiteRow, 'rate_class'>) => SOLAR.test(s.rate_class ?? '')

/** Which side of the split a bill site is on. */
export function powerUse(s: Pick<BillSiteRow, 'pump_id' | 'rate_class'>): 'irrigation' | 'overhead' | 'solar' {
  if (isSolarSite(s)) return 'solar'
  return s.pump_id ? 'irrigation' : 'overhead'
}

const endOf = (s: Pick<BillSiteRow, 'period_end' | 'period_start'>) => s.period_end ?? s.period_start

/**
 * A crop year's irrigation season on the bills: May of that year to the end
 * of the next April, so the winter's fixed delivery charges, which the pumps
 * pay whether they run or not, go with the season just finished.
 */
export const seasonWindow = (year: number) => ({ from: `${year}-05-01`, to: `${year + 1}-04-30` })

export type PumpSeason = { pumpId: string; cost: number; kwh: number; bills: number; season: number }

/** Each pump's power for a season; a pump with no bills that season falls back to the season before. */
export function pumpSeasons(sites: BillSiteRow[], year: number): Map<string, PumpSeason> {
  const by = new Map<string, Map<number, PumpSeason>>()
  for (const s of sites) {
    if (!s.pump_id || isSolarSite(s)) continue
    const end = endOf(s)
    if (!end) continue
    // The season a bill belongs to: May–Dec is that year's, Jan–Apr the year before's.
    const y = Number(end.slice(0, 4))
    const m = Number(end.slice(5, 7))
    const season = m >= 5 ? y : y - 1
    const seasons = by.get(s.pump_id) ?? new Map<number, PumpSeason>()
    const p = seasons.get(season) ?? { pumpId: s.pump_id, cost: 0, kwh: 0, bills: 0, season }
    p.cost += siteCost(s)
    p.kwh += Number(s.kwh) || 0
    p.bills += 1
    seasons.set(season, p)
    by.set(s.pump_id, seasons)
  }
  const out = new Map<string, PumpSeason>()
  for (const [pumpId, seasons] of by) {
    // Only the season before stands in (a budget ahead of its bills); an older one would mislead.
    const best = seasons.get(year) ?? seasons.get(year - 1)
    if (best) out.set(pumpId, best)
  }
  return out
}

export type PowerPivot = { field_id: string; pump_id: string | null; acres_irrigated: unknown }

/** A field's share of each pump that waters it, by irrigated acres (evenly where acres are missing). */
export function fieldPumpShares(pivots: PowerPivot[], fieldId: string): { pumpId: string; share: number; acres: number }[] {
  const out: { pumpId: string; share: number; acres: number }[] = []
  const pumps = new Set(pivots.filter((p) => p.field_id === fieldId && p.pump_id).map((p) => p.pump_id!))
  for (const pumpId of pumps) {
    const on = pivots.filter((p) => p.pump_id === pumpId)
    const acres = (p: PowerPivot) => Number(p.acres_irrigated) || 0
    const total = on.reduce((n, p) => n + acres(p), 0)
    const mine = on.filter((p) => p.field_id === fieldId).reduce((n, p) => n + acres(p), 0)
    const fields = new Set(on.map((p) => p.field_id)).size
    out.push({ pumpId, share: total > 0 ? mine / total : 1 / fields, acres: mine })
  }
  return out
}

/** The field's irrigation power line: its share of each pump's season bills. */
export function irrigationPowerLine(args: {
  fieldId: string
  year: number
  pivots: PowerPivot[]
  seasons: Map<string, PumpSeason>
  pumpName: (id: string) => string
}): { key: string; label: string; total: number; acres: number; source: string } | null {
  const shares = fieldPumpShares(args.pivots, args.fieldId)
  const parts = shares.map((s) => ({ ...s, season: args.seasons.get(s.pumpId) })).filter((s) => s.season && s.season.cost !== 0)
  if (!parts.length) return null
  const total = parts.reduce((n, p) => n + p.season!.cost * p.share, 0)
  const acres = parts.reduce((n, p) => n + p.acres, 0)
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
  const source = parts
    .map((p) => {
      const s = p.season!
      const when = s.season === args.year ? `${s.season} season` : `${s.season} season's bills (none for ${args.year} yet)`
      const share = p.share < 0.999 ? `, ${Math.round(p.share * 100)}% by irrigated acres` : ''
      return `${args.pumpName(p.pumpId)}: ${when}, ${money(s.cost)} on ${s.bills} bill${s.bills === 1 ? '' : 's'}${share}`
    })
    .join('; ')
  return { key: IRRIGATION_POWER_LINE, label: IRRIGATION_POWER_LINE, total, acres, source: `${source}; before GST` }
}

/** The farm's power for a fiscal year by use: what overhead carries, what the fields carry, what the solar earned. */
export function powerByUse(sites: BillSiteRow[], from: string, to: string) {
  const out = { irrigation: 0, overhead: 0, solar: 0, months: new Set<string>() }
  for (const s of sites) {
    const end = endOf(s)
    if (!end || end < from || end > to) continue
    out[powerUse(s)] += siteCost(s)
    out.months.add(end.slice(0, 7))
  }
  return out
}
