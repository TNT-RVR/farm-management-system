/**
 * Corteva's prescout spreadsheet, read into scout reports.
 *
 * The sheet is eighty-one columns wide and arrives once a year by email
 * ("Prairie Creek Prescouts 2027.xlsx", from Corteva, 12 Nov 2026). Most of the
 * width is the same seven weeds counted twice — in the count and between the
 * counts — for each of two walks, plus link columns that only work inside
 * Corteva's own app.
 *
 * Pure, and keyed by column letter rather than header text, because the
 * headers are abbreviations that have already changed once ("PS2 VC per M2
 * (dup)") while the column positions have not. `scripts/import-prescouts.mjs`
 * does the reading with exceljs and hands the letters in here.
 *
 * Everything that is read is also kept in `raw`, so a column this does not
 * understand is still on the record.
 */

export type SheetRow = Record<string, string | number | Date | boolean | null | undefined>

export type ParsedPrescout = {
  parcel: string
  grower_name: string | null
  acres: number | null
  rating: string | null
  crop_this_year: string | null
  crop_history: string[]
  last_canola_year: number | null
  last_canola_tech: string | null
  scouting_method: string | null
  ps1_on: string | null
  ps1_stage: string | null
  ps1_notes: string | null
  ps2_required: boolean | null
  ps2_on: string | null
  ps2_by: string | null
  ps2_notes: string | null
  vc_per_m2: number | null
  tissue_on: string | null
  tissue_summary: string | null
  agronomist_note: string | null
  contact_name: string | null
  contact_phone: string | null
  counts: Record<string, Record<string, { ic: number | null; bc: number | null }>>
  raw: Record<string, string | number | boolean | null>
}

/** Where each weed's four count columns live: [ps1 ic, ps1 bc, ps2 ic, ps2 bc]. */
const WEED_COLUMNS: Record<string, [string, string, string, string]> = {
  VC: ['M', 'S', 'AD', 'AI'],
  WM: ['N', 'T', 'AE', 'AJ'],
  BJ: ['O', 'V', 'AF', 'AK'],
  CLV: ['P', 'U', 'AG', 'AL'],
  FB: ['Q', 'W', 'AH', 'AM'],
  WBW: ['R', 'AP', 'AT', 'AS'],
  WO: ['AN', 'AO', 'AR', 'AQ'],
}

/** The tissue test's four results: column → what it tested for. */
const TISSUE_COLUMNS: [string, string][] = [
  ['AW', 'RR+'],
  ['AX', 'LL+'],
  ['AY', 'Gly+'],
  ['AZ', 'Stack'],
]

const text = (v: SheetRow[string]): string | null => {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

const num = (v: SheetRow[string]): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^-0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** "Yes"/"true" → true, "No"/"false" → false, anything else → null. */
const bool = (v: SheetRow[string]): boolean | null => {
  if (typeof v === 'boolean') return v
  const s = text(v)?.toLowerCase()
  if (s === 'yes' || s === 'true' || s === 'y') return true
  if (s === 'no' || s === 'false' || s === 'n') return false
  return null
}

/**
 * A date out of the sheet, as `YYYY-MM-DD`.
 *
 * Corteva writes month-first ("6/18/2026"), but one drone column in the 2027
 * sheet is day-first ("26/05/2026"), so a first part over twelve is read as
 * the day.
 *
 * A cell Excel stored as a date comes back as UTC midnight of the day that
 * was typed, so it has to be read with the UTC getters. Mountain time is
 * seven hours behind, and reading it locally moved every such date back a day.
 */
export function sheetDate(v: SheetRow[string]): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = text(v)
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3])
  const [month, day] = a > 12 ? [b, a] : [a, b]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)}`
}

/**
 * The legal land description, including the ones Excel ate.
 *
 * "2-12-11" is a section-township-range with the quarter left off, which Excel
 * reads as 11 December 2002 and hands back as a date. Turning it back into
 * `2-12-11` loses nothing: a two-digit year is the section, the month the
 * township and the day the range, in the order they were typed. UTC, for the
 * reason sheetDate gives — read locally this came back as `2-12-10`, a
 * quarter that is not the one that was scouted.
 */
export function sheetParcel(v: SheetRow[string]): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear() % 100}-${v.getUTCMonth() + 1}-${v.getUTCDate()}`
  return text(v)
}

/** "75% LL+ | 3/4 Samples" → what it found, or null when it found nothing. */
export function tissueResult(v: SheetRow[string], label: string): string | null {
  const s = text(v)
  if (!s) return null
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(s)
  if (!pct || Number(pct[1]) <= 0) return null
  const samples = /(\d+)\s*\/\s*(\d+)\s*samples/i.exec(s)
  return `${pct[1]}% ${label}${samples ? ` (${samples[1]} of ${samples[2]})` : ''}`
}

/** Four tissue columns into one line, or null when no trait was found. */
export function tissueSummary(row: SheetRow): string | null {
  const hits = TISSUE_COLUMNS.map(([col, label]) => tissueResult(row[col], label)).filter(Boolean)
  return hits.length ? hits.join(', ') : null
}

/** One sheet row as a scout report. Null when the row names no parcel. */
export function parsePrescoutRow(row: SheetRow): ParsedPrescout | null {
  const parcel = sheetParcel(row.B)
  if (!parcel) return null
  const counts: ParsedPrescout['counts'] = { ps1: {}, ps2: {} }
  for (const [weed, [a, b, c, d]] of Object.entries(WEED_COLUMNS)) {
    counts.ps1[weed] = { ic: num(row[a]), bc: num(row[b]) }
    counts.ps2[weed] = { ic: num(row[c]), bc: num(row[d]) }
  }
  const raw: ParsedPrescout['raw'] = {}
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v === '') continue
    raw[k] = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'boolean' || typeof v === 'number' ? v : String(v).replace(/\s+/g, ' ').trim()
  }
  const history = ['E', 'F', 'G', 'H'].map((c) => text(row[c])).filter((v): v is string => !!v)
  return {
    parcel,
    grower_name: text(row.A),
    acres: num(row.C),
    rating: text(row.CB)?.toUpperCase() ?? null,
    crop_this_year: text(row.D),
    crop_history: history,
    last_canola_year: num(row.I),
    last_canola_tech: text(row.J),
    scouting_method: text(row.CA),
    ps1_on: sheetDate(row.K),
    ps1_stage: text(row.L),
    ps1_notes: text(row.Y),
    ps2_required: bool(row.AA),
    ps2_on: sheetDate(row.AC),
    ps2_by: text(row.AB),
    ps2_notes: text(row.AU),
    // The sheet's own per-square-metre figure, else the one it computed for
    // the first walk. The second walk's column is a copy of the first.
    vc_per_m2: num(row.X) ?? num(row.BQ),
    tissue_on: sheetDate(row.BA),
    tissue_summary: tissueSummary(row),
    agronomist_note: text(row.CC),
    contact_name: text(row.BD),
    contact_phone: text(row.BC),
    counts,
    raw,
  }
}
