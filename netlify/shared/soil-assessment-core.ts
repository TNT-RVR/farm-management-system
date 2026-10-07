import type { SupabaseClient } from '@supabase/supabase-js'
import { alwaysThinks } from './anthropic-reply.ts'
import { withFarm } from '../../src/lib/farm-context.ts'
import { manureAssumptions, manureCredit, sourceOf, typeOf } from '../../src/lib/manure-credit.ts'
import { legumeCreditAfterTest } from '../../src/lib/fert-savings/agronomy.ts'
import {
  aopaNitrateLimit,
  clampSeedRowP,
  type SeedRowRec as Rec,
  kRateAlberta,
  nRateAlberta,
  nTargetFor,
  pRateAlberta,
  sRateAlberta,
  seedRowPCap,
  zincCritical,
  WATER_S_BY_SOURCE,
  type SoilZone,
  type WaterSource,
} from '../../src/lib/fert-savings/alberta.ts'

/**
 * Generates the agronomic write-up for one soil report.
 *
 * Split across parallel calls rather than one, because the OUTPUT is what costs
 * the time. A narrative plus twenty-six columns at four sentences each is around
 * four thousand tokens, written one after another — which is why a single call
 * took a minute and a half. Broken into a narrative and four chunks of column
 * notes issued together, the wall clock is the slowest chunk instead of the sum.
 *
 * The notes also go to a faster model. They are formulaic by construction — two
 * sentences on the result, one on the last crop, one on the next — where the
 * narrative is the part that benefits from the stronger one.
 *
 * It reasons from THIS field's numbers and rotation rather than restating the
 * lab's own recommendation, which is printed on the report beside it.
 */

const NOTE_COLUMNS = [
  'om_pct', 'no3n_lb_ac', 'p_bicarb_ppm', 'p_melich3_ppm', 'k_ppm', 'so4s_ppm',
  'ph', 'cec_meq', 'base_k_pct', 'base_mg_pct', 'base_ca_pct', 'base_na_pct',
  'ca_ppm', 'mg_ppm', 'na_ppm', 'zn_ppm', 'mn_ppm', 'fe_ppm', 'cu_ppm', 'b_ppm',
  'soluble_salts', 'ec_ms_cm', 'cl_ppm', 'p_sat_pct', 'k_mg_ratio', 'enr',
]

/** Written this way because a literal escape does not survive the tooling. */
const NL = String.fromCharCode(10)

/** Columns per parallel call. Four chunks of seven keeps each one short. */
const CHUNK = 7

const NARRATIVE_TOOL = {
  name: 'record_assessment',
  description: 'Record the agronomic read and the fertiliser programme.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assessment_md: {
        type: 'string',
        description:
          'ONLY what needs acting on for the upcoming crop, and why, citing the figures that drive ' +
          'it. Do NOT inventory the soil or reassure that a nutrient is adequate — a nutrient that ' +
          'needs nothing should not appear at all. 2-4 short paragraphs, no preamble, no summary ' +
          'section restating the recommendation table.',
      },
      recommendation: {
        type: 'array',
        description: 'The proposed programme, in lb/ac of actual nutrient.',
        items: {
          type: 'object',
          properties: {
            nutrient: { type: 'string', description: 'N, P2O5, K2O, S, Zn, Cu, B...' },
            product: { type: 'string', description: 'A concrete product, e.g. 46-0-0 urea, 11-52-0 MAP' },
            lb_per_ac: { type: 'number', description: 'Pounds per acre of ACTUAL NUTRIENT, not product' },
            product_lb_per_ac: { type: 'number', description: 'Pounds per acre of the PRODUCT' },
            timing: { type: 'string', description: 'e.g. seed-placed, pre-plant banded, in-season' },
            note: { type: 'string', description: 'One sentence on why.' },
          },
          required: ['nutrient', 'product', 'lb_per_ac', 'note'],
        },
      },
    },
    required: ['assessment_md', 'recommendation'],
  },
}

