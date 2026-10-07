/**
 * Read a soil lab's results export (CSV) into soil test reports and samples.
 *
 * The browser half of scripts/soil_tests/import_ici_csv.mjs, with the parts
 * that were fixed to one lab's export made general: columns are matched by a
 * forgiving name lookup and can be re-pointed by hand, and the field a report
 * belongs to is proposed, never assumed.
 *
 * Pure: no React, no Supabase. The screen is src/pages/fertilizer/SoilTestImport.tsx.
 */

/** The numeric sample columns a CSV column can be filed under. */
export const SOIL_VALUE_COLUMNS = [
  { key: 'no3n_ppm', label: 'Nitrate-N (ppm)' },
  { key: 'no3n_lb_ac', label: 'Nitrate-N (lb/ac)' },
  { key: 'p_bicarb_ppm', label: 'P, Olsen / bicarbonate (ppm)' },
  { key: 'p_melich3_ppm', label: 'P, Mehlich-3 (ppm)' },
  { key: 'k_ppm', label: 'Potassium (ppm)' },
  { key: 'so4s_ppm', label: 'Sulphate-S (ppm)' },
  { key: 'om_pct', label: 'Organic matter (%)' },
  { key: 'ph', label: 'pH' },
  { key: 'ec_ms_cm', label: 'EC / soluble salts (dS/m = mS/cm)' },
  { key: 'cec_meq', label: 'CEC (meq/100 g)' },
  { key: 'ca_ppm', label: 'Calcium (ppm)' },
  { key: 'mg_ppm', label: 'Magnesium (ppm)' },
  { key: 'na_ppm', label: 'Sodium (ppm)' },
  { key: 'b_ppm', label: 'Boron (ppm)' },
  { key: 'cu_ppm', label: 'Copper (ppm)' },
  { key: 'fe_ppm', label: 'Iron (ppm)' },
  { key: 'mn_ppm', label: 'Manganese (ppm)' },
  { key: 'zn_ppm', label: 'Zinc (ppm)' },
  { key: 'cl_ppm', label: 'Chloride (ppm)' },
  { key: 'al_ppm', label: 'Aluminium (ppm)' },
  { key: 'base_k_pct', label: 'Base saturation K (%)' },
  { key: 'base_mg_pct', label: 'Base saturation Mg (%)' },
  { key: 'base_ca_pct', label: 'Base saturation Ca (%)' },
  { key: 'base_na_pct', label: 'Base saturation Na (%)' },
  { key: 'base_h_pct', label: 'Base saturation H (%)' },
  { key: 'p_sat_pct', label: 'P saturation (%)' },
  { key: 'al_sat_pct', label: 'Al saturation (%)' },
  { key: 'k_mg_ratio', label: 'K:Mg ratio' },
  { key: 'enr', label: 'ENR' },
  { key: 'gfi', label: 'GFI' },
] as const

export type SoilValueColumn = (typeof SOIL_VALUE_COLUMNS)[number]['key']

/** Columns that say WHICH sample a row is rather than what was in it. */
export const ROLES = [
  { key: 'label', label: 'Field / sample label' },
  { key: 'date', label: 'Sampling date' },
  { key: 'depth', label: 'Depth' },
  { key: 'sampleId', label: 'Sample ID' },
  { key: 'reportRef', label: 'Lab report number' },
  { key: 'crop', label: 'Crop' },
  { key: 'lab', label: 'Lab name' },
  { key: 'sampleType', label: 'Sample type (soil / tissue)' },
] as const

export type Role = (typeof ROLES)[number]['key']
export type Target = Role | SoilValueColumn | 'ignore'

/**
 * Header → what it holds.
 *
 * The first block is the reference export's own headers (the ones the import
 * script was written against); the rest are the names other labs and hand-made
 * spreadsheets use. Keys are run through normaliseHeader before lookup, so
 * "NO3-N (ppm)", "no3-n ppm" and "NO3 N" are the same entry.
 *
 * A bare "P" is filed as bicarbonate (Olsen): that is the method prairie labs
 * run on alkaline soils. Mehlich-3 is only chosen when the header names it.
 */
