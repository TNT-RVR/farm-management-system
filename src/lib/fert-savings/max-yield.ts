/**
 * The maximum-yield blend (Sam, 13 Oct 2026): the rates thought to give the
 * highest attainable yield — the top of the response curve, not the economic
 * optimum — ignoring what the fertilizer costs, how efficiently it is used and
 * what it does to the soil over time.
 *
 * What it still respects are the limits that LOWER yield, because those are
 * yield problems, not cost problems:
 *  - soil + fertilizer N caps for lodging (cereals) and delayed maturity
 *    (canola, beans, corn, potatoes), from Alberta's tables;
 *  - haying-off on dryland, where water and not N sets the top;
 *  - salinity, which lowers the yield the crop can reach (Maas–Hoffman);
 *  - seed-row safety: what can go with the seed without thinning the stand.
 *
 * The rates, per nutrient, on top of the field's own soil test:
 *  - N: soil (0–24 in nitrate; 0–12 for beans) + fertilizer up to the lower of
 *    the curve's plateau (99% of the top yield on the Agdex 100/541-1 irrigated
 *    curves) and Alberta's cap on soil + fertilizer N. Crops without a curve
 *    use the top of Alberta's published range (Agdex 142/532-1 beans; the
 *    potato and corn caps in alberta.ts). Dryland takes 60% of it — the app's
 *    long-standing dryland scaling of the irrigated curves (Alberta Fertilizer
 *    Guide 2004 dryland rates run at roughly half to 60%).
 *  - P2O5, K2O, S: the Alberta table rate at the soil test, raised to what a
 *    top crop removes wherever the table says the crop still responds — the
 *    build-and-maintain rule, which keeps the soil from ever being the limit
 *    (Olson et al. 1987; IPNI 4R Plant Nutrition Manual, 2016). No credit for
 *    irrigation-water sulphur, which arrives through the season rather than
 *    at canola's bolting demand.
 *  - A banded P starter on every soil short of excessive: banded P on calcareous
 *    southern Alberta soils pays 30–50% of the time even on high tests
 *    (Agdex 542-3; Karamanos et al., Can. J. Plant Sci.). The economic floor is
 *    10 lb; at maximum yield it is 20 (15 for canola and flax, their seed-row
 *    limit).
 *  - Cereals on a soil too high in K for the table still get 20 lb K2O as
 *    potash for its chloride, where soil Cl is low: Prairie wheat and barley
 *    respond to Cl below about 30 lb/ac in 0–24 in (Fixen et al. 1986;
 *    Karamanos & Flore, Saskatchewan). Not on saline soil.
 *  - Canola gets at least 20 lb S whatever the test (Canola Council: sulphate
 *    tests are too patchy to trust a zero).
 */
import { cropRemoval } from './tools'
import { cropKind, kRateAlberta, N_CURVES, curveYield, nTargetFor, olsenToMkLbAc, P_STOP_LB_AC, pRateAlberta, seedRowPCap, sRateAlberta, zincCritical, type CropKind, type SoilZone } from './alberta'

export type MaxYieldSoil = {
  /** Nitrate-N, lb/ac, 0–24 in. */
  nitrate0to24: number | null
  /** Nitrate-N, lb/ac, 0–12 in (beans read this depth). */
  nitrate0to12?: number | null
  /** Olsen (bicarbonate) P, ppm, 0–6 in. */
  olsenPpm: number | null
  /** K, ppm, 0–6 in. */
  kPpm: number | null
  /** Sulphate-S, lb/ac, 0–12 in. */
  sLbAc: number | null
  /** DTPA zinc, ppm, 0–6 in. */
  znPpm: number | null
  /** Electrical conductivity, dS/m (= mS/cm), 0–6 in. */
  ecDsM: number | null
  /** Chloride, ppm, 0–6 in. */
  clPpm: number | null
}

export type MaxYieldCeiling = {
  kind: 'lodging' | 'maturity' | 'dryland' | 'salinity' | 'seed-row' | 'zinc'
  /** A few words for a chip. */
  label: string
  /** One sentence for its tooltip. */
  detail: string
}

export type MaxYieldPlan = {
  /** lb/ac of nutrient: N, P2O5, K2O, S, Zn. */
  targets: { n: number; p: number; k: number; s: number; zn: number }
  /** Where each number came from, a few words each. */
  why: { n: string; p: string; k: string; s: string; zn: string }
  /** Limits that lower yield, kept in. */
  ceilings: MaxYieldCeiling[]
  /** What can go with the seed; the rest is banded away or broadcast. */
  seedRow: { p2o5: number | null; ureaN: number | null; note: string }
  /** Soil tests the plan needed and did not have. */
  missing: string[]
  /** Share of the top yield the soil's salinity allows, 0–1. */
  relativeYield: number
}

