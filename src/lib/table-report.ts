import { csvCell } from '@/hooks/useExport'

/**
 * A report that is a title, a few label/value lines and a run of tables — the
 * shape of every export the farm hands to someone else (a bin's records, a
 * field's 4R/NERP pack, anything on the Reports page). Written once as CSV or
 * PDF so the two formats never disagree about what is in it.
 *
 * The PDF is the farm's printed face: its logo and name at the top, the
 * report's title and what it covers, the facts in a panel, then tables with a
 * green header row that repeats on every page, zebra rows, numbers right-
 * aligned and totals picked out, and "page x of y" at the foot. It turns
 * landscape by itself when the tables are too wide for a portrait page.
 * Every PDF in the app goes through tableReportToPdf; there is no second one.
 */

export type Cell = string | number | null
export type Align = 'left' | 'right' | 'center'

export type ReportSection = {
  title: string
  head: string[]
  rows: Cell[][]
  note?: string
  /** A totals row, drawn bold on a pale green band under the last row. */
  foot?: Cell[]
  /** Per column. Left out (or a gap), a column of numbers is right-aligned by itself. */
  align?: (Align | undefined)[]
  /** What an empty table says; "None in this range" unless told otherwise. */
  empty?: string
  /** A column of app paths (/fields/…): each becomes a link to that page in the app. */
  linkColumn?: number
  /** Start this table on a fresh page: one record a page (a manifest each). PDF only. */
  pageBreakBefore?: boolean
  /** The least a body row stands, in points: room to sign on a signature line. PDF only. */
  minRowHeight?: number
  /**
   * Columns of filled-in answers, as on a form: a filled cell prints bold and
   * an empty string as a line to write on (null leaves the cell bare). PDF
   * only; the CSV leaves blanks blank.
   */
  answerColumns?: number[]
}

export type TableReport = {
  title: string
  /** One line under the title: the year, the field, the range the report covers. */
  subtitle?: string
  meta: [string, Cell][]
  sections: ReportSection[]
  /** PDF only: a picture (a chart) under the heading, and lines of text under it. */
  image?: { dataUrl: string; width: number; height: number }
  lead?: string[]
  /** Forces the page orientation; left out, it follows the widest table. */
  orientation?: 'portrait' | 'landscape'
}

/** Who the report is from: the farm's name and logo, and the app's name for the footer. */
export type PdfBrand = {
  farmName: string
  appName: string
  /** A PNG or JPEG data URL. Null prints the header without a logo. */
  logo: string | null
}

export { csvCell }

export function tableReportToCsv(r: TableReport): string {
  const line = (cells: Cell[]) => cells.map(csvCell).join(',')
  const out: string[] = [line([r.title]), ...(r.subtitle ? [line([r.subtitle])] : []), ...r.meta.map(([k, v]) => line([k, v]))]
  for (const s of r.sections) {
    out.push('', line([s.title]))
    if (s.note) out.push(line([s.note]))
    out.push(line(s.head))
    if (!s.rows.length) out.push(line([s.empty ?? '(none in this range)']))
    for (const row of s.rows) out.push(line(row))
    if (s.foot) out.push(line(s.foot))
  }
  // A byte-order mark so Excel opens the degree signs and dashes as UTF-8.
  return '﻿' + out.join('\r\n') + '\r\n'
}

/* ── Look ───────────────────────────────────────────────────────────────── */

type RGB = [number, number, number]
/** The app's own greens (src/index.css brand-*) and Tailwind's greys. */
const C = {
  brand50: [240, 253, 244] as RGB,
  brand100: [220, 252, 231] as RGB,
  brand700: [21, 128, 61] as RGB,
  brand800: [22, 101, 52] as RGB,
  brand900: [20, 83, 45] as RGB,
  gray900: [17, 24, 39] as RGB,
  gray700: [55, 65, 81] as RGB,
  gray600: [75, 85, 99] as RGB,
  gray500: [107, 114, 128] as RGB,
  gray400: [156, 163, 175] as RGB,
  gray200: [229, 231, 235] as RGB,
  zebra: [247, 250, 248] as RGB,
}
const MARGIN = 40
/** Where a table carries on after a page break: under the running header. */
const TOP_AFTER_FIRST = 58
const FOOTER_SPACE = 44

