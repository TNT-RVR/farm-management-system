import { toCsv, type ExportColumn } from '@/hooks/useExport'
import type { UnitSystem } from '@/lib/units'
import { autoAlign, tableReportToCsv, type Align, type Cell, type ReportSection, type TableReport } from '@/lib/table-report'
import type { ReportFormat } from './catalogue'

/**
 * The shape every report on the Reports page is gathered into, and the two
 * files made from it. A report's gather function reads the database once and
 * returns ReportData; the same object becomes the CSV and the PDF, so the two
 * can never disagree. How to add a report: see the top of catalogue.ts.
 */

export type { Cell } from '@/lib/table-report'

export type ReportColumn = {
  label: string
  /** Left out, a column of numbers right-aligns by itself in the PDF. */
  align?: Align
  /**
   * Decimal places for a number in this column. The CSV gets the number
   * rounded (no thousands separators, so Excel reads it as a number); the PDF
   * gets it with separators. Strings are left alone either way.
   */
  decimals?: number
  /** Up to this many decimal places, no trailing zeros (a rate of 0.356 L/ac, or 50). */
  upTo?: number
  /** Print as dollars in the PDF ($1,234.50); the CSV keeps the bare number. */
  money?: boolean
  /** Cells are app paths (/fields/…/history): links to those pages in the PDF. */
  link?: boolean
}

/** A run of rows under one heading — a field, a crop, a supplier. */
export type ReportGroup = {
  title: string
  note?: string
  rows: Cell[][]
  /** The group's totals row, under its last row. */
  totals?: Cell[]
  /** What the PDF says when the group has no rows ("Nothing was left over."). */
  empty?: string
}

export type ReportData = {
  title: string
  /** What it covers: "Crop year 2026 · All fields". */
  subtitle?: string
  /** The facts at the top of the PDF (passes, acres, the year's allotment…). */
  meta?: [string, Cell][]
  /** Sentences under the heading: what is in it and what is left out. PDF only. */
  summary?: string[]
  columns: ReportColumn[]
  /** One untitled group for a flat list. */
  groups: ReportGroup[]
  /**
   * The CSV is one flat table: with groups, each row starts with its group's
   * title under this heading ("Field", "Supplier"). Left out, no column is added.
   */
  groupLabel?: string
  /** The whole report's totals: the last row of both files. */
  totals?: Cell[]
  image?: TableReport['image']
  orientation?: TableReport['orientation']
  /** File name without its extension. */
  filename: string
}

/**
 * A report already laid out as several tables with their own columns (a bin's
 * records, the 4R/NERP pack, the water review). Its CSV keeps the sections.
 */
export type SectionedReport = TableReport & { filename: string }

export type Gathered = ReportData | SectionedReport

export const isSectioned = (g: Gathered): g is SectionedReport => 'sections' in g

/**
 * A file a report makes in its own shape rather than as a table: a ZIP of
 * stored invoices or of a shapefile, a Markdown bundle. A gather returns one
 * when the row's format asks for it (ctx.format).
 */
export type ReportFile = { blob: Blob; filename: string }

export type Made = Gathered | ReportFile

export const isFile = (m: Made): m is ReportFile => 'blob' in m

/** Bytes as a download: a Uint8Array may be a view into a larger buffer, so only its own part goes. */
export function fileOf(data: Uint8Array | string, filename: string, type: string): ReportFile {
  const part = typeof data === 'string' ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  return { blob: new Blob([part], { type }), filename }
}

/** Rows in a report, for "nothing to put in it" checks. */
export function rowCount(g: Gathered): number {
  return isSectioned(g) ? g.sections.reduce((n, s) => n + s.rows.length, 0) : g.groups.reduce((n, s) => n + s.rows.length, 0)
}

/** A number as the CSV writes it: rounded to the column's places, nothing else. */
function csvValue(v: Cell, col: ReportColumn | undefined): Cell {
  if (typeof v !== 'number' || !Number.isFinite(v)) return typeof v === 'number' ? null : v
  const places = col?.decimals ?? col?.upTo
  if (places == null) return v
  const f = 10 ** places
  return Math.round(v * f) / f
}

