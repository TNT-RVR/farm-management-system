import type { ReportSection } from '@/lib/table-report'
import { formDate, missingAnswers, slashDate, stockReturnDue, type Disposition, type StockReturn } from '@/lib/grazing-leases'
import { pick, yearParam, type Cell, type GatherContext, type ParamValues, type SectionedReport } from './framework'

/**
 * The Stewardship Stock Return for one grazing lease and year, laid out in
 * the order of Alberta's form: the lease's header, where it goes, then the
 * ten numbered parts and the declaration. Answers print bold and anything
 * still blank prints as a line, so the PDF reads as a filled-in form to copy
 * from (or attach). The CSV is the same sections, blanks left blank.
 *
 * It is the farm's worksheet, not the government's form: no crest, and it
 * says so at the top.
 */

export const WORKSHEET_TITLE = 'Stewardship Stock Return - worksheet'
export const NOT_THE_FORM = "Mirrors Alberta's Stewardship Stock Return, filled from the farm's records. It is not the government form: copy the answers onto it, or attach this."
export const ANNUAL_NOTE = 'Completion and submission of this form annually is a requirement of your disposition.'
const DECLARATION =
  'I declare that the information on this return is complete and correct, and understand that making a false or fraudulent declaration is an offence.'
const COLLECTION_NOTICE =
  "The province collects this information under Alberta's Protection of Privacy Act and the Public Lands Administration Regulation (PLAR) to administer the disposition. Questions about the form go to the stock return client administration mailbox."
export const CLIENT_ADMIN_EMAIL = 'user-c6e1@gov.ab.ca'

/** Each table shows at least this many rows, the spare ones as lines to write on. */
export const SPARE_ROWS = 2

export type StockReturnForm = { disposition: Disposition; ret: StockReturn; ranchName?: string | null }

