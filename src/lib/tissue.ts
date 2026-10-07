/**
 * Reading a plant tissue test.
 *
 * A tissue test is a number with no meaning on its own: 17 ppm of zinc is
 * short in corn at tassel and perfectly adequate in wheat at boot. What makes
 * it useful is the sufficiency range for THAT crop at THAT growth stage, so
 * everything here is keyed on both, and a reading with no stage recorded is
 * judged loosely and says so rather than pretending to a precision it has not
 * got.
 *
 * The ranges are the published sufficiency bands used across the northern
 * plains — the same ones the labs print down the side of their reports. They
 * are guidance, not a prescription: a reading below the band means look into
 * it, not apply something.
 */

export type NutrientKey =
  | 'n_pct'
  | 'p_pct'
  | 'k_pct'
  | 'ca_pct'
  | 'mg_pct'
  | 's_pct'
  | 'b_ppm'
  | 'cu_ppm'
  | 'fe_ppm'
  | 'mn_ppm'
  | 'zn_ppm'
  | 'no3n_ppm'

export type Nutrient = {
  key: NutrientKey
  label: string
  unit: '%' | 'ppm'
  /** Majors first, then micros — the order every lab report prints them in. */
  group: 'major' | 'micro'
}

export const NUTRIENTS: Nutrient[] = [
  { key: 'n_pct', label: 'Nitrogen', unit: '%', group: 'major' },
  { key: 'p_pct', label: 'Phosphorus', unit: '%', group: 'major' },
  { key: 'k_pct', label: 'Potassium', unit: '%', group: 'major' },
  { key: 's_pct', label: 'Sulphur', unit: '%', group: 'major' },
  { key: 'ca_pct', label: 'Calcium', unit: '%', group: 'major' },
  { key: 'mg_pct', label: 'Magnesium', unit: '%', group: 'major' },
  { key: 'b_ppm', label: 'Boron', unit: 'ppm', group: 'micro' },
  { key: 'cu_ppm', label: 'Copper', unit: 'ppm', group: 'micro' },
  { key: 'fe_ppm', label: 'Iron', unit: 'ppm', group: 'micro' },
  { key: 'mn_ppm', label: 'Manganese', unit: 'ppm', group: 'micro' },
  { key: 'zn_ppm', label: 'Zinc', unit: 'ppm', group: 'micro' },
  // Potato 4th-petiole nitrate — the one tissue test that sets a rate here.
  { key: 'no3n_ppm', label: 'Petiole nitrate-N', unit: 'ppm', group: 'major' },
]

export type Band = [low: number, high: number]

export type StageRanges = {
  /** What was sampled, in the words the lab and the agronomist use. */
  stage: string
  part: string
  ranges: Partial<Record<NutrientKey, Band>>
}

/**
 * Sufficiency bands, per crop and growth stage.
 *
 * Corn is split because the difference is large and the mistake is easy: the
 * whole young plant runs far richer in nitrogen and potassium than the ear leaf
 * does at tassel, so judging a V6 whole-plant sample against ear-leaf numbers
 * calls a healthy crop deficient.
 */
