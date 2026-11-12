/**
 * The eShepherd animal sheet, read and written back.
 *
 * eShepherd's Animals panel has no export. The only file it hands out is the
 * "Bulk Create - Download File" spreadsheet (Animals → + → Bulk Create), and
 * it comes back carrying every animal it knows. That file is what this reads,
 * and what it writes, so a sheet can be uploaded here, edited, and sent
 * straight back to eShepherd without anything in between retyping it.
 *
 * Two things about the file that would quietly corrupt a herd:
 *
 * **Dates are day-first.** "01-05-2025" is 1 May 2025, not 5 January. Every
 * date of birth in Sam's 679 rows is the first of a month, in months 1, 4
 * and 5 — a May calving, which is what happens here. Read as month-first it
 * would put all 328 dated animals in January. eShepherd is Australian and
 * writes d-m-Y throughout.
 *
 * **The template's dropdowns are out of date.** The workbook's own data
 * validation still offers the old pregnancy words (Empty, Dry, Joined,
 * Pregnant, Wet/Lactating, Wet Joined), while the data in it already uses
 * eShepherd's current ones — 114 rows say "In Calf", which the dropdown does
 * not contain. So a value is never rewritten to fit the list: it is written
 * back exactly as it came, and anything outside BOTH vocabularies is shown as
 * a problem for a person to settle.
 */

/** The fourteen columns, in the order eShepherd writes them. */
export const SHEET_HEADERS = [
  'Action',
  'Animal ID',
  'Neckband',
  'EID*',
  'VID*',
  'Breed',
  'Stock Class',
  'Date of Birth',
  'Tattoo or Brand',
  'Weight (kg)',
  'Weighed date',
  'Expected Weight Gain (kg)',
  'Pregnancy Status',
  'Note',
] as const

/** The banner eShepherd puts above the header row. Written back as it came. */
export const SHEET_BANNER =
  'Spreadsheet Instructions\n' +
  '1. Select an "Action" to tell the spreadsheet what to do for that Neckband/Animal (rows with "NO ACTION" will do nothing)\n' +
  '2. Refine the information in each row and ensure EID or VID is provided\n' +
  '3. Save your changes and upload to eShepherd'

export const SHEET_ACTIONS = ['NO ACTION', 'EDIT', 'CREATE', 'DELETE'] as const
export type SheetAction = (typeof SHEET_ACTIONS)[number]

/** The Stock Class dropdown, exactly as the workbook spells it. */
export const STOCK_CLASSES = ['-', 'Bulls', 'Steers', 'Cows', 'Heifers'] as const

/**
 * Pregnancy words eShepherd uses now (its help centre, Nov 2025), and the ones
 * its older template still lists. Both are accepted; neither is rewritten.
 */
export const PREGNANCY_STATUSES = ['Not Joined', 'Joined', 'Empty', 'In Calf', 'Calf at Foot'] as const
export const LEGACY_PREGNANCY_STATUSES = ['Dry', 'Pregnant', 'Wet/Lactating', 'Wet Joined'] as const

/** One row of the sheet, by header name, exactly as read. */
export type SheetRow = Record<string, string>

/** A row turned into the fields the app keeps. */
export type ParsedAnimal = {
  action: string
  eshepherd_animal_id: string | null
  eid: string | null
  vid: string | null
  neckband: string | null
  breed: string | null
  stock_class: string | null
  birth_date: string | null
  brand: string | null
  weight_kg: number | null
  weighed_on: string | null
  expected_gain_kg: number | null
  pregnancy_status: string | null
  eshepherd_note: string | null
  /** What makes this row an animal: EID, else neckband, else id+VID. */
  key: string | null
  /** Anything eShepherd would reject, or that could not be read. */
  problems: string[]
}

const clean = (v: unknown): string => {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if (o.text != null) return clean(o.text)
    if (o.result != null) return clean(o.result)
    return ''
  }
  return String(v).trim()
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Where the header row is.
 *
 * Row 1 is a merged instruction banner repeated across all fourteen columns,
 * so the headers are on row 2 — but a sheet somebody has edited may have
 * moved, so it is found rather than assumed. A row counts as the header when
 * it holds Action and either EID or VID.
 */
