// Relative imports only: the hourly watch (netlify/shared/combine-monitor-watch.ts) bundles this file too.
import { writePolygonShapefile, writePolylineShapefile, zipStore, type DbfField } from './geo/shp-write'
import { LINE_TYPE_LABELS, MAY_NOT_IMPORT, exportParts, lineDisplayName, type LineType } from './guidance-lines'
import { MONITOR_NAME_MAX } from './monitor-limits'
import { taskDataXml } from './combine-isoxml'

/**
 * Files for the combine display (a CNH IntelliView IV; Sam's photos, 16 Oct
 * 2026). The display's own .CN1 folder is a closed database and is never
 * written here. What it does read is a `Shapefile` folder at the root of the
 * stick, beside the .CN1 folder, through Data Management → Import2: a
 * boundary goes onto a Field that already exists on the display, picked
 * first, then the boundary file from a list.
 *
 * The display files data Grower → Farm → Field (Sam, 17 Oct 2026). One
 * Grower for the whole farm. Land we own sits under one Farm (a farm-wide
 * setting) and keeps the APP's name as its Field. Rented and crop-share land
 * sits under a Farm named for the landowner (the 'in' land deal), and its
 * Field is the land location from the legal land description. A manager can
 * set either by hand per field; that wins. Every name is cut to the
 * display's 18 characters only when longer — the MONITOR NAME. A file name
 * cannot hold / \ : * ? " < > |, so the boundary's FILE NAME is
 * "<Farm> <Field>" (just the Field when that is over 18) with those turned
 * into "-"; the NAME attribute inside the file keeps the monitor name
 * exactly. Names are given across every active field at once, so a field
 * keeps its name whichever fields are downloaded.
 *
 * Background: reports/CR9090 monitor data integration.md.
 */

/** The display's name limit: one constant in monitor-limits.ts (18 from the IntelliView III guide). */
export { MONITOR_NAME_MAX }

/** The folder the display's Import2 looks for at the root of the stick. */
export const SHAPEFILE_FOLDER = 'Shapefile'

/** The ISOXML folder: the standard place a display looks for TASKDATA.XML, at the top of the stick. */
export const TASKDATA_FOLDER = 'TASKDATA'

export const LOAD_STEPS: string[] = [
  'Back up the stick to a computer first. It holds the season’s yield data.',
  'Copy the Shapefile folder to the stick’s root, next to the .CN1 folder. Don’t rename or touch the .CN1 folder.',
  'Insert the stick, then power up.',
  'Try the TASKDATA folder first: it holds the grower, every farm and field, their boundaries and lines in one ISOXML file. Look in Data Management → Import and Import2 for a Source or Data Type called ISO XML or TASKDATA, and import it if it is there. Then check Data Management → Field. If the display has no such option, carry on with the steps below.',
  'Make sure the Grower on the field-name list exists on the display (Data Management → Grower). Create it if it’s missing.',
  'For each farm on the field-name list: create the Farm under that Grower if it’s missing, then the fields under it, with the names from the list exactly. Rename any field already on the display to match (Data Management → Field → Edit Name).',
  'Go to Data Management → Import2. Set Source to Shapefile and Data Type to Boundary, pick the Grower, Farm and Field, pick the matching Boundary file, then press Import. A file name starts with the farm when it fits in 18 characters, and has - where a name has / or another character a file can’t hold.',
  'For guidance lines: Data Management → Import2. Set Source to Non-IntelliView 2 and Data Type to MultiSwath+, pick the Grower, Farm and Field, pick the line, then press Import.',
  'Check it on the Map tab.',
  'Repeat for each field.',
  'Fields to take off (no longer on a combine crop, or no longer farmed): the app can’t remove them. Delete the field on the display (Data Management → Delete) if you want it gone.',
  'Caution: lines only line up when the Deere machines and the combines use the same correction source or RTK base. Drive one pass and compare before relying on a line.',
]

export const COPY_STEPS: string[] = [
  'Back up both combines’ sticks.',
  'On combine #1, power down fully so it finishes writing to the stick, then take the stick out.',
  'Insert combine #1’s stick in combine #2 before powering it up. At power-up the display automatically merges grower, farm, field, operator, product, tag and boundaries.',
  'On combine #2, go to Data Management → Import. For each of Work Condition (the ACS crop settings), Crop Setup and Current Layout: pick the Data Type, pick Vehicle Name = combine #1, then press Import.',
  'Crop Setup replaces combine #2’s existing crop setup.',
  'Don’t import Crop Calibration unless both combines were calibrated together. Yield calibration belongs to each machine.',
  'Power down combine #2, put combine #2’s own stick back, and return combine #1’s stick to combine #1. Each combine keeps logging to its own stick.',
  'The Interface Level must be Advanced, or the USB port is locked.',
]

/* ── Monitor names ──────────────────────────────────────────────────────── */

const fits = (s: string) => s.length <= MONITOR_NAME_MAX

