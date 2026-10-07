import { supabase } from '@/lib/supabase'
import { PURPOSES, totalHead, type ManifestWithLines } from '@/lib/manifests'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, longDate, pick, type Cell, type GatherContext, type Gathered, type ParamValues, type ReportData } from './framework'

/**
 * Livestock manifests: one load, or every load over a date range. The PDF
 * lays each out as the printed form does (ManifestPrint.tsx) — consignor and
 * consignee side by side, the livestock with spare rows for the head counted
 * at the chute, who hauled it, the declaration and signature lines — a
 * manifest to a page. The CSV is a row a line of livestock, the load's
 * details repeated on each, for a spreadsheet of what moved.
 *
 * Like the printed form, it says it is the farm's record, not the numbered
 * Livestock Identification Services manifest.
 */

/** Spare rows on the form, as on paper: the last few head are counted at the chute. */
export const BLANK_ROWS = 4

export const NOT_OFFICIAL = 'Farm record - not the official Livestock Identification Services manifest.'
const DECLARATION = 'I declare that the livestock described above are owned by the consignor named, that the brands shown are correct, and that this movement is for the purpose stated.'

const purposeLabel = (v: string | null) => PURPOSES.find((p) => p.value === v)?.label ?? v ?? ''
const join = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' - ')

/** One manifest as the form's tables, the first starting a fresh page unless it is the first manifest. */
export function manifestSections(m: ManifestWithLines, first: boolean): ReportSection[] {
  const head = totalHead(m.lines)
  const blanks = Math.max(0, BLANK_ROWS - m.lines.length)
  return [
    {
      title: `Manifest ${m.manifest_no ? `no. ${m.manifest_no}` : '(number not entered)'} · moved ${m.moved_on ?? 'date not set'}`,
      note: NOT_OFFICIAL,
      pageBreakBefore: !first,
      head: ['Consignor - left from', '', 'Consignee - going to', ''],
      align: ['left', 'left', 'left', 'left'],
      rows: [
        ['Owner', m.owner_name, 'Destination', m.destination_name],
        ['Phone', m.owner_phone, 'Phone', m.destination_phone],
        ['Address', m.origin_address, 'Address', m.destination_address],
        ['Premises ID', m.origin_premises_id, 'Premises ID', m.destination_premises_id],
        ['Brand', join(m.brand, m.brand_location), 'Purpose', purposeLabel(m.purpose)],
      ],
    },
    {
      title: `Livestock - ${head} head`,
      head: ['Class', 'Head', 'Sex', 'Colour', 'Avg lb', 'Brand', 'Tag numbers'],
      align: ['left', 'right', 'left', 'left', 'right', 'left', 'left'],
      rows: [
        ...m.lines.map((l): Cell[] => [l.animal_class, l.head, l.sex, l.colour, l.avg_weight_lb == null ? null : Number(l.avg_weight_lb), l.brand, l.tag_range]),
        ...Array.from({ length: blanks }, (): Cell[] => ['', '', '', '', '', '', '']),
      ],
      foot: ['Total', head || '', '', '', '', '', ''],
      minRowHeight: 17,
    },
    {
      title: 'Hauled by',
      note: m.notes ? `Notes: ${m.notes}` : undefined,
      head: ['Transporter', 'Driver', 'Licence plate', 'Phone'],
      rows: [[m.transporter_name, m.driver_name, m.licence_plate, m.transporter_phone]],
    },
    {
      title: 'Declaration',
      note: DECLARATION,
      head: ['Owner or agent', 'Date', 'Driver'],
      rows: [[m.signed_by, m.signed_on, '']],
      // Room to sign above the rule, as on the paper form.
      minRowHeight: 34,
    },
  ]
}

