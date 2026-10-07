/**
 * Fuel and trucking, joined up for the screens that show them: the Work list
 * (per pass), the Travel & trucking page (per field), and the Profit/Loss
 * map's books (as cost lines).
 *
 * One hook gathers the settings, distances and the farm's own fuel averages;
 * the pure functions below turn one field's passes and crop into numbers.
 *
 * Where each distance starts (road-routes.ts startFor): passes — field work,
 * spraying, harvest — from the shop and back; the crop to the bins, and from
 * the bins to an elevator.
 */
import { useMemo } from 'react'
import { bushelWeightFor } from './bushels'
import { farmAverages, opAcres, opFuel, sumFuel, type FarmAverage, type FuelSettings, type OpFuel, type OpKind } from './fuel'
import { haulCost, tonnesOf, HAUL_MODES, type HaulCost, type TruckSettings } from './trucking'
import { lineKey, type AutoLine } from './profit-loss-lines'
import { useAllBoundaries, useCrops } from './queries'
import {
  fieldKey,
  siteKey,
  useAllFuelOps,
  useBasics,
  useFuelSettings,
  useHaulPlans,
  useSites,
  useTrips,
  useTruckSettings,
  type Basics,
  type FuelOpRow,
  type HaulPlan,
  type Site,
  type TripFn,
} from './hauling-data'
import { startFor, type Trip } from './road-routes'
import { useDistrictRate, useFieldPivots, type DistrictRate } from './irrigation'
import { dealFor, type LandDeal } from './land-deals'
import { useLandDeals } from './land-deals-data'

export const FUEL_FIELD_LINE = 'Fuel — field work'
export const FUEL_ROAD_LINE = 'Fuel — to the field and back'
export const TRUCKING_LINE = 'Trucking the crop'
export const DISTRICT_RATE_LINE = 'Irrigation district rate (SMRID)'

export type FuelModel = {
  settings: FuelSettings
  farm: Partial<Record<OpKind, FarmAverage>>
  acresOf: (fieldId: string | null | undefined) => number
  /** Shop → the field's entry, one way: every machine going out to work a field leaves from the shop. */
  /** Shop → the field's entry, one way: every machine going out to work a field leaves from the shop. */
  tripTo: (fieldId: string) => Trip | null
  ready: boolean
}

/** The fuel model from what it reads; the hook below and the Reports page both build it here. */
export function fuelModelFrom(o: {
  settings: FuelSettings
  boundaries: { field_id: string; valid_to: string | null; acres: number | string | null }[] | undefined
  logged: FuelOpRow[] | undefined
  trip: TripFn
  ready: boolean
}): FuelModel {
  // The field's current boundary acres — what the Work list costs a pass on.
  const acres = new Map<string, number>()
  for (const b of o.boundaries ?? []) if (b.valid_to == null && b.acres != null) acres.set(b.field_id, Number(b.acres))
  for (const b of o.boundaries ?? []) if (!acres.has(b.field_id) && b.acres != null) acres.set(b.field_id, Number(b.acres))
  const acresOf = (id: string | null | undefined) => (id ? (acres.get(id) ?? 0) : 0)
  const farm = farmAverages((o.logged ?? []) as never, (op) => opAcres(op, acresOf((op as FuelOpRow).field_id)))
  return { settings: o.settings, farm, acresOf, tripTo: (id: string) => o.trip(startFor('field_work'), fieldKey(id)), ready: o.ready }
}

/** Everything fuel needs, farm-wide. */
export function useFuelModel(): FuelModel {
  const settings = useFuelSettings()
  const { data: boundaries } = useAllBoundaries()
  const { data: logged } = useAllFuelOps()
  const { trip, isLoading } = useTrips()
  return useMemo(() => fuelModelFrom({ settings, boundaries, logged, trip, ready: !!boundaries && !isLoading }), [settings, boundaries, logged, trip, isLoading])
}

/** Fuel for each of a field's passes, keyed by operation id. */
export function fuelByOp(ops: FuelOpRow[], fieldId: string, m: FuelModel): Map<string, OpFuel> {
  const fieldAcres = m.acresOf(fieldId)
  const trip = m.tripTo(fieldId)
  return new Map(ops.map((o) => [o.id, opFuel(o as never, { fieldAcres, trip, settings: m.settings, farm: m.farm })]))
}