export const KNOWN_COLUMNS: Record<string, Target> = {
  // The reference export.
  'NO3-N ppm': 'no3n_ppm',
  'P ppm': 'p_bicarb_ppm',
  'K ppm': 'k_ppm',
  'SO4-S ppm': 'so4s_ppm',
  'OM %': 'om_pct',
  pH: 'ph',
  'SS dS/m': 'ec_ms_cm',
  'Ca ppm': 'ca_ppm',
  'Mg ppm': 'mg_ppm',
  'Na ppm': 'na_ppm',
  'B ppm': 'b_ppm',
  'Cu ppm': 'cu_ppm',
  'Fe ppm': 'fe_ppm',
  'Mn ppm': 'mn_ppm',
  'Zn ppm': 'zn_ppm',
  'CEC meq/100g': 'cec_meq',
  'BS-K %': 'base_k_pct',
  'BS-Mg %': 'base_mg_pct',
  'BS-Ca %': 'base_ca_pct',
  'BS-Na %': 'base_na_pct',
  'BS-H %': 'base_h_pct',
  Field: 'label',
  'Event Date': 'date',
  'Sample Depth': 'depth',
  'Sample ID': 'sampleId',
  Report: 'reportRef',
  Crop: 'crop',
  'Sample Type': 'sampleType',

  // Nitrate.
  'Nitrate-N': 'no3n_ppm',
  'Nitrate N': 'no3n_ppm',
  Nitrate: 'no3n_ppm',
  'NO3-N (ppm)': 'no3n_ppm',
  NO3: 'no3n_ppm',
  N: 'no3n_ppm',
  'NO3-N lb/ac': 'no3n_lb_ac',
  'NO3-N (lb/ac)': 'no3n_lb_ac',
  'Nitrate-N lb/ac': 'no3n_lb_ac',
  'N lb/ac': 'no3n_lb_ac',
  'NO3-N lbs/ac': 'no3n_lb_ac',
  'Nitrate-N lbs/acre': 'no3n_lb_ac',

  // Phosphorus.
  P: 'p_bicarb_ppm',
  Phosphorus: 'p_bicarb_ppm',
  'Olsen P': 'p_bicarb_ppm',
  'P (Olsen)': 'p_bicarb_ppm',
  'P Olsen': 'p_bicarb_ppm',
  'Bicarb P': 'p_bicarb_ppm',
  'P Bicarb': 'p_bicarb_ppm',
  'P (Bicarbonate)': 'p_bicarb_ppm',
  'Modified Kelowna P': 'p_bicarb_ppm',
  'Mehlich-3 P': 'p_melich3_ppm',
  'Mehlich 3 P': 'p_melich3_ppm',
  'P (Mehlich-3)': 'p_melich3_ppm',
  'P Mehlich': 'p_melich3_ppm',
  'M3 P': 'p_melich3_ppm',
  'P (M3)': 'p_melich3_ppm',
  'Melich-3 P': 'p_melich3_ppm',

  // Potassium, sulphur.
  K: 'k_ppm',
  Potassium: 'k_ppm',
  'Exch K': 'k_ppm',
  S: 'so4s_ppm',
  'SO4-S': 'so4s_ppm',
  'Sulfate-S': 'so4s_ppm',
  'Sulphate-S': 'so4s_ppm',
  'Sulfate S': 'so4s_ppm',
  'Sulphate S': 'so4s_ppm',
  Sulfur: 'so4s_ppm',
  Sulphur: 'so4s_ppm',
  SO4: 'so4s_ppm',

  // Organic matter, pH, salts, CEC.
  OM: 'om_pct',
  'Organic Matter': 'om_pct',
  'Organic Matter %': 'om_pct',
  'Soil pH': 'ph',
  'pH (1:2)': 'ph',
  'pH 1:1': 'ph',
  'pH (water)': 'ph',
  EC: 'ec_ms_cm',
  'Electrical Conductivity': 'ec_ms_cm',
  'EC dS/m': 'ec_ms_cm',
  'EC mS/cm': 'ec_ms_cm',
  'Soluble Salts': 'ec_ms_cm',
  SS: 'ec_ms_cm',
  Salts: 'ec_ms_cm',
  CEC: 'cec_meq',
  'Cation Exchange Capacity': 'cec_meq',

  // Cations and micronutrients.
  Ca: 'ca_ppm',
  Calcium: 'ca_ppm',
  Mg: 'mg_ppm',
  Magnesium: 'mg_ppm',
  Na: 'na_ppm',
  Sodium: 'na_ppm',
  B: 'b_ppm',
  Boron: 'b_ppm',
  Cu: 'cu_ppm',
  Copper: 'cu_ppm',
  Fe: 'fe_ppm',
  Iron: 'fe_ppm',
  Mn: 'mn_ppm',
  Manganese: 'mn_ppm',
  Zn: 'zn_ppm',
  Zinc: 'zn_ppm',
  Cl: 'cl_ppm',
  Chloride: 'cl_ppm',
  Al: 'al_ppm',
  Aluminum: 'al_ppm',
  Aluminium: 'al_ppm',

  // Base saturation and ratios.
  'Base Sat K': 'base_k_pct',
  'K Sat': 'base_k_pct',
  'K Base Saturation': 'base_k_pct',
  'Base Sat Mg': 'base_mg_pct',
  'Mg Sat': 'base_mg_pct',
  'Mg Base Saturation': 'base_mg_pct',
  'Base Sat Ca': 'base_ca_pct',
  'Ca Sat': 'base_ca_pct',
  'Ca Base Saturation': 'base_ca_pct',
  'Base Sat Na': 'base_na_pct',
  'Na Sat': 'base_na_pct',
  'Na Base Saturation': 'base_na_pct',
  'Base Sat H': 'base_h_pct',
  'H Sat': 'base_h_pct',
  'H Base Saturation': 'base_h_pct',
  'P Sat': 'p_sat_pct',
  'P Saturation': 'p_sat_pct',
  'Al Sat': 'al_sat_pct',
  'Al Saturation': 'al_sat_pct',
  'K:Mg': 'k_mg_ratio',
  'K/Mg Ratio': 'k_mg_ratio',
  'K:Mg Ratio': 'k_mg_ratio',
  ENR: 'enr',
  GFI: 'gfi',

  // Which sample.
  'Field Name': 'label',
  Location: 'label',
  'Sample Location': 'label',
  'Sample Name': 'label',
  'Sample Description': 'label',
  Description: 'label',
  'Legal Land Description': 'label',
  Legal: 'label',
  Label: 'label',
  Date: 'date',
  'Sample Date': 'date',
  'Date Sampled': 'date',
  'Sampling Date': 'date',
  'Sampled Date': 'date',
  'Collection Date': 'date',
  Depth: 'depth',
  'Depth (in)': 'depth',
  'Depth (cm)': 'depth',
  'Sample Depth (in)': 'depth',
  'Sample ID#': 'sampleId',
  'Sample #': 'sampleId',
  'Sample No': 'sampleId',
  'Sample Number': 'sampleId',
  'Sample Code': 'sampleId',
  'Lab ID': 'sampleId',
  'Lab Number': 'sampleId',
  'Lab No': 'sampleId',
  'Report #': 'reportRef',
  'Report No': 'reportRef',
  'Report Number': 'reportRef',
  'Lab Report': 'reportRef',
  'Lab Report Number': 'reportRef',
  'Work Order': 'reportRef',
  'Intended Crop': 'crop',
  'Crop to be Grown': 'crop',
  'Next Crop': 'crop',
  Lab: 'lab',
  Laboratory: 'lab',
  'Lab Name': 'lab',
  Type: 'sampleType',
  'Sample Kind': 'sampleType',
}