const r5 = (x: number) => Math.round(x / 5) * 5

/**
 * Total N where the Alberta curve reaches 99% of its own top — the plateau.
 * Agdex 100/541-1's tables flatten past 150–210 lb/ac.
 */
export function curvePlateau(kind: CropKind): number | null {
  const c = N_CURVES[kind]
  if (!c) return null
  const top = c.points[c.points.length - 1][1]
  for (let total = 0; total <= c.points[c.points.length - 1][0]; total += 1) {
    if ((curveYield(kind, total) ?? 0) >= top * 0.99) return total
  }
  return c.points[c.points.length - 1][0]
}

/**
 * Salt tolerance, saturated-paste ECe in dS/m: yield falls `slope` % for every
 * dS/m over `threshold`. Maas & Grattan (1999), Maas & Hoffman (1977).
 */
const SALT_TOLERANCE: Partial<Record<CropKind, { threshold: number; slope: number }>> = {
  cwrs: { threshold: 6.0, slope: 7.1 },
  durum: { threshold: 5.9, slope: 3.8 },
  'feed barley': { threshold: 8.0, slope: 5.0 },
  'malt barley': { threshold: 8.0, slope: 5.0 },
  canola: { threshold: 11.0, slope: 13 },
  flax: { threshold: 1.7, slope: 12 },
  corn: { threshold: 1.7, slope: 12 },
  potato: { threshold: 1.7, slope: 12 },
  bean: { threshold: 1.0, slope: 19 },
  alfalfa: { threshold: 2.0, slope: 7.3 },
}

/** Share of top yield at this EC. Lab EC is read as ECe — approximate. */
export function saltRelativeYield(crop: string | null | undefined, ecDsM: number | null | undefined): number {
  const t = SALT_TOLERANCE[cropKind(crop)]
  if (!t || ecDsM == null || !Number.isFinite(ecDsM) || ecDsM <= t.threshold) return 1
  return Math.max(0.1, 1 - (t.slope / 100) * (ecDsM - t.threshold))
}

/** Above this EC no fertilizer salt goes near the seed, and no potash for chloride. */
export const SALINE_EC = 4

/**
 * Urea N that is safe with the seed, lb N/ac, at about 1 in spread on 9–10 in
 * rows in good moisture (Saskatchewan "Guidelines for safe rates of fertilizer
 * applied with the seed"; Manitoba Soil Fertility Guide). Canola, flax, beans,
 * corn and potatoes take none (Canola Council; Agdex 142/532-1).
 */
export function seedRowUreaCap(crop: string | null | undefined, texture: string | null | undefined): number | null {
  const t = (texture ?? '').toLowerCase()
  switch (cropKind(crop)) {
    case 'cwrs':
    case 'durum':
    case 'feed barley':
    case 'malt barley':
    case 'oats':
      return /sand/.test(t) ? 15 : /clay/.test(t) ? 25 : 20
    case 'canola':
    case 'flax':
    case 'bean':
    case 'corn':
    case 'potato':
    case 'alfalfa':
    case 'sainfoin':
    case 'pea':
      return 0
    default:
      return null
  }
}

const LEGUMES: CropKind[] = ['pea', 'alfalfa', 'sainfoin']
const CEREALS: CropKind[] = ['cwrs', 'durum', 'feed barley', 'malt barley', 'oats']