const WORDS: [RegExp, string][] = [
  [/\bNorth ?east\b/gi, 'NE'],
  [/\bNorth ?west\b/gi, 'NW'],
  [/\bSouth ?east\b/gi, 'SE'],
  [/\bSouth ?west\b/gi, 'SW'],
  [/\bNorth\b/gi, 'N'],
  [/\bSouth\b/gi, 'S'],
  [/\bEast\b/gi, 'E'],
  [/\bWest\b/gi, 'W'],
  [/\bQuarter\b/gi, 'Qtr'],
  [/\bSection\b/gi, 'Sec'],
  [/\bCorner\b/gi, 'Cnr'],
  [/\bPivot\b/gi, 'Pvt'],
  [/\bField\b/gi, 'Fld'],
  [/\bRoad\b/gi, 'Rd'],
  [/\bIrrigated\b/gi, 'Irr'],
]

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Fractions as words (Sam, 17 Oct 2026): 1/2 or ½ → Half, 1/4 or ¼ →
 * Quarter, 3/4 or ¾ → 3 Quarter. Only a fraction standing alone: a "/" used
 * as a separator ("10/Aspen Flat", "7/55 acres") is left as it is.
 */
export function fractionsToWords(s: string): string {
  return tidy(
    s
      .replace(/(?<!\d)3\/4(?!\d)|¾/g, ' 3 Quarter ')
      .replace(/(?<!\d)1\/2(?!\d)|½/g, ' Half ')
      .replace(/(?<!\d)1\/4(?!\d)|¼/g, ' Quarter '),
  )
}

/**
 * Steps tried in order, each only while the name is still too long, from the
 * least lost to the most.
 * "Moreau W 1/2 SE 9-40-26" → "Moreau W Half SE 9-40-26" → "Moreau WHlf 9-11-14".
 */
const STEPS: ((s: string) => string)[] = [
  // The meridian is the same across the farm: 9-40-26-W4 → 9-11-14.
  (s) => s.replace(/\b(\d{1,2}-\d{1,3}-\d{1,2})-?W\d\b/g, '$1'),
  // Spaces around a dash or slash.
  (s) => s.replace(/ ?([-/]) ?/g, '$1'),
  // Brackets and the full stop after an abbreviation: (NE 12-40-27) → NE 12-40-27, Jr. → Jr.
  (s) => s.replace(/[()[\]]/g, ' ').replace(/\.(?= |$)/g, ''),
  // Common words to their usual short forms.
  (s) => WORDS.reduce((t, [re, short]) => t.replace(re, short), s),
  // The quarter between a half and the legal land: W Half SE 9-40-26 → W Half 9-11-14.
  (s) => s.replace(/\b([NSEW]{1,2}) Half (?:NE|NW|SE|SW) (?=\d{1,2}-\d)/g, '$1 Half '),
  (s) => s.replace(/\bHalf\b/g, 'Hlf'),
  // W Hlf → WHlf: a half or quarter of something reads as one token.
  (s) => s.replace(/\b([NSEW]{1,2}) (Hlf|Qtr)\b/g, '$1$2'),
  // A quarter joins its legal land: SE 12-39-25 → SE12-39-25.
  (s) => s.replace(/\b([NSEW]{1,2}) (?=\d{1,2}-\d{1,3}-\d{1,2}\b)/g, '$1'),
]

/** Cut to 18, keeping the last word (a legal land, a number, "Home") whole when it is short. */
function cut(s: string): string {
  if (fits(s)) return s
  const words = s.split(' ')
  const tail = words[words.length - 1]
  if (words.length > 1 && tail.length <= 10) {
    const head = words
      .slice(0, -1)
      .join(' ')
      .slice(0, MONITOR_NAME_MAX - tail.length - 1)
      .replace(/[\s.,/-]+$/, '')
    return head ? `${head} ${tail}` : tail
  }
  return s.slice(0, MONITOR_NAME_MAX).replace(/[\s.,/-]+$/, '')
}

/**
 * The name a field carries on the display: the app's name with fractions as
 * words and spaces tidied, cut down only when it is over 18 characters.
 * Deterministic, so the same field always gets the same name.
 */
export function shortenForMonitor(appName: string): string {
  let s = fractionsToWords(appName)
  if (fits(s)) return s
  for (const step of STEPS) {
    s = tidy(step(s))
    if (fits(s)) return s
  }
  return cut(s)
}

/** Characters no file on the stick may carry (FAT32 and Windows refuse them). */
const FORBIDDEN = /[\\/:*?"<>|]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/**
 * A monitor name as a file name. Normally the same name; only a character a
 * file cannot hold (/ \ : * ? " < > |) becomes -, accents go, and nothing
 * trails a dot or space.
 */
export function fileSafeName(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(FORBIDDEN, '-')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.]+$/, '')
  if (RESERVED.test(s)) s = `${s}_`
  return s || 'Field'
}

/* ── Grower, Farm and Field ─────────────────────────────────────────────── */

/** The farm-wide names (operating_settings 'combine_monitor'). Blank farm = no farm known (no prefix on files). */
export type MonitorSettings = { grower: string; ownedFarm: string }

/** A manager's names for one field (combine_monitor_names); a blank part keeps the automatic one. */
export type MonitorOverride = { farm?: string | null; field?: string | null }

