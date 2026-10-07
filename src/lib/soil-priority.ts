/**
 * Which number wins when this farm's own samples and the provincial survey both
 * have something to say.
 *
 * The order is always: a person's own figure, then OUR SOIL TEST, then the
 * survey, then nothing. Our tests are real cores out of these fields this
 * season; AGRASID is a lookup on the soil's NAME, identical for all thirty-six
 * Cavendish polygons on this farm because nobody cored any of them. A measured
 * number must never lose to a tabulated one.
 *
 * The two sources do not overlap as much as it looks, and pretending otherwise
 * is the trap here:
 *
 *   - Phosphorus and potassium: OUR TEST ONLY. AGRASID carries no P or K at
 *     all, so an untested field has no figure and must be said to have none
 *     rather than quietly scored as adequate.
 *   - Field capacity, wilting point, texture: SURVEY ONLY. The lab reports
 *     chemistry and does not measure water holding, so there is nothing of ours
 *     to prefer.
 *   - Organic matter, pH, CEC, salinity: BOTH. Our test wins; the survey fills
 *     the gap for a field we have never sampled.
 */

export type SoilSource = 'manual' | 'test' | 'survey'

export type Resolved<T> = {
  value: T | null
  source: SoilSource | null
  /** Where a value came from, in words, for the screen to show. */
  note: string | null
}

const NOTES: Record<SoilSource, string> = {
  manual: 'set by hand',
  test: 'from our soil test',
  survey: 'from the provincial soil survey',
}

/**
 * The first of these that has a value, with where it came from.
 *
 * Zero is a value. An organic matter of 0 or a salinity of 0 is a reading, and
 * a nullish check that treated it as missing would fall through to the survey
 * and report a number nobody measured.
 */
export function resolve<T>(
  candidates: { source: SoilSource; value: T | null | undefined }[],
): Resolved<T> {
  for (const c of candidates) {
    if (c.value != null) return { value: c.value, source: c.source, note: NOTES[c.source] }
  }
  return { value: null, source: null, note: null }
}

/** Organic carbon to organic matter, the conventional factor. */
export const ORGANIC_CARBON_TO_MATTER = 1.72

export type SoilInputs = {
  /** Topsoil averages from our most recent soil test on this field. */
  test?: {
    omPct?: number | null
    olsenPPpm?: number | null
    kPpm?: number | null
    ph?: number | null
    cec?: number | null
    ec?: number | null
  } | null
  /** The dominant survey unit for this field. */
  survey?: {
    /** Organic CARBON from the top horizon, not organic matter. */
    organicCarbonPct?: number | null
    ph?: number | null
    cec?: number | null
    ec?: number | null
    fcPct?: number | null
    wpPct?: number | null
    texture?: string | null
  } | null
  /** Values a person set on the field record. */
  manual?: { fcPct?: number | null; wpPct?: number | null; texture?: string | null } | null
}

export type SoilProperties = {
  omPct: Resolved<number>
  olsenPPpm: Resolved<number>
  kPpm: Resolved<number>
  ph: Resolved<number>
  cec: Resolved<number>
  ec: Resolved<number>
  fcPct: Resolved<number>
  wpPct: Resolved<number>
  texture: Resolved<string>
}

export function resolveSoil(inputs: SoilInputs): SoilProperties {
  const t = inputs.test ?? {}
  const s = inputs.survey ?? {}
  const m = inputs.manual ?? {}

  // The survey stores organic CARBON. Reporting it as organic matter would
  // understate every untested field by about 42%, which on a 2.5% threshold is
  // the difference between "low" and "fine".
  const surveyOm =
    s.organicCarbonPct == null
      ? null
      : Math.round(s.organicCarbonPct * ORGANIC_CARBON_TO_MATTER * 100) / 100

  return {
    omPct: resolve([
      { source: 'test', value: t.omPct },
      { source: 'survey', value: surveyOm },
    ]),
    // No survey fallback: AGRASID has no phosphorus or potassium.
    olsenPPpm: resolve([{ source: 'test', value: t.olsenPPpm }]),
    kPpm: resolve([{ source: 'test', value: t.kPpm }]),
    ph: resolve([
      { source: 'test', value: t.ph },
      { source: 'survey', value: s.ph },
    ]),
    cec: resolve([
      { source: 'test', value: t.cec },
      { source: 'survey', value: s.cec },
    ]),
    ec: resolve([
      { source: 'test', value: t.ec },
      { source: 'survey', value: s.ec },
    ]),
    // No test fallback: the lab reports chemistry and never measures these.
    fcPct: resolve([
      { source: 'manual', value: m.fcPct },
      { source: 'survey', value: s.fcPct },
    ]),
    wpPct: resolve([
      { source: 'manual', value: m.wpPct },
      { source: 'survey', value: s.wpPct },
    ]),
    texture: resolve([
      { source: 'manual', value: m.texture },
      { source: 'survey', value: s.texture },
    ]),
  }
}

/** Available water in inches per metre, from whichever pair of figures won. */
export function availableWaterFrom(p: SoilProperties): Resolved<number> {
  const fc = p.fcPct.value
  const wp = p.wpPct.value
  if (fc == null || wp == null || fc <= wp) return { value: null, source: null, note: null }
  // The weaker of the two sources describes the pair: a hand-set field capacity
  // over a surveyed wilting point is not "set by hand".
  const source: SoilSource =
    p.fcPct.source === 'survey' || p.wpPct.source === 'survey' ? 'survey' : 'manual'
  return {
    value: Math.round(((fc - wp) / 100 / 2.54) * 100 * 10) / 10,
    source,
    note: NOTES[source],
  }
}
