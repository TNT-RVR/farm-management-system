import { binReportTable, gatherBinReport, reportToXlsx } from '@/lib/bin-export'
import { waterReviewTable } from '@/lib/reports/water-review'
import { longDate, yearParam, type GatherContext, type Gathered, type ParamValues } from '@/lib/reports/framework'

/** Reports gathered in one call that have no module of their own. Loaded when one is made (gatherers.ts). */

export async function binRecords(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  if (!p.bin) throw new Error('Choose a bin.')
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const r = await gatherBinReport(p.bin, from, to)
  return { ...binReportTable(r), filename: `${r.bin.name} ${from} to ${to}` }
}

/** The same report as a formatted Excel sheet. */
export async function binRecordsXlsx(p: ParamValues, ctx: GatherContext): Promise<{ blob: Blob; filename: string }> {
  if (!p.bin) throw new Error('Choose a bin.')
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const r = await gatherBinReport(p.bin, from, to)
  return { blob: await reportToXlsx(r), filename: `${r.bin.name} ${from} to ${to}.xlsx`.replace(/[\\/:*?"<>|]/g, '-') }
}

export async function waterReview(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  const year = yearParam(p, ctx)
  const { report, rows } = await waterReviewTable(year, ctx.units)
  if (!rows) throw new Error(`No irrigated field has a crop or a season in ${year}.`)
  return { ...report, subtitle: `${year} season · as at ${longDate(ctx.today)}`, filename: `water-review-${year}` }
}