/** A number as the PDF prints it: thousands grouped, the column's places, dollars where asked. */
export function pdfValue(v: Cell, col: ReportColumn | undefined): Cell {
  if (typeof v !== 'number') return v
  if (!Number.isFinite(v)) return null
  const d = col?.decimals
  const s = v.toLocaleString('en-CA', d == null ? { maximumFractionDigits: col?.upTo ?? 2 } : { minimumFractionDigits: d, maximumFractionDigits: d })
  return col?.money ? (v < 0 ? `-$${s.slice(1)}` : `$${s}`) : s
}

/** The CSV text: one header line and one line a row (totals included), group first when grouped. */
export function reportCsv(g: Gathered): string {
  if (isSectioned(g)) return tableReportToCsv(g)
  const grouped = Boolean(g.groupLabel)
  type Row = { group: string; cells: Cell[] }
  // Totals rows ride along after their rows, as on the PDF, so the file
  // holds the same figures; each is labelled in its first cell.
  const rows: Row[] = g.groups.flatMap((gr) => [...gr.rows.map((cells) => ({ group: gr.title, cells })), ...(gr.totals ? [{ group: gr.title, cells: gr.totals }] : [])])
  if (g.totals) rows.push({ group: 'All', cells: g.totals })
  const columns: ExportColumn<Row>[] = [
    ...(grouped ? [{ key: '_group', label: g.groupLabel!, value: (r: Row) => r.group }] : []),
    ...g.columns.map((c, i) => ({ key: `c${i}`, label: c.label, value: (r: Row) => csvValue(r.cells[i] ?? null, c) })),
  ]
  return toCsv(rows, columns)
}

/** The PDF's layout: a table per group, the grand total as its own last band. */
export function reportTable(g: Gathered): TableReport {
  if (isSectioned(g)) return g
  const head = g.columns.map((c) => c.label)
  const fmt = (cells: Cell[]) => g.columns.map((c, i) => pdfValue(cells[i] ?? null, c))
  // One alignment for the whole report, so a group whose column happens to be
  // empty does not flip its header to the other side.
  const auto = autoAlign(head, g.groups.flatMap((gr) => gr.rows.map(fmt)))
  const align: Align[] = g.columns.map((c, i) => c.align ?? (i > 0 && (c.decimals != null || c.upTo != null || c.money) ? 'right' : auto[i]))
  const link = g.columns.findIndex((c) => c.link)
  const linkColumn = link >= 0 ? link : undefined
  const sections: ReportSection[] = g.groups.map((gr) => ({
    linkColumn,
    title: gr.title,
    note: gr.note,
    head,
    rows: gr.rows.map(fmt),
    foot: gr.totals ? fmt(gr.totals) : undefined,
    align,
    empty: gr.empty,
  }))
  if (g.totals) {
    // One table: its totals go under it. Several: a last band with the lot.
    if (sections.length === 1 && !sections[0].foot) sections[0].foot = fmt(g.totals)
    else sections.push({ title: 'All together', head, rows: [], foot: fmt(g.totals), align })
  }
  return {
    title: g.title,
    subtitle: g.subtitle,
    meta: g.meta ?? [],
    lead: g.summary,
    image: g.image,
    orientation: g.orientation,
    sections,
  }
}

/* ── Parameters ─────────────────────────────────────────────────────────── */

/**
 * What a report asks for before it is made, drawn as small pickers on its
 * row. Every value is a string ('' meaning "all" for an optional pick), so a
 * row's state is a plain record; gather functions read them with the helpers
 * below.
 */