export type Trucking = {
  plan: HaulPlan | null
  site: Site | null
  tonnes: number | null
  cost: HaulCost | null
  /** Why there is no cost, when there is none. */
  why: string | null
}

/** One field's trucking, from its haul plan and its crop. */
export function truckingFor(args: {
  fieldId: string
  plan: HaulPlan | null
  sites: Site[]
  crop: { name: string | null; unit: string | null; quantity: number | null; lbPerBu: number | null } | null
  trip: (a: string, b: string) => Trip | null
  truck: { field: TruckSettings; highway: TruckSettings }
  basics: Basics
}): Trucking {
  const { plan, crop } = args
  const site = plan?.delivery_site_id ? (args.sites.find((s) => s.id === plan.delivery_site_id) ?? null) : null
  if (!plan) return { plan, site, tonnes: null, cost: null, why: 'no haul plan set' }
  if (!crop?.name || crop.quantity == null) return { plan, site, tonnes: null, cost: null, why: 'no yield yet' }
  const lb = bushelWeightFor(crop.name, crop.lbPerBu)?.lbPerBu ?? null
  const tonnes = tonnesOf(crop.quantity, crop.unit, lb)
  if (tonnes == null) return { plan, site, tonnes: null, cost: null, why: `cannot weigh ${crop.unit ?? 'that unit'}` }
  const f = fieldKey(args.fieldId)
  const s = site ? siteKey(site.id) : null
  const cost = haulCost({
    tonnes,
    mode: plan.mode,
    trips: {
      fieldYard: args.trip(startFor('grain'), f),
      fieldSite: s ? args.trip(f, s) : null,
      yardSite: s ? args.trip(startFor('grain'), s) : null,
    },
    siteName: site?.name ?? null,
    truck: args.truck,
    dieselPerL: args.basics.dieselPerL,
    wage: args.basics.wage,
  })
  return { plan, site, tonnes, cost, why: cost.missing }
}

/**
 * The cost lines fuel and trucking add to a field's books.
 *
 * Field-work fuel keeps its passes, so the map lays each pass's litres where
 * that pass went; road fuel and trucking go on evenly. Trucking is only
 * booked once the scale has the crop — before harvest it is an estimate, and
 * the Travel & trucking page is where estimates live.
 */
export function operatingLines(args: {
  fuel: Map<string, OpFuel>
  dieselPerL: number
  trucking: Trucking | null
  harvested: boolean
}): AutoLine[] {
  const out: AutoLine[] = []
  const rows = [...args.fuel.entries()]
  const s = sumFuel(rows.map(([, f]) => f))
  if (s.inField > 0) {
    const logged = rows.filter(([, f]) => f.inField.basis === 'logged').length
    const est = rows.filter(([, f]) => f.inField.basis === 'farm' || f.inField.basis === 'default').length
    out.push({
      key: lineKey(FUEL_FIELD_LINE),
      side: 'input',
      label: FUEL_FIELD_LINE,
      unit: 'L',
      price: args.dieselPerL,
      amount: s.inField,
      source: [logged && `logged by the machine on ${logged} pass${logged === 1 ? '' : 'es'}`, est && `estimated on ${est}`].filter(Boolean).join(', '),
      passes: rows.filter(([, f]) => f.inField.litres > 0).map(([id, f]) => ({ operationId: id, share: f.inField.litres / s.inField })),
      problem: null,
    })
  }
  if (s.travel > 0) {
    out.push({
      key: lineKey(FUEL_ROAD_LINE),
      side: 'input',
      label: FUEL_ROAD_LINE,
      unit: 'L',
      price: args.dieselPerL,
      amount: s.travel,
      source: `${Math.round(s.travelKm)} km of road from the shop to the field entry and back, one round trip a day worked`,
      passes: [],
      problem: null,
    })
  }
  const t = args.trucking
  if (args.harvested && t?.cost && t.cost.legs.length && t.tonnes) {
    const mode = HAUL_MODES.find((m) => m.key === t.plan?.mode)
    // The truck's fuel only. The driver is on the payroll, which the fixed
    // expenses already charge every acre; booking his hours here as well
    // would count the same wages twice. (Travel & trucking still shows the
    // driver: there it prices a haul, own trucks against hiring one.)
    out.push({
      key: lineKey(TRUCKING_LINE),
      side: 'input',
      label: TRUCKING_LINE,
      unit: 't',
      price: t.cost.fuel / t.tonnes,
      amount: t.tonnes,
      source: `${mode?.label.toLowerCase() ?? 'haul plan'}${t.site ? ` (${t.site.name})` : ''}: the truck's fuel, ${t.cost.legs.reduce((n, l) => n + l.loads, 0)} loads (the driver is on the payroll, in the fixed expenses)`,
      passes: [],
      problem: t.cost.missing,
    })
  }
  return out
}