/** What the names are made from, per active field. */
export type NamingField = {
  id: string
  /** The app's field name. */
  name: string
  /** fields.legal_land_description */
  legal?: string | null
  /** The landowner on an active 'in' land deal (rented or crop-share land); none = our own land. */
  landowner?: string | null
  override?: MonitorOverride | null
}

/** Where a field's display name came from. */
export type NameSource = 'owned' | 'legal' | 'name' | 'override'

const COMPANY_WORDS = /[\s,]+(?:farms?|ranch(?:es)?|ltd|limited|inc|incorporated|corp|corporation|co|company|enterprises?|holdings?)\.?$/i
const NAME_SUFFIX = /[\s,]+(?:jr|sr|ii|iii|iv)\.?$/i

/**
 * The Farm a landowner's land goes under: their last name. A company keeps
 * its name without "Farms", "Ltd" and the like; a full name gives its last
 * word. "Pat Example" → Example, "Example Farms Ltd." → Example.
 */
export function landownerFarm(landlord: string): string {
  let s = tidy(landlord.replace(/^the\s+/i, '').replace(/[.,\s]+$/, ''))
  let company = false
  for (let t = s.replace(COMPANY_WORDS, ''); t !== s && t.trim(); t = s.replace(COMPANY_WORDS, '')) {
    s = t.trim()
    company = true
  }
  if (!company) {
    s = s.replace(NAME_SUFFIX, '').trim()
    const words = s.split(' ')
    s = words[words.length - 1]
  }
  return shortenForMonitor(s || landlord)
}

/** A legal land the display way, and whether a quarter was dropped from a half. */
export type LegalForMonitor = { text: string; quarterDropped: boolean }

/**
 * The land location from a legal land description, written the way Sam
 * types it on the display (17 Oct 2026): fractions as words, the meridian
 * dropped, and the quarter dropped when a half is given.
 *   "SW-13-30-14-W4"        → "SW 13-30-14"
 *   "W1/2 SE-9-30-14-W4"    → "W Half 9-1-2"   (quarter dropped)
 *   "N-35-30-14-W4"         → "N Half 35-1-2"  (a bare N/S/E/W is a half)
 *   "Sec-16-1-2w4"        → "Sec 16-1-2"
 *   "2-30-14-W4"            → "2-1-2"
 * Null when it is not one plain section-township-range (two lands, or
 * words it doesn't know), so the caller falls back to the field's name.
 */
export function legalForMonitor(legal: string | null | undefined): LegalForMonitor | null {
  if (!legal?.trim()) return null
  const s = fractionsToWords(legal)
  const m = s.match(/^(.*?)(?:\bLSD[\s-]*(\d{1,2})[\s-]+)?(?<!\d)(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})(?:[\s-]*W\s?\d)?[\s.]*$/i)
  if (!m) return null
  const [, prefix, lsd, sec, twp, rge] = m
  if (/\d/.test(prefix)) return null
  const halves: string[] = []
  const quarters: string[] = []
  let section = false
  const tokens = prefix
    .toUpperCase()
    .split(/[\s,&/+-]+/)
    .filter((t) => t && t !== 'AND' && t !== 'OF' && t !== 'THE')
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (/^[NSEW]$/.test(t)) {
      halves.push(t)
      if (tokens[i + 1] === 'HALF') i++
    } else if (/^[NS][EW]$/.test(t)) quarters.push(t)
    else if (t === 'SEC' || t === 'SECTION') section = true
    else if (t === 'HALF') continue
    else return null
  }
  const str = `${sec}-${twp}-${rge}`
  const lsdPart = lsd ? `LSD ${lsd} ` : ''
  if (halves.length) return { text: `${halves.map((h) => `${h} Half`).join(' ')} ${lsdPart}${str}`, quarterDropped: quarters.length > 0 }
  if (quarters.length) return { text: `${quarters.join(' ')} ${lsdPart}${str}`, quarterDropped: false }
  return { text: `${section && !lsd ? 'Sec ' : lsdPart}${str}`, quarterDropped: false }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The app's name without a leading landowner name ("Example's (NE 1-31-15)" → "NE 1-31-15"); the name itself when nothing is left. */
export function withoutLandowner(appName: string, farm: string): string {
  const s = tidy(appName.replace(new RegExp(`^${escapeRe(farm)}(?:'?s)?(?![a-z])[\\s,:-]*`, 'i'), ''))
  const unbracketed = s.replace(/^\((.*)\)$/, '$1').trim()
  return unbracketed || appName
}

/** The automatic Farm and Field text for one field, before shortening and numbering. */
export function autoPlace(f: NamingField, settings: MonitorSettings): { farm: string; field: string; source: Exclude<NameSource, 'override'>; quarterDropped: boolean } {
  if (f.landowner?.trim()) {
    const farm = landownerFarm(f.landowner)
    const legal = legalForMonitor(f.legal)
    if (legal) return { farm, field: legal.text, source: 'legal', quarterDropped: legal.quarterDropped }
    return { farm, field: withoutLandowner(f.name, farm), source: 'name', quarterDropped: false }
  }
  return { farm: shortenForMonitor(settings.ownedFarm), field: f.name, source: 'owned', quarterDropped: false }
}

