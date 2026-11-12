/**
 * Judging a figure a model says it read out of a paper.
 *
 * The extraction itself runs in a function (netlify/shared/research-numbers-core.ts),
 * but the part that decides whether a reading may be stored lives here, where
 * the test suite reaches it. That split is deliberate: this is the only thing
 * standing between "a model typed a number" and a figure the farm might act
 * on, so it is the part that has to be provable.
 */

/** The figures worth having. Must match the check constraint on the table. */
export const MEASURES = [
  'economic threshold', 'application rate', 'water volume',
  'seeding rate', 'seeding depth', 'plant density',
  'growth stage', 'timing window', 'pre-harvest interval',
  're-crop interval', 'grazing restriction',
  'fertilizer rate', 'soil temperature', 'soil moisture',
  // The soil-test level you act on either side of ("no benefit above 30 kg
  // P/ha of soil test P"), and what the previous crop leaves behind for the
  // next one. Neither is a rate you apply, and filing them as one loses the
  // condition that makes them worth anything.
  'soil test threshold', 'nutrient credit',
  'irrigation amount', 'yield response',
] as const

export type Measure = (typeof MEASURES)[number]

/**
 * A passage is worth reading only if it carries a unit a farm would act on.
 *
 * Written for Postgres (PostgREST's imatch), which is where it turns 187,000
 * passages into a few hundred. Without this test "threshold" matches the noise
 * floor of a mass spectrometer and "rate" matches a chromatography gradient —
 * both of which are in this library.
 */
export const UNITS_SQL =
  '([0-9][0-9.,]*\\s?(kg|g|l|ml|lb)\\s?(ai\\s?)?/\\s?(ha|ac|acre)' +
  '|[0-9][0-9.,]*\\s?(plants?|seeds?|larvae|beetles?|aphids?|sclerotia)\\s?/\\s?(m2|m²|m\\^2|plant|sweep|ft2)' +
  '|economic threshold|action threshold|spray threshold' +
  '|[0-9][0-9.,]*\\s?(bu|t|tonnes?)\\s?/\\s?(ac|acre|ha)' +
  // The Alberta extension sheets write it out: "30 lb of P2O5 per acre", "10
  // gallons of water per acre". Only 241 of the 2,221 papers strongly about
  // our subjects held a slashed unit, and the sheets are where a figure a
  // farm can act on is actually written down.
  '|[0-9][0-9.,]*[a-z%$.,()\\s]{0,24}(per acre|per hectare)' +
  // And irrigation is written as a depth of water, never as a rate.
  '|[0-9][0-9.,]*\\s?(inch|inches|mm|cm)[a-z\\s]{0,12}(of water|irrigation))'

/**
 * Level a quote and the text it claims to come from, so they can be compared.
 *
 * PDF text arrives with the typesetting's line breaks and the odd lost
 * ligature, so an exact match would reject honest quotes. Spacing, dashes and
 * quote marks are levelled; letters and digits are untouched, so a changed
 * number still fails — which is the point.
 */
export function flatten(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Which of our own crops a passage actually names.
 *
 * A figure is only worth attaching to a crop if the crop can be named, and the
 * folders are a poor source for that: the topic folders (fertility, irrigation,
 * water quality) carry no crop names at all, so a 1985 Alberta sheet on pea
 * nitrogen was offered no crops and correctly returned none. Peas, oats,
 * triticale, soybeans and sorghum are all crops here that no folder names.
 *
 * So the text itself is asked. A crop is offered only if the passage names it,
 * which is stricter than folder metadata rather than looser — the model still
 * picks from a list and can still answer null.
 *
 * Matching is on whole words, checked by hand rather than with \b: a word
 * boundary escape in this project's tooling has a way of arriving as a literal
 * backspace and failing silently. Without it "wheat" matches buckwheat.
 */
export function cropsNamedIn(text: string, cropNames: string[]): string[] {
  const hay = flatten(text)
  return cropNames.filter((name) => cropNeedles(name).some((n) => hasWord(hay, n)))
}

/**
 * The words that mean a crop is in the text.
 *
 * Built from the crop's own name, less the parts that say how we sell or buy
 * it rather than what it is — 'Spinach Seed' must not be offered to every
 * paper that says "seed", and 'Green Feed' must not be offered for "feed".
 */
const NOT_A_CROP_WORD = new Set([
  'seed', 'green', 'feed', 'grain', 'silage', 'high', 'moisture', 'dry',
  'custom', 'crop', 'red', 'black', 'yellow', 'white', 'chipper', 'creamer',
  'fresh', 'pack', 'processor', 'fry', 'great', 'northern', 'basf', 'corteva',
  'nutrien',
])

export function cropNeedles(name: string): string[] {
  // 'Potato (kind not chosen)', 'Custom Crop bu/ac', 'Summer Fallow' and
  // 'Not farmed by us' are bookkeeping, not crops a paper writes about.
  if (/\(|custom crop|not farmed|fallow/i.test(name)) return []
  const flat = flatten(name)
  const out = new Set<string>([flat])
  for (const part of flat.split(/[-\s]+/)) {
    if (part.length < 4 || NOT_A_CROP_WORD.has(part)) continue
    out.add(part)
    // 'Peas' is how we spell it; a paper writes "field pea". Only strip the s
    // when what is left is not itself an s-word, so 'grass' stays whole.
    if (part.endsWith('s') && !part.slice(0, -1).endsWith('s') && part.length > 3) {
      out.add(part.slice(0, -1))
    }
  }
  return [...out]
}

/** Does `needle` occur in `hay` as a whole word? */
function hasWord(hay: string, needle: string): boolean {
  const letter = (c: string) => c >= 'a' && c <= 'z'
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = i === 0 ? ' ' : hay[i - 1]
    const after = hay[i + needle.length] ?? ' '
    if (!letter(before) && !letter(after)) return true
  }
  return false
}

/**
 * Does the number itself appear in the sentence that is supposed to prove it?
 *
 * The passage check stops an invented sentence. It does not stop a number
 * inferred from a real one, and the second reading pass did that twice. From
 * "A majority of the growers seeded shallow, within one inch of the soil
 * surface" it produced a seeding depth of 0.25 to 1 inch — the 0.25 is
 * nowhere. From "The rate is decreased as nitrogen soil test results increase"
 * it produced a threshold of 20 lb/acre out of nothing at all. And from a
 * passage where the text layer read 105 as "1OS" it produced 105, which may
 * well be right but cannot be checked by the person being asked to confirm it.
 *
 * So the digits have to be there. Numbers up to twelve may be spelled out,
 * because papers write "within one inch", and a figure is matched as a whole
 * number so 1 does not match the 1 inside 15.
 */
const SPELLED = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]