export type ParamSpec =
  /** A crop year; defaults to the year the app is set to, or that many years on (ahead: 1, a plan for next year). */
  | { key: string; kind: 'year'; label?: string; ahead?: number }
  /** One field; with allLabel it may be left at "all". */
  | { key: string; kind: 'field'; label?: string; allLabel?: string }
  | { key: string; kind: 'crop'; label?: string; allLabel?: string }
  | { key: string; kind: 'ranch'; label?: string; allLabel?: string }
  | { key: string; kind: 'bin'; label?: string }
  /** A date; the default is counted back from today. */
  | { key: string; kind: 'date'; label: string; daysAgo?: number; startOfYear?: boolean }
  | { key: string; kind: 'choice'; label: string; options: { value: string; label: string }[]; default: string }
  /**
   * A list read from the database when the row is drawn (suppliers, audited
   * tables). Without allLabel one must be chosen, and the first is to start with.
   */
  | { key: string; kind: 'lookup'; label: string; lookup: LookupKey; allLabel?: string }

export type LookupKey = 'suppliers' | 'auditTables' | 'contactTypes' | 'alertKinds' | 'manifests' | 'nTrials' | 'jointVentures' | 'grazingDispositions'

export type ParamValues = Record<string, string>

/** What a gather function is told about who is asking. */
export type GatherContext = {
  /** The farm's calendar day, YYYY-MM-DD. */
  today: string
  cropYear: number
  isAdmin: boolean
  isManager: boolean
  /** An owner (users.is_owner) — the fixed-cost breakdown is theirs alone. */
  isOwner: boolean
  /** The person's units (metric / imperial), for reports that follow the toggle. */
  units: UnitSystem
  /** True for a page switched off for the farm or closed to this person (a bare path, no ?tab). */
  viewOff?: (path: string) => boolean
  /**
   * The file being made. Most reports ignore it (one gather makes both
   * files); a report whose CSV is a different cut from its PDF (the AIMM
   * report's daily balance), or that makes a ZIP or Markdown, reads it.
   */
  format?: ReportFormat
}

export const yearParam = (p: ParamValues, ctx: GatherContext, key = 'year') => {
  const n = Number(p[key])
  return Number.isFinite(n) && n > 1900 ? n : ctx.cropYear
}

/** An optional pick: null when left at "all". */
export const pick = (p: ParamValues, key: string): string | null => (p[key] ? p[key] : null)

/** A date picker's starting value. */
export function dateDefault(spec: Extract<ParamSpec, { kind: 'date' }>, today: string): string {
  if (spec.startOfYear) return `${today.slice(0, 4)}-01-01`
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (spec.daysAgo ?? 0))
  return d.toISOString().slice(0, 10)
}

/** "2026-10-02" → "2 Oct 2026", for subtitles. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A field called "3" reads as "Field 3" when it stands alone (a heading, a list of things to fix). */
export const fieldLabel = (name: string) => (/^\d+$/.test(name.trim()) ? `Field ${name.trim()}` : name)

/** Adapts a list's export columns (lib/reports/lists.ts) to a one-table report. */
export function fromExportColumns<Row>(rows: Row[], cols: ExportColumn<Row>[]): Pick<ReportData, 'columns' | 'groups'> {
  return {
    columns: cols.map((c) => ({ label: c.label })),
    groups: [{ title: '', rows: rows.map((r) => cols.map((c) => c.value(r) ?? null)) }],
  }
}

/* ── Fetching ───────────────────────────────────────────────────────────── */

/**
 * Every row of a query, a thousand at a time: PostgREST stops at a thousand
 * and a report that quietly loses row 1,001 is worse than no report. The
 * query must be ordered so the pages do not overlap.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** Postgres numerics come back as strings through PostgREST. */
export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Each picker's starting value, filled in once its list has loaded (the first bin). */
export function initialParams(specs: ParamSpec[], cropYear: number, today: string): ParamValues {
  const p: ParamValues = {}
  for (const s of specs) {
    if (s.kind === 'year') p[s.key] = String(cropYear + (s.ahead ?? 0))
    else if (s.kind === 'date') p[s.key] = dateDefault(s, today)
    else if (s.kind === 'choice') p[s.key] = s.default
    else p[s.key] = ''
  }
  return p
}
