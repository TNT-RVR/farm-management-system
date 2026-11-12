/**
 * Is this water fit for cattle to drink? Alberta's own table, per class.
 *
 * The thresholds are Agdex 400/716-2, "Water Analysis Interpretation for
 * Livestock" (second edition, revised April 2007), read out of the publication
 * the research library holds. Its chart gives a band and one of three words for
 * each parameter — Acceptable, Poor, Unsuitable — in a single column for
 * cattle, sheep and horses, and then qualifies several of those bands by class
 * of animal in the prose beside them: "acceptable for mature dry cows",
 * "avoid use for pregnant and/or lactating cows", "may affect calves",
 * "decreased performance in feedlot cattle".
 *
 * That shape is kept exactly. Each band carries the table's own grade, and a
 * class is only moved off it where the publication names that class. Nothing
 * here is interpolated and nothing is averaged across parameters: the table is
 * explicit that no single concentration is dangerous in all situations, and
 * that the feed's own salt and mineral content has to be added to the water's
 * before any of it means anything.
 *
 * Two later papers argue with the 1987-vintage numbers and are carried as
 * notes rather than as thresholds, because neither published a replacement
 * table:
 *
 * - Hare et al. 2026 (Canadian Journal of Animal Science) put 48 crossbred
 *   Angus heifers on naturally saline water at 980, 5190 and 9720 mg/L TDS
 *   (sulphate 350, 2970 and 5770 mg/L) for 100 days. Weight, daily gain, dry
 *   matter and water intake and gain:feed were all unaffected. Serum and liver
 *   copper fell at the two higher levels, liver selenium at the highest. So
 *   above the table's sulphate limits the thing at risk is the herd's copper
 *   and selenium reserves, not its gain — which is a mineral-programme
 *   problem, not necessarily a reason to fence the water off. The paper also
 *   notes Saskatchewan's 2000 mg/L sulphate limit would condemn 40 to 60 per
 *   cent of that province's surveyed water sources.
 *
 * - Anderson 2018 (University of Calgary) sampled 25 shallow Alberta prairie
 *   lakes for sulphate, molybdenum, nitrogen, phosphorus and microcystins.
 *   Cyanobacteria pigment went *down* as sulphate went up, and up with
 *   molybdenum and total nitrogen. Explicitly: no threshold was found, in
 *   either analysis. So a low-sulphate, nitrogen-rich dugout is the one to
 *   watch for a bloom, which is the opposite end of the scale from the one the
 *   livestock table worries about — and the app can only point at a direction,
 *   not a number.
 */

/** Which cattle are drinking it. The four the publication names. */
export type WaterClass = 'dry_cow' | 'pregnant_lactating' | 'calf' | 'feedlot'

export const WATER_CLASSES: { key: WaterClass; label: string; short: string }[] = [
  { key: 'dry_cow', label: 'Mature dry cows', short: 'Dry cows' },
  { key: 'pregnant_lactating', label: 'Pregnant or lactating cows', short: 'Pregnant / nursing' },
  { key: 'calf', label: 'Calves and young stock', short: 'Calves' },
  { key: 'feedlot', label: 'Cattle on feed', short: 'On feed' },
]

/**
 * The table's three words, plus one for a parameter the sheet did not test.
 *
 * 'limits' is the publication's "Poor". It is deliberately not called that on
 * screen: "Poor" reads as a grade for the water, and what the table actually
 * describes in every Poor band is a cost — scours, reduced gain, a trace
 * mineral tied up — which is a thing to weigh, not a pass or a fail.
 */
export type Verdict = 'acceptable' | 'limits' | 'do_not_use' | 'untested'

export const VERDICT_LABEL: Record<Verdict, string> = {
  acceptable: 'Acceptable',
  limits: 'Limits gain',
  do_not_use: 'Do not use',
  untested: 'Not tested',
}

const RANK: Record<Verdict, number> = { untested: 0, acceptable: 1, limits: 2, do_not_use: 3 }