export const SUFFICIENCY: Record<string, StageRanges[]> = {
  corn: [
    {
      stage: 'early vegetative (V4–V8)',
      part: 'whole plant above ground',
      ranges: {
        n_pct: [3.5, 5.0],
        p_pct: [0.3, 0.5],
        k_pct: [2.5, 4.0],
        s_pct: [0.15, 0.5],
        ca_pct: [0.3, 0.7],
        mg_pct: [0.15, 0.45],
        b_ppm: [5, 25],
        cu_ppm: [5, 20],
        fe_ppm: [50, 250],
        mn_ppm: [20, 150],
        zn_ppm: [20, 60],
      },
    },
    {
      stage: 'tasselling / early silk',
      part: 'ear leaf',
      ranges: {
        n_pct: [2.75, 3.5],
        p_pct: [0.25, 0.5],
        k_pct: [1.75, 2.75],
        s_pct: [0.15, 0.5],
        ca_pct: [0.21, 1.0],
        mg_pct: [0.16, 0.6],
        b_ppm: [4, 25],
        cu_ppm: [3, 15],
        fe_ppm: [20, 250],
        mn_ppm: [20, 150],
        zn_ppm: [20, 70],
      },
    },
  ],
  wheat: [
    {
      stage: 'before heading',
      part: 'whole plant above ground',
      // Alberta: under 1.5% low, 1.5–2.0 marginal, over 2.0 sufficient.
      ranges: { n_pct: [2.0, 4.5], p_pct: [0.2, 0.5], k_pct: [1.5, 3.0], s_pct: [0.15, 0.4] },
    },
    {
      stage: 'boot',
      part: 'flag leaf',
      ranges: {
        n_pct: [2.5, 4.5],
        p_pct: [0.2, 0.5],
        k_pct: [1.5, 3.0],
        s_pct: [0.15, 0.4],
        ca_pct: [0.2, 1.0],
        mg_pct: [0.15, 0.5],
        b_ppm: [5, 25],
        cu_ppm: [5, 25],
        fe_ppm: [20, 200],
        mn_ppm: [20, 150],
        zn_ppm: [15, 70],
      },
    },
  ],
  // Barley reads like wheat; it is the most potash-responsive cereal.
  barley: [
    {
      stage: 'before heading',
      part: 'whole plant above ground',
      ranges: { n_pct: [2.0, 4.5], p_pct: [0.2, 0.5], k_pct: [1.5, 3.0], s_pct: [0.15, 0.4] },
    },
  ],
  alfalfa: [
    {
      stage: 'bud',
      part: 'top 6 inches',
      // Agdex 561-18 minimums: N 3.0%, P 0.2%, K 1.7%, S 0.2%.
      ranges: { n_pct: [3.0, 5.0], p_pct: [0.2, 0.7], k_pct: [1.7, 3.5], s_pct: [0.2, 0.5] },
    },
    {
      stage: '5% bloom',
      part: 'top 6 inches',
      ranges: { n_pct: [3.0, 5.0], p_pct: [0.2, 0.7], k_pct: [1.7, 3.5], s_pct: [0.2, 0.5], b_ppm: [20, 80], zn_ppm: [20, 70] },
    },
  ],
  // Russet Burbank 4th petiole, sampled 8–11 a.m. Alberta's own bands by days
  // after planting (Agdex 258/541-1, 2011); the low value is 90% of top yield.
  // The band resets upward around 85 days.
  potato: [
    { stage: '60 days after planting', part: '4th petiole', ranges: { no3n_ppm: [13000, 21400] } },
    { stage: '70 days after planting', part: '4th petiole', ranges: { no3n_ppm: [10100, 18500] } },
    { stage: '80 days after planting', part: '4th petiole', ranges: { no3n_ppm: [7200, 15600] } },
    { stage: '85 days after planting', part: '4th petiole', ranges: { no3n_ppm: [12978, 20378] } },
    { stage: '100 days after planting', part: '4th petiole', ranges: { no3n_ppm: [9311, 16711] } },
    { stage: '125 days after planting', part: '4th petiole', ranges: { no3n_ppm: [3200, 10600] } },
  ],
  canola: [
    {
      stage: 'early flower',
      part: 'youngest mature leaf',
      ranges: {
        // Alberta/Canola Council: under 2.0% low, 2.0–2.5 marginal, over 2.5 sufficient.
        n_pct: [2.5, 5.5],
        p_pct: [0.25, 0.6],
        k_pct: [2.0, 4.0],
        s_pct: [0.35, 0.8],
        ca_pct: [0.8, 2.5],
        mg_pct: [0.2, 0.6],
        b_ppm: [20, 60],
        cu_ppm: [3, 15],
        fe_ppm: [40, 200],
        mn_ppm: [25, 150],
        zn_ppm: [20, 70],
      },
    },
  ],
}

/** Normalise "Corn - Grain", "Silage Corn", "corn" to a key we hold ranges for. */
export function cropKey(crop: string | null | undefined): string | null {
  if (!crop) return null
  const c = crop.toLowerCase()
  if (c.includes('corn')) return 'corn'
  if (c.includes('canola')) return 'canola'
  if ((c.includes('wheat') && !c.includes('buckwheat')) || c.includes('durum')) return 'wheat'
  if (c.includes('barley')) return 'barley'
  if (c.includes('alfalfa')) return 'alfalfa'
  if (c.includes('potato')) return 'potato'
  return null
}