/**
 * An ARRAY of fixed-shape items, not an object keyed by column.
 *
 * The first version used `additionalProperties` — an open-ended map whose keys
 * the model invents. Sixteen of fifty-six reports came back with that field as
 * a JSON *string* instead of an object, and the strings were not even valid
 * JSON: the model wrote measurements like 0-24" straight into text it was
 * simultaneously trying to escape. Unrecoverable, and silent — the column held
 * a scalar and every popover for that report showed nothing.
 *
 * A list of records with named fields removes the nesting the model was getting
 * wrong. The map is rebuilt in code, where a stray quote is just a character.
 */
const NOTES_TOOL = {
  name: 'record_column_notes',
  description: 'Record a short note for each soil-test column asked about.',
  input_schema: {
    type: 'object' as const,
    properties: {
      notes: {
        type: 'array',
        description: 'One item per column key given. Omit a column only when it has no value.',
        items: {
          type: 'object',
          properties: {
            column: { type: 'string', description: 'The column key exactly as given, e.g. p_bicarb_ppm' },
            summary: {
              type: 'string',
              description: "EXACTLY two sentences: this field's result for this column and what it means.",
            },
            priorCrop: {
              type: 'string',
              description: 'EXACTLY one sentence on how last year’s crop may have affected this column.',
            },
            nextCrop: {
              type: 'string',
              description:
                'EXACTLY one sentence on what must change in this column for the upcoming crop, and why.',
            },
          },
          required: ['column', 'summary', 'priorCrop', 'nextCrop'],
        },
      },
    },
    required: ['notes'],
  },
}

type Sample = Record<string, number | string | null>
type ToolCall = { type: string; name?: string; input?: Record<string, unknown> }

async function callTool(
  apiKey: string,
  model: string,
  tool: typeof NARRATIVE_TOOL | typeof NOTES_TOOL,
  prompt: string,
  maxTokens: number,
): Promise<{ input: Record<string, unknown> | null; problem: string | null }> {
  // A model that always thinks refuses a forced tool_choice: it is asked for
  // the tool in words, at high effort, with room for the thinking before it.
  const thinks = alwaysThinks(model)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      tools: [tool],
      ...(thinks
        ? {
            max_tokens: 16000,
            output_config: { effort: 'high' },
            tool_choice: { type: 'auto' },
            messages: [{ role: 'user', content: `${prompt}\nRecord your answer with the ${tool.name} tool.` }],
          }
        : {
            max_tokens: maxTokens,
            tool_choice: { type: 'tool', name: tool.name },
            messages: [{ role: 'user', content: prompt }],
          }),
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const payload = (await res.json()) as { content?: ToolCall[]; stop_reason?: string }
  const input = payload.content?.find((c) => c.type === 'tool_use' && c.name === tool.name)?.input ?? null
  // Why there is no answer, for the sweep's heartbeat: "assessment was empty"
  // alone gave nothing to go on.
  const problem = input
    ? null
    : `${model} did not record ${tool.name} (stop: ${payload.stop_reason ?? '?'}; blocks: ${(payload.content ?? []).map((c) => c.type).join(', ') || 'none'})`
  return { input, problem }
}

function avg(rows: Sample[], key: string) {
  const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')
  return vals.length ? Math.round((vals.reduce((a, c) => a + c, 0) / vals.length) * 100) / 100 : null
}

/** Sum each site down its depths, then average the sites. lb/ac only. */
function avgProfile(samples: Sample[], key: string) {
  const bySite = new Map<string, number>()
  for (const s of samples) {
    const v = s[key]
    if (typeof v !== 'number') continue
    const site = String(s.sample_code).replace(/[A-Z]$/, '')
    bySite.set(site, (bySite.get(site) ?? 0) + v)
  }
  const vals = [...bySite.values()]
  return vals.length ? Math.round((vals.reduce((a, c) => a + c, 0) / vals.length) * 100) / 100 : null
}

/**
 * Alberta's own numbers for this field, worked out here rather than left to
 * the model. The model explains and adjusts; it does not invent the rate.
 */