export type MonitorName = {
  /** The Grower on the display (the same for every field). */
  grower: string
  /** The Farm on the display. */
  farm: string
  /** The Field: exactly what to type on the display. */
  name: string
  /** The boundary's file name (no extension): "<Farm> <Field>", or the Field when that is over 18. */
  fileName: string
  /** The automatic Farm and Field, as they would be without a manager's names. */
  auto: { farm: string; name: string }
  source: NameSource
  /** A manager set the Farm by hand. */
  farmSet: boolean
  /** Over 18 characters, so cut down. */
  shortened: boolean
  /** 1/2, 1/4 or 3/4 written as a word. */
  fractions: boolean
  /** Two fields under one farm came out the same, so this one got -2, -3… */
  numbered: boolean
  /** "W Half SE 9-…" written "W Half 9-…": the quarter is gone. */
  quarterDropped: boolean
  /** "<Farm> <Field>" is over 18, so the file is named for the Field alone. */
  fileWithoutFarm: boolean
}

/** What the name list says about a monitor name that is not the app's name as it stands. */
export function nameNote(n: MonitorName): string {
  const bits: string[] = []
  if (n.source === 'override' || n.farmSet) bits.push('Set by hand')
  if (n.source === 'legal') bits.push('From the legal land')
  if (n.quarterDropped) bits.push('Quarter dropped')
  if (n.fractions) bits.push('Fraction as a word')
  if (n.shortened) bits.push('Shortened')
  if (n.numbered) bits.push('Numbered to stay unique')
  if (n.fileWithoutFarm) bits.push('File without the farm (too long)')
  return bits.join(', ')
}

/** The app's field order (queries.ts compareFieldNames): 1, 2 … 10 before names. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareNames = (a: string, b: string) => collator.compare(a, b)

/** A name with -2, -3… on the end, still within 18. */
const numbered = (base: string, n: number) => `${base.slice(0, MONITOR_NAME_MAX - String(n).length - 1).trimEnd()}-${n}`

/** No farm-wide names: no Grower and no Farm for own land (files are named for the Field alone). */
export const NO_SETTINGS: MonitorSettings = { grower: '', ownedFarm: '' }

/** "<Farm> <Field>" when it fits in 18, else the Field alone. */
export const withFarm = (farm: string, name: string) => (farm && fits(`${farm} ${name}`) ? `${farm} ${name}` : name)

/**
 * Every field's Grower, Farm, Field and file name. Fields are unique within
 * their Farm and files across the stick, each ignoring case (the display's
 * lists and the stick's file system both ignore it); two spellings of one
 * farm become the first one's. Given in field-name order, so the first of two
 * fields that come out alike keeps the plain name. A manager's Farm or Field
 * wins over the automatic one.
 */
export function assignMonitorNames(
  fields: NamingField[],
  settings: MonitorSettings = NO_SETTINGS,
  compare: (a: string, b: string) => number = compareNames,
): Map<string, MonitorName> {
  const out = new Map<string, MonitorName>()
  const grower = settings.grower.trim() ? shortenForMonitor(settings.grower) : ''
  const farmSpelling = new Map<string, string>()
  const namesByFarm = new Map<string, Set<string>>()
  const files = new Set<string>()
  for (const f of [...fields].sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id))) {
    const auto = autoPlace(f, settings)
    const setFarm = f.override?.farm?.trim()
    const setField = f.override?.field?.trim()
    const autoFarm = auto.farm ? shortenForMonitor(auto.farm) : ''
    const farmText = setFarm ? shortenForMonitor(setFarm) : autoFarm
    const farmKey = farmText.toLowerCase()
    if (!farmSpelling.has(farmKey)) farmSpelling.set(farmKey, farmText)
    const farm = farmSpelling.get(farmKey)!
    const source: NameSource = setField ? 'override' : auto.source
    const text = setField || auto.field
    const words = fractionsToWords(text)
    const base = shortenForMonitor(text)
    const taken = namesByFarm.get(farmKey) ?? new Set<string>()
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = numbered(base, n)
    taken.add(name.toLowerCase())
    namesByFarm.set(farmKey, taken)
    const fileText = withFarm(farm, name)
    let fileName = fileSafeName(fileText)
    const fileBase = fileName
    for (let n = 2; files.has(fileName.toLowerCase()); n++) fileName = numbered(fileBase, n)
    files.add(fileName.toLowerCase())
    out.set(f.id, {
      grower,
      farm,
      name,
      fileName,
      auto: { farm: autoFarm, name: shortenForMonitor(auto.field) },
      source,
      farmSet: Boolean(setFarm),
      shortened: base !== words,
      fractions: words !== tidy(text),
      numbered: name !== base,
      quarterDropped: source === 'legal' && auto.quarterDropped,
      fileWithoutFarm: Boolean(farm) && fileText === name,
    })
  }
  return out
}