/**
 * The band to judge a reading against.
 *
 * A crop with one set is judged by it. A crop whose bands change with the
 * stage is NOT judged until the stage is known: falling back to the leaner
 * late band used to call a healthy early crop "in band" for nitrogen and tell
 * the pivot top-up to skip, and falling back to the early band would do the
 * opposite. Either guess moves money, so neither is made.
 */
export function rangesFor(crop: string | null | undefined, stage: string | null | undefined) {
  const key = cropKey(crop)
  if (!key) return null
  const sets = SUFFICIENCY[key]
  if (!sets?.length) return null
  if (sets.length === 1) return { ...sets[0], assumed: !stage || stage !== sets[0].stage }
  if (!stage) return null
  const hit = sets.find((s) => s.stage === stage)
  return hit ? { ...hit, assumed: false } : null
}

/** Whether a reading can be judged once its growth stage is chosen. */
export function needsStage(crop: string | null | undefined, stage: string | null | undefined): boolean {
  const key = cropKey(crop)
  const sets = key ? SUFFICIENCY[key] : null
  return !!sets && sets.length > 1 && !sets.some((s) => s.stage === stage)
}

export type Verdict = 'low' | 'ok' | 'high' | 'unknown'

/** Where a reading sits against its band. */
export function judge(value: number | null | undefined, band: Band | undefined): Verdict {
  if (value == null || !band) return 'unknown'
  if (value < band[0]) return 'low'
  if (value > band[1]) return 'high'
  return 'ok'
}

export type Reading = {
  nutrient: Nutrient
  value: number | null
  band: Band | undefined
  verdict: Verdict
}

/** Every nutrient on a test, judged, in report order. */
/** Readings only a petiole test carries; left off a leaf or whole-plant panel. */
export const PETIOLE_ONLY = new Set<NutrientKey>(['no3n_ppm'])

/** The boxes worth offering for a crop: petiole nitrate only where it is judged. */
export function nutrientsFor(crop: string | null | undefined) {
  const sets = SUFFICIENCY[cropKey(crop) ?? ''] ?? []
  return NUTRIENTS.filter((x) => !PETIOLE_ONLY.has(x.key) || sets.some((s) => s.ranges[x.key]))
}

export function readTissue(
  row: Partial<Record<NutrientKey, number | string | null>>,
  crop: string | null | undefined,
  stage: string | null | undefined,
): { readings: Reading[]; ranges: ReturnType<typeof rangesFor> } {
  const ranges = rangesFor(crop, stage)
  const readings = NUTRIENTS.map((nutrient) => {
    const raw = row[nutrient.key]
    const value = raw == null || raw === '' ? null : Number(raw)
    const band = ranges?.ranges[nutrient.key]
    return {
      nutrient,
      value: value != null && Number.isFinite(value) ? value : null,
      band,
      verdict: judge(value, band),
    }
  }).filter((r) => !PETIOLE_ONLY.has(r.nutrient.key) || r.value != null || r.band)
  return { readings, ranges }
}

const TISSUE_TEXT_KEYS = ['field_id', 'sampled_on', 'crop', 'growth_stage', 'plant_part', 'lab', 'sample_code', 'notes'] as const

/**
 * A saved test as the hand-entry form's strings, so the same form corrects it
 * (Sam, 7 Oct 2026). Blanks stay out, so an unmeasured nutrient stays blank.
 */
export function tissueFormOf(t: Record<string, unknown>): Record<string, string> {
  const m: Record<string, string> = {}
  for (const k of [...TISSUE_TEXT_KEYS, ...NUTRIENTS.map((x) => x.key)]) if (t[k] != null && t[k] !== '') m[k] = String(t[k])
  return m
}

/** The short version: what is actually short, worst first. */
export function shortages(readings: Reading[]): Reading[] {
  return readings
    .filter((r) => r.verdict === 'low' && r.value != null && r.band)
    .sort((a, b) => a.value! / a.band![0] - b.value! / b.band![0])
}