function albertaBaseline(a: {
  crop: string
  prior: string
  twoBack: string
  irrigated: boolean
  zone: SoilZone
  water: WaterSource
  waterSPerInch: number | null
  waterSamples: number
  irrigationInches: number
  texture: string | null
  soilN: number | null
  olsen: number | null
  kPpm: number | null
  so4Top: number | null
  so4Sub: number | null
  zn: number | null
}): { lines: string[]; seedCap: number | null } {
  const out: string[] = ['ALBERTA BASELINE (worked out by the app from Alberta\'s published tables — start here):']
  const r = (x: number) => Math.round(x)

  // Nitrogen
  if (a.soilN != null) {
    const cheap = nRateAlberta({ crop: a.crop, soilN: a.soilN, yieldGoal: null, nPerLb: 1, cropPerUnit: 1 / 0.05 })
    const dear = nRateAlberta({ crop: a.crop, soilN: a.soilN, yieldGoal: null, nPerLb: 1, cropPerUnit: 1 / 0.1 })
    const target = nTargetFor(a.crop)
    if (cheap && dear) {
      out.push(
        `  N: soil nitrate ${r(a.soilN)} lb/ac (0-24 in). From the irrigated response curve: ${r(cheap.fertN)} lb N at an ` +
          `N:crop price ratio of 0.05, ${r(dear.fertN)} at 0.10 (Alberta's conservative 2:1 rates ${r(cheap.fertN2to1)} and ` +
          `${r(dear.fertN2to1)}); soil + fertilizer never past ${cheap.cap}. The curves include about 40 lb/ac of in-season release.` +
          (a.irrigated ? '' : ' This field is DRYLAND: the irrigated curve overstates it — take 50–60% of these rates.'),
      )
    } else if (target) {
      out.push(
        target.total === 0
          ? `  N: ${target.source}.`
          : `  N: soil (${target.depth} in) + fertilizer to about ${target.total} lb/ac, no more than ${target.cap} (${target.source}); ` +
              `soil nitrate ${r(a.soilN)} lb/ac.`,
      )
    }
  }
  const legume = legumeCreditAfterTest({ lastYear: a.prior, twoYearsBack: a.twoBack, tested: true })
  if (legume.lbN > 0) out.push(`  Legume credit still owed after this nitrate test: about ${legume.lbN} lb N (${legume.label}).`)

  // Phosphorus
  const p = pRateAlberta({ crop: a.crop, olsenPpm: a.olsen, irrigated: a.irrigated, zone: a.zone })
  const cap = seedRowPCap(a.crop)
  if (p) {
    out.push(
      `  P2O5: ${p.rate} lb/ac (Olsen ${a.olsen} ppm ≈ ${r(p.mkLbAc)} lb/ac on the Modified Kelowna scale the tables use; ${p.source}).` +
        (p.stop ? ' Soil P is excessive — no P and no manure.' : p.floored ? ' This is the starter floor, not a build rate.' : ''),
    )
  }
  if (cap) out.push(`  Seed-row cap: ${cap.cap === 0 ? 'NO P2O5 with the seed — band it away from the seed' : `at most ${cap.cap} lb P2O5 with the seed`}. ${cap.note}`)

  // Potassium
  const k = kRateAlberta({ crop: a.crop, kPpm: a.kPpm })
  if (k) out.push(`  K2O: ${k.rate} lb/ac (K ${a.kPpm} ppm ≈ ${r(k.lbAc)} lb/ac; ${k.source}).`)

  // Sulphur: 0-12 in lb/ac from the two concentrations (about 2 lb/ac per ppm per 6 in).
  if (a.so4Top != null) {
    const soilS = a.so4Top * 2 + (a.so4Sub ?? a.so4Top) * 2
    const sr = sRateAlberta({ crop: a.crop, soilSLbAc: soilS, irrigated: a.irrigated, irrigationInches: a.irrigationInches, water: a.water, waterSPerInch: a.waterSPerInch })
    if (sr) {
      out.push(
        `  S: ${sr.rate} lb/ac (soil about ${r(soilS)} lb/ac in 0-12 in` +
          (a.irrigated
            ? `; less ${sr.waterCredit} lb from ${a.irrigationInches} in of ${WATER_S_BY_SOURCE[a.water].label} water` +
              (a.waterSPerInch != null
                ? ` at ${a.waterSPerInch} lb S/in, the May–Sep median of ${a.waterSamples} provincial samples`
                : ` at ${WATER_S_BY_SOURCE[a.water].lbPerInch} lb S/in`)
            : '') +
          `). Use sulphate, not elemental, for this year's crop.`,
      )
    }
  }

  // Zinc
  const z = zincCritical(a.crop, a.texture)
  if (z && a.zn != null) {
    out.push(`  Zn: DTPA ${a.zn} ppm against a critical level of ${z.critical} for this crop${a.zn < z.critical ? ` — short: ${z.rate}` : ' — adequate'}.`)
  }

  // Manure law
  const limit = aopaNitrateLimit({ zone: a.zone, irrigated: a.irrigated, sandy: /sand/i.test(a.texture ?? ''), shallowWater: false })
  out.push(`  AOPA: manure only while soil nitrate-N (0-60 cm) is under ${limit} lb/ac${a.soilN != null && a.soilN > limit ? ` — this field is OVER it at ${r(a.soilN)}` : ''}, and not where EC is over 4 dS/m.`)
  out.push('')
  return { lines: out, seedCap: cap?.cap ?? null }
}