/** A Deere guidance line meant for the combines, as it goes on the stick. */
export type MonitorLine = {
  /** jd_guidance_lines.id */
  id: string
  /** Its name in Operations Center. */
  lineName: string
  /** "<field's monitor name> <line name without Combine>", at most 18: the NAME attribute. */
  name: string
  fileName: string
  lineType: LineType
  headingDeg: number | null
  hash: string
}

export type StoredLine = { id: string; field_id: string; name: string; line_type: LineType; heading_deg: number | null; data_hash: string }

/**
 * Names for the combine lines, unique against every field's monitor name and
 * file and each other (fields in name order, a field's lines by name). The
 * file starts with the field's farm when that fits in 18.
 */
export function assignLineNames(names: Map<string, MonitorName>, lines: StoredLine[], compare: (a: string, b: string) => number = compareNames): Map<string, MonitorLine[]> {
  const taken = new Set([...names.values()].map((n) => n.name.toLowerCase()))
  const files = new Set([...names.values()].map((n) => n.fileName.toLowerCase()))
  const out = new Map<string, MonitorLine[]>()
  const sorted = [...lines]
    .filter((l) => names.has(l.field_id))
    .sort((a, b) => compare(names.get(a.field_id)!.name, names.get(b.field_id)!.name) || compare(a.name, b.name) || a.id.localeCompare(b.id))
  for (const l of sorted) {
    const field = names.get(l.field_id)!
    const base = lineDisplayName(field.name, l.name)
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = numbered(base, n)
    // Like a boundary: the farm first when it fits.
    let fileName = fileSafeName(withFarm(field.farm, name))
    const fileBase = fileName
    for (let n = 2; files.has(fileName.toLowerCase()); n++) fileName = numbered(fileBase, n)
    taken.add(name.toLowerCase())
    files.add(fileName.toLowerCase())
    out.set(l.field_id, [...(out.get(l.field_id) ?? []), { id: l.id, lineName: l.name, name, fileName, lineType: l.line_type, headingDeg: l.heading_deg, hash: l.data_hash }])
  }
  return out
}

/** "AB", or "Circle — may not import". */
export const lineTypeNote = (t: LineType) => `${LINE_TYPE_LABELS[t]}${MAY_NOT_IMPORT.includes(t) ? ' — may not import' : ''}`

/* ── Which fields ───────────────────────────────────────────────────────── */

/**
 * Is a field on the combines this crop year? (Sam, 17 Oct 2026.)
 *
 *   on        its planned crop, or the crop of any of its crop areas that
 *             year (a split field), is harvested with the combines
 *             (crops.on_combines, a switch per crop on the Crops page and
 *             the Monitor files tab);
 *   off       it is planned, and none of its crops are;
 *   unplanned nothing is planned on it that year yet.
 *
 * "Unplanned" is neither put on nor taken off a combine: on 1 January every
 * field is unplanned for the new year until the plan is made, and calling
 * them all "take off" would be a false alarm.
 */
export type CombineStatus = 'on' | 'off' | 'unplanned'

export function combineStatusByField(
  plans: { field_id: string; crop_id: string | null }[],
  zones: { field_id: string; crop_id: string | null }[],
  crops: { id: string; on_combines?: boolean | null }[],
): Map<string, CombineStatus> {
  const on = new Map(crops.map((c) => [c.id, c.on_combines !== false]))
  const out = new Map<string, CombineStatus>()
  for (const r of [...plans, ...zones]) {
    if (!r.crop_id) continue
    const now = on.get(r.crop_id) ?? true
    if (now) out.set(r.field_id, 'on')
    else if (!out.has(r.field_id)) out.set(r.field_id, 'off')
  }
  return out
}

/** A field's status, unplanned when it has no crop that year. */
export const statusOf = (m: Map<string, CombineStatus>, fieldId: string): CombineStatus => m.get(fieldId) ?? 'unplanned'

/* ── Geometry and the ZIP ───────────────────────────────────────────────── */

/** A boundary's GeoJSON (Polygon or MultiPolygon) as polygon coordinates; anything else gives none. */
export function polygonsOf(geometry: unknown): number[][][][] {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (!g || !Array.isArray(g.coordinates)) return []
  if (g.type === 'Polygon') return [g.coordinates as number[][][]]
  if (g.type === 'MultiPolygon') return g.coordinates as number[][][][]
  return []
}

export type BoundaryItem = {
  /** The field's name on the display: the NAME attribute. */
  monitorName: string
  /** Its Farm and Grower on the display: the FARM and GROWER attributes. Blank when not known. */
  farm?: string
  grower?: string
  /** The file's base name. */
  fileName: string
  appName: string
  acres: number | null
  geometry: unknown
  /** The field's combine guidance lines, with their stored GeoJSON. */
  lines?: (MonitorLine & { geometry: unknown })[]
}

/** NAME is sized in bytes for UTF-8: up to three bytes a character of a monitor name. */
const NAME_BYTES = Math.min(MONITOR_NAME_MAX * 3, 254)
export const BOUNDARY_FIELDS: DbfField[] = [
  { name: 'NAME', type: 'C', length: NAME_BYTES },
  { name: 'FARM', type: 'C', length: NAME_BYTES },
  { name: 'GROWER', type: 'C', length: NAME_BYTES },
  { name: 'AREA_AC', type: 'N', length: 12, decimals: 2 },
]