/** The worst verdict in a set, ignoring parameters that were never tested. */
export function worst(verdicts: Verdict[]): Verdict {
  let out: Verdict = 'untested'
  for (const v of verdicts) if (RANK[v] > RANK[out]) out = v
  return out
}

type Band = {
  /** Up to and including this value, in the parameter's own unit. */
  upTo: number
  /** The table's word for this band, for cattle, sheep and horses. */
  grade: Exclude<Verdict, 'untested'>
  /** Where the publication names a class in this band, in that class's words. */
  byClass?: Partial<Record<WaterClass, Exclude<Verdict, 'untested'>>>
  /** What the table says about this band, close to its own words. */
  says: string
}

export type WaterParam = {
  key: string
  label: string
  unit: string
  digits: number
  /** Which column of a lab sheet this is. */
  column: string
  bands: Band[]
  /** True when a low reading is the risk and the bands do not cover it. */
  note?: string
}

/**
 * The parameters the chart grades, in the order it grades them.
 *
 * Only the ones a prairie water sheet actually reports are here. The chart also
 * covers aluminium, antimony, arsenic, boron, cadmium, chloride, cobalt, lead,
 * mercury and vanadium as a single recommended maximum each; those are in
 * TRACE_MAXIMA below rather than as bands, because one number is not a band.
 */