export function findHeaderRow(grid: unknown[][]): number {
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const cells = (grid[i] ?? []).map((c) => norm(clean(c)))
    const hasAction = cells.includes('action')
    const hasId = cells.some((c) => c === 'eid' || c === 'vid' || c === 'animalid')
    if (hasAction && hasId) return i
  }
  return -1
}

/** Our column name for a header as found, so a renamed column still lands. */
export function matchHeader(header: string): string | null {
  const n = norm(header)
  const hit = SHEET_HEADERS.find((h) => norm(h) === n)
  if (hit) return hit
  // The stars on EID*/VID* are eShepherd's "one of these is required" mark and
  // have been dropped from the odd export.
  if (n === 'eid') return 'EID*'
  if (n === 'vid') return 'VID*'
  if (n === 'weightkg' || n === 'weight') return 'Weight (kg)'
  if (n === 'weigheddate' || n === 'weighdate') return 'Weighed date'
  if (n === 'expectedweightgainkg' || n === 'expectedweightgain') return 'Expected Weight Gain (kg)'
  if (n === 'dateofbirth' || n === 'dob') return 'Date of Birth'
  if (n === 'tattooorbrand' || n === 'tattoo' || n === 'brand') return 'Tattoo or Brand'
  if (n === 'stockclass') return 'Stock Class'
  if (n === 'pregnancystatus' || n === 'pregnancy') return 'Pregnancy Status'
  if (n === 'animalid') return 'Animal ID'
  return null
}

export type ParsedSheet = {
  headerRow: number
  /** The headers as found, in the file's own order. */
  headers: string[]
  /** Every data row with anything in it, keyed by our column names. */
  rows: SheetRow[]
  /** Columns in the file we did not recognise; their values are still kept. */
  unknownHeaders: string[]
  /** Columns we expected and did not find. */
  missingHeaders: string[]
}

/** Read a grid of cells into rows keyed by column name. */
export function parseSheet(grid: unknown[][]): ParsedSheet {
  const headerRow = findHeaderRow(grid)
  if (headerRow < 0) {
    return { headerRow: -1, headers: [], rows: [], unknownHeaders: [], missingHeaders: [...SHEET_HEADERS] }
  }
  const raw = (grid[headerRow] ?? []).map((c) => clean(c))
  const mapped = raw.map((h) => matchHeader(h))
  const unknownHeaders = raw.filter((h, i) => h !== '' && mapped[i] === null)
  const found = new Set(mapped.filter(Boolean) as string[])
  const missingHeaders = SHEET_HEADERS.filter((h) => !found.has(h))

  const rows: SheetRow[] = []
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row: SheetRow = {}
    let any = false
    for (let c = 0; c < raw.length; c++) {
      const name = mapped[c] ?? raw[c]
      if (!name) continue
      const v = clean((grid[r] ?? [])[c])
      row[name] = v
      // The Action column is pre-filled on every template row, so a sheet of
      // 10,000 "NO ACTION" rows would otherwise read as 10,000 animals.
      if (v && name !== 'Action') any = true
    }
    if (any) rows.push(row)
  }
  return { headerRow, headers: raw, rows, unknownHeaders, missingHeaders }
}

/**
 * A date as eShepherd writes it: d-m-Y, day first.
 *
 * ISO and a real date cell are accepted too, because a sheet that has been
 * through Excel on another machine can come back either way. A two-part or
 * unreadable value returns null and is reported rather than guessed at.
 */