/** A guidance line's attributes: its name on the display, its field's, farm and grower, and AB / A+ / Curve / Circle / Adaptive. */
export const LINE_FIELDS: DbfField[] = [
  { name: 'NAME', type: 'C', length: NAME_BYTES },
  { name: 'FIELD', type: 'C', length: NAME_BYTES },
  { name: 'FARM', type: 'C', length: NAME_BYTES },
  { name: 'GROWER', type: 'C', length: NAME_BYTES },
  { name: 'TYPE', type: 'C', length: 10 },
]

/** A line's parts as written: AB as A→B, A+ across the field's boundary, the rest as drawn. */
export const lineParts = (line: MonitorLine & { geometry: unknown }, boundaryGeometry: unknown) =>
  exportParts({ lineType: line.lineType, headingDeg: line.headingDeg, geometry: line.geometry }, polygonsOf(boundaryGeometry))

const lines = (title: string, steps: string[]) => [title, ...steps.map((s, i) => `${i + 1}. ${s}`)]

/** The README at the root of the ZIP: both sets of steps, then what is in it. CRLF, for Notepad. */
export function readmeText(opts: { items: BoundaryItem[]; cropYear: number; madeOn: string; appName?: string }): string {
  const width = Math.max(...opts.items.map((i) => i.fileName.length), 4)
  const grower = opts.items.find((i) => i.grower)?.grower ?? ''
  const byFarm = new Map<string, BoundaryItem[]>()
  for (const i of opts.items) byFarm.set(i.farm ?? '', [...(byFarm.get(i.farm ?? '') ?? []), i])
  const out = [
    'Field boundaries for the combine display (IntelliView, Import2)',
    `Made${opts.appName ? ` by ${opts.appName}` : ''} on ${opts.madeOn}, crop year ${opts.cropYear}.`,
    `One boundary per field in the ${SHAPEFILE_FOLDER} folder, named "<Farm> <Field>" as on the display (the Field alone when that is over ${MONITOR_NAME_MAX} characters).`,
    ...(grower ? [`Grower on the display: ${grower}`] : []),
    '',
    ...lines('HOW TO LOAD BOUNDARIES INTO THE COMBINE', LOAD_STEPS),
    '',
    ...lines('HOW TO COPY SETUP FROM ONE COMBINE TO THE OTHER', COPY_STEPS),
    '',
    'FILES IN THIS ZIP, by farm: file name, then the field name on the display, then the field in the app',
    ...[...byFarm.entries()].flatMap(([farm, items]) => [
      `FARM ${farm || '(none)'}`,
      ...items.map(
        (i) => `  ${i.fileName.padEnd(width)}  ${i.monitorName}${i.monitorName !== i.appName ? `  (app: ${i.appName})` : ''}${i.acres != null ? `  ${i.acres.toFixed(1)} ac` : ''}`,
      ),
    ]),
    '',
  ]
  const lineRows = opts.items.flatMap((i) => (i.lines ?? []).filter((l) => lineParts(l, i.geometry).length).map((l) => ({ l, field: i.farm ? `${i.farm} / ${i.monitorName}` : i.monitorName })))
  if (lineRows.length) {
    const w = Math.max(...lineRows.map(({ l }) => l.fileName.length), 4)
    out.push(
      'GUIDANCE LINES (Import2, Source Non-IntelliView 2, Data Type MultiSwath+): file name, farm / field on the display, type, the line in Operations Center',
      ...lineRows.map(({ l, field }) => `${l.fileName.padEnd(w)}  ${field}  ${lineTypeNote(l.lineType)}  (${l.lineName})`),
      '',
    )
  }
  return out.join('\r\n')
}

/**
 * The download: `Shapefile/<file name>.shp|.shx|.dbf|.prj|.cpg` for each
 * field (WGS 84, UTF-8 attributes NAME, FARM, GROWER and AREA_AC), and README.txt beside the
 * folder. Fields without polygons are left out; the caller says which.
 */
export function boundaryZip(items: BoundaryItem[], opts: { cropYear: number; madeOn: string; appName?: string }): Uint8Array {
  return zipStore(boundaryFiles(items, opts))
}