/**
 * Reduce a header to the letters and digits that name it.
 *
 * Case, spacing, punctuation and the concentration unit do not change what a
 * column is, so they are dropped: "NO3-N (ppm)" and "no3n" agree. Units that DO
 * change the meaning — lb/ac against ppm — are kept, so the two nitrate
 * columns stay apart. A "(1:2)" soil-to-water ratio goes the same way as ppm.
 */
export function normaliseHeader(h: string): string {
  let s = String(h ?? '').toLowerCase()
  s = s.replace(/lbs?\s*\/\s*ac(re)?s?/g, ' lbac ')
  s = s.replace(/\d+\s*:\s*\d+/g, ' ')
  s = s.replace(/meq\s*\/\s*100\s*g?/g, ' ')
  s = s.replace(/cmol\S*\s*\/\s*kg/g, ' ')
  s = s.replace(/mg\s*\/\s*kg/g, ' ')
  s = s.replace(/ds\s*\/\s*m/g, ' ')
  s = s.replace(/ms\s*\/\s*cm/g, ' ')
  s = s.replace(/mmhos?\s*\/\s*cm/g, ' ')
  s = s.replace(/[^a-z0-9]+/g, ' ')
  const drop = new Set(['ppm', 'pct', 'percent', 'in', 'inches', 'cm'])
  return s
    .split(' ')
    .filter((w) => w && !drop.has(w))
    .join('')
}

