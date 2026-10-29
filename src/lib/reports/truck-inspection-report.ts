import type { ReportSection, TableReport } from '@/lib/table-report'
import { INSPECTION_SECTIONS, progress, toFix, type Answer } from '@/lib/truck-inspection'
import type { Inspection } from '@/lib/truck-inspection-data'
import { longDate } from './framework'

const RESULT: Record<Answer, string> = { ok: 'OK', fix: 'NEEDS WORK', na: 'N/A' }

/**
 * One truck's inspection as a report (Sam, 21 Oct 2026: "Once complete it
 * builds a report for the inspection, including a checklist of what needs to
 * be done"): what needs work first, as a list to tick off; then every section
 * with its answers and note; then the sign-off with the signature. An
 * unfinished inspection prints as a draft.
 */
export function inspectionReport(
  i: Inspection,
  truck: { name: string; make: string | null; model: string | null },
  signature: { dataUrl: string; width: number; height: number } | null,
): TableReport & { filename: string } {
  const fix = toFix(i.answers, i.notes)
  const p = progress(i.answers)
  const signed = !!i.signed_at
  const sections: ReportSection[] = [
    {
      title: 'What needs to be done',
      head: ['Done', 'Item', 'Section', 'Note'],
      rows: fix.map((f) => ['', f.text, f.section, f.note ?? '']),
      // A line to tick on when it is fixed.
      answerColumns: [0],
      empty: 'Nothing needs work.',
      minRowHeight: 16,
    },
    ...INSPECTION_SECTIONS.map(
      (s): ReportSection => ({
        title: s.title,
        note: i.notes[s.key]?.trim() ? `Notes: ${i.notes[s.key]!.trim()}` : undefined,
        head: ['Item', 'Result'],
        rows: s.items.map((it) => [it.text, i.answers[it.key] ? RESULT[i.answers[it.key]!] : 'not checked']),
        align: ['left', 'center'],
      }),
    ),
    {
      title: 'Signed off',
      head: ['Signature', 'Inspected by', 'Date'],
      rows: [['', i.signer_name ?? '', i.signed_on ? longDate(i.signed_on) : '']],
      minRowHeight: 34,
      cellImages: signature ? [{ row: 0, col: 0, image: signature }] : undefined,
    },
  ]
  const day = i.signed_on ?? i.started_at.slice(0, 10)
  return {
    title: `Truck inspection: ${truck.name}`,
    subtitle: signed ? `Signed off ${longDate(i.signed_on)}` : `DRAFT, not signed off · started ${longDate(i.started_at.slice(0, 10))}`,
    meta: [
      ['Truck', truck.name],
      ['Make and model', [truck.make, truck.model].filter(Boolean).join(' ') || '—'],
      ['Items checked', `${p.done} of ${p.total}`],
      ['Need work', fix.length],
    ],
    lead: [
      'The yearly inspection, to the trip inspection in Alberta’s Commercial Driver’s Guide to Operation, Safety and Licensing (chapter 3), for a truck-tractor with air brakes and its trailer.',
    ],
    sections,
    orientation: 'portrait',
    filename: `Truck inspection ${truck.name} ${day}`,
  }
}