export function parseSheetDate(value: string | null | undefined): string | null {
  const s = (value ?? '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    if (day < 1 || day > 31 || month < 1 || month > 12) return null
    return `${dmy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

/** Back to eShepherd's d-m-Y, which is what its upload expects. */
export function formatSheetDate(iso: string | null | undefined): string {
  const s = (iso ?? '').slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${m[3]}-${m[2]}-${m[1]}`
}

const num = (v: string | null | undefined): number | null => {
  const s = (v ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const orNull = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  // eShepherd writes a bare dash for "not set" in Stock Class and Brand.
  return s === '' || s === '-' ? null : s
}

/**
 * One row as an animal, with everything that would not go back into
 * eShepherd listed rather than silently fixed.
 */
export function toAnimal(row: SheetRow): ParsedAnimal {
  const problems: string[] = []
  const eid = orNull(row['EID*'])
  const vid = orNull(row['VID*'])
  const neckband = orNull(row['Neckband'])
  const animalId = orNull(row['Animal ID'])

  const dob = row['Date of Birth']
  const birth_date = parseSheetDate(dob)
  if (dob && dob.trim() && !birth_date) problems.push(`date of birth “${dob}” could not be read`)

  const weighed = row['Weighed date']
  const weighed_on = parseSheetDate(weighed)
  if (weighed && weighed.trim() && !weighed_on) problems.push(`weighed date “${weighed}” could not be read`)

  const weight_kg = num(row['Weight (kg)'])
  if (weight_kg != null && (weight_kg < 0 || weight_kg > 9999)) problems.push('weight is outside 0–9999 kg')

  const stock_class = orNull(row['Stock Class'])
  if (stock_class && !STOCK_CLASSES.includes(stock_class as (typeof STOCK_CLASSES)[number])) {
    problems.push(`stock class “${stock_class}” is not one eShepherd offers`)
  }

  const pregnancy_status = orNull(row['Pregnancy Status'])
  if (
    pregnancy_status &&
    !PREGNANCY_STATUSES.includes(pregnancy_status as (typeof PREGNANCY_STATUSES)[number]) &&
    !LEGACY_PREGNANCY_STATUSES.includes(pregnancy_status as (typeof LEGACY_PREGNANCY_STATUSES)[number])
  ) {
    problems.push(`pregnancy status “${pregnancy_status}” is not one eShepherd offers`)
  }

  // eShepherd's own rule, printed at the top of the sheet: a row needs an EID
  // or a VID. Without either, and without a collar, nothing identifies it.
  const key = eid ?? (neckband ? `nb:${neckband}` : animalId && vid ? `id:${animalId}|${vid}` : null)
  if (!key) problems.push('no EID, neckband or Animal ID + VID, so there is nothing to match it on')

  return {
    action: (row['Action'] ?? '').trim() || 'NO ACTION',
    eshepherd_animal_id: animalId,
    eid,
    vid,
    neckband,
    breed: orNull(row['Breed']),
    stock_class,
    birth_date,
    brand: orNull(row['Tattoo or Brand']),
    weight_kg,
    weighed_on,
    expected_gain_kg: num(row['Expected Weight Gain (kg)']),
    pregnancy_status,
    eshepherd_note: orNull(row['Note']),
    key,
    problems,
  }
}

/** Stock Class → the app's own sex, where the two plainly agree. */
export function sexFromStockClass(stockClass: string | null | undefined): 'bull' | 'cow' | 'steer' | 'heifer' | null {
  switch ((stockClass ?? '').trim().toLowerCase()) {
    case 'bulls':
    case 'bull':
      return 'bull'
    case 'cows':
    case 'cow':
      return 'cow'
    case 'steers':
    case 'steer':
      return 'steer'
    case 'heifers':
    case 'heifer':
    case 'replacement heifer':
      return 'heifer'
    default:
      return null
  }
}

/**
 * The ranch a brand belongs to, from the mapping somebody has confirmed.
 *
 * Returns null for a brand nobody has placed yet, and the animal is then left
 * without a ranch. Guessing one would put an animal on the wrong ranch's
 * paperwork, which is harder to notice than a blank.
 */
export function ranchForBrand(brand: string | null | undefined, map: Map<string, string | null>): string | null {
  const b = (brand ?? '').trim().toUpperCase()
  if (!b || b === '-') return null
  return map.get(b) ?? null
}

/** What an upload would do, worked out before anything is written. */
export type ImportPlan = {
  creates: ParsedAnimal[]
  updates: { animal: ParsedAnimal; id: string }[]
  /** Rows that cannot be matched or placed, with why. */
  skips: { animal: ParsedAnimal; why: string }[]
  /** Every row's problems, flattened, for the summary. */
  problemCount: number
}

export type ExistingAnimal = {
  id: string
  eid: string | null
  neckband: string | null
  eshepherd_animal_id: string | null
  vid: string | null
}

/** The same key an uploaded row gets, for an animal already here. */
export function existingKey(a: ExistingAnimal): string | null {
  if (a.eid) return a.eid
  if (a.neckband) return `nb:${a.neckband}`
  if (a.eshepherd_animal_id && a.vid) return `id:${a.eshepherd_animal_id}|${a.vid}`
  return null
}

/**
 * Match an uploaded sheet against what is already here.
 *
 * On EID first, because it is the only column in the file that is genuinely
 * unique — the Animal ID repeats 99 times in Sam's own sheet, since a
 * re-tagged animal keeps its number.
 */
export function planImport(rows: ParsedAnimal[], existing: ExistingAnimal[]): ImportPlan {
  const byKey = new Map<string, string>()
  for (const e of existing) {
    const k = existingKey(e)
    if (k) byKey.set(k, e.id)
  }
  const plan: ImportPlan = { creates: [], updates: [], skips: [], problemCount: 0 }
  const seen = new Set<string>()
  for (const a of rows) {
    plan.problemCount += a.problems.length
    if (!a.key) {
      plan.skips.push({ animal: a, why: 'nothing to identify it by' })
      continue
    }
    if (seen.has(a.key)) {
      plan.skips.push({ animal: a, why: 'the same animal appears earlier in the sheet' })
      continue
    }
    seen.add(a.key)
    if (a.action.trim().toUpperCase() === 'DELETE') {
      plan.skips.push({ animal: a, why: 'marked DELETE — remove it in eShepherd, not here' })
      continue
    }
    const id = byKey.get(a.key)
    if (id) plan.updates.push({ animal: a, id })
    else plan.creates.push(a)
  }
  return plan
}

/** An animal as the sheet's fourteen values, for writing back. */
export type ExportAnimal = {
  eshepherd_animal_id: string | null
  eid: string | null
  vid: string | null
  neckband: string | null
  breed: string | null
  stock_class: string | null
  birth_date: string | null
  brand: string | null
  weight_kg: number | null
  weighed_on: string | null
  expected_gain_kg: number | null
  pregnancy_status: string | null
  eshepherd_note: string | null
}

/**
 * One animal as a row of the sheet.
 *
 * `action` is what eShepherd will do with it. It defaults to NO ACTION, which
 * is what its own download carries: a file that came back saying EDIT on
 * every row would rewrite the whole herd on upload.
 */
export function toSheetRow(a: ExportAnimal, action: SheetAction = 'NO ACTION'): string[] {
  return [
    action,
    a.eshepherd_animal_id ?? '',
    a.neckband ?? '',
    a.eid ?? '',
    a.vid ?? '',
    a.breed ?? '',
    a.stock_class ?? '',
    formatSheetDate(a.birth_date),
    a.brand ?? '',
    a.weight_kg == null ? '' : String(a.weight_kg),
    formatSheetDate(a.weighed_on),
    a.expected_gain_kg == null ? '' : String(a.expected_gain_kg),
    a.pregnancy_status ?? '',
    a.eshepherd_note ?? '',
  ]
}

/** The whole file: banner, headers, then a row per animal. */
export function toSheetGrid(animals: ExportAnimal[], action: SheetAction = 'NO ACTION'): string[][] {
  return [
    [SHEET_BANNER],
    [...SHEET_HEADERS],
    ...animals.map((a) => toSheetRow(a, action)),
  ]
}