export function numberInPassage(value: number, passage: string): boolean {
  // Thousands separators go, so 1,000 and 1000 are the same number.
  const hay = flatten(passage).replace(/(\d),(?=\d{3}\b)/g, '$1')
  const forms = new Set<string>([String(value)])
  if (Number.isInteger(value)) forms.add(value.toFixed(1))
  else forms.add(String(value).replace(/0+$/, ''))
  if (Number.isInteger(value) && value >= 0 && value <= 12) forms.add(SPELLED[value])
  if (value === 0.5) forms.add('half')
  return [...forms].some((f) => hasNumberWord(hay, f))
}

/** `needle` in `hay`, not glued to another digit, decimal point or letter. */
function hasNumberWord(hay: string, needle: string): boolean {
  const glued = (c: string) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || c === '.'
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = i === 0 ? ' ' : hay[i - 1]
    const after = hay[i + needle.length] ?? ' '
    // A trailing decimal point is only glue if a digit follows it: "15." at
    // the end of a sentence is still 15.
    const afterGlued = after === '.' ? /[0-9]/.test(hay[i + needle.length + 1] ?? '') : glued(after)
    if (!glued(before) && !afterGlued) return true
  }
  return false
}

/**
 * Is this somebody else's number, or one the paper itself says means nothing?
 *
 * Two of the prompt's own rules turn out to be checkable, and a full pass over
 * the library broke both often enough to be worth enforcing rather than
 * asking:
 *
 *   "The increases in barley yields from KCl fertilization in the studies of
 *   Bauer and Vasey (1964) ... were modest" — a 1987 southern Alberta paper
 *   quoting 1964 North Dakota. The library is ordered by how near the work was
 *   done, and a figure quoted from elsewhere makes that ordering a lie.
 *
 *   "the ammonium availability was higher in Humalite-treated plants (10, 42
 *   and 155 % higher ...)" — stored as a yield response, from a sentence the
 *   paper goes on to call not significant.
 *
 * The test is on where the citation sits, not merely that there is one. A
 * sentence that carries on after naming someone else is a sentence about their
 * work: "Wen et al. (2023) found that ... yield increased by 41%". A citation
 * in the last few characters is a paper backing up its own advice, and that is
 * left alone: "The optimal seeding time is from early May to early June
 * (Baron et al., 2000)." is this paper's recommendation and worth keeping.
 */
export function quotesSomeoneElse(passage: string): boolean {
  const p = flatten(passage)
  if (/\[\d{1,3}(\s*[,-]\s*\d{1,3})*\]/.test(p)) return true
  if (/\bin the stud(y|ies) of\b|\bas reported by\b/.test(p)) return true
  const cite = p.lastIndexOf('et al')
  // 22 characters is enough for "et al., 2000)." and its full stop, and not
  // enough for the sentence to go on and say something.
  return cite >= 0 && p.length - cite > 22
}

export function saysNotSignificant(passage: string): boolean {
  return /\b(not|no)\s+(statistically\s+)?significant|\bnot\s+significantly\b|\bns\)/
    .test(flatten(passage))
}