/** A canal pivot, as far as the district's rate needs it. */
export type RatePivot = { field_id: string; water_source: string | null; acres_irrigated: unknown; operated_by?: string | null }

/**
 * SMRID's rate on a field's canal pivots: the year's rate × the assessed
 * acres (the pivot's irrigated acres), or the parcel minimum where that is
 * more. Charged only where the farm pays it (Sam, 7 Oct 2026): not on land
 * the landowner runs, and not under a land deal — on the 50/50 fields the
 * owner covers the water, and on Novak's cash rent the landowner pays it.
 */
export function districtRateLine(args: { fieldId: string; year: number; pivots: RatePivot[]; rate: DistrictRate | null | undefined; deals: LandDeal[] }): AutoLine | null {
  const canal = args.pivots.filter((p) => p.field_id === args.fieldId && p.water_source === 'smrid' && !p.operated_by)
  if (!canal.length || !args.rate) return null
  if (dealFor(args.deals.filter((d) => d.direction !== 'out'), args.fieldId, args.year)) return null
  const acres = canal.reduce((n, p) => n + (Number(p.acres_irrigated) || 0), 0)
  if (!(acres > 0)) return null
  const r = args.rate
  const total = Math.max(acres * r.ratePerAcre, r.minPerParcel ?? 0)
  return {
    key: lineKey(DISTRICT_RATE_LINE),
    side: 'input',
    label: DISTRICT_RATE_LINE,
    unit: 'ac',
    price: total / acres,
    amount: acres,
    source: `${r.year} rate $${r.ratePerAcre.toFixed(2)} an assessed acre${total > acres * r.ratePerAcre ? ` (the $${r.minPerParcel} parcel minimum)` : ''} × the pivot's ${Math.round(acres * 10) / 10} ac, before GST`,
    passes: [],
    problem: null,
  }
}

/**
 * Fuel and trucking lines for every field in a season, for the books.
 * `linesFor` is null-safe until everything has loaded.
 */
export function useOperatingCostLines(year: number, ops: FuelOpRow[] | undefined) {
  const model = useFuelModel()
  const basics = useBasics()
  const truck = useTruckSettings()
  const { data: plans } = useHaulPlans(year)
  const { data: sites } = useSites()
  const { data: crops } = useCrops()
  const { trip } = useTrips()
  const { data: pivots } = useFieldPivots()
  const { data: rate } = useDistrictRate(year)
  const { data: deals } = useLandDeals()
  return useMemo(() => {
    const byField = new Map<string, FuelOpRow[]>()
    for (const o of ops ?? []) {
      if (!o.field_id || o.crop_season !== year) continue
      const list = byField.get(o.field_id) ?? []
      list.push(o)
      byField.set(o.field_id, list)
    }
    const lbOf = (name: string | null) => {
      const c = name ? crops?.find((x) => x.name === name) : null
      return c?.test_weight_lb_per_bu != null ? Number(c.test_weight_lb_per_bu) : null
    }
    return (fieldId: string, season: { cropName: string | null; yieldUnit: string | null; yieldTotal: number | null } | null | undefined): AutoLine[] => {
      if (!model.ready) return []
      const fuel = fuelByOp(byField.get(fieldId) ?? [], fieldId, model)
      const harvested = season?.yieldTotal != null && season.yieldTotal > 0
      const trucking = truckingFor({
        fieldId,
        plan: plans?.get(fieldId) ?? null,
        sites: sites ?? [],
        crop: season ? { name: season.cropName, unit: season.yieldUnit, quantity: season.yieldTotal, lbPerBu: lbOf(season.cropName) } : null,
        trip,
        truck,
        basics,
      })
      const water = districtRateLine({ fieldId, year, pivots: (pivots ?? []) as RatePivot[], rate, deals: deals ?? [] })
      return [...operatingLines({ fuel, dieselPerL: basics.dieselPerL, trucking, harvested }), ...(water ? [water] : [])]
    }
  }, [ops, year, model, basics, truck, plans, sites, crops, trip, pivots, rate, deals])
}