/** The most N the soil plus fertilizer should reach for the top yield, before dryland and salinity. */
function nTop(kind: CropKind, crop: string | null | undefined): { total: number; ceiling: MaxYieldCeiling | null; why: string } | null {
  const c = N_CURVES[kind]
  if (c) {
    const plateau = curvePlateau(kind)!
    if (c.cap < plateau) {
      const reason = kind === 'malt barley' ? 'lodging and malt protein' : kind === 'canola' ? 'lodging and late maturity' : 'lodging'
      return {
        total: c.cap,
        why: `Agdex 100/541-1 cap, ${c.cap} soil + fertilizer`,
        ceiling: {
          kind: kind === 'canola' ? 'maturity' : 'lodging',
          label: `${c.cap} lb N cap`,
          detail: `The yield curve keeps rising to about ${r5(plateau)} lb/ac soil + fertilizer N, but Alberta caps it at ${c.cap} for ${reason}.`,
        },
      }
    }
    return { total: plateau, why: `Agdex 100/541-1 curve plateau, ${plateau} soil + fertilizer`, ceiling: null }
  }
  const t = nTargetFor(crop)
  if (!t) return null
  if (t.total === 0) return { total: 0, why: 'Legume: fixes its own N', ceiling: null }
  // Beans: the top of the row-crop range (80–100); 100–120 is for solid-seeded.
  const total = kind === 'bean' ? 100 : t.cap
  const detail =
    kind === 'bean'
      ? 'More N delays bean maturity into frost and feeds white mould (Agdex 142/532-1: 80–100 row-cropped, up to 120 solid-seeded).'
      : kind === 'potato'
        ? 'More N delays tuber bulking and skin set; the top of Alberta trial responses is about 200 lb/ac soil + fertilizer.'
        : 'More N delays corn maturity in a short heat-unit season; southern Alberta trials flatten well before 200.'
  return { total, why: `${t.source.split(':')[0]}; top ${total} soil + fertilizer`, ceiling: { kind: 'maturity', label: `${total} lb N cap`, detail } }
}