/** The ZIP's files, path and bytes: a folder ends in "/" with no bytes. Written straight onto the stick by lib/save-to-folder.ts. */
export function boundaryFiles(items: BoundaryItem[], opts: { cropYear: number; madeOn: string; appName?: string }): { name: string; data: Uint8Array }[] {
  const kept = items.filter((i) => polygonsOf(i.geometry).length > 0)
  const files: { name: string; data: Uint8Array }[] = [{ name: `${SHAPEFILE_FOLDER}/`, data: new Uint8Array(0) }]
  for (const item of kept) {
    const f = writePolygonShapefile(
      [{ polygons: polygonsOf(item.geometry), props: { NAME: item.monitorName, FARM: item.farm ?? '', GROWER: item.grower ?? '', AREA_AC: item.acres } }],
      BOUNDARY_FIELDS,
    )
    const base = `${SHAPEFILE_FOLDER}/${item.fileName}`
    files.push(
      { name: `${base}.shp`, data: f.shp },
      { name: `${base}.shx`, data: f.shx },
      { name: `${base}.dbf`, data: f.dbf },
      { name: `${base}.prj`, data: f.prj },
      { name: `${base}.cpg`, data: f.cpg },
    )
    for (const line of item.lines ?? []) {
      const parts = lineParts(line, item.geometry)
      if (!parts.length) continue
      const l = writePolylineShapefile([{ lines: parts, props: { NAME: line.name, FIELD: item.monitorName, FARM: item.farm ?? '', GROWER: item.grower ?? '', TYPE: LINE_TYPE_LABELS[line.lineType] } }], LINE_FIELDS)
      const lb = `${SHAPEFILE_FOLDER}/${line.fileName}`
      files.push(
        { name: `${lb}.shp`, data: l.shp },
        { name: `${lb}.shx`, data: l.shx },
        { name: `${lb}.dbf`, data: l.dbf },
        { name: `${lb}.prj`, data: l.prj },
        { name: `${lb}.cpg`, data: l.cpg },
      )
    }
  }
  // The same fields as ISOXML, so the display can make the grower, farms and fields itself (lib/combine-isoxml.ts).
  const iso = kept.map((item) => ({
    ...item,
    lines: (item.lines ?? []).map((l) => ({ name: l.name, parts: lineParts(l, item.geometry), curve: l.lineType === 'curve' })),
  }))
  files.push({ name: `${TASKDATA_FOLDER}/`, data: new Uint8Array(0) })
  files.push({ name: `${TASKDATA_FOLDER}/TASKDATA.XML`, data: new TextEncoder().encode(taskDataXml(iso, { appName: opts.appName })) })
  files.push({ name: 'README.txt', data: new TextEncoder().encode(readmeText({ ...opts, items: kept })) })
  return files
}

/* ── What each combine has, and what has changed since ─────────────────── */

/**
 * One field as it was loaded on a combine (combine_monitor_loads.fields), or
 * as it stands in the app now. The boundary is known by its row id, with its
 * start date and acres beside it so an edit in place is caught as well as a
 * new version.
 */
export type SnapshotField = {
  field_id: string
  app_name: string
  monitor_name: string
  /** Its Farm and Grower on the display. Left out by loads made before farms were. */
  monitor_farm?: string
  grower?: string
  file_name: string
  boundary_id: string | null
  valid_from: string | null
  acres: number | null
  /** Its combine guidance lines (jd_guidance_lines id and data hash). Left out by loads made before lines were. */
  lines?: { id: string; hash: string; name: string }[]
  /** Now, not as loaded: is the field on the combines this crop year? Left out = on. */
  status?: CombineStatus
}

/**
 * add       on a combine crop this year, with a boundary, and not on the combine
 * boundary / name / lines   on the combine, and that changed in the app (name: its Field, Farm or Grower)
 * take_off  on the combine, but this year's crop is not harvested with the
 *           combines or the field is no longer active. Advice only: the
 *           display is only changed by someone in the cab.
 */
export type ChangeKind = 'add' | 'boundary' | 'name' | 'lines' | 'take_off'

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  add: 'To add',
  boundary: 'Boundary changed',
  name: 'Renamed (farm or field)',
  lines: 'Guidance lines changed',
  take_off: 'To take off',
}

/** The same lines with the same data, ignoring order. */
const lineKey = (lines: SnapshotField['lines']) =>
  (lines ?? [])
    .map((l) => `${l.id}:${l.hash}:${l.name}`)
    .sort()
    .join('|')

export type FieldChange = {
  fieldId: string
  /** The app's name now, or as loaded for a field no longer active. */
  appName: string
  monitorName: string
  /** Its Farm on the display now, when known. */
  monitorFarm?: string
  /** The monitor name the combine has, when it changed. */
  wasName?: string
  /** The Farm the combine has it under, when that changed. */
  wasFarm?: string
  kinds: ChangeKind[]
}

/** Both known and not the same (a load made before farms has neither, and is not flagged for it). */
const changed = (now: string | undefined, was: string | undefined) => now != null && was != null && now !== was

const sameAcres = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.05)

/**
 * What a combine is missing, against the app's active fields now (their
 * status for the crop year): fields on a combine crop with a boundary it has
 * never had, boundaries replaced or edited, names that changed with the
 * app's name, combine guidance lines added, changed or removed; and fields it
 * has that are now off the combines or no longer active. A field with no
 * boundary has nothing to load, so it is not "to add"; an unplanned field is
 * neither added nor taken off.
 */