export const MANIFEST_CSV_COLUMNS = [
  { label: 'Manifest no.' },
  { label: 'Moved' },
  { label: 'Owner' },
  { label: 'From premises' },
  { label: 'From address' },
  { label: 'Brand' },
  { label: 'Destination' },
  { label: 'To premises' },
  { label: 'Purpose' },
  { label: 'Class' },
  { label: 'Head', decimals: 0 },
  { label: 'Sex' },
  { label: 'Colour' },
  { label: 'Avg lb', decimals: 0 },
  { label: 'Line brand' },
  { label: 'Tags' },
  { label: 'Transporter' },
  { label: 'Driver' },
  { label: 'Plate' },
  { label: 'Signed by' },
]

/** A row a line of livestock; a manifest with no lines still gets one row, so it is not lost. */
export function manifestCsvRows(list: ManifestWithLines[]): Cell[][] {
  return list.flatMap((m) => {
    const load: Cell[] = [m.manifest_no, m.moved_on, m.owner_name, m.origin_premises_id, m.origin_address, join(m.brand, m.brand_location), m.destination_name, m.destination_premises_id, purposeLabel(m.purpose)]
    const haul: Cell[] = [m.transporter_name, m.driver_name, m.licence_plate, m.signed_by]
    const lines = m.lines.length ? m.lines : [null]
    return lines.map((l): Cell[] => [...load, l?.animal_class ?? null, l?.head ?? null, l?.sex ?? null, l?.colour ?? null, l?.avg_weight_lb == null ? null : Number(l.avg_weight_lb), l?.brand ?? null, l?.tag_range ?? null, ...haul])
  })
}

export async function gatherManifests(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  const one = pick(p, 'manifest')
  const from = p.from || `${ctx.today.slice(0, 4)}-01-01`
  const to = p.to || ctx.today
  if (!one && from > to) throw new Error('The start date is after the end date.')
  const manifests = await fetchAll<Omit<ManifestWithLines, 'lines'>>((a, b) => {
    let q = supabase.from('cattle_manifests').select('*')
    q = one ? q.eq('id', one) : q.gte('moved_on', from).lte('moved_on', to)
    return q.order('moved_on').order('id').range(a, b)
  })
  if (!manifests.length) throw new Error(one ? 'That manifest is not there any more.' : `No manifests between ${longDate(from)} and ${longDate(to)}.`)
  const lines = await fetchAll<ManifestWithLines['lines'][number]>((a, b) =>
    supabase.from('cattle_manifest_lines').select('*').in('manifest_id', manifests.map((m) => m.id)).order('manifest_id').order('sort_order').order('id').range(a, b),
  )
  const list: ManifestWithLines[] = manifests.map((m) => ({ ...m, lines: lines.filter((l) => l.manifest_id === m.id).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0)) }))

  const single = list.length === 1 ? list[0] : null
  const subtitle = single ? join(single.owner_name, single.destination_name) || longDate(single.moved_on) : `${longDate(from)} to ${longDate(to)}`
  const filename = single ? `Manifest ${single.manifest_no ?? ''} ${single.moved_on ?? ''}`.replace(/\s+/g, ' ').trim() : `Manifests ${from} to ${to}`
  const meta: [string, Cell][] = single
    ? [
        ['Manifest no.', single.manifest_no ?? 'not entered'],
        ['Date moved', single.moved_on],
        ['Head', totalHead(single.lines)],
        ['Purpose', purposeLabel(single.purpose)],
      ]
    : [
        ['Manifests', list.length],
        ['Head', list.reduce((n, m) => n + totalHead(m.lines), 0)],
        ['First', list[0].moved_on],
        ['Last', list.at(-1)!.moved_on],
      ]

  if (ctx.format === 'CSV') {
    const report: ReportData = { title: 'Livestock manifests', subtitle, meta, columns: MANIFEST_CSV_COLUMNS, groups: [{ title: '', rows: manifestCsvRows(list) }], filename }
    return report
  }
  return {
    title: single ? 'Livestock manifest' : 'Livestock manifests',
    subtitle,
    meta,
    orientation: 'portrait',
    sections: list.flatMap((m, i) => manifestSections(m, i === 0)),
    filename,
  }
}