const KNOWN_NORMALISED: Map<string, Target> = (() => {
  const m = new Map<string, Target>()
  for (const [k, v] of Object.entries(KNOWN_COLUMNS)) {
    const n = normaliseHeader(k)
    if (!m.has(n)) m.set(n, v)
  }
  return m
})()

/** What a header holds, or 'ignore' when nothing known matches it. */
export function guessTarget(header: string): Target {
  return KNOWN_NORMALISED.get(normaliseHeader(header)) ?? 'ignore'
}

/**
 * A target for every header. The first header to claim a target keeps it; a
 * second "K ppm" further along the row is set to ignore rather than letting the
 * last one silently overwrite the first.
 */
export function autoMap(headers: string[]): Target[] {
  const taken = new Set<Target>()
  return headers.map((h) => {
    const t = guessTarget(h)
    if (t === 'ignore' || taken.has(t)) return 'ignore'
    taken.add(t)
    return t
  })
}

/**
 * Split CSV text into rows of cells.
 *
 * Honours quoted cells, doubled quotes inside them, commas and line breaks in
 * quotes, CRLF line ends and a leading byte-order mark. Rows that are entirely
 * empty are dropped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const LEGAL_RE = /(?:^|[^A-Z0-9])(NE|NW|SE|SW)?[\s-]*(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})(?![0-9])/g

/**
 * Every quarter section in a piece of text, in one shape.
 *
 * "SW 13-71-14 Field 1", "#1 SW 13-71-14" and "SW-13-71-14-W4" all reduce to
 * SW-13-71-14. The meridian is dropped. A legal with no quarter keeps an empty
 * one: "-10-11-13".
 */
