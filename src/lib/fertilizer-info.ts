import { farmRetailer } from './farm-context'
/**
 * What each fertilizer is, in a paragraph, for the info button on the
 * market tab.
 *
 * Keyed by what the product IS rather than by its name, because ICI writes
 * "Tonne 46-0-0", Deere writes "46-0-0" and a person says "urea", and the
 * button should say the same thing for all three. Blends get a paragraph
 * built from their analysis, since each one is a one-off recipe.
 */
export type FertKind =
  | 'urea'
  | 'uan'
  | 'map'
  | 'potash'
  | 'esn'
  | 'ams'
  | 'ats'
  | 'sulf4r'
  | 'anhydrous'
  | 'blend'
  | 'other'

export type FertInfo = { kind: FertKind; title: string; what: string; usedFor: string }

const INFO: Record<Exclude<FertKind, 'blend' | 'other'>, Omit<FertInfo, 'kind'>> = {
  urea: {
    title: 'Urea 46-0-0',
    what: 'Dry granular nitrogen, 46% N — the most concentrated dry nitrogen there is, which is why it ships and spreads cheaply per pound of N. It converts to ammonium in the soil within days and can lose nitrogen to the air if it sits on a warm, wet surface without being worked in or rained in.',
    usedFor: 'The main nitrogen source in dry blends and for top-dressing or pre-seed broadcast. Best banded or incorporated; surface applications go on ahead of rain or irrigation.',
  },
  uan: {
    title: 'UAN 28-0-0',
    what: 'Urea ammonium nitrate solution, 28% N by weight: a quarter of its N is nitrate the crop can take up at once, half is urea, a quarter ammonium. About 1.28 kg per litre, so 28-0-0 carries roughly 0.36 kg of N in every litre.',
    usedFor: 'Liquid nitrogen for the sprayer or the fertigation pump: dribble-banded, streamed, or run through the pivot. What this farm uses for in-season N on corn and beans and as the carrier for Sulf4R.',
  },
  map: {
    title: 'MAP 11-52-0',
    what: 'Monoammonium phosphate: 52% phosphate (P₂O₅) with 11% nitrogen along for the ride. Slightly acidic where it dissolves, which keeps the phosphorus available on high-pH prairie soils longer than DAP would.',
    usedFor: 'The phosphorus in nearly every dry blend and the seed-placed starter. Phosphorus barely moves in soil, so it goes on at seeding, in or beside the row, rather than broadcast later.',
  },
  potash: {
    title: 'Potash 0-0-60',
    what: 'Muriate of potash, potassium chloride, 60% K₂O. Mined in Saskatchewan, so it is the one fertilizer where the freight runs the other way. Very soluble; the chloride is harmless at field rates but adds to salt index in the seed row.',
    usedFor: 'Potassium where the soil test calls for it — the irrigated sandy fields and anywhere the K is under about 150 ppm. Goes in the blend at seeding or is broadcast ahead of tillage; kept out of the seed row at high rates.',
  },
  esn: {
    title: 'ESN 44-0-0',
    what: 'Environmentally Smart Nitrogen: urea inside a polymer coat that lets water in and nitrogen out over weeks, the release speeding up as the soil warms. 44% N because the coating takes 2% of the weight.',
    usedFor: 'Seed-row-safe nitrogen at higher rates than urea, and nitrogen that lasts into the season on sandy or leaching ground. Usually blended with urea rather than used alone; costs a premium over urea per pound of N.',
  },
  ams: {
    title: 'Ammonium sulphate 21-0-0-24',
    what: 'A dry sulphur source, 24% sulphate sulphur with 21% nitrogen, all of it available to the crop the year it goes on. Acidifying, which is a small bonus on this farm’s high-pH soils.',
    usedFor: 'Sulphur for canola and for any crop on a low-S soil test. Goes in the dry blend at seeding; the 21-0-0-10S blend a retailer mixes is this cut with urea.',
  },
  ats: {
    title: 'Ammonium thiosulphate 12-0-0-26',
    what: 'Liquid sulphur, 26% S with 12% N, that mixes straight into UAN. Half the sulphur is available quickly and half converts over a few weeks.',
    usedFor: 'Sulphur through the sprayer or the pivot alongside UAN, where a dry product would mean a second pass.',
  },
  sulf4r: {
    title: 'Sulf4R 0-0-0-17-21',
    what: 'A liquid sulphur product for tank-mixing with UAN: 17% sulphur plus a calcium fraction, in a form that stays in solution and does not salt out in the tank. No nitrogen of its own.',
    usedFor: 'Sulphur in-season through the sprayer with UAN on canola and beans, or in the fertigation water, where a dry sulphur source would not go on.',
  },
  anhydrous: {
    title: 'Anhydrous ammonia 82-0-0',
    what: 'Nitrogen as a pressurised gas, 82% N — the cheapest nitrogen per pound but needs its own toolbar, tanks and a licence, and must be knifed into moist soil to seal.',
    usedFor: 'Fall or spring pre-seed banding on dry-land grain.',
  },
}