export function maxYieldPlan(args: {
  crop: string | null | undefined
  irrigated: boolean
  zone?: SoilZone
  texture?: string | null
  /** The field's top expected yield (the high end of its range), in `yieldUnit`. */
  topYield?: number | null
  yieldUnit?: string | null
  soil: MaxYieldSoil
}): MaxYieldPlan | null {
  const kind = cropKind(args.crop)
  if (kind === 'other' || kind === 'forage') return null
  const soil = args.soil
  const missing: string[] = []
  const ceilings: MaxYieldCeiling[] = []
  const ry = saltRelativeYield(args.crop, soil.ecDsM)
  const saline = soil.ecDsM != null && soil.ecDsM >= SALINE_EC
  if (ry < 0.98) {
    ceilings.push({
      kind: 'salinity',
      label: `salinity: ${Math.round(ry * 100)}% yield`,
      detail: `EC ${soil.ecDsM} dS/m caps this crop at about ${Math.round(ry * 100)}% of its top yield (Maas–Hoffman), so N and removal are scaled to it. Lab EC read as saturated paste — approximate.`,
    })
  }
  const removal = cropRemoval(args.crop, args.topYield, args.yieldUnit)
  const remove = (x: number | undefined) => (x == null ? 0 : x * ry)

  // ---- N
  let n = 0
  let nWhy: string
  const top = nTop(kind, args.crop)
  const soilN = kind === 'bean' ? (soil.nitrate0to12 ?? soil.nitrate0to24) : soil.nitrate0to24
  if (top && top.total > 0) {
    let total = top.total
    if (top.ceiling) ceilings.push(top.ceiling)
    if (!args.irrigated) {
      total *= 0.6
      ceilings.push({
        kind: 'dryland',
        label: 'dryland: 60%',
        detail: 'Dryland takes 60% of the irrigated maximum: past what the moisture can carry, extra N grows leaf that hays off in a dry July and lowers yield.',
      })
    }
    total *= ry
    if (soilN == null || !Number.isFinite(soilN)) {
      missing.push(kind === 'bean' ? 'nitrate 0–12 in' : 'nitrate 0–24 in')
      nWhy = `${top.why}; no nitrate test, so no N set`
    } else {
      n = Math.max(0, r5(total - soilN))
      nWhy = `${top.why}${args.irrigated ? '' : ' × 60% dryland'}${ry < 0.98 ? ` × ${Math.round(ry * 100)}% salinity` : ''}, less ${Math.round(soilN)} soil nitrate`
    }
  } else if (top) {
    nWhy = top.why
  } else {
    nWhy = 'No Alberta maximum for this crop'
  }

  // ---- P2O5
  let p = 0
  let pWhy: string
  const pr = pRateAlberta({ crop: args.crop, olsenPpm: soil.olsenPpm, irrigated: args.irrigated, zone: args.zone })
  const pCap = seedRowPCap(args.crop)
  const starter = kind === 'canola' || kind === 'flax' ? 15 : 20
  if (!pr) {
    missing.push('Olsen P')
    pWhy = 'No P test'
  } else {
    const responds = !pr.stop && !pr.floored && pr.rate > 0
    const fromRemoval = responds ? remove(removal?.p2o5) : 0
    const veryHigh = olsenToMkLbAc(soil.olsenPpm!) > P_STOP_LB_AC
    const floor = LEGUMES.includes(kind) && kind !== 'pea' ? 0 : veryHigh ? 0 : starter
    p = r5(Math.max(responds ? pr.rate : 0, fromRemoval, floor))
    pWhy = veryHigh
      ? 'Soil P excessive: no yield response'
      : fromRemoval > pr.rate && fromRemoval >= floor
        ? `Removal by a ${args.topYield} ${args.yieldUnit ?? ''} crop (table ${pr.rate})`.replace(/\s+/g, ' ')
        : responds && pr.rate >= floor
          ? pr.source
          : `Banded starter ${floor} (table ${pr.rate})`
  }

  // ---- K2O
  let k = 0
  let kWhy: string
  const kr = kRateAlberta({ crop: args.crop, kPpm: soil.kPpm })
  if (!kr) {
    if (soil.kPpm == null) missing.push('K')
    kWhy = soil.kPpm == null ? 'No K test' : 'No Alberta K table for this crop'
  } else if (kr.rate > 0) {
    const fromRemoval = remove(removal?.k2o)
    k = r5(Math.max(kr.rate, fromRemoval))
    kWhy = fromRemoval > kr.rate ? `Removal by a ${args.topYield} ${args.yieldUnit ?? ''} crop (table ${kr.rate})`.replace(/\s+/g, ' ') : kr.source
  } else if (CEREALS.includes(kind) && !saline && (soil.clPpm == null || soil.clPpm < 4)) {
    k = 20
    kWhy = soil.clPpm == null ? 'Potash for chloride (no Cl test)' : 'Potash for chloride: soil Cl low'
  } else {
    kWhy = 'Soil K above the response range'
  }

  // ---- S
  let s: number
  let sWhy: string
  // The dryland call is the table without any water credit.
  const sr = sRateAlberta({ crop: args.crop, soilSLbAc: soil.sLbAc, irrigated: false })
  if (!sr) {
    if (soil.sLbAc == null) missing.push('sulphate-S')
    s = kind === 'canola' ? 20 : 0
    sWhy = kind === 'canola' ? 'Canola: 20 lb S whatever the test' : soil.sLbAc == null ? 'No S test' : 'No Alberta S table for this crop'
  } else {
    const fromRemoval = sr.rate > 0 ? remove(removal?.s) : 0
    s = r5(Math.max(sr.rate, fromRemoval, kind === 'canola' ? 20 : 0))
    sWhy = fromRemoval > sr.rate && fromRemoval > 20 ? 'Removal by a top crop' : kind === 'canola' && sr.rate < 20 ? 'Canola: 20 lb S whatever the test' : 'Agdex 100/541-1 Table 9, no water credit'
  }

  // ---- Zn
  let zn = 0
  let znWhy = 'Not needed'
  const z = zincCritical(args.crop)
  if (z && soil.znPpm == null) {
    missing.push('zinc')
    znWhy = 'No zinc test'
  } else if (z && soil.znPpm! < z.critical) {
    zn = kind === 'bean' && soil.znPpm! < 1 ? 5 : 3
    znWhy = `DTPA Zn ${soil.znPpm} under ${z.critical}`
    if (p >= 50) {
      ceilings.push({ kind: 'zinc', label: 'P–Zn', detail: 'High P on a low-zinc calcareous soil can bring on zinc deficiency; the zinc here is part of the maximum.' })
    }
  }

  // ---- What can go with the seed
  const urea = seedRowUreaCap(args.crop, args.texture)
  const pSeed = pCap?.cap ?? null
  const seedNote =
    pSeed === 0
      ? 'Nothing with the seed: band it all away'
      : pSeed == null
        ? 'No published seed-row limit for this crop: band away from the seed'
        : `With the seed: up to ${pSeed} lb P₂O₅${urea ? ` and ${urea} lb urea N` : ', no urea'}; band or broadcast the rest`
  const overSeed = (pSeed != null && p > pSeed) || (urea != null && n > urea)
  if (overSeed) {
    ceilings.push({
      kind: 'seed-row',
      label: 'seed-row limit',
      detail: `${seedNote}. More with the seed thins the stand and costs yield${saline ? ', and worse on this saline soil' : ''}.`,
    })
  }

  return {
    targets: { n, p, k, s, zn },
    why: { n: nWhy, p: pWhy, k: kWhy, s: sWhy, zn: znWhy },
    ceilings,
    seedRow: { p2o5: pSeed, ureaN: urea, note: seedNote },
    missing,
    relativeYield: ry,
  }
}

