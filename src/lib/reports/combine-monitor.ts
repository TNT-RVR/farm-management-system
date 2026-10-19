import { MONITOR_NAME_MAX, boundaryFiles, boundaryZip, lineTypeNote, nameNote, type BoundaryItem, type SnapshotField } from '@/lib/combine-monitor'
import { loadBoundaryGeometry, loadLineGeometry, loadMonitorFields, type MonitorField, type MonitorFieldList } from '@/lib/combine-monitor-data'
import { compareFieldNames } from '@/lib/queries'
import { lineShortName } from '@/lib/guidance-lines'
import { fileOf, longDate, yearParam, type Cell, type GatherContext, type Made, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * The two files for the combine display (lib/combine-monitor.ts): the
 * boundary shapefiles as one ZIP for the stick, and the list of names to
 * create on the display. Made here for the Reports page and by the Combines
 * page's Monitor files tab, which picks its own fields.
 */

export type Which = 'harvest' | 'all'

/** The fields a "which" means: this year's combined crops, or every active field. Only fields with a boundary can go in a ZIP. */
export function fieldsFor(list: MonitorField[], which: Which): MonitorField[] {
  return list.filter((f) => f.hasBoundary && (which === 'all' || f.harvesting))
}

/** The ZIP for the chosen fields, and the fields as they went in (for "Mark loaded"). */
export async function makeBoundaryZip(
  fields: MonitorField[],
  opts: { cropYear: number; today: string; appName?: string },
): Promise<{ data: Uint8Array; loaded: SnapshotField[]; filename: string }> {
  const { items, madeOpts } = await boundaryItems(fields, opts)
  const data = boundaryZip(items, madeOpts)
  return { data, loaded: items.map((i) => i.field.snapshot), filename: `Combine boundaries ${opts.cropYear}.zip` }
}

/** The same files unzipped, for writing straight onto the stick (lib/save-to-folder.ts). */
export async function makeBoundaryFiles(
  fields: MonitorField[],
  opts: { cropYear: number; today: string; appName?: string },
): Promise<{ files: { name: string; data: Uint8Array }[]; loaded: SnapshotField[] }> {
  const { items, madeOpts } = await boundaryItems(fields, opts)
  return { files: boundaryFiles(items, madeOpts), loaded: items.map((i) => i.field.snapshot) }
}

async function boundaryItems(fields: MonitorField[], opts: { cropYear: number; today: string; appName?: string }) {
  const withBoundary = fields.filter((f) => f.hasBoundary)
  if (!withBoundary.length) throw new Error('None of those fields has a boundary drawn.')
  const [geometry, lineGeometry] = await Promise.all([
    loadBoundaryGeometry(withBoundary.map((f) => f.id)),
    loadLineGeometry(withBoundary.flatMap((f) => f.lines.map((l) => l.id))),
  ])
  const items: (BoundaryItem & { field: MonitorField })[] = withBoundary
    .filter((f) => geometry.has(f.id))
    .map((f) => ({
      field: f,
      monitorName: f.monitor.name,
      farm: f.monitor.farm,
      grower: f.monitor.grower,
      fileName: f.monitor.fileName,
      appName: f.name,
      acres: f.acres,
      geometry: geometry.get(f.id),
      lines: f.lines.filter((l) => lineGeometry.has(l.id)).map((l) => ({ ...l, geometry: lineGeometry.get(l.id) })),
    }))
  if (!items.length) throw new Error('Those boundaries could not be read.')
  return { items, madeOpts: { cropYear: opts.cropYear, madeOn: longDate(opts.today), appName: opts.appName } }
}

export async function gatherCombineBoundaries(p: ParamValues, ctx: GatherContext): Promise<Made> {
  const year = yearParam(p, ctx)
  const which: Which = p.which === 'all' ? 'all' : 'harvest'
  const list = await loadMonitorFields(year)
  const fields = fieldsFor(list.fields, which)
  if (!fields.length) throw new Error(which === 'harvest' ? `No field on a combine crop in ${year} has a boundary. Choose all active fields.` : 'No active field has a boundary.')
  if (ctx.format !== 'ZIP') {
    // The fields the ZIP holds, as the name list.
    const r = fieldNameReport({ ...list, fields }, year)
    return { ...r, title: 'Combine boundary files', subtitle: `Crop year ${year} · ${which === 'harvest' ? 'fields on the combines' : 'every active field with a boundary'}`, filename: `Combine boundaries ${year}` }
  }
  const zip = await makeBoundaryZip(fields, { cropYear: year, today: ctx.today })
  return fileOf(zip.data, zip.filename, 'application/zip')
}

/**
 * The name list's rows, Grower → Farm: one group per Farm on the display
 * (own land first, then the landowners' farms by name). Pure.
 */
export function fieldNameReport(all: MonitorFieldList, year: number, which: Which = 'all'): ReportData {
  // On the combines this year, or every active field.
  const list = which === 'all' ? all : { ...all, fields: all.fields.filter((f) => f.harvesting) }
  const byFarm = new Map<string, MonitorField[]>()
  for (const f of list.fields) {
    const k = f.monitor.farm
    byFarm.set(k, [...(byFarm.get(k) ?? []), f])
  }
  const own = list.ownedFarm.toLowerCase()
  const rank = (farm: string) => (!farm ? 2 : farm.toLowerCase() === own ? 0 : 1)
  const groups: ReportGroup[] = [...byFarm.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || compareFieldNames(a, b))
    .map(([farm, fields]) => {
      const owners = [...new Set(fields.map((f) => f.landowner).filter((o): o is string => Boolean(o)))]
      return {
        title: farm || 'No farm',
        note: owners.length ? `Landowner: ${owners.join(', ')}` : farm.toLowerCase() === own ? 'Own land' : undefined,
        rows: fields.map((f): Cell[] => [
          f.name,
          f.monitor.farm || null,
          f.monitor.name,
          f.monitor.fileName,
          [nameNote(f.monitor), f.hasBoundary ? '' : 'No boundary'].filter(Boolean).join(', '),
          f.acres,
          f.crops.join(' / ') || null,
          f.varieties.join(' / ') || null,
        ]),
      }
    })
  // The combine guidance lines, one row each, under the fields.
  const lines = list.fields.flatMap((f) => f.lines.map((l) => ({ f, l })))
  if (lines.length)
    groups.push({
      title: 'Guidance lines (MultiSwath+)',
      note: 'Deere lines with “Combine” in the name. Import2, Source Non-IntelliView 2.',
      rows: lines.map(({ f, l }): Cell[] => [
        f.name,
        f.monitor.farm || null,
        l.name,
        l.fileName,
        [`${lineTypeNote(l.lineType)} · ${l.lineName}`, l.name !== `${f.monitor.name} ${lineShortName(l.lineName)}` ? 'Shortened' : ''].filter(Boolean).join(', '),
        null,
        null,
        null,
      ]),
    })
  const count = (p: (f: MonitorField) => boolean) => list.fields.filter(p).length
  return {
    title: 'Field names for the combine display',
    subtitle: `Crop year ${year} · ${which === 'all' ? 'every active field' : 'fields on the combines'}`,
    meta: [
      ['Grower on the display', list.grower || 'not set'],
      ['Farm for own land', list.ownedFarm || 'not set'],
      ['Farms', byFarm.size],
      ['Fields', list.fields.length],
      ['Names shortened', count((f) => f.monitor.shortened)],
      ['Set by hand', count((f) => f.monitor.source === 'override' || f.monitor.farmSet)],
    ],
    summary: [
      `On the display, under the Grower: create each Farm if it’s missing, then its fields with the names in “Field on the display” exactly (the display shows them in capitals).`,
      `Own land is under the own-land Farm with the app’s name. Rented and crop-share land is under the landowner’s Farm, named for its legal land. Names are cut to ${MONITOR_NAME_MAX} characters only when longer, with 1/2, 1/4 and 3/4 written as words.`,
      `Boundary files are named “<Farm> <Field>”, or the Field alone when that is over ${MONITOR_NAME_MAX}.`,
    ],
    columns: [
      { label: 'Field in the app' },
      { label: 'Farm on the display' },
      { label: 'Field on the display' },
      { label: 'File name' },
      { label: 'Note' },
      { label: 'Mapped ac', decimals: 1 },
      { label: 'Crop' },
      { label: 'Variety' },
    ],
    groupLabel: 'Farm on the display',
    groups,
    orientation: 'landscape',
    filename: `Combine field names ${year}`,
  }
}

export async function gatherCombineFieldNames(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const which: Which = p.which === 'all' ? 'all' : 'harvest'
  const list = await loadMonitorFields(year)
  if (!list.fields.length) throw new Error('No active fields.')
  const r = fieldNameReport(list, year, which)
  if (!r.groups.some((g) => g.rows.length)) throw new Error(`No field is on a combine crop in ${year}. Choose all active fields, or switch crops on under Combine → Monitor files.`)
  return r
}