/**
 * Words that have to be in the sentence for the measure to be what it says.
 *
 * Matched as pieces of a word, so "produc" covers produced, production and
 * productivity, and "yield" covers yields and yielded.
 *
 * Only 'yield response' is listed, because that is the one that went wrong.
 * It is the easiest label to reach for, so it collected everything a trial
 * happened to weigh: "medium plant density plots had 1535.5 ± 86.9 kg/ha",
 * "CPY by 61.5% (832.8 vs. 320.5 kg/ha)", "a minimum residue of 126 and 104
 * kg/ha". Each is a real sentence out of a real paper, and not one of them
 * says what the number is a yield of — the first two never name the crop or
 * the measurement, and the third is residue left on the ground, which is the
 * opposite of a yield. A figure whose own sentence never mentions a yield is
 * mislabelled, whatever else it may be.
 *
 * Other measures can be added here when a pass shows they need it. Adding one
 * on suspicion would throw away good figures to no purpose.
 */
export const MEASURE_WORDS: Partial<Record<Measure, readonly string[]>> = {
  'yield response': [
    'yield', 'produc', 'harvest', 'biomass', 'dry matter',
    'silage', 'forage', 'herbage', 'tonnage', 'bushel', 'loss',
    // The Alberta potash work writes it as a response and never repeats the
    // word yield: "the response to KCl amounted to 0.16 t/ha (3.0 bu/ac)".
    // Five southern Alberta figures turned on this one word.
    'response',
    // Dry matter yield, as every forage paper abbreviates it.
    'dmy',
  ],
}

/** Does the sentence mention the thing the figure claims to measure? */
export function namesWhatItMeasures(measure: string, passage: string): boolean {
  const words = MEASURE_WORDS[measure as Measure]
  if (!words) return true
  const hay = flatten(passage)
  return words.some((w) => hay.includes(w))
}

export type FigureRow = {
  paper_id: string
  chunk_id: number | null
  page: number | null
  measure: string
  subject: string
  crop_name: string | null
  active: string | null
  value_low: number | null
  value_high: number | null
  unit: string | null
  qualifier: string | null
  passage: string
  confidence: number
  model: string
}

export type Checked = { bad: string; row?: undefined } | { bad?: undefined; row: FigureRow }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Turn one reading into a row, or say why it cannot be stored.
 *
 * The tests that matter here are the refusals. A figure is kept only if its
 * measure is one we asked for, it names a subject, and — the whole defence
 * against an invented number — the sentence it quotes really occurs in the
 * passage it was read from. A crop or active the paper's own folders never
 * named is dropped to null rather than believed.
 */
export function checkFigure(
  row: unknown,
  chunk: { id: number | null; paper_id: string; page_from: number | null },
  crops: string[],
  actives: string[],
  haystack: string,
  model: string,
): Checked {
  if (!row || typeof row !== 'object') return { bad: 'not an object' }
  const r = row as Record<string, unknown>
  if (!(MEASURES as readonly string[]).includes(String(r.measure))) return { bad: 'unknown measure' }
  const subject = String(r.subject ?? '').trim()
  if (!subject) return { bad: 'no subject' }
  const passage = String(r.passage ?? '').trim()
  if (passage.length < 30) return { bad: 'passage too short' }
  // A quote has to be a sentence, not furniture off a table. One reading came
  // back quoting "50 lb/acre 11 O lb / acre" — two cells of a fertilizer table
  // whose zero the PDF read as a letter O — and inferred 110 lb/acre from it.
  // The number may even have been right; nothing in that string shows it. Five
  // words is enough to tell prose from a row of cells, and short real quotes
  // like "fall rye - 1 kg/ha (0.9 lbs/ac)" still clear it.
  if ((passage.match(/[A-Za-z]{2,}/g) ?? []).length < 5) return { bad: 'passage is not prose' }
  if (!haystack.includes(flatten(passage))) return { bad: 'passage not in the text' }
  if (quotesSomeoneElse(passage)) return { bad: 'the figure is quoted from another paper' }
  if (saysNotSignificant(passage)) return { bad: 'the paper calls it not significant' }
  if (!namesWhatItMeasures(String(r.measure), passage)) {
    return { bad: `the quote does not mention a ${String(r.measure)}` }
  }

  const low = num(r.low)
  const high = num(r.high) ?? low
  // A stage or a window can be words ("early bloom to petal fall"), so those
  // alone may arrive without a number. Everything else must have one.
  const staged = /stage|timing|window/.test(String(r.measure))
  if (low === null && !staged) return { bad: 'no number' }
  if (low !== null && !numberInPassage(low, passage)) return { bad: 'the number is not in the quote' }
  if (high !== null && high !== low && !numberInPassage(high, passage)) {
    return { bad: 'the number is not in the quote' }
  }

  return {
    row: {
      paper_id: chunk.paper_id,
      chunk_id: chunk.id,
      page: chunk.page_from ?? null,
      measure: String(r.measure),
      subject: subject.slice(0, 120),
      crop_name: crops.includes(String(r.crop)) ? String(r.crop) : null,
      active: actives.includes(String(r.active)) ? String(r.active) : null,
      value_low: low,
      value_high: high !== null && low !== null && high < low ? low : high,
      unit: r.unit ? String(r.unit).slice(0, 40) : null,
      qualifier: r.qualifier ? String(r.qualifier).slice(0, 160) : null,
      passage: passage.slice(0, 1000),
      confidence: [1, 2, 3].includes(Number(r.confidence)) ? Number(r.confidence) : 2,
      model,
    },
  }
}
