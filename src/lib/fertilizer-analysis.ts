import { toCanonicalRate } from './applied'

/**
 * The nutrients in a fertiliser, read out of what somebody called it.
 *
 * Nobody records an analysis field. What they record is a name — "46-0-0",
 * "11-52-0 MAP", "ESN 44-0-0", "SULF4R 0-0-0-17-21" — and the analysis is in
 * it, because that is how the industry names these things. Reading it is what
 * makes "what did we actually put on" comparable with "what was prescribed",
 * which are otherwise two lists of trade names.
 *
 * The order is the one printed on every bag in Canada: N, P2O5, K2O, S, then
 * micronutrients carrying their own symbol.
 */
export type Analysis = {
  n: number
  p2o5: number
  k2o: number
  s: number
  /** "Zn" → percent. Named in the product as "0.28Zn". */
  micro: Record<string, number>
}


/**
 * Percentages, or nothing.
 *
 * The guard that matters is the total: "80N - 50P - 30K - 20S - 23.77Ca - 5Zn"
 * is a Deere product name too, and it is pounds per acre of nutrient, not an
 * analysis. It reads as a perfectly good four-number blend and would claim a
 * bag was 80% nitrogen — so anything whose numbers cannot fit in a bag is
 * refused rather than believed.
 */
export function parseAnalysis(name: string | null | undefined): Analysis | null {
  if (!name) return null
  // A run of at least three dash-separated numbers, each optionally trailed by
  // an element symbol. Spaces around the dashes are allowed; the letters after
  // a number are not consumed into the next one.
  const m = name.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?)[A-Za-z]*){2,}/)
  if (!m) return null
  const run = name.slice(m.index ?? 0)
  const parts: { value: number; symbol: string }[] = []
  const re = /(\d+(?:\.\d+)?)\s*([A-Za-z]*)\s*(?:-|$)/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(run))) {
    parts.push({ value: Number(hit[1]), symbol: hit[2] })
    // Stop at the first thing that is not part of the run: "0-0-60 KCL" ends
    // after 60, and KCL is a trade name rather than a fifth number.
    const next = run.slice(re.lastIndex)
    if (!/^\s*\d/.test(next)) break
  }
  if (parts.length < 3) return null

  const [n, p2o5, k2o, s] = parts.map((p) => p.value)
  const micro: Record<string, number> = {}
  for (const p of parts.slice(4)) if (p.symbol) micro[p.symbol] = p.value

  const total = parts.reduce((a, p) => a + p.value, 0)
  if (total > 100) return null

  return { n, p2o5, k2o, s: s ?? 0, micro }
}

const KG_PER_LB = 0.45359237

/**
 * Pounds per acre of each nutrient from a rate and a product name.
 *
 * Null where the rate is a volume. A liquid rate needs the product's density to
 * become a weight, and this farm's records carry "46-0-0" at 6 gallons an acre
 * — urea, which is not a liquid — so the density is not merely unknown, the
 * entry is wrong. Guessing one would put a confident, invented nitrogen figure
 * beside a real prescription.
 */
export function nutrientsApplied(
  name: string | null | undefined,
  rateValue: number | undefined,
  unitId: string | undefined,
): { n: number; p2o5: number; k2o: number; s: number; micro: Record<string, number> } | null {
  const analysis = parseAnalysis(name)
  if (!analysis) return null
  const canonical = toCanonicalRate(rateValue, unitId)
  if (!canonical || canonical.unit !== 'kg') return null
  const lbPerAcre = canonical.rate / KG_PER_LB
  const scale = lbPerAcre / 100
  const micro: Record<string, number> = {}
  for (const [k, v] of Object.entries(analysis.micro)) micro[k] = v * scale
  return {
    n: analysis.n * scale,
    p2o5: analysis.p2o5 * scale,
    k2o: analysis.k2o * scale,
    s: analysis.s * scale,
    micro,
  }
}

/** Adds nutrient figures across several passes. */
export function sumNutrients(
  parts: { n: number; p2o5: number; k2o: number; s: number }[],
): { n: number; p2o5: number; k2o: number; s: number } {
  return parts.reduce(
    (a, p) => ({ n: a.n + p.n, p2o5: a.p2o5 + p.p2o5, k2o: a.k2o + p.k2o, s: a.s + p.s }),
    { n: 0, p2o5: 0, k2o: 0, s: 0 },
  )
}