/**
 * jsPDF's built-in fonts are Latin-1: the degree sign survives, dashes,
 * curly quotes and anything wider do not — they are swapped for their plain
 * equivalents rather than printed as gibberish.
 */
export function pdfSafe(v: Cell | undefined): string {
  if (v == null) return ''
  return String(v)
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/→/g, '->')
    .replace(/[•·]/g, '|')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '')
}

/** A cell that reads as a number: 1,234.5 · -3 · $12.00 · 45% · 6.2 in. */
const NUMERIC = /^[-+]?\$?[-+]?\d[\d,]*(\.\d+)?\s?(%|in|ac|ft|mm|bu|lb|kg|L|ac-ft|t)?$/
const looksNumeric = (v: Cell) => typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim()))

/**
 * Right-align a column when every filled cell in it is a number. The first
 * column is the row's name (a field called "3" is still a name) and stays left.
 */
export function autoAlign(head: string[], rows: Cell[][]): Align[] {
  return head.map((_, i) => {
    if (i === 0) return 'left'
    let filled = 0
    for (const row of rows.slice(0, 300)) {
      const v = row[i]
      if (v == null || v === '' || v === '-' || v === '—') continue
      if (!looksNumeric(v)) return 'left'
      filled++
    }
    return filled > 0 ? 'right' : 'left'
  })
}

/** Numbers as the page prints them: grouped thousands, no float noise. */
const show = (v: Cell | undefined): string =>
  typeof v === 'number' ? (Number.isFinite(v) ? v.toLocaleString('en-CA', { maximumFractionDigits: 2 }) : '') : pdfSafe(v)

type Doc = InstanceType<typeof import('jspdf').jsPDF>

/**
 * Portrait unless a table will not fit: each column's widest cell (capped,
 * since long text wraps) at the table's type size, against the page's width.
 */
function wantsLandscape(doc: Doc, r: TableReport): boolean {
  if (r.orientation) return r.orientation === 'landscape'
  const usable = 612 - MARGIN * 2
  doc.setFontSize(7.5)
  for (const s of r.sections) {
    let total = 0
    s.head.forEach((h, i) => {
      let w = Math.min(doc.getTextWidth(pdfSafe(h)) + 10, 90)
      for (const row of s.rows.slice(0, 120)) w = Math.max(w, Math.min(doc.getTextWidth(show(row[i])) + 10, 150))
      total += w
    })
    if (total > usable * 1.05 || s.head.length > 9) return true
  }
  return false
}

