import type { Cell, TableReport } from '@/lib/table-report'
import { MILE_M, isCanolaCrop, ownerContact, whoseLabel, type CropCell, type QuarterOwner } from '@/lib/canola-isolation-core'

/**
 * The two reports a seed canola company asks for (Sam, 8 Oct 2026):
 *
 *   - Isolation: one field, the map of the mile around it, and every quarter
 *     section in that mile with what is planted on it now and the four years
 *     before, canola picked out.
 *   - Field history: the crops on fields we pick, year by year, for the
 *     company to judge whether canola can go on them.
 *
 * Built as TableReports, so the PDF and the CSV say the same thing.
 */

export type IsolationRow = {
  parcel: string
  label: string
  /** Our field's name when the quarter is ours, else null (a neighbour's). */
  ours: string | null
  isTheField: boolean
  /** Who has the quarter when it isn't ours: pasture, or a neighbour with the owner's contact. */
  owner?: QuarterOwner | null
  /** Newest first, matching `years`. */
  cells: CropCell[]
}

/**
 * Each owner in the mile once, with how to reach them and the quarters they
 * have, so the seed company can see who farms what. The field itself is
 * left out.
 */
export function neighboursOf(rows: IsolationRow[]): { name: string; kind: string; contact: QuarterOwner; quarters: string[] }[] {
  const out = new Map<string, { name: string; kinds: Set<string>; contact: QuarterOwner; quarters: string[] }>()
  for (const r of rows) {
    const name = r.owner?.owner_name?.trim()
    if (r.isTheField || !r.owner || !name) continue
    const k = name.toLowerCase()
    const e = out.get(k) ?? { name, kinds: new Set<string>(), contact: r.owner, quarters: [] }
    e.kinds.add(r.owner.kind === 'pasture' ? 'Pasture' : 'Cropland')
    // The first quarter with a phone or email speaks for the owner.
    if (!ownerContact(e.contact) && ownerContact(r.owner)) e.contact = r.owner
    e.quarters.push(r.label)
    out.set(k, e)
  }
  return [...out.values()]
    .map((e) => ({ name: e.name, kind: [...e.kinds].join(', '), contact: e.contact, quarters: e.quarters }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const yearHead = (y: number, thisYear: number) => (y === thisYear ? `${y} (now)` : String(y))

export function isolationReport(o: {
  farmName: string
  field: { name: string; legal: string | null; acres: number | null }
  year: number
  years: number[]
  distanceM: number
  company: string | null
  notes: string | null
  rows: IsolationRow[]
  map: { dataUrl: string; width: number; height: number } | null
  /** The field's last seed canola, from its whole record: "2025, Corteva Roundup Ready". */
  lastSeedCanola?: { year: number; label: string } | null
}): TableReport {
  const canolaNow = o.rows.filter((r) => !r.isTheField && isCanolaCrop(r.cells[0]?.crop))
  const unlabelled = o.rows.filter((r) => !r.isTheField && !r.cells[0]?.crop)
  const canolaRecent = o.rows.filter((r) => !r.isTheField && r.cells.slice(1).some((c) => isCanolaCrop(c.crop)))
  const miles = o.distanceM / MILE_M
  const dist = Math.abs(miles - 1) < 0.01 ? '1 mile' : `${Math.round(miles * 100) / 100} miles (${Math.round(o.distanceM)} m)`
  const cell = (c: CropCell | undefined): Cell => c?.crop ?? ''
  const ownerOf = (r: IsolationRow) => (!r.isTheField ? r.owner?.owner_name?.trim() : '') || ''
  const neighbours = neighboursOf(o.rows)
  return {
    title: `Canola isolation — ${o.field.name}`,
    subtitle: `${o.year} crop · every quarter section within ${dist} of the field's edge`,
    meta: [
      ['Field', o.field.name],
      ['Legal land', o.field.legal ?? ''],
      ['Acres', o.field.acres == null ? '' : Math.round(o.field.acres * 10) / 10],
      ['Isolation distance', `${dist} from the outer edge of the field`],
      ['Last seed canola on this field', o.lastSeedCanola ? `${o.lastSeedCanola.year}, ${o.lastSeedCanola.label}` : 'None on record'],
      ['Prepared for', o.company ?? ''],
      ['Quarters in the area', o.rows.length],
      [`Canola within ${dist}, ${o.year}`, canolaNow.length ? canolaNow.map((r) => `${r.label} (${[r.cells[0].crop, ownerOf(r)].filter(Boolean).join(', ')})`).join('; ') : 'None'],
      [`Canola in the last ${o.years.length - 1} years`, canolaRecent.length ? canolaRecent.map((r) => r.label).join('; ') : 'None'],
      ...(unlabelled.length ? ([['Not known for this year', unlabelled.map((r) => r.label).join('; ')]] as [string, Cell][]) : []),
      ...(o.notes ? ([['Notes', o.notes]] as [string, Cell][]) : []),
    ],
    image: o.map ?? undefined,
    lead: o.map ? ['Red: the field. Dashed white: the isolation line. Quarters: yellow canola, green ours, lime pasture, blue a neighbour’s, grey not known.'] : undefined,
    sections: [
      {
        title: 'Quarter sections within the isolation distance',
        head: ['Quarter', 'Whose', ...o.years.map((y) => yearHead(y, o.year)), 'Notes'],
        rows: o.rows.map((r) => [
          r.label,
          r.isTheField ? `This field (${r.ours})` : whoseLabel(r),
          ...r.cells.map(cell),
          r.cells.map((c, k) => (c.notes ? `${o.years[k]}: ${c.notes}` : '')).filter(Boolean).join(' · '),
        ]),
      },
      ...(neighbours.length
        ? [
            {
              title: 'Neighbours within the isolation distance',
              head: ['Owner', 'Land', 'Phone', 'Email', 'Quarters'],
              rows: neighbours.map((n) => [n.name, n.kind, n.contact.phone?.trim() ?? '', n.contact.email?.trim() ?? '', n.quarters.join('; ')] as Cell[]),
            },
          ]
        : []),
    ],
    orientation: 'landscape',
  }
}

export type HistoryField = {
  name: string
  legal: string | null
  acres: number | null
  /** The field's last seed canola from its whole record, not only the years shown. */
  lastSeedCanola: { year: number; label: string } | null
  years: { year: number; crop: string | null; variety: string | null; yield: string | null; acres: number | null; from: 'history' | 'plan' | null }[]
}

export function fieldHistoryReport(o: { company: string | null; notes: string | null; fromYear: number; toYear: number; fields: HistoryField[] }): TableReport {
  return {
    title: 'Field crop history',
    subtitle: `${o.fields.length} field${o.fields.length === 1 ? '' : 's'} · ${o.fromYear}–${o.toYear}`,
    meta: [
      ['Prepared for', o.company ?? ''],
      ['Years', `${o.fromYear}–${o.toYear}`],
      ...o.fields.map((f) => [`${f.name}: last seed canola`, f.lastSeedCanola ? `${f.lastSeedCanola.year}, ${f.lastSeedCanola.label}` : 'None on record'] as [string, Cell]),
      ...(o.notes ? ([['Notes', o.notes]] as [string, Cell][]) : []),
    ],
    sections: o.fields.map((f) => ({
      title: `${f.name}${f.legal ? ` · ${f.legal}` : ''}${f.acres != null ? ` · ${Math.round(f.acres * 10) / 10} ac` : ''}`,
      note: `Last seed canola: ${f.lastSeedCanola ? `${f.lastSeedCanola.year}, ${f.lastSeedCanola.label}` : 'none on record'}`,
      head: ['Year', 'Crop', 'Variety', 'Acres', 'Yield', 'From'],
      // The year as text: the PDF groups numbers, and 2023 would print "2,023".
      rows: f.years.map((y) => [String(y.year), y.crop ?? 'Not recorded', y.variety ?? '', y.acres == null ? '' : Math.round(y.acres * 10) / 10, y.yield ?? '', y.from === 'plan' ? 'Crop plan' : y.from === 'history' ? 'Crop history' : '']),
    })),
  }
}