const yn = (v: boolean | null) => (v === true ? 'YES' : v === false ? 'NO' : '')
const n = (v: number | null | undefined): Cell => (v == null ? '' : v)
const lines = (s: string | null | undefined) => (s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

/** Rows to at least SPARE_ROWS, padded with blank ones. */
function padded(rows: Cell[][], width: number, min = SPARE_ROWS): Cell[][] {
  return [...rows, ...Array.from({ length: Math.max(0, min - rows.length) }, () => Array.from({ length: width }, () => '' as Cell))]
}

/** A draft's "check this" note for a section the app filled in. */
function checkNote(r: StockReturn, ...keys: string[]): string | undefined {
  if (r.status === 'filed') return undefined
  const hit = keys.map((k) => r.prefilled[k]).filter(Boolean)
  return hit.length ? `Filled ${[...new Set(hit)].join('; ')} - check before filing.` : undefined
}

const question = (title: string, q: string, answer: string, note?: string): ReportSection => ({
  title,
  note,
  head: ['Question', 'Answer'],
  rows: [[q, answer]],
  align: ['left', 'left'],
  answerColumns: [1],
})

export function stockReturnSections(f: StockReturnForm): ReportSection[] {
  const { disposition: d, ret: r } = f
  const ALL = (k: number) => Array.from({ length: k }, (_, i) => i)

  const header: ReportSection = {
    title: `Grazing disposition ${d.disposition_no}`,
    note: NOT_THE_FORM,
    head: ['Holder', '', 'Disposition', ''],
    align: ['left', 'left', 'left', 'left'],
    answerColumns: [1, 3],
    rows: [
      ['Year', String(r.year), 'Due date', formDate(stockReturnDue(r.year))],
      ['Name', d.holder_name ?? '', 'Disposition', d.disposition_no],
      ['Address', lines(d.holder_address).join(', '), 'Expiry date', slashDate(d.expiry_date)],
      // The left column runs out before the right one: nothing to fill there.
      [null, null, 'Key land', d.key_land ?? ''],
      [null, null, 'Billable AUM', n(d.billable_aum)],
      [null, null, 'Grazing capacity AUM', n(d.capacity_aum)],
    ],
  }
  const holderNote = checkNote(r, 'holder')
  if (holderNote) header.note = `${NOT_THE_FORM} ${holderNote}`

  const returnTo: ReportSection = {
    title: 'Return to',
    note: [ANNUAL_NOTE, checkNote(r, 'return_to')].filter(Boolean).join(' '),
    head: ['Office', ''],
    align: ['left', 'left'],
    answerColumns: [1],
    rows: [
      ['Address', lines(d.return_to).join(', ')],
      ['Phone', d.return_phone ?? ''],
      ['Fax', d.return_fax ?? ''],
    ],
  }

  const sections: ReportSection[] = [header, returnTo]

  sections.push(
    question('1. Livestock grazed', 'Did you graze livestock on the disposition this year?', yn(r.grazed), checkNote(r, 'grazed', 'livestock')),
    {
      title: '',
      head: ['Pasture unit', 'Livestock class', 'Count', 'Date in', 'Date out'],
      align: ['left', 'left', 'right', 'left', 'left'],
      answerColumns: ALL(5),
      rows: padded(
        r.livestock.map((x): Cell[] => [x.pasture_unit, x.livestock_class, n(x.count), slashDate(x.date_in), slashDate(x.date_out)]),
        5,
      ),
    },
    {
      title: '2. Livestock weight and type',
      note: checkNote(r, 'weights'),
      head: ['Livestock class', 'Weight', 'Unit'],
      align: ['left', 'right', 'left'],
      answerColumns: ALL(3),
      rows: padded(
        r.weights.map((x): Cell[] => [x.livestock_class, n(x.weight), x.weight == null ? '' : x.unit]),
        3,
      ),
    },
    {
      title: '3. Whose livestock',
      head: ['Question', 'Answer'],
      align: ['left', 'left'],
      answerColumns: [1],
      rows: [
        ['Was the disposition grazed solely with livestock you own, have financed, or that were approved?', yn(r.owned)],
        // The explanation is only asked for on a no.
        ['If no, explain', r.owned === true && !r.owned_explain ? null : (r.owned_explain ?? '')],
      ],
    },
    question('4. Calving', 'In which months were most calves born?', d.calving_months ?? '', checkNote(r, 'calving')),
    {
      title: '5. Registered brands',
      note: checkNote(r, 'brands'),
      head: ['Owner', 'Brand', 'Location', 'Livestock'],
      align: ['left', 'left', 'left', 'left'],
      answerColumns: ALL(4),
      rows: padded(
        d.brands.map((b): Cell[] => [b.owner, b.description, b.location, b.livestock]),
        4,
      ),
    },
    question('6. Hay', 'Did you cut hay on the disposition?', yn(r.hay_cut)),
    {
      title: '',
      head: ['Hay type', 'Weight', 'Area'],
      align: ['left', 'left', 'left'],
      answerColumns: ALL(3),
      rows: padded(
        r.hay.map((h): Cell[] => [h.hay_type, h.weight, h.area]),
        3,
        r.hay_cut === false ? 1 : SPARE_ROWS,
      ),
    },
    question('7. Additional feed', 'Did you supply additional feed?', yn(r.feed_supplied)),
    {
      title: '',
      head: ['Feed type', 'Total amount', 'Date from', 'Date to'],
      align: ['left', 'left', 'left', 'left'],
      answerColumns: ALL(4),
      rows: padded(
        r.feed.map((x): Cell[] => [x.feed_type, x.amount, slashDate(x.date_from), slashDate(x.date_to)]),
        4,
        r.feed_supplied === false ? 1 : SPARE_ROWS,
      ),
    },
    question('8. Other lands fenced with the disposition', 'Are other lands fenced together with the disposition?', yn(r.other_fenced)),
    {
      title: '',
      head: ['Land type', 'Acres', 'Quarter', 'Section', 'Township', 'Range', 'Meridian'],
      align: ['left', 'right', 'left', 'left', 'left', 'left', 'left'],
      answerColumns: ALL(7),
      rows: padded(
        r.other_fenced === false ? [] : d.other_lands.map((l): Cell[] => [l.land_type, l.acres == null ? '' : l.acres.toFixed(1), l.quarter, l.section, l.township, l.range, l.meridian]),
        7,
        r.other_fenced === false ? 1 : SPARE_ROWS,
      ),
    },
    question('9. Missing and/or dead livestock (optional)', 'Any livestock missing or dead on the disposition this year?', yn(r.had_losses)),
    {
      title: '',
      head: ['Livestock type', 'Loss type', 'Number'],
      align: ['left', 'left', 'right'],
      answerColumns: ALL(3),
      rows: padded(
        r.losses.map((x): Cell[] => [x.livestock_type, x.loss_type, n(x.number)]),
        3,
        r.had_losses === false ? 1 : SPARE_ROWS,
      ),
    },
    {
      title: '10. Declaration',
      note: [DECLARATION, checkNote(r, 'signer')].filter(Boolean).join(' '),
      head: ['Declaration and contact', ''],
      align: ['left', 'left'],
      answerColumns: [1],
      rows: [
        ['Declared', r.declared ? '[X] I agree' : ''],
        ['Phone', d.phone ?? ''],
        ['E-mail', d.email ?? ''],
      ],
    },
    {
      title: '',
      head: ['Signature of grazing disposition holder', 'Printed name', 'Date'],
      align: ['left', 'left', 'left'],
      answerColumns: [1, 2],
      rows: [['', d.signer_name ?? '', slashDate(r.signed_on)]],
      // Room to sign above the rule, as on the paper form.
      minRowHeight: 34,
    },
    {
      title: 'Collection of information',
      note: COLLECTION_NOTICE,
      head: ['Questions about this form', 'E-mail'],
      align: ['left', 'left'],
      rows: [['Stock return client administration', CLIENT_ADMIN_EMAIL]],
    },
  )
  return sections
}

/** The whole worksheet as the Reports page and the Grazing leases page download it. */
export function stockReturnReport(f: StockReturnForm): SectionedReport {
  const { disposition: d, ret: r } = f
  const missing = missingAnswers(d, r)
  return {
    title: WORKSHEET_TITLE,
    subtitle: `${d.disposition_no} · ${r.year} grazing year${f.ranchName ? ` · ${f.ranchName}` : ''}`,
    meta: [
      ['Disposition', d.disposition_no],
      ['Year', String(r.year)],
      ['Due', formDate(stockReturnDue(r.year))],
      ['Status', r.status === 'filed' ? (r.filed_on ? `Filed ${slashDate(r.filed_on)}` : 'Filed') : 'Draft'],
      ['Still to answer', r.status === 'filed' ? null : missing.length ? missing.length : 'Nothing'],
    ],
    lead: r.status === 'filed' || !missing.length ? undefined : [`Still to answer: ${missing.join(', ')}.`],
    orientation: 'portrait',
    sections: stockReturnSections(f),
    filename: `Stock return ${d.disposition_no} ${r.year}`,
  }
}

export async function gatherStockReturn(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const id = pick(p, 'disposition')
  if (!id) throw new Error('Pick a grazing lease.')
  const year = yearParam(p, ctx)
  // Loaded on demand: the page's data module brings React Query with it.
  const { loadStockReturnForm } = await import('@/lib/grazing-leases-data')
  const form = await loadStockReturnForm(id, year)
  return stockReturnReport(form)
}