/** The image's own proportions, so a logo is never squashed. */
function imageSize(doc: Doc, dataUrl: string, maxW: number, maxH: number): { w: number; h: number } | null {
  try {
    const p = doc.getImageProperties(dataUrl)
    const scale = Math.min(maxW / p.width, maxH / p.height)
    return { w: p.width * scale, h: p.height * scale }
  } catch {
    return null
  }
}
const imageKind = (dataUrl: string) => (dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG')

/**
 * Column widths for every table with the same columns, so a report of many
 * groups (a table per field) lines its columns up from one table to the
 * next instead of each sizing itself to its own cells. Each column wants its
 * widest cell (long text capped, it wraps) and needs at least its header's
 * longest word; the lot is stretched or squeezed to the page's width.
 */
function sharedWidths(doc: Doc, sections: ReportSection[], inner: number, fontSize: number): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const pad = 8.5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  const longestWord = (t: string) => Math.max(0, ...t.split(/\s+/).map((w) => doc.getTextWidth(w)))
  for (const s of sections) {
    const key = s.head.join('|')
    if (out.has(key) || s.head.length > 16) continue
    const same = sections.filter((x) => x.head.join('|') === key)
    const rows = same.flatMap((x) => [...x.rows, ...(x.foot ? [x.foot] : [])]).slice(0, 400)
    // The least a column can have: a short header whole ("On it", not "On /
    // it"), a long one's longest word, and no number or word broken mid-way.
    doc.setFont('helvetica', 'bold')
    const headMin = s.head.map((h) => {
      const whole = doc.getTextWidth(pdfSafe(h))
      return (whole <= 52 ? whole : longestWord(pdfSafe(h))) + pad
    })
    doc.setFont('helvetica', 'normal')
    const min = s.head.map((_, i) => Math.max(headMin[i], ...rows.map((r) => Math.min(longestWord(show(r[i])), 90) + pad)))
    const want = s.head.map((_, i) => Math.max(min[i], ...rows.map((r) => Math.min(doc.getTextWidth(show(r[i])), 170) + pad)))
    const total = want.reduce((a, b) => a + b, 0)
    let widths: number[]
    if (total <= inner) {
      widths = want.map((w) => w * (inner / total))
    } else {
      // Squeeze the wide (wrapping) columns first; the narrow ones keep their room.
      const floor = min.reduce((a, b) => a + b, 0)
      const give = want.map((w, i) => w - min[i])
      const spare = give.reduce((a, b) => a + b, 0)
      const need = Math.max(0, total - inner)
      widths = floor >= inner ? min.map((m) => m * (inner / floor)) : want.map((w, i) => w - (spare > 0 ? (give[i] / spare) * need : 0))
    }
    out.set(key, widths)
  }
  return out
}

/** The first page's heading: logo and farm, a rule, the title and subtitle. Returns where content starts. */
function drawMasthead(doc: Doc, r: TableReport, brand: PdfBrand, generated: string): number {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...C.brand800)
  doc.rect(0, 0, W, 5, 'F')

  let x = MARGIN
  const logo = brand.logo ? imageSize(doc, brand.logo, 96, 34) : null
  if (brand.logo && logo) {
    try {
      doc.addImage(brand.logo, imageKind(brand.logo), MARGIN, 22 + (34 - logo.h) / 2, logo.w, logo.h, 'brand-logo', 'FAST')
      x = MARGIN + logo.w + 12
    } catch {
      // A logo jsPDF cannot read prints the header without it.
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...C.gray900)
  doc.text(pdfSafe(brand.farmName), x, 37)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.gray500)
  doc.text(pdfSafe(brand.appName), x, 49)

  doc.setFontSize(7)
  doc.text('GENERATED', W - MARGIN, 35, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(...C.gray700)
  doc.text(pdfSafe(generated), W - MARGIN, 47, { align: 'right' })

  doc.setDrawColor(...C.gray200)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, 66, W - MARGIN, 66)

  let y = 94
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.setTextColor(...C.gray900)
  const title = doc.splitTextToSize(pdfSafe(r.title), W - MARGIN * 2) as string[]
  doc.text(title, MARGIN, y)
  y += (title.length - 1) * 22
  if (r.subtitle) {
    y += 17
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...C.brand800)
    const sub = doc.splitTextToSize(pdfSafe(r.subtitle), W - MARGIN * 2) as string[]
    doc.text(sub, MARGIN, y)
    y += (sub.length - 1) * 13
  }
  // A short green accent under the heading.
  y += 10
  doc.setFillColor(...C.brand700)
  doc.rect(MARGIN, y, 36, 2.2, 'F')
  return y + 18
}