/** Which of these a product is, from its name. */
export function fertKind(name: string): FertKind {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim()
  if (/\bblend\b/.test(n)) return 'blend'
  if (/\besn\b|44-0-0/.test(n)) return 'esn'
  if (/sulf ?4 ?r|0-0-0-17-21/.test(n)) return 'sulf4r'
  if (/\bats\b|12-0-0-26|thiosul/.test(n)) return 'ats'
  if (/\bams\b|21-0-0-24|ammonium sul/.test(n)) return 'ams'
  if (/anhydrous|82-0-0/.test(n)) return 'anhydrous'
  if (/\buan\b|28-0-0|32-0-0/.test(n)) return 'uan'
  if (/\burea\b|46-0-0|46\.0-0\.0/.test(n)) return 'urea'
  if (/\bm\.?a\.?p\b|11-52-0|monoammonium/.test(n)) return 'map'
  if (/potash|kcl|0-0-60|muriate/.test(n)) return 'potash'
  return 'other'
}

/** The N-P-K-S (and micros) numbers out of an ICI blend name. */
export function blendAnalysis(name: string): { n: number; p: number; k: number; s: number; extras: string[] } | null {
  const m = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?)(?:S)?)?((?:-\d+(?:\.\d+)?[A-Za-z]+)*)/.exec(name)
  if (!m) return null
  const extras = (m[5] ?? '')
    .split('-')
    .filter(Boolean)
    .map((e) => e.replace(/^(\d+(?:\.\d+)?)([A-Za-z]+)$/, '$1% $2'))
  return { n: Number(m[1]), p: Number(m[2]), k: Number(m[3]), s: m[4] != null ? Number(m[4]) : 0, extras }
}

export function fertInfo(name: string): FertInfo {
  const kind = fertKind(name)
  if (kind === 'blend') {
    const a = blendAnalysis(name)
    const parts = a
      ? [
          a.n ? `${a.n}% nitrogen` : null,
          a.p ? `${a.p}% phosphate` : null,
          a.k ? `${a.k}% potash` : null,
          a.s ? `${a.s}% sulphur` : null,
          ...a.extras,
        ].filter(Boolean)
      : []
    return {
      kind,
      title: name.replace(/^tonne\s+/i, ''),
      what:
        (parts.length ? `A dry blend ${farmRetailer()} mixed to this analysis: ${parts.join(', ')}. ` : `A dry blend ${farmRetailer()} mixed to order. `) +
        'Each number is percent of the tonne by weight, so a tonne of it carries that many kilograms of each nutrient. Made from urea, MAP, potash and ammonium sulphate in the proportions the soil test and the crop asked for, usually with the micronutrients coated on.',
      usedFor:
        'A one-field, one-season recipe: applied at seeding by the floater or the drill, at the rate the prescription set. The price is for that recipe, so it is not comparable year to year the way a straight product is.',
    }
  }
  if (kind === 'other') {
    return {
      kind,
      title: name,
      what: 'A fertilizer product this farm has bought that the app has no write-up for yet.',
      usedFor: 'See the invoice line and the applications below.',
    }
  }
  return { kind, ...INFO[kind] }
}