export const WATER_PARAMS: WaterParam[] = [
  {
    key: 'tds_mg_l',
    label: 'Total dissolved solids',
    unit: 'mg/L',
    digits: 0,
    column: 'TDS',
    bands: [
      { upTo: 1000, grade: 'acceptable', says: 'Acceptable for every class.' },
      { upTo: 3000, grade: 'acceptable', says: 'Acceptable for every class.' },
      {
        upTo: 5000,
        grade: 'acceptable',
        byClass: { calf: 'limits' },
        says: 'Acceptable, but may cause diarrhea, and at the higher end may reduce performance and affect the health of calves.',
      },
      {
        upTo: 7000,
        grade: 'limits',
        byClass: { pregnant_lactating: 'do_not_use' },
        says: 'Higher levels cause diarrhea, especially in lactating cows. The table says to avoid it for pregnant or lactating cows, and to test for sulphate.',
      },
      {
        upTo: 10000,
        grade: 'limits',
        byClass: { pregnant_lactating: 'do_not_use', calf: 'do_not_use' },
        says: 'Older animals may subsist on it for longer periods. Not to be used for pregnant or lactating cattle or for young animals. Sulphate is likely to be high.',
      },
      { upTo: Infinity, grade: 'do_not_use', says: 'Unsuitable for every class.' },
    ],
    note: 'Production and health problems have been reported in the field below 4,000 mg/L — polioencephalomalacia diagnosed in range cattle drinking from dugouts and ponds in southern Alberta, in hot, dry weather.',
  },
  {
    key: 'so4_mg_l',
    label: 'Sulphate',
    unit: 'mg/L',
    digits: 0,
    column: 'SO4',
    bands: [
      { upTo: 125, grade: 'acceptable', says: 'The desirable level of sulphate in drinking water.' },
      { upTo: 500, grade: 'acceptable', says: 'The maximum acceptable level. Tolerance depends on the level of sulphur in the feed.' },
      {
        upTo: 1000,
        grade: 'acceptable',
        byClass: { calf: 'limits', feedlot: 'limits' },
        says: '500 to 800 mg/L may induce a trace mineral deficiency in calves, which depresses growth rate, fertility and immune response. Decreased performance in feedlot cattle. 1,000 mg/L is the recommended maximum when the feed level or the temperature is high.',
      },
      {
        upTo: 2500,
        grade: 'limits',
        says: 'Laxative. Sporadic cases of polio seen in feedlot cattle, performance reduced. Over 2,000 mg/L can cause diarrhea. High sulphate also contributes to copper deficiency in beef cattle.',
      },
      {
        upTo: Infinity,
        grade: 'do_not_use',
        says: 'Sporadic cases of polio are highly probable in feedlot cattle; performance of feedlot cattle reduced and grazing cattle may be affected; scours. Over 4,000 mg/L, dangerous health problems are expected.',
      },
    ],
  },
  {
    key: 'no3n_mg_l',
    label: 'Nitrate-N',
    unit: 'mg/L',
    digits: 1,
    column: 'NO3-N',
    bands: [
      { upTo: 2, grade: 'acceptable', says: 'Acceptable.' },
      { upTo: 10, grade: 'acceptable', says: 'Acceptable. Animals already adapted to nitrate tolerate more; stressed or unhealthy ones can show toxicity below the guideline.' },
      { upTo: 30, grade: 'acceptable', says: 'Generally safe in balanced diets with low-nitrate feeds.' },
      { upTo: 49, grade: 'limits', says: 'Could be harmful if drunk over long periods alongside feeds that also carry nitrate.' },
      { upTo: 100, grade: 'do_not_use', says: 'Cattle at risk, especially if the feed is also high in nitrate. Abortions and/or death.' },
      { upTo: Infinity, grade: 'do_not_use', says: 'Toxic. High risk of abortions and death. Should not be used as a water source.' },
    ],
    note: 'The recommended upper limit for livestock is 23 mg/L nitrate-N (100 mg/L as nitrate). These figures only hold when the water is the only source of nitrate — with nitrate in the feed as well, the table says to ask a nutritionist or a vet.',
  },
  {
    key: 'ph',
    label: 'pH',
    unit: '',
    digits: 1,
    column: 'pH',
    bands: [
      { upTo: 5.5, grade: 'do_not_use', says: 'Unsuitable: reduced feed intake, and acidosis may occur in cattle on feed.' },
      { upTo: 6.5, grade: 'acceptable', says: 'Below the 6.5 to 8.0 band the chart calls acceptable, but above the 5.5 it calls unsuitable. The chart does not grade this gap.' },
      { upTo: 8.0, grade: 'acceptable', says: 'Acceptable.' },
      { upTo: 10, grade: 'limits', says: 'Poor.' },
      { upTo: Infinity, grade: 'do_not_use', says: 'Unsuitable.' },
    ],
  },
  {
    key: 'na_mg_l',
    label: 'Sodium',
    unit: 'mg/L',
    digits: 0,
    column: 'Na',
    bands: [
      { upTo: 400, grade: 'acceptable', says: 'By itself sodium poses little risk. Its association with sulphate is the concern.' },
      {
        upTo: 800,
        grade: 'acceptable',
        says: 'Acceptable, but may be unsuitable depending on alkalinity and pH. High sodium in water may mean taking salt out of the ration.',
      },
      {
        upTo: Infinity,
        grade: 'limits',
        says: 'Over 800 mg/L sodium can cause diarrhea and a drop in milk production. High sodium in water may mean taking salt out of the ration.',
      },
    ],
  },
  {
    key: 'alkalinity_mg_l',
    label: 'Alkalinity (as CaCO3)',
    unit: 'mg/L',
    digits: 0,
    column: 'Alkalinity',
    bands: [
      { upTo: 500, grade: 'acceptable', says: 'Acceptable.' },
      { upTo: 1000, grade: 'acceptable', says: 'Acceptable.' },
      {
        upTo: 2500,
        grade: 'limits',
        byClass: { dry_cow: 'acceptable', calf: 'do_not_use', pregnant_lactating: 'do_not_use' },
        says: 'Acceptable for mature dry cows; unsuitable for young calves or lactating cows at the higher levels.',
      },
      { upTo: Infinity, grade: 'limits', says: 'Above the chart’s last band. Treat as at least as poor as 1,001 to 2,500.' },
    ],
    note: 'Low alkalinity works the other way: it increases the laxative effect of high sulphate in young animals, and as alkalinity rises the sulphate level at which scouring starts falls.',
  },
  {
    key: 'hardness_mg_l',
    label: 'Hardness (as CaCO3)',
    unit: 'mg/L',
    digits: 0,
    column: 'Hardness',
    bands: [
      { upTo: 100, grade: 'acceptable', says: 'Soft. Acceptable.' },
      { upTo: 2000, grade: 'acceptable', says: 'Hard, and acceptable to drink. Scaling on pipes, heaters and fixtures may occur.' },
      { upTo: Infinity, grade: 'acceptable', says: 'Above the chart’s band, which runs to 2,000 and calls all of it acceptable for livestock.' },
    ],
  },
  {
    key: 'fe_mg_l',
    label: 'Iron',
    unit: 'mg/L',
    digits: 2,
    column: 'Fe',
    bands: [
      { upTo: 0.3, grade: 'acceptable', says: 'Acceptable. 0.1 mg/L can colour the meat of veal calves.' },
      { upTo: Infinity, grade: 'acceptable', says: 'Tastes bad, with minimal effect on water intake or productivity.' },
    ],
  },
]