/** The report's facts as a pale green panel of label-over-value cells. */
function drawMetaPanel(doc: Doc, meta: [string, Cell][], y: number): number {
  const items = meta.filter(([, v]) => v != null && v !== '')
  if (!items.length) return y
  const W = doc.internal.pageSize.getWidth()
  const inner = W - MARGIN * 2
  const perRow = inner > 600 ? 5 : 4
  const cellW = (inner - 24) / perRow
  // Each cell's value wraps within its width; a row is as tall as its tallest.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const wrapped = items.map(([k, v]) => ({ k: pdfSafe(k).toUpperCase(), v: (doc.splitTextToSize(show(v), cellW - 10) as string[]).slice(0, 3) }))
  const rows: (typeof wrapped)[] = []
  for (let i = 0; i < wrapped.length; i += perRow) rows.push(wrapped.slice(i, i + perRow))
  const rowH = rows.map((row) => 14 + Math.max(...row.map((c) => c.v.length)) * 11)
  const h = rowH.reduce((a, b) => a + b, 0) + 14
  doc.setFillColor(...C.brand50)
  doc.setDrawColor(...C.brand100)
  doc.setLineWidth(0.8)
  doc.roundedRect(MARGIN, y, inner, h, 5, 5, 'FD')
  let ry = y + 18
  rows.forEach((row, ri) => {
    row.forEach((c, ci) => {
      const cx = MARGIN + 12 + ci * cellW
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.8)
      doc.setTextColor(...C.gray500)
      doc.text(c.k, cx, ry)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...C.gray900)
      doc.text(c.v, cx, ry + 11)
    })
    ry += rowH[ri]
  })
  return y + h + 16
}

/** Pages after the first: a slim header, so a loose page still says what it is. */
function drawRunningHeader(doc: Doc, r: TableReport, brand: PdfBrand) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...C.brand800)
  doc.rect(0, 0, W, 3, 'F')
  let x = MARGIN
  const logo = brand.logo ? imageSize(doc, brand.logo, 40, 15) : null
  if (brand.logo && logo) {
    try {
      doc.addImage(brand.logo, imageKind(brand.logo), MARGIN, 17 + (15 - logo.h) / 2, logo.w, logo.h, 'brand-logo', 'FAST')
      x += logo.w + 8
    } catch {
      // Header without the logo.
    }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...C.gray700)
  doc.text(pdfSafe(brand.farmName), x, 28)
  const fw = doc.getTextWidth(pdfSafe(brand.farmName))
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...C.gray500)
  doc.text(pdfSafe(`  |  ${r.title}${r.subtitle ? ` - ${r.subtitle}` : ''}`), x + fw, 28, { maxWidth: W - MARGIN - x - fw })
  doc.setDrawColor(...C.gray200)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, 38, W - MARGIN, 38)
}

function drawFooter(doc: Doc, brand: PdfBrand, generated: string, page: number, pages: number) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...C.gray200)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, H - 32, W - MARGIN, H - 32)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray500)
  doc.text(pdfSafe(`Generated by ${brand.appName} | ${generated}`), MARGIN, H - 20)
  doc.text(`Page ${page} of ${pages}`, W - MARGIN, H - 20, { align: 'right' })
}

/* ── Brand ──────────────────────────────────────────────────────────────── */

const logoCache = new Map<string, Promise<string | null>>()

/**
 * A logo URL as a PNG data URL jsPDF can embed, drawn through a canvas so an
 * SVG or WebP logo works too. Null when it cannot be loaded (offline, a
 * missing file, a server that refuses the cross-origin read).
 */
export function logoDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:image/png') || url.startsWith('data:image/jpeg')) return Promise.resolve(url)
  if (typeof document === 'undefined') return Promise.resolve(null)
  const hit = logoCache.get(url)
  if (hit) return hit
  const job = new Promise<string | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        // Twice the printed size or so, so it stays crisp without bloating the file.
        const scale = Math.min(1, 400 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round((img.naturalWidth || 300) * scale))
        canvas.height = Math.max(1, Math.round((img.naturalHeight || 150) * scale))
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  logoCache.set(url, job)
  return job
}

/**
 * The farm's name and logo as Farm setup has them (brand.ts where it has no
 * answer), and the app's own logo when the farm's will not load — so another
 * farm's reports carry its logo, and ours carry the monogram.
 */
