import type { Workbook, Worksheet } from 'exceljs'
import { emcKind, sixLevels, type Level } from './bin-monitor'

/**
 * BASF's bin-monitoring report, written into BASF's own template.
 *
 * The template (public/templates/basf-bin-monitoring.xlsx) is loaded and
 * filled rather than rebuilt, so the lookup table, its formulas, its colours
 * and its layout are theirs. Each bin is a block: Bin #, Lot #, LLD, then up to
 * fourteen dated rows of RH (B–G), moisture (H–M), temperature (N–S) at six
 * cable levels and the initials of whoever read it (T).
 *
 * Moisture: for canola with a humidity reading, the template's own formula is
 * kept (with its result filled in, so it shows even before Excel recalculates).
 * Where the only figure is the sensor's own moisture, or the crop is not
 * canola, the number is written in — BASF's formula is a canola table and would
 * be wrong for anything else.
 */

export type ReportBin = {
  name: string
  lot: string | null
  lld: string | null
  crop: string | null
  readings: { read_on: string; initials: string | null; levels: Level[] }[]
}

/** The template has five blocks, 21 rows apart, starting at row 21. */
const FIRST = 21
const STEP = 21
const TEMPLATE_BLOCKS = 5
const ROWS_PER_BLOCK = 14

const COL = (i: number) => String.fromCharCode(65 + i) // 0 → A
const RH_COL = (k: number) => COL(1 + k) // B..G
const M_COL = (k: number) => COL(7 + k) // H..M
const T_COL = (k: number) => COL(13 + k) // N..S

/** The template's moisture formula for one cell, as it appears in the sheet. */
export function moistureFormula(row: number, k: number): string {
  const rh = `${RH_COL(k)}${row}`
  const t = `${T_COL(k)}${row}`
  return (
    `IF(AND(${t} >= -2, ${t} <= 28, ${rh} >= 35, ${rh} <= 85, ${t} <> "", ${rh} <> ""), ` +
    `INDEX($B$3:$L$17, MATCH(2 * ROUND(${t} / 2, 0), $A$3:$A$17, 1), MATCH(5 * ROUND(${rh} / 5, 0), $B$2:$L$2, 1)),"")`
  )
}

/** Copy one block's labels, styles and merges to a new place below the last. */
function cloneBlock(ws: Worksheet, to: number) {
  for (let r = 0; r < STEP; r++) {
    const src = ws.getRow(FIRST + r)
    const dst = ws.getRow(to + r)
    dst.height = src.height
    for (let c = 1; c <= 21; c++) {
      const s = src.getCell(c)
      const d = dst.getCell(c)
      d.style = JSON.parse(JSON.stringify(s.style ?? {}))
      const v = s.value
      // Labels and headers only; data and formulas are written per bin.
      if (typeof v === 'string' || (typeof v === 'number' && r === 5)) d.value = v
    }
  }
  try {
    ws.mergeCells(`I${to + 1}:L${to + 2}`)
  } catch {
    /* already merged */
  }
}

/** Split a bin's readings into blocks of fourteen, oldest first. */
function blocksOf(bins: ReportBin[]): { bin: ReportBin; part: number; rows: ReportBin['readings'] }[] {
  const out: { bin: ReportBin; part: number; rows: ReportBin['readings'] }[] = []
  for (const bin of bins) {
    const sorted = [...bin.readings].sort((a, b) => a.read_on.localeCompare(b.read_on))
    if (!sorted.length) out.push({ bin, part: 0, rows: [] })
    for (let i = 0; i < sorted.length; i += ROWS_PER_BLOCK) {
      out.push({ bin, part: i / ROWS_PER_BLOCK, rows: sorted.slice(i, i + ROWS_PER_BLOCK) })
    }
  }
  return out
}

/** Fill a loaded template workbook. Returns how many blocks were written. */
export function fillBasfWorkbook(wb: Workbook, bins: ReportBin[]): number {
  const ws = wb.worksheets[0]
  const blocks = blocksOf(bins)
  blocks.forEach((b, i) => {
    const s = FIRST + i * STEP
    if (i >= TEMPLATE_BLOCKS) cloneBlock(ws, s)
    const canola = emcKind(b.bin.crop) === 'canola'
    ws.getCell(`B${s}`).value = b.part > 0 ? `${b.bin.name} (continued)` : b.bin.name
    ws.getCell(`B${s + 1}`).value = b.bin.lot ?? null
    ws.getCell(`B${s + 2}`).value = b.bin.lld ?? null
    if (b.bin.crop && !canola) ws.getCell(`D${s}`).value = `Crop: ${b.bin.crop} — moisture by crop equation, not the canola table`

    for (let j = 0; j < ROWS_PER_BLOCK; j++) {
      const row = s + 6 + j
      const rd = b.rows[j]
      if (!rd) continue
      const [y, m, d] = rd.read_on.split('-').map(Number)
      const date = ws.getCell(`A${row}`)
      date.value = new Date(Date.UTC(y, m - 1, d))
      date.numFmt = 'yyyy-mm-dd'
      ws.getCell(`T${row}`).value = rd.initials ?? null
      sixLevels(rd.levels).forEach((lv, k) => {
        ws.getCell(`${RH_COL(k)}${row}`).value = lv?.rh_pct ?? null
        ws.getCell(`${T_COL(k)}${row}`).value = lv?.temp_c ?? null
        const cell = ws.getCell(`${M_COL(k)}${row}`)
        const mo = lv?.moisture_pct ?? null
        if (canola && lv?.rh_pct != null) {
          cell.value = { formula: moistureFormula(row, k), result: mo ?? '' }
        } else {
          cell.value = mo
        }
      })
    }
  })
  return blocks.length
}

/** Load the template, fill it, and hand back the file. */
export async function buildBasfReport(bins: ReportBin[]): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const buf = await fetch('/templates/basf-bin-monitoring.xlsx').then((r) => {
    if (!r.ok) throw new Error('The BASF template could not be loaded')
    return r.arrayBuffer()
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  fillBasfWorkbook(wb, bins)
  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