/**
 * The trace elements the chart gives one recommended maximum for, in mg/L.
 *
 * Copper's two numbers are both the publication's: 1.0 is the maximum for
 * cattle, and 5.0 is where the chart turns unsuitable for them (0.5 is the
 * sheep maximum, and over that is fatal for sheep — worth knowing but not what
 * this herd is).
 */
export const TRACE_MAXIMA: { key: string; label: string; max: number; says: string }[] = [
  { key: 'cu_mg_l', label: 'Copper', max: 1.0, says: 'The maximum for cattle. Above 0.6 mg/L can cause liver damage in dairy cows, below the level considered toxic. The chart turns unsuitable for cattle at 5.0.' },
  { key: 'mo_mg_l', label: 'Molybdenum', max: 0.5, says: 'Essential but toxic, and tied to copper and sulphate intake. Molybdenum reduces copper absorption and can cause a copper deficiency.' },
  { key: 'se_mg_l', label: 'Selenium', max: 0.05, says: 'Essential, toxic at high levels. Watch total intake from feed plus water if toxicity is suspected.' },
  { key: 'f_mg_l', label: 'Fluoride', max: 2.0, says: 'Above 2.0, browning and mottling of teeth may occur. If fluoride is in the feed as well, the water should not exceed 1 mg/L.' },
  // Manganese is deliberately absent. The chart lists it among the metals but
  // grades no band for cattle, and putting a number from somewhere else beside
  // Alberta's own would make this table say something it does not say. The
  // column is still recorded on the test — just not graded.
]

export type ParamFinding = {
  param: WaterParam
  value: number
  /** The table's own grade for the band the reading falls in. */
  grade: Exclude<Verdict, 'untested'>
  byClass: Record<WaterClass, Verdict>
  says: string
  note?: string
}

const classVerdict = (band: Band, cls: WaterClass): Verdict => band.byClass?.[cls] ?? band.grade

const bandFor = (p: WaterParam, v: number) => p.bands.find((b) => v <= b.upTo) ?? p.bands[p.bands.length - 1]

/** The reading of one parameter, for every class at once. */
export function judgeParam(param: WaterParam, value: number): ParamFinding {
  const band = bandFor(param, value)
  const byClass = Object.fromEntries(
    WATER_CLASSES.map((c) => [c.key, classVerdict(band, c.key)]),
  ) as Record<WaterClass, Verdict>
  return { param, value, grade: band.grade, byClass, says: band.says, note: param.note }
}

/** A reading over a recommended maximum, which the chart gives no band for. */
export type TraceFinding = { key: string; label: string; value: number; max: number; over: boolean; says: string }

/**
 * The combinations the chart insists on, which no single parameter catches.
 *
 * Each is the publication's own instruction, not an interaction invented here:
 * salt is additive with sulphate and the two should be added together; sodium
 * and potassium both contribute to alkalinity and should be added together;
 * a copper to molybdenum ratio of 2:1 will prevent molybdenum poisoning.
 */