export function diffSnapshot(loaded: SnapshotField[], current: SnapshotField[]): FieldChange[] {
  const had = new Map(loaded.map((f) => [f.field_id, f]))
  const now = new Set(current.map((f) => f.field_id))
  const out: FieldChange[] = []
  for (const f of current) {
    const was = had.get(f.field_id)
    const status = f.status ?? 'on'
    const kinds: ChangeKind[] = []
    if (!was) {
      if (f.boundary_id && status === 'on') kinds.push('add')
    } else if (status === 'off') {
      kinds.push('take_off')
    } else {
      if (f.boundary_id && (f.boundary_id !== was.boundary_id || f.valid_from !== was.valid_from || !sameAcres(f.acres, was.acres))) kinds.push('boundary')
      // A new Farm or Grower is a rename on the display too.
      if (f.monitor_name !== was.monitor_name || changed(f.monitor_farm, was.monitor_farm) || changed(f.grower, was.grower)) kinds.push('name')
      if (f.boundary_id && lineKey(f.lines) !== lineKey(was.lines)) kinds.push('lines')
    }
    if (kinds.length) {
      const renamed = kinds.includes('name')
      out.push({
        fieldId: f.field_id,
        appName: f.app_name,
        monitorName: f.monitor_name,
        monitorFarm: f.monitor_farm,
        wasName: renamed ? was?.monitor_name : undefined,
        wasFarm: renamed && changed(f.monitor_farm, was?.monitor_farm) ? was?.monitor_farm : undefined,
        kinds,
      })
    }
  }
  for (const f of loaded) if (!now.has(f.field_id)) out.push({ fieldId: f.field_id, appName: f.app_name, monitorName: f.monitor_name, monitorFarm: f.monitor_farm, kinds: ['take_off'] })
  return out.sort((a, b) => compareNames(a.appName, b.appName))
}

/** Changes a download can fix: everything but a field to take off (that is deleted on the display, if at all). */
export const loadableChanges = (changes: FieldChange[]) => changes.filter((c) => !c.kinds.includes('take_off'))

/**
 * The combine's new snapshot after a load: the fields just loaded as they
 * were downloaded, the rest as it had them. Only fields still to be on the
 * combines are kept (`keep`: active and not off this year), so a field off
 * the combines is not recorded even if it was in the download, and one
 * taken off is assumed tidied off the display at this load.
 */
export function mergeSnapshot(previous: SnapshotField[], loaded: SnapshotField[], keep: Set<string>): SnapshotField[] {
  const by = new Map(previous.filter((f) => keep.has(f.field_id)).map((f) => [f.field_id, f]))
  for (const f of loaded) if (keep.has(f.field_id)) by.set(f.field_id, { ...f, status: undefined })
  return [...by.values()].sort((a, b) => compareNames(a.app_name, b.app_name))
}

/** The fields a load may record: active, and on the combines or not planned yet. */
export const keepIds = (current: SnapshotField[]) => new Set(current.filter((f) => f.status !== 'off').map((f) => f.field_id))

/** "3 fields to update", "1 field to update". */
export const changeCount = (n: number) => `${n} field${n === 1 ? '' : 's'} to update`

/** "2 to add, 1 to update, 1 to take off" — what the badge, notice and checklist say. */
export function changeSummary(changes: FieldChange[]): string {
  const add = changes.filter((c) => c.kinds.includes('add')).length
  const off = changes.filter((c) => c.kinds.includes('take_off')).length
  const update = changes.length - add - off
  const bits = [add && `${add} to add`, update && `${update} to update`, off && `${off} to take off`].filter(Boolean)
  return bits.length ? `${bits.join(', ')}` : 'Up to date'
}

/** A short list for a notification or the checklist: "Field 3, North 40 and 2 more". */
export function changeList(changes: FieldChange[], max = 4): string {
  const names = changes.map((c) => c.appName)
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** The display in a combine's cab (jd_equipment.monitor). Every key optional. */
export type MonitorInfo = {
  display?: string
  software?: string
  framework?: string
  precision_farming?: string
  yield_monitor?: string
  combine_controller?: string
  vehicle_name?: string
  interface_level?: string
  checked_on?: string
  notes?: string
}

export const MONITOR_INFO_KEYS = ['display', 'software', 'framework', 'precision_farming', 'yield_monitor', 'combine_controller', 'vehicle_name', 'interface_level', 'checked_on', 'notes'] as const

/** The stored object, with only its text keys kept and blanks dropped. */
export function monitorInfoOf(json: unknown): MonitorInfo {
  const out: MonitorInfo = {}
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  for (const k of MONITOR_INFO_KEYS) {
    const v = (json as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

/** "IntelliView IV · V30.26", or null when neither is recorded. */
export function monitorHeadline(m: MonitorInfo): string | null {
  const s = [m.display, m.software].filter(Boolean).join(' · ')
  return s || null
}

export type EquipmentLite = { name: string | null; category: string | null; make: string | null; model: string | null; equipment_type: string | null; archived: boolean }

/** A combine in the fleet: a machine whose type says combine, or a CR/CX-series New Holland, or the like by name. */
export function isCombine(e: EquipmentLite): boolean {
  if (e.archived) return false
  if (/combine/i.test(e.equipment_type ?? '')) return true
  if (e.category && e.category !== 'machine') return false
  return /^C[RX][- ]?\d{3,4}/i.test((e.model ?? '').trim()) || /\bC[RX] ?\d{4}\b/i.test(e.name ?? '') || /combine/i.test(e.name ?? '')
}
