import { supabase } from '@/lib/supabase'
import { copyResult, personCounts, windowLabel, windowOf, ymOf, type CopyLite, type JobLite } from '@/lib/monthly'
import { fetchAll, longDate, yearParam, type GatherContext, type ParamValues, type SectionedReport } from './framework'

/**
 * The monthly jobs' year (Sam, 24 Oct 2026: "we still can create a report on
 * what was completed for each year: stats on who completed the most, how many
 * each person completed"). Every job's copies due that year — done (who,
 * when), skipped (with the note), missed, or still open — then each person's
 * count, most first.
 */

type Copy = CopyLite & { skip_note: string | null }
type Job = JobLite

const RESULT = { done: 'Done', skipped: 'Skipped', missed: 'Missed', open: 'Still open' } as const

export function monthlyYearReport(jobs: Job[], copies: Copy[], names: Map<string, string>, year: number, now: number): SectionedReport {
  const jobOf = new Map(jobs.map((j) => [j.id, j]))
  const rows = copies
    .filter((c) => c.year === year && jobOf.has(c.template_id))
    .map((c) => {
      const job = jobOf.get(c.template_id)!
      const w = windowOf(c, job)
      return { c, job, start: w.start, result: copyResult(c, w.end, now) }
    })
    .sort((a, b) => a.job.sort_order - b.job.sort_order || a.job.title.localeCompare(b.job.title) || a.start - b.start)
  const count = (r: keyof typeof RESULT) => rows.filter((x) => x.result === r).length
  const who = (id: string | null) => (id ? (names.get(id) ?? 'Unknown') : null)
  const people = personCounts(rows.map((x) => x.c))
  const totalDone = count('done')
  return {
    title: `Monthly jobs ${year}`,
    subtitle: `Calendar year ${year}`,
    meta: [
      ['Jobs due', rows.length],
      ['Done', totalDone],
      ['Skipped', count('skipped')],
      ['Missed', count('missed')],
      ['Still open', count('open')],
    ],
    sections: [
      {
        title: 'Each job',
        head: ['Job', 'Due', 'Result', 'By', 'When', 'Note'],
        rows: rows.map((x) => [
          x.job.title,
          windowLabel(x.c, x.job, true),
          RESULT[x.result],
          x.result === 'done' || x.result === 'skipped' ? who(x.c.completed_by) : null,
          x.c.completed_at ? longDate(x.c.completed_at.slice(0, 10)) : null,
          x.result === 'skipped' ? x.c.skip_note : null,
        ]),
        empty: 'No monthly jobs were due this year.',
      },
      {
        title: 'Who did them',
        head: ['Person', 'Done', 'Skipped', 'Share of done'],
        rows: people.map((p) => [who(p.userId), p.done, p.skipped, totalDone ? `${Math.round((p.done / totalDone) * 100)}%` : null]),
        align: [undefined, 'right', 'right', 'right'],
        empty: 'Nothing done yet this year.',
      },
    ],
    filename: `monthly-jobs-${year}`,
  }
}

export async function gatherMonthlyJobsYear(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const year = yearParam(p, ctx)
  const [jobs, copies, users] = await Promise.all([
    fetchAll<Job>((a, b) => supabase.from('monthly_task_templates').select('id, title, start_month, end_month, recurrence, active, sort_order').order('id').range(a, b)),
    fetchAll<Copy>((a, b) =>
      supabase.from('monthly_task_instances').select('id, template_id, year, month, state, completed_by, completed_at, skip_note').eq('year', year).order('id').range(a, b),
    ),
    fetchAll<{ id: string; full_name: string | null }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
  ])
  if (!copies.length) throw new Error(`No monthly jobs were due in ${year}.`)
  return monthlyYearReport(jobs, copies, new Map(users.map((u) => [u.id, u.full_name ?? 'Unnamed'])), year, ymOf(new Date()))
}