export type CombinedFinding = {
  key: 'na_so4' | 'na_k' | 'cu_mo'
  label: string
  detail: string
  verdict: Verdict
}

/**
 * A lab sheet as the judging reads it.
 *
 * Deliberately a loose record: the caller hands over a whole
 * cattle_water_tests row, which also carries an id, a date, a lab name and a
 * boolean, and every value is coerced with Number() before it is used. Typing
 * this as numbers only would mean the page picking the chemistry out of its own
 * row before asking — one more place for a parameter to be dropped by accident.
 */
export type WaterTestValues = Record<string, unknown>

export function combinedFindings(t: WaterTestValues): CombinedFinding[] {
  const out: CombinedFinding[] = []
  const num = (k: string) => {
    const v = t[k]
    return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  }

  const na = num('na_mg_l')
  const so4 = num('so4_mg_l')
  if (na != null && so4 != null) {
    const sum = na + so4
    out.push({
      key: 'na_so4',
      label: 'Sodium plus sulphate',
      detail: `${Math.round(na)} + ${Math.round(so4)} = ${Math.round(sum)} mg/L. The chart says salt and sulphate are additive and should be added together when water is evaluated, so neither one being inside its own band settles it.`,
      // Judged on the sulphate scale, since that is the one the additive
      // warning is written against.
      verdict: sum > 2500 ? 'do_not_use' : sum > 1000 ? 'limits' : 'acceptable',
    })
  }

  const k = num('k_mg_l')
  if (na != null && k != null) {
    out.push({
      key: 'na_k',
      label: 'Sodium plus potassium',
      detail: `${Math.round(na)} + ${Math.round(k)} = ${Math.round(na + k)} mg/L. Both contribute to alkalinity, so the chart adds them together; whether the total is acceptable depends on this water’s alkalinity and pH.`,
      verdict: 'acceptable',
    })
  }

  const cu = num('cu_mg_l')
  const mo = num('mo_mg_l')
  if (cu != null && mo != null && mo > 0) {
    const ratio = cu / mo
    out.push({
      key: 'cu_mo',
      label: 'Copper to molybdenum',
      detail: `${ratio.toFixed(1)}:1. The chart says a copper to molybdenum ratio of 2:1 will prevent molybdenum poisoning${ratio < 2 ? ' — this water is below that, so molybdenum is holding copper back' : ''}.`,
      verdict: ratio < 2 ? 'limits' : 'acceptable',
    })
  }

  return out
}

/**
 * Whether this water is worth watching for a bloom, as a direction only.
 *
 * Standing water alone — a dugout, a pond, a slough. Anderson 2018 found
 * cyanobacteria pigment fell as sulphate rose and climbed with molybdenum and
 * total nitrogen, and found no threshold in either analysis, so this returns a
 * lean and the reasons for it and never a number to clear.
 */
export type BloomLean = {
  lean: 'watch' | 'less likely' | 'unknown'
  reasons: string[]
  /** Microcystin against the two guidelines the thesis plots against. */
  microcystin: { value: number; overDrinking: boolean; overRecreational: boolean } | null
}

/** Health Canada's drinking-water guideline for total microcystins, ug/L. */
export const MICROCYSTIN_DRINKING = 1.5
/** Health Canada's recreational-water guideline for total microcystins, ug/L. */
export const MICROCYSTIN_RECREATIONAL = 20