export function legalsIn(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  const s = String(text).toUpperCase()
  for (const m of s.matchAll(LEGAL_RE)) {
    const [, q, sec, twp, rge] = m
    const key = `${q ?? ''}-${Number(sec)}-${Number(twp)}-${Number(rge)}`
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/** The first quarter section in the text, or null. */
export function normaliseLegal(text: string | null | undefined): string | null {
  return legalsIn(text)[0] ?? null
}

/**
 * A sampling date as YYYY-MM-DD.
 *
 * Takes ISO dates (with or without a time), YYYY/MM/DD, and slashed dates with
 * the year last — read month first, unless the first number cannot be a month.
 * Anything else the browser can parse (e.g. "Oct 3, 2025") is accepted too.
 */
export function parseDate(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const iso = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCMonth() !== m - 1) return null
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?![0-9])/)
  if (m) {
    let y = Number(m[3])
    if (y < 100) y += 2000
    const a = Number(m[1])
    const b = Number(m[2])
    return a > 12 ? iso(y, b, a) : iso(y, a, b)
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** A fall sample informs the following spring: July onward counts toward next year. */
export function cropYearOf(isoDate: string | null | undefined): number | null {
  const m = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const month = Number(m[2])
  return month >= 7 ? y + 1 : y
}

export type Depth = { label: string; top: number; bottom: number }

/** Depths a lab writes in centimetres when it gives no unit. */
const CM_BOTTOMS = new Set([15, 30, 45, 60, 90, 120])

/**
 * A depth range in inches.
 *
 * '0"-6"', '0-6 in', '6-24' → inches; '0-15 cm', '15-30cm' → converted. With
 * no unit on the value, `defaultUnit` (from a header like "Depth (cm)") decides;
 * failing that, a range ending at 15, 30, 45, 60, 90 or 120 is read as cm,
 * since nobody samples to 15 or 30 inches.
 */
export function parseDepth(v: string | null | undefined, defaultUnit?: 'in' | 'cm'): Depth | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:"|''|in(?:ch(?:es)?)?\.?|cm)?\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  if (!(b > a)) return null
  let unit: 'in' | 'cm'
  if (/cm/i.test(s)) unit = 'cm'
  else if (/"|''|in/i.test(s)) unit = 'in'
  else if (defaultUnit) unit = defaultUnit
  else unit = CM_BOTTOMS.has(b) ? 'cm' : 'in'
  const toIn = (x: number) => (unit === 'cm' ? Math.round(x / 2.54) : Math.round(x))
  return { label: s, top: toIn(a), bottom: toIn(b) }
}

/**
 * A lab number, or null for a blank, "n/a", or a below-detection "<0.1".
 *
 * Below-detection is left empty rather than filed as the detection limit: the
 * soil had less than that, and writing the limit would overstate it.
 */
export function parseNumber(v: string | null | undefined): number | null {
  const s = String(v ?? '').trim().replace(/,(?=\d{3}(?:\D|$))/g, '')
  if (!s || /^[<>]/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * A row that is a plant-tissue test, not soil.
 *
 * Tissue reports share some labs' soil template with % of dry matter in the
 * ppm columns — filing them would put a 2.2% leaf potassium where 2.2 ppm of
 * soil potassium belongs. A blank type is taken as soil (a hand-typed sheet).
 */
export function isTissueRow(sampleType: string | null | undefined): boolean {
  const s = String(sampleType ?? '').trim().toLowerCase()
  return s !== '' && s !== 'soil'
}

export type SampleDraft = {
  sample_code: string
  depth_label: string | null
  depth_top_in: number | null
  depth_bottom_in: number | null
  values: Partial<Record<SoilValueColumn, number>>
}

export type ImportGroup = {
  /** label|date — stable across re-mapping so per-report choices survive. */
  key: string
  label: string
  date: string
  cropYear: number | null
  crop: string | null
  reportRef: string | null
  lab: string | null
  samples: SampleDraft[]
}

export type Grouped = {
  groups: ImportGroup[]
  /** Rows skipped as plant tissue. */
  tissue: number
  /** Soil rows with no label or no readable date. */
  incomplete: number
}

/**
 * Group the rows into reports: one label + one sampling date, however many
 * depths and sites. `mapping[i]` is what column i holds.
 */
export function groupRows(
  rows: string[][],
  mapping: Target[],
  opts: { depthUnit?: 'in' | 'cm' } = {},
): Grouped {
  const col = (t: Target) => mapping.indexOf(t)
  const at = (r: string[], t: Role) => {
    const i = col(t)
    return i < 0 ? '' : (r[i] ?? '').trim()
  }
  const valueCols = mapping
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: SoilValueColumn; i: number } =>
      SOIL_VALUE_COLUMNS.some((c) => c.key === x.t),
    )

  const groups = new Map<string, ImportGroup>()
  let tissue = 0
  let incomplete = 0
  for (const r of rows) {
    if (isTissueRow(at(r, 'sampleType'))) {
      tissue++
      continue
    }
    const label = at(r, 'label')
    const date = parseDate(at(r, 'date'))
    if (!label || !date) {
      incomplete++
      continue
    }
    const key = `${label}|${date}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        label,
        date,
        cropYear: cropYearOf(date),
        crop: at(r, 'crop') || null,
        reportRef: at(r, 'reportRef') || null,
        lab: at(r, 'lab') || null,
        samples: [],
      }
      groups.set(key, g)
    }
    const depthText = at(r, 'depth')
    const depth = parseDepth(depthText, opts.depthUnit)
    const values: SampleDraft['values'] = {}
    for (const { t, i } of valueCols) {
      const n = parseNumber(r[i])
      if (n != null) values[t] = n
    }
    // The table keys a sample on (report, code), so a code must be unique within
    // its report. A lab that gives one id per site for both depths gets the
    // depth appended; no id at all falls back to the report number, then a count.
    const base = at(r, 'sampleId') || at(r, 'reportRef') || String(g.samples.length + 1)
    let code = base
    const used = new Set(g.samples.map((s) => s.sample_code))
    if (used.has(code) && depthText) code = `${base} ${depthText}`
    for (let n = 2; used.has(code); n++) code = `${base}-${n}`
    g.samples.push({
      sample_code: code,
      depth_label: depthText || null,
      depth_top_in: depth?.top ?? null,
      depth_bottom_in: depth?.bottom ?? null,
      values,
    })
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label),
    ),
    tissue,
    incomplete,
  }
}

export type FieldLite = {
  id: string
  name: string
  legal_land_description: string | null
  active: boolean | null
}

export type FieldMatch = { fieldId: string; how: 'legal' | 'name' }

/**
 * The field a report's label points at, or null.
 *
 * The quarter section in the label is tried first — it does not change with a
 * field's nickname. Then a field whose whole name appears in the label. An
 * active field beats an archived one carrying the same quarter or name; two
 * candidates that are otherwise equal are a tie, and a tie is no match. A
 * report that matches nothing is left for a person to assign, never guessed.
 */
export function matchField(label: string, fields: FieldLite[]): FieldMatch | null {
  const pick = (cands: FieldLite[]): FieldLite | null => {
    if (!cands.length) return null
    const active = cands.filter((f) => f.active)
    const pool = active.length ? active : cands
    return pool.length === 1 ? pool[0] : null
  }

  const legal = normaliseLegal(label)
  if (legal) {
    const hit = pick(fields.filter((f) => legalsIn(f.legal_land_description).includes(legal)))
    if (hit) return { fieldId: hit.id, how: 'legal' }
  }

  const hay = ` ${label.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const named = fields
    .map((f) => ({ f, n: f.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }))
    .filter(({ n }) => n.length >= 3 && hay.includes(` ${n} `))
  if (!named.length) return null
  const longest = Math.max(...named.map((x) => x.n.length))
  const hit = pick(named.filter((x) => x.n.length === longest).map((x) => x.f))
  return hit ? { fieldId: hit.id, how: 'name' } : null
}

export type ExistingReport = {
  field_id: string
  crop_year: number
  part_label: string
  report_date: string | null
  source_file: string | null
}

/**
 * Why a planned report should not be written, or null if it should.
 *
 * 'imported' — the same file already brought in this field and date (the
 * re-import case). 'clash' — the field already has a report for that crop year
 * under the same label; the table allows one, so writing would fail.
 */
export function skipReason(
  plan: { fieldId: string; cropYear: number; label: string; date: string; sourceFile: string },
  existing: ExistingReport[],
): 'imported' | 'clash' | null {
  for (const e of existing) {
    if (e.field_id !== plan.fieldId) continue
    if (e.report_date === plan.date && e.source_file === plan.sourceFile) return 'imported'
  }
  for (const e of existing) {
    if (e.field_id !== plan.fieldId) continue
    if (e.crop_year === plan.cropYear && e.part_label === plan.label) return 'clash'
  }
  return null
}

/** Headers for a blank sheet a farm can type results into. All auto-map. */
export const TEMPLATE_HEADERS = [
  'Field',
  'Sample Date',
  'Depth',
  'Sample ID',
  'Lab',
  'Report',
  'Crop',
  'NO3-N ppm',
  'NO3-N lb/ac',
  'P ppm',
  'K ppm',
  'SO4-S ppm',
  'OM %',
  'pH',
  'EC dS/m',
  'CEC meq/100g',
  'Ca ppm',
  'Mg ppm',
  'Na ppm',
  'B ppm',
  'Cu ppm',
  'Fe ppm',
  'Mn ppm',
  'Zn ppm',
  'Cl ppm',
]

export function templateCsv(): string {
  return TEMPLATE_HEADERS.join(',') + '\r\n'
}