async function currentBrand(): Promise<PdfBrand> {
  const [{ farmBrand }, { BRAND }] = await Promise.all([import('@/lib/farm-setup'), import('@/config/brand')])
  const b = farmBrand()
  const logo = (await logoDataUrl(b.logo)) ?? (b.logo !== BRAND.logo ? await logoDataUrl(BRAND.logo) : null)
  return { farmName: b.farmName, appName: b.appName, logo }
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

export type PdfOptions = {
  /** Who it is from; left out, the farm's own (Farm setup, else brand.ts). */
  brand?: PdfBrand
  /** The time stamped on it; now unless a test pins it. */
  now?: Date
  /** The app's address for links to its pages; the current one in a browser. */
  linkBase?: string
}

export async function tableReportToPdf(r: TableReport, opts: PdfOptions = {}): Promise<Blob> {
  const doc = await tableReportPdfDoc(r, opts)
  return doc.output('blob')
}

/** The jsPDF document itself, for a test to write to disk and look at. */
export async function tableReportPdfDoc(r: TableReport, opts: PdfOptions = {}): Promise<Doc> {
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')
  const brand = opts.brand ?? (await currentBrand())
  const generated = (opts.now ?? new Date()).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

  const probe = new jsPDF({ unit: 'pt', format: 'letter' })
  const landscape = wantsLandscape(probe, r)
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const inner = W - MARGIN * 2
  const bottom = H - FOOTER_SPACE

  let y = drawMasthead(doc, r, brand, generated)
  y = drawMetaPanel(doc, r.meta, y)

  if (r.image) {
    const h = Math.min(landscape ? 300 : 340, (r.image.height / r.image.width) * inner)
    const w = (r.image.width / r.image.height) * h
    if (y + h > bottom) {
      doc.addPage()
      y = TOP_AFTER_FIRST
    }
    doc.addImage(r.image.dataUrl, imageKind(r.image.dataUrl), MARGIN, y, Math.min(w, inner), h)
    y += h + 16
  }
  if (r.lead?.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...C.gray700)
    for (const line of r.lead) {
      const wrapped = doc.splitTextToSize(pdfSafe(line), inner) as string[]
      if (y + wrapped.length * 11.5 > bottom) {
        doc.addPage()
        y = TOP_AFTER_FIRST
      }
      doc.text(wrapped, MARGIN, y)
      y += wrapped.length * 11.5 + 3
    }
    y += 10
  }

  // Where the app is, for links to its pages; none when made outside a browser.
  const linkBase = opts.linkBase ?? (typeof window !== 'undefined' ? window.location.origin : null)
  const bodySize = (cols: number) => (cols > 11 ? 6.8 : 7.6)
  const widthsBySize = new Map<number, Map<string, number[]>>()
  const widthsFor = (s: ReportSection) => {
    const size = bodySize(s.head.length)
    if (!widthsBySize.has(size)) widthsBySize.set(size, sharedWidths(doc, r.sections.filter((x) => bodySize(x.head.length) === size), inner, size))
    return widthsBySize.get(size)!.get(s.head.join('|'))
  }

  for (const s of r.sections) {
    // A heading never sits alone at the foot of a page.
    if (y > bottom - 70 || (s.pageBreakBefore && y > TOP_AFTER_FIRST)) {
      doc.addPage()
      y = TOP_AFTER_FIRST
    }
    let startY = y
    if (s.title) {
      doc.setFillColor(...C.brand700)
      doc.rect(MARGIN, y - 9.5, 2.5, 12, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11.5)
      doc.setTextColor(...C.brand900)
      doc.text(pdfSafe(s.title), MARGIN + 8, y)
      startY = y + 8
    }
    if (s.note) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.8)
      doc.setTextColor(...C.gray500)
      const note = doc.splitTextToSize(pdfSafe(s.note), inner) as string[]
      doc.text(note, MARGIN, startY + 6)
      startY += 6 + note.length * 9.5
    }
    const auto = autoAlign(s.head, s.rows.length ? s.rows : s.foot ? [s.foot] : [])
    const align = s.head.map((_, i) => s.align?.[i] ?? auto[i])
    // A totals band on its own (a report's grand total) is drawn as a body
    // row styled as a total: a table with no body sizes its columns its own way.
    const footOnly = !s.rows.length && Boolean(s.foot)
    const footCells = s.foot ? s.head.map((_, i) => show(s.foot![i])) : null
    const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = s.rows.length
      ? s.rows.map((row) => s.head.map((_, i) => show(row[i])))
      : footOnly
        ? [footCells!]
        : [[{ content: pdfSafe(s.empty ?? 'None in this range'), colSpan: Math.max(1, s.head.length), styles: { textColor: C.gray500, fontStyle: 'italic', halign: 'left' } }]]
    autoTable(doc, {
      startY: startY + 2,
      head: [s.head.map(pdfSafe)],
      body,
      foot: footCells && !footOnly ? [footCells] : undefined,
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
      // A table too wide even for landscape (the water review's thirty-odd
      // columns) carries on across pages, the first column repeated on each,
      // rather than being squeezed into unreadable slivers.
      horizontalPageBreak: s.head.length > 16,
      horizontalPageBreakRepeat: s.head.length > 16 ? 0 : undefined,
      theme: 'plain',
      margin: { left: MARGIN, right: MARGIN, top: TOP_AFTER_FIRST, bottom: FOOTER_SPACE },
      columnStyles: Object.fromEntries((widthsFor(s) ?? []).map((w, i) => [i, { cellWidth: w }])),
      styles: {
        font: 'helvetica',
        fontSize: bodySize(s.head.length),
        cellPadding: { top: 3.6, bottom: 3.6, left: 4, right: 4 },
        textColor: C.gray900,
        lineColor: C.gray200,
        lineWidth: { bottom: 0.4 },
        valign: 'middle',
        overflow: 'linebreak',
      },
      // Body rows only: the header keeps its own height.
      bodyStyles: s.minRowHeight ? { minCellHeight: s.minRowHeight, valign: 'bottom' } : undefined,
      headStyles: { fillColor: C.brand700, textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0, fontSize: s.head.length > 11 ? 6.8 : 7.4 },
      footStyles: { fillColor: C.brand100, textColor: C.brand900, fontStyle: 'bold', lineWidth: { top: 0.8 }, lineColor: C.brand700 },
      alternateRowStyles: { fillColor: C.zebra },
      didParseCell: (data) => {
        const a = align[data.column.index]
        if (a && !(data.cell.raw && typeof data.cell.raw === 'object' && 'colSpan' in (data.cell.raw as object))) data.cell.styles.halign = a
        // A form's answers: what is filled stands out from the questions.
        if (data.section === 'body' && s.answerColumns?.includes(data.column.index) && String(data.cell.raw ?? '').trim()) data.cell.styles.fontStyle = 'bold'
        if (footOnly && data.section === 'body') Object.assign(data.cell.styles, { fillColor: C.brand100, textColor: C.brand900, fontStyle: 'bold', lineWidth: { top: 0.8 }, lineColor: C.brand700 })
        // A column of app pages reads as links, in the brand green.
        if (data.section === 'body' && data.column.index === s.linkColumn && linkBase && String(data.cell.raw ?? '').startsWith('/')) data.cell.styles.textColor = C.brand700
      },
      didDrawCell: (data) => {
        // A blank answer is a line to write on, as on the paper form.
        if (data.section === 'body' && s.answerColumns?.includes(data.column.index) && s.rows[data.row.index]?.[data.column.index] === '') {
          const yLine = data.cell.y + data.cell.height - 4
          doc.setDrawColor(...C.gray400)
          doc.setLineWidth(0.5)
          doc.line(data.cell.x + 4, yLine, data.cell.x + data.cell.width - 4, yLine)
        }
        if (data.section !== 'body' || data.column.index !== s.linkColumn || !linkBase) return
        const path = String(data.cell.raw ?? '')
        if (path.startsWith('/')) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: `${linkBase}${path}` })
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
  }

  // Headers and footers last, once the page count is known.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1) drawRunningHeader(doc, r, brand)
    drawFooter(doc, brand, generated, p, pages)
  }
  return doc
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name.replace(/[\\/:*?"<>|]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