export function bloomLean(t: WaterTestValues): BloomLean {
  const num = (k: string) => {
    const v = t[k]
    return v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  }
  const reasons: string[] = []
  let score = 0

  const so4 = num('so4_mg_l')
  if (so4 != null) {
    if (so4 < 500) {
      score += 1
      reasons.push(`sulphate is low (${Math.round(so4)} mg/L), and pigment rose as sulphate fell across the 25 lakes`)
    } else {
      score -= 1
      reasons.push(`sulphate is ${Math.round(so4)} mg/L, and higher sulphate went with less cyanobacteria pigment`)
    }
  }
  const tn = num('total_n_ug_l')
  if (tn != null && tn > 1000) {
    score += 1
    reasons.push(`total nitrogen is ${Math.round(tn)} ug/L, and pigment climbed with total nitrogen`)
  }
  const mo = num('mo_mg_l')
  if (mo != null && mo > 0.01) {
    score += 1
    reasons.push(`molybdenum is ${mo} mg/L, and pigment climbed with molybdenum`)
  }
  if (t.bloom_seen) {
    score += 2
    reasons.push('a bloom was seen on the water when it was sampled')
  }

  const mc = num('microcystin_ug_l')
  return {
    lean: reasons.length === 0 ? 'unknown' : score > 0 ? 'watch' : 'less likely',
    reasons,
    microcystin:
      mc == null
        ? null
        : {
            value: mc,
            overDrinking: mc > MICROCYSTIN_DRINKING,
            overRecreational: mc > MICROCYSTIN_RECREATIONAL,
          },
  }
}

export type WaterJudgement = {
  findings: ParamFinding[]
  trace: TraceFinding[]
  combined: CombinedFinding[]
  /** The worst verdict across every tested parameter, per class. */
  byClass: Record<WaterClass, Verdict>
  /** Parameters the chart grades that this sheet did not report. */
  untested: string[]
}

/**
 * One lab sheet read against the whole chart.
 *
 * Classes only ever take the worst verdict any single parameter gives them.
 * Nothing is added up: two parameters that each limit gain do not make water
 * unusable, and the publication gives no basis for saying they would.
 */
export function judgeWater(t: WaterTestValues): WaterJudgement {
  const findings: ParamFinding[] = []
  const untested: string[] = []
  for (const p of WATER_PARAMS) {
    const raw = t[p.key]
    const v = raw == null || raw === '' ? null : Number(raw)
    if (v == null || !Number.isFinite(v)) {
      untested.push(p.label)
      continue
    }
    findings.push(judgeParam(p, v))
  }

  const trace: TraceFinding[] = []
  for (const m of TRACE_MAXIMA) {
    const raw = t[m.key]
    const v = raw == null || raw === '' ? null : Number(raw)
    if (v == null || !Number.isFinite(v)) continue
    trace.push({ key: m.key, label: m.label, value: v, max: m.max, over: v > m.max, says: m.says })
  }

  const combined = combinedFindings(t)

  const byClass = Object.fromEntries(
    WATER_CLASSES.map((c) => [
      c.key,
      worst([
        ...findings.map((f) => f.byClass[c.key]),
        // A trace element over its recommended maximum limits every class;
        // the chart gives no per-class split for those.
        ...trace.filter((x) => x.over).map((): Verdict => 'limits'),
        ...combined.map((x) => x.verdict),
      ]),
    ]),
  ) as Record<WaterClass, Verdict>

  return { findings, trace, combined, byClass, untested }
}

/** The papers behind this screen, for the citation line and the library link. */
export const LIVESTOCK_WATER_SOURCES = {
  chart: {
    paper: 'Water analysis interpretation for livestock',
    agdex: '400/716-2',
    year: 2007,
    what: 'The threshold chart every verdict on this screen comes from.',
  },
  southernAlberta: {
    paper: 'Effects of water quality on cattle performance',
    year: 2002,
    what: 'The southern Alberta work on the same question. The library holds it as a citation only — no text was extracted, so nothing here is quoted from it.',
  },
  sulphateGain: {
    paper: 'Total dissolved solids in water high in naturally occurring sulfates impacts serum and liver copper and selenium concentrations but does not affect the growth of beef heifers',
    year: 2026,
    what: 'Why high sulphate shows as a cost to the mineral programme here rather than as a flat refusal.',
  },
  bloom: {
    paper: "Toxic cyanobacteria in relation to sulfate, molybdenum, nitrogen and phosphorus in Alberta's shallow prairie lakes",
    year: 2018,
    what: 'The dugout bloom lean, and the reason it is a lean and not a threshold.',
  },
} as const