export async function runSoilAssessment(
  sb: SupabaseClient,
  reportId: string,
  apiKey: string,
  model: string,
  fastModel = process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5-20251001',
): Promise<{ ok: boolean; detail: string }> {
  const { data: report, error } = await sb
    .from('soil_test_reports')
    .select('*, fields(name, soil_texture)')
    .eq('id', reportId)
    .single()
  if (error || !report) return { ok: false, detail: `report not found: ${error?.message ?? reportId}` }

  const { data: samples } = await sb
    .from('soil_test_samples')
    .select('*')
    .eq('report_id', reportId)
    .order('sample_code')
  if (!samples?.length) return { ok: false, detail: 'report has no samples' }

  const year = report.crop_year as number

  // Rotation comes from TWO tables, which is the whole reason the first version
  // reported "prior crop unknown" on every field: crop_plans holds the forward
  // plan only (2026 onward here), while everything actually grown lives in
  // crop_history. Reading plans alone meant the model was told nothing about
  // the crop that had just come off — the one that moved these numbers.
  const [{ data: history }, { data: plans }, { data: manure }, { data: pivots }, { data: settingRows }, { data: waterRows }] = await Promise.all([
    sb
      .from('crop_history')
      .select('crop_year, yield_per_acre, yield_unit, crops(name)')
      .eq('field_id', report.field_id)
      .gte('crop_year', year - 6)
      .lt('crop_year', year)
      .order('crop_year', { ascending: false }),
    sb
      .from('crop_plans')
      .select('crop_year, crops(name)')
      .eq('field_id', report.field_id)
      .gte('crop_year', year - 2),
    // Manure inside the credit window. This is the one input with no record
    // anywhere else — it goes on by the load and turns up months later as a
    // soil test nobody can explain — so a write-up that has not been told about
    // it will read high phosphorus as a trend and recommend cutting it back.
    sb
      .from('manure_applications')
      .select('crop_year, source, rate_tons_per_acre, acres, incorporated, incorporated_days, manure_type, n_lb_ton, p2o5_lb_ton, k2o_lb_ton')
      .eq('field_id', report.field_id)
      .gte('crop_year', year - 3)
      .lte('crop_year', year)
      .order('crop_year', { ascending: false }),
    // Irrigated or dryland, per field. The prompt used to tell the model every
    // field was irrigated, which on dryland roughly doubles the N it writes.
    sb.from('field_pivots').select('field_id').eq('field_id', report.field_id).eq('not_used', false),
    sb.from('fert_settings').select('key, value').in('key', ['soil_zone', 'irrigation_water', 'irrigation_inches']),
    // The measured water sulphur, from the monthly provincial pull.
    sb.from('water_s_credit').select('water_source, lb_s_per_inch, so4_samples, latest_sample'),
  ])
  const setting = (k: string) => (settingRows ?? []).find((r) => (r as { key: string }).key === k)?.value as unknown
  const irrigated = (pivots ?? []).length > 0
  const zone = ((setting('soil_zone') as string) ?? 'Brown') as SoilZone
  const water = ((setting('irrigation_water') as string) ?? 'smrid') as WaterSource
  const irrigationInches = Number(setting('irrigation_inches') ?? 12) || 12
  const measured = (waterRows ?? []).find((w) => (w as { water_source: string }).water_source === water) as
    | { lb_s_per_inch: number | null; so4_samples: number; latest_sample: string | null }
    | undefined
  const waterSPerInch = measured?.lb_s_per_inch != null ? Number(measured.lb_s_per_inch) : null

  type Named = { crop_year: number; crops?: { name?: string } | null }
  const histFor = (y: number) => (history ?? []).find((h) => (h as Named).crop_year === y) as
    | (Named & { yield_per_acre?: number | null; yield_unit?: string | null })
    | undefined
  const planFor = (y: number) => (plans ?? []).find((p) => (p as Named).crop_year === y) as Named | undefined
  // Prefer what was actually grown; fall back to what was planned for it.
  const cropFor = (y: number) => histFor(y)?.crops?.name ?? planFor(y)?.crops?.name ?? null

  const priorCrop = cropFor(year - 1) ?? 'not recorded'
  const twoBack = cropFor(year - 2) ?? 'not recorded'
  const nextCrop = (report.crop_label as string) || cropFor(year) || 'not recorded'

  // A few more years of it, with yields where recorded — a nutrient drawn down
  // over three years of the same heavy feeder reads differently from one bad
  // season, and that is exactly what the prior-crop sentence is meant to catch.
  const rotationLines = (history ?? [])
    .map((h) => {
      const row = h as Named & { yield_per_acre?: number | null; yield_unit?: string | null }
      const yieldPart =
        row.yield_per_acre != null ? ` (${row.yield_per_acre} ${row.yield_unit ?? ''})`.trimEnd() : ''
      return `  ${row.crop_year}: ${row.crops?.name ?? 'not recorded'}${yieldPart}`
    })
    .join(NL)

  /**
   * Manure, and what the crop actually gets from it.
   *
   * Both numbers, because they differ by four times and the model needs the
   * available one to write a rate. The arithmetic is deliberately spelled out
   * rather than left implicit: told only "20 ton/ac of beef manure", a model
   * will credit the total nitrogen and advise cutting the plan to nothing.
   */
  const manureLines = (() => {
    const rows = (manure ?? []) as {
      crop_year: number
      source: string | null
      rate_tons_per_acre: number | null
      acres: number | null
      incorporated: boolean | null
      incorporated_days: number | null
      manure_type: string | null
      n_lb_ton: number | null
      p2o5_lb_ton: number | null
      k2o_lb_ton: number | null
    }[]
    if (rows.length === 0) {
      return ['MANURE: none recorded on this field in the last three years.', '']
    }
    const lines = rows.map((m) => {
      const c = manureCredit(
        {
          crop_year: m.crop_year,
          source: m.source ?? 'solid_beef',
          rate_tons_per_acre: m.rate_tons_per_acre,
          n_lb_ton: m.n_lb_ton,
          p2o5_lb_ton: m.p2o5_lb_ton,
          k2o_lb_ton: m.k2o_lb_ton,
          incorporated: m.incorporated,
          incorporated_days: m.incorporated_days,
          manure_type: m.manure_type,
        },
        year,
      )
      const measured = m.n_lb_ton != null || m.p2o5_lb_ton != null || m.k2o_lb_ton != null
      const where = m.acres != null ? `${m.acres} ac covered` : 'area not recorded'
      const worked =
        m.incorporated_days != null
          ? `worked in after ${m.incorporated_days} day${m.incorporated_days === 1 ? '' : 's'}`
          : m.incorporated === false
            ? 'surface applied'
            : m.incorporated
              ? 'worked in'
              : 'incorporation not recorded'
      const assumed = manureAssumptions(m)
      return (
        `  ${m.crop_year}: ${m.rate_tons_per_acre ?? '?'} ${sourceOf(m.source).unit} ` +
        `${sourceOf(m.source).label.toLowerCase()} (${m.manure_type ? typeOf(m.manure_type).label.toLowerCase() : 'kind not recorded'}), ${where}, ${worked}. ` +
        `Available to the ${year} crop on that ground: ${Math.round(c.n)} lb N, ` +
        `${Math.round(c.p2o5)} lb P2O5, ${Math.round(c.k2o)} lb K2O per acre ` +
        `(${measured ? 'from a manure test' : 'typical analysis, not tested'}` +
        `${assumed.length ? `; assumed ${assumed.join('; ')}` : ''}).`
      )
    })
    return [
      'MANURE ON THIS FIELD (most recent first). The available figures below are',
      "already worked by Alberta's feedlot method — ammonium less ammonia loss by days to",
      'incorporation, plus the organic N released that year; P at 50% in year one —',
      'subtract them from the requirement, do NOT credit the total nutrient content:',
      ...lines,
      'Manure covers part of a field, not all of it. Where the acres covered are less',
      'than the field, say which ground the credit applies to rather than cutting the',
      'whole field rate.',
      '',
    ]
  })()

  const field = (report.fields ?? {}) as { name?: string; soil_texture?: string }
  const rows = samples as Sample[]
  const top = rows.filter((s) => Number(s.depth_top_in) === 0)
  const sub = rows.filter((s) => Number(s.depth_top_in) !== 0)

  const averages: Record<string, number | null> = {}
  for (const key of NOTE_COLUMNS) {
    // lb/ac is an AMOUNT and adds down the profile. Everything else is a
    // concentration or a topsoil-only test, where averaging is the only sound
    // way to combine the cores.
    averages[key] = key === 'no3n_lb_ac' ? avgProfile(rows, key) : avg(top, key)
  }
  averages.so4s_ppm_subsoil = avg(sub, 'so4s_ppm')

  const baseline = albertaBaseline({
    crop: nextCrop,
    prior: priorCrop,
    twoBack,
    irrigated,
    zone,
    water,
    waterSPerInch,
    waterSamples: measured?.so4_samples ?? 0,
    irrigationInches,
    texture: field.soil_texture ?? null,
    soilN: averages.no3n_lb_ac,
    olsen: averages.p_bicarb_ppm,
    kPpm: averages.k_ppm,
    so4Top: averages.so4s_ppm,
    so4Sub: averages.so4s_ppm_subsoil,
    zn: averages.zn_ppm ?? null,
  })

  // A compact table rather than raw JSON. The previous version shipped twenty
  // thousand characters of sample dump for numbers already summarised directly
  // above it, which is input the model has to read before writing a word.
  const compact = rows
    .map((s) => {
      const vals = NOTE_COLUMNS.filter((k) => s[k] != null)
        .map((k) => `${k}=${s[k]}`)
        .join(' ')
      return `  ${s.sample_code} ${s.depth_label ?? ''}: ${vals}`
    })
    .join(NL)

  const context = withFarm([
    `Field "${field.name ?? 'unknown'}", crop year ${year}. Lab ${report.lab ?? 'unknown'}.`,
    `Soil texture on file: ${field.soil_texture ?? 'not set'}.`,
    `Upcoming crop (what this test is for): ${nextCrop}. Last year: ${priorCrop}. Two years back: ${twoBack}.`,
    rotationLines
      ? 'CROPPING HISTORY (most recent first, actual crops grown on this field):'
      : 'CROPPING HISTORY: nothing recorded for this field before this year.',
    rotationLines,
    '',
    ...manureLines,
    'FIELD AVERAGES (topsoil, except no3n_lb_ac which is the 0-24in site total and',
    'so4s_ppm_subsoil which is the 6-24in average; sulphate is a concentration and is',
    'never summed between depths):',
    ...Object.entries(averages).map(([k, v]) => `  ${k}: ${v ?? 'not reported'}`),
    '',
    'SAMPLES:',
    compact,
    '',
    `${irrigated ? 'IRRIGATED (a pivot is on file for this field)' : 'DRYLAND (no pivot on file for this field)'}, ${zone} soil zone, southern Alberta:`,
    'alkaline and calcareous, so use the bicarbonate (Olsen) phosphorus figure rather',
    'than Mehlich-III, and expect phosphorus, zinc, iron and manganese to be less',
    'available than the raw numbers suggest.',
    '',
    ...baseline.lines,
  ].join('\n'))

  const chunks: string[][] = []
  for (let i = 0; i < NOTE_COLUMNS.length; i += CHUNK) {
    chunks.push(NOTE_COLUMNS.slice(i, i + CHUNK))
  }

  // All of it at once. The wall clock becomes the slowest call rather than the
  // sum, which is the entire point of splitting it up.
  const [narrative, ...noteResults] = await Promise.all([
    callTool(
      apiKey,
      model,
      NARRATIVE_TOOL,
      `${context}\n\nWhat does this field need for the UPCOMING crop, and why?\n` +
        `Write ONLY about what requires action. Skip anything already adequate — the grower has the ` +
        `full table of numbers beside this and does not need it read back to them. No opening ` +
        `summary of the soil, no closing paragraph restating the rates. Rates in lb/ac of actual ` +
        `nutrient, naming real products. Do NOT restate the lab's own recommendation; it is already ` +
        `printed on the report.
` +
        // It wrote "with no rotation history on file" on a field whose six years
        // of cropping were sitting in the prompt above it. The grower reads that
        // as the app not knowing what it plainly does know.
        `The cropping history above is what the farm has recorded. Never write that the rotation ` +
        `or history is unknown, unavailable or not on file when years are listed — use them. ` +
        `Say a year is unrecorded only where that line actually says so.\n` +
        `Start every rate from the ALBERTA BASELINE above. Where you recommend a different rate, the ` +
        `note must say why (manure, a legume, a yield goal, a test result). Never put more P2O5 with ` +
        `the seed than the seed-row cap given, and never recommend manure past the AOPA limit.`,
      3000,
    ),
    ...chunks.map((cols) =>
      callTool(
        apiKey,
        fastModel,
        NOTES_TOOL,
        `${context}\n\nWrite column_notes for ONLY these keys that have a value: ${cols.join(', ')}.\n` +
          `summary: exactly two sentences on this field's result and what it means. ` +
          `priorCrop: exactly one sentence on how last year's crop may have affected it. ` +
          `nextCrop: exactly one sentence on what must change for the upcoming crop and why. ` +
          `Be specific to these numbers — a note that would read the same for any field is not worth showing.`,
        2000,
      ),
    ),
  ])

  const written = narrative.input
  if (!written?.assessment_md) return { ok: false, detail: narrative.problem ?? 'assessment was empty' }
  const recommendation = clampSeedRowP((written.recommendation as Rec[]) ?? [], baseline.seedCap)

  // Rebuild the keyed map from the flat list. Anything without a recognised
  // column key is dropped rather than stored under an invented name.
  const valid = new Set(NOTE_COLUMNS)
  const column_notes: Record<string, unknown> = {}
  for (const { input: r } of noteResults) {
    const items = Array.isArray(r?.notes) ? (r.notes as Record<string, unknown>[]) : []
    for (const item of items) {
      const key = typeof item?.column === 'string' ? item.column : null
      if (!key || !valid.has(key)) continue
      column_notes[key] = {
        summary: item.summary ?? '',
        priorCrop: item.priorCrop ?? '',
        nextCrop: item.nextCrop ?? '',
      }
    }
  }

  const { error: upErr } = await sb.from('soil_test_assessments').upsert(
    {
      report_id: reportId,
      crop_label: nextCrop,
      assessment_md: written.assessment_md as string,
      recommendation,
      column_notes,
      model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'report_id' },
  )
  if (upErr) return { ok: false, detail: `write failed: ${upErr.message}` }

  // Stamp what it was written from, using the SAME function the staleness view
  // reads. A second implementation in TypeScript would drift, and the failure
  // is silent: every report reads as permanently stale and is rewritten hourly.
  const { data: hash, error: hashErr } = await sb.rpc('fn_soil_inputs_hash', {
    p_report_id: reportId,
  })
  if (hashErr) return { ok: false, detail: `hash failed: ${hashErr.message}` }
  await sb
    .from('soil_test_assessments')
    .update({ inputs_hash: hash as string })
    .eq('report_id', reportId)

  const recCount = recommendation.length
  return {
    ok: true,
    detail: `${field.name} ${year}: ${recCount} recommendations, ${Object.keys(column_notes).length} column notes`,
  }
}
