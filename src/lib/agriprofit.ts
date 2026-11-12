/**
 * Putting our own budget beside Alberta's published benchmark.
 *
 * The comparison is deliberately shallow. Our cost per acre is built from the
 * crop plan, the input prices and the farm's fixed costs; the benchmark's is
 * built from what Alberta producers reported, with its own ideas about unpaid
 * labour, depreciation and land. Mapping one of our cost buckets onto one of
 * theirs would invent a correspondence that is not there, so this matches the
 * crop, lines the headline figures up, and leaves the reading to whoever is
 * looking at it.
 *
 * Both of the benchmark's cost totals are carried for that reason: cash costs
 * leave out unpaid labour and depreciation, total production costs put them in,
 * and which one our number belongs against depends on how the budget was built
 * that year.
 */

import {
  AGRIPROFIT_SOURCE,
  BENCHMARK_CROP_LABELS,
  DRYLAND_BLACK_2024,
  IRRIGATED_2024,
  type AgriProfitRow,
} from './agriprofit-data'

export type BenchmarkZone = keyof typeof AGRIPROFIT_SOURCE

export const BENCHMARK_YEAR = 2024

const rowsFor = (zone: BenchmarkZone) => (zone === 'irrigated' ? IRRIGATED_2024 : DRYLAND_BLACK_2024)

/** Punctuation and case gone, the way the crop-label maps expect. */
export const normaliseName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()

/**
 * The benchmark row for one of our crops, or null.
 *
 * Matched through an explicit label map, never by similarity: the crops with no
 * 2024 benchmark — potatoes, dry beans, hybrid seed canola, sugar beet — must
 * come back empty rather than borrow the nearest cereal's costs.
 */
export function benchmarkFor(cropName: string | null | undefined, zone: BenchmarkZone): AgriProfitRow | null {
  if (!cropName) return null
  const want = BENCHMARK_CROP_LABELS[normaliseName(cropName)]
  if (!want) return null
  return rowsFor(zone).find((r) => r.crop === want) ?? null
}

/** Which of our crops the benchmark has nothing for, for saying so out loud. */
export function unmatchedCrops(cropNames: (string | null | undefined)[], zone: BenchmarkZone) {
  return [
    ...new Set(
      cropNames
        .filter((n): n is string => Boolean(n))
        .filter((n) => !benchmarkFor(n, zone)),
    ),
  ]
}

export type BenchmarkLine = {
  /** The crop as we name it. */
  crop: string
  acres: number
  ourYield: number | null
  ourUnit: string | null
  ourCostPerAcre: number | null
  ourMarginPerAcre: number | null
  benchmark: AgriProfitRow | null
  /** True when our yield unit and the benchmark's are the same word. */
  sameUnit: boolean
}

/**
 * Line up one budget row against the benchmark.
 *
 * `sameUnit` decides whether the two yields can be read against each other at
 * all. The benchmark quotes hay in tonnes; a farm that books hay in tons would
 * otherwise appear 10 per cent short of a benchmark it is level with.
 */
export function benchmarkLine(
  ours: {
    cropName: string
    acres: number
    yieldPerAcre: number | null
    yieldUnit: string | null
    costPerAcre: number | null
    marginPerAcre: number | null
  },
  zone: BenchmarkZone,
): BenchmarkLine {
  const benchmark = benchmarkFor(ours.cropName, zone)
  const ourUnit = ours.yieldUnit ? normaliseName(ours.yieldUnit) : null
  const theirUnit = benchmark?.unit ? normaliseName(benchmark.unit) : null
  return {
    crop: ours.cropName,
    acres: ours.acres,
    ourYield: ours.yieldPerAcre,
    ourUnit: ours.yieldUnit,
    ourCostPerAcre: ours.costPerAcre,
    ourMarginPerAcre: ours.marginPerAcre,
    benchmark,
    sameUnit: Boolean(ourUnit && theirUnit && singular(ourUnit) === singular(theirUnit)),
  }
}

/**
 * The unit two words both mean, where they mean the same one.
 *
 * MT and tonne are one unit and must compare equal, or a silage crop level with
 * the benchmark reads as mismatched. A TON is not a tonne — 2,000 lb against
 * 2,205 — and is deliberately its own unit, because treating them as one would
 * quietly move every hay and silage comparison by ten per cent.
 */
const UNIT_ALIASES: Record<string, string> = {
  mt: 'tonne',
  t: 'tonne',
  tonne: 'tonne',
  tonnes: 'tonne',
  tonnes_metric: 'tonne',
  ton: 'ton',
  tons: 'ton',
  bu: 'bushel',
  bus: 'bushel',
  bushel: 'bushel',
  bushels: 'bushel',
  lb: 'pound',
  lbs: 'pound',
  pound: 'pound',
  pounds: 'pound',
  cwt: 'cwt',
}

const singular = (u: string) => UNIT_ALIASES[u] ?? (u.endsWith('s') ? u.slice(0, -1) : u)

/** Pounds in one of each mass unit. A tonne is 2,204.62 lb, a ton 2,000. */
const LB_PER: Record<string, number> = { pound: 1, ton: 2000, tonne: 2204.62 }

/**
 * Our yield in the benchmark's own unit, where that conversion is exact.
 *
 * Mass converts and nothing else does. A bushel is not a mass without a test
 * weight that differs by crop, so bushels against tonnes stay uncompared and
 * flagged rather than converted on an assumed weight — which is the same
 * reasoning that keeps a ton and a tonne separate units.
 */
export function inBenchmarkUnit(
  value: number | null,
  ourUnit: string | null,
  theirUnit: string | null,
): number | null {
  if (value == null || !ourUnit || !theirUnit) return null
  const from = LB_PER[singular(normaliseName(ourUnit))]
  const to = LB_PER[singular(normaliseName(theirUnit))]
  if (!from || !to || from === to) return null
  return (value * from) / to
}

/** The benchmark's own variable-cost lines, biggest first, for a breakdown. */
export function costLines(row: AgriProfitRow) {
  const lines: [string, number | null][] = [
    ['Seed and seed cleaning', row.seed],
    ['Fertilizer', row.fertilizer],
    ['Chemicals', row.chemicals],
    ['Hail, crop insurance and premiums', row.insurancePremiums],
    ['Trucking and marketing', row.trucking],
    ['Fuel', row.fuel],
    ['Irrigation fuel and electricity', row.irrigationPower],
    ['Repairs — machine', row.repairsMachine],
    ['Repairs — buildings', row.repairsBuildings],
    ['Utilities and miscellaneous', row.utilities],
    ['Custom work and specialized labour', row.customWork],
    ['Operating interest paid', row.operatingInterest],
    ['Paid labour', row.paidLabour],
    ['Unpaid labour', row.unpaidLabour],
  ]
  return lines
    .filter((l): l is [string, number] => l[1] != null && l[1] > 0)
    .sort((a, b) => b[1] - a[1])
}

/** The capital-cost lines, in the order the publication prints them. */
export function capitalLines(row: AgriProfitRow) {
  const lines: [string, number | null][] = [
    ['Cash and share rent, land lease', row.rent],
    ['Taxes, water rates, licences and insurance', row.taxesAndWater],
    ['Equipment and building depreciation', row.depreciation],
    ['Lease payments', row.leasePayments],
    ['Paid capital interest', row.capitalInterest],
  ]
  return lines.filter((l): l is [string, number] => l[1] != null && l[1] > 0)
}

export { AGRIPROFIT_SOURCE }
export type { AgriProfitRow }