/* -------------------------------------------------- the field's soil test */

export type SoilSample = {
  sample_code: string
  depth_top_in: number | null
  depth_bottom_in: number | null
  no3n_lb_ac: number | null
  p_bicarb_ppm: number | null
  k_ppm: number | null
  so4s_ppm: number | null
  zn_ppm: number | null
  ec_ms_cm: number | null
  cl_ppm: number | null
}
export type SoilReport = { crop_year: number; samples: SoilSample[] }

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const site = (code: string) => code.replace(/[A-Z]$/, '')

/** Nitrate summed down each site to `depth` inches, sites averaged. */
function nitrateTo(samples: SoilSample[], depth: number): number | null {
  const bySite = new Map<string, number>()
  for (const s of samples) {
    if (s.no3n_lb_ac == null) continue
    const topIn = s.depth_top_in ?? 0
    if (topIn >= depth) continue
    // A layer that runs past the depth counts in proportion.
    const bottom = s.depth_bottom_in ?? topIn + 6
    const share = bottom > depth && bottom > topIn ? (depth - topIn) / (bottom - topIn) : 1
    bySite.set(site(s.sample_code), (bySite.get(site(s.sample_code)) ?? 0) + Number(s.no3n_lb_ac) * share)
  }
  return mean([...bySite.values()])
}

/** Sulphate-S, lb/ac in 0–12 in: about 2 lb/ac per ppm per 6 in, the deepest layer carried down. */
function sulphate0to12(samples: SoilSample[]): number | null {
  const bySite = new Map<string, SoilSample[]>()
  for (const s of samples) if (s.so4s_ppm != null) bySite.set(site(s.sample_code), [...(bySite.get(site(s.sample_code)) ?? []), s])
  const vals: number[] = []
  for (const layers of bySite.values()) {
    layers.sort((a, b) => (a.depth_top_in ?? 0) - (b.depth_top_in ?? 0))
    let covered = 0
    let lb = 0
    let last = 0
    for (const l of layers) {
      const t = Math.max(covered, l.depth_top_in ?? 0)
      const b = Math.min(12, l.depth_bottom_in ?? t + 6)
      if (b <= t) continue
      lb += Number(l.so4s_ppm) * ((b - t) / 3)
      covered = b
      last = Number(l.so4s_ppm)
    }
    if (covered < 12) lb += last * ((12 - covered) / 3)
    vals.push(lb)
  }
  return mean(vals)
}

/**
 * The field's soil for the maximum-yield blend, from its own uploaded tests:
 * nitrate from the newest report (it changes every season); P, K, S, Zn, EC
 * and Cl as the average of the last five seasons' reports, each report
 * averaged first.
 */
export function fieldSoilForMaxYield(reports: SoilReport[], cropYear: number): (MaxYieldSoil & { nitrateYear: number | null; years: number[] }) | null {
  const recent = reports.filter((r) => r.crop_year <= cropYear && r.crop_year > cropYear - 5 && r.samples.length)
  if (!recent.length) return null
  const newestYear = Math.max(...recent.map((r) => r.crop_year))
  const newest = recent.filter((r) => r.crop_year === newestYear).flatMap((r) => r.samples)
  const topOf = (r: SoilReport) => r.samples.filter((s) => (s.depth_top_in ?? 0) === 0)
  const avgTop = (key: 'p_bicarb_ppm' | 'k_ppm' | 'zn_ppm' | 'ec_ms_cm' | 'cl_ppm') => {
    const perReport = recent
      .map((r) => mean(topOf(r).map((s) => s[key]).filter((v): v is number => v != null).map(Number)))
      .filter((v): v is number => v != null)
    const m = mean(perReport)
    return m == null ? null : Math.round(m * 100) / 100
  }
  const sPer = recent.map((r) => sulphate0to12(r.samples)).filter((v): v is number => v != null)
  const n24 = nitrateTo(newest, 24)
  return {
    nitrate0to24: n24,
    nitrate0to12: nitrateTo(newest, 12),
    olsenPpm: avgTop('p_bicarb_ppm'),
    kPpm: avgTop('k_ppm'),
    sLbAc: mean(sPer),
    znPpm: avgTop('zn_ppm'),
    ecDsM: avgTop('ec_ms_cm'),
    clPpm: avgTop('cl_ppm'),
    nitrateYear: n24 == null ? null : newestYear,
    years: [...new Set(recent.map((r) => r.crop_year))].sort(),
  }
}
