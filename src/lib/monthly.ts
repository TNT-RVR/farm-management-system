/**
 * Monthly jobs: the pure part (Sam, 24 Oct 2026).
 *
 * "A list of things that need to be done that typically happen during that
 * month." A job is due in a window of months; each time it comes due it has a
 * COPY (monthly_task_instances) and the copy is what gets ticked, skipped or
 * handed out. Next year's copy is a new row, so the month comes round fresh,
 * and this year's stays for the year report.
 *
 *   once in the window ('annual', and the old 'one_time')
 *                 one copy a year, keyed to the window's start month
 *   every month   ('multi_per_year') one copy per month in the window
 *
 * The database makes the copies (ensure_monthly_copies); this file decides
 * which list each one belongs on, so the Monthly page, the Monday meeting and
 * the agenda download all pick the same rows. No database here, so it tests.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export type Recurrence = 'annual' | 'multi_per_year' | 'one_time'
export type CopyState = 'todo' | 'done' | 'skipped'

export type JobLite = {
  id: string
  title: string
  start_month: number
  end_month: number
  recurrence: Recurrence
  active: boolean
  sort_order: number
}

export type CopyLite = {
  id: string
  template_id: string
  year: number
  month: number
  state: CopyState
  completed_by: string | null
  completed_at: string | null
}

/** A month as one number, so months compare and subtract across years. */
export const ym = (year: number, month: number) => year * 12 + (month - 1)
export const fromYm = (n: number) => ({ year: Math.floor(n / 12), month: (n % 12) + 1 })
export const ymOf = (d: Date) => ym(d.getFullYear(), d.getMonth() + 1)

export const everyMonth = (j: Pick<JobLite, 'recurrence'>) => j.recurrence === 'multi_per_year'

/** Is month m (1–12) inside start..end, wrapping Dec→Jan? */
export function inWindow(m: number, start: number, end: number): boolean {
  return start <= end ? m >= start && m <= end : m >= start || m <= end
}

/** Months in a job's window, counting both ends: Nov–Feb is 4. */
export const windowLength = (start: number, end: number) => ((end - start + 12) % 12) + 1

/** The months a copy is due over, as ym numbers, both ends included. */
export function windowOf(copy: Pick<CopyLite, 'year' | 'month'>, job: Pick<JobLite, 'recurrence' | 'start_month' | 'end_month'>): { start: number; end: number } {
  const start = ym(copy.year, copy.month)
  return { start, end: everyMonth(job) ? start : start + windowLength(job.start_month, job.end_month) - 1 }
}

/**
 * The copy key (year, month) a job is due under in a given month, or null when
 * the month is outside its window. Once-in-window jobs are keyed to the start
 * of the window, so January of a Nov–Feb job belongs to last November's copy.
 */
export function dueKey(job: Pick<JobLite, 'recurrence' | 'start_month' | 'end_month'>, year: number, month: number): { year: number; month: number } | null {
  if (!inWindow(month, job.start_month, job.end_month)) return null
  if (everyMonth(job)) return { year, month }
  return { year: month >= job.start_month ? year : year - 1, month: job.start_month }
}

/** "Oct", "Sep–Nov", or "Nov 2026–Feb 2027" when the window crosses New Year. */
export function windowLabel(copy: Pick<CopyLite, 'year' | 'month'>, job: Pick<JobLite, 'recurrence' | 'start_month' | 'end_month'>, withYear = false): string {
  const w = windowOf(copy, job)
  const a = fromYm(w.start)
  const b = fromYm(w.end)
  const one = (x: { year: number; month: number }) => `${MONTHS[x.month - 1]}${withYear ? ` ${x.year}` : ''}`
  if (w.start === w.end) return one(a)
  if (a.year !== b.year) return `${MONTHS[a.month - 1]} ${a.year}–${MONTHS[b.month - 1]} ${b.year}`
  return `${MONTHS[a.month - 1]}–${one(b)}`
}

/** A job's months as words: "Every month, Nov–Feb" / "Once, Sep–Nov". */
export function jobWhen(job: Pick<JobLite, 'recurrence' | 'start_month' | 'end_month'>): string {
  const span = job.start_month === job.end_month ? MONTHS[job.start_month - 1] : `${MONTHS[job.start_month - 1]}–${MONTHS[job.end_month - 1]}`
  return everyMonth(job) ? `Every month, ${span}` : job.start_month === job.end_month ? span : `Once, ${span}`
}

export type ListItem<C extends CopyLite, J extends JobLite> = { copy: C; job: J; start: number; end: number }

const byJob = <J extends JobLite>(a: { job: J }, b: { job: J }) => a.job.sort_order - b.job.sort_order || a.job.title.localeCompare(b.job.title)

/**
 * What goes on the To do list in month `now`.
 *
 *   leftovers   copies still to do whose window has ended — earliest first.
 *               A leftover goes when the job comes round again (a newer copy
 *               of it has started), which for a once-a-year job is the
 *               "everything resets 11 months later"; and never older than a
 *               year whatever happens.
 *   thisMonth   every copy due this month, done and skipped included — ticked
 *               work stays on the list, greyed, until the month passes
 *               (Sam: "doesn't remove it from the list").
 *   nextMonth   the same for next month, less what is already shown above
 *               (a Sep–Nov job is due in both).
 *
 * Copies of switched-off jobs are left out; their record stays for reports.
 */
export function monthlyLists<C extends CopyLite, J extends JobLite>(jobs: J[], copies: C[], now: number): { leftovers: ListItem<C, J>[]; thisMonth: ListItem<C, J>[]; nextMonth: ListItem<C, J>[] } {
  const jobOf = new Map(jobs.filter((j) => j.active).map((j) => [j.id, j]))
  const items: ListItem<C, J>[] = []
  for (const copy of copies) {
    const job = jobOf.get(copy.template_id)
    if (!job) continue
    items.push({ copy, job, ...windowOf(copy, job) })
  }
  // The latest start of each job's copies that has begun by now.
  const latestStart = new Map<string, number>()
  for (const i of items) if (i.start <= now) latestStart.set(i.job.id, Math.max(latestStart.get(i.job.id) ?? -Infinity, i.start))

  const leftovers = items
    .filter((i) => i.copy.state === 'todo' && i.end < now && i.start > now - 12 && (latestStart.get(i.job.id) ?? i.start) <= i.start)
    .sort((a, b) => a.start - b.start || byJob(a, b))
  const thisMonth = items.filter((i) => i.start <= now && i.end >= now).sort(byJob)
  const shown = new Set(thisMonth.map((i) => i.copy.id))
  const nextMonth = items.filter((i) => i.start <= now + 1 && i.end >= now + 1 && !shown.has(i.copy.id)).sort(byJob)
  return { leftovers, thisMonth, nextMonth }
}

/** Copies the meeting still has to deal with: leftovers, then this month's (and next month's) still to do. */
export function outstanding<C extends CopyLite, J extends JobLite>(lists: ReturnType<typeof monthlyLists<C, J>>, withNext: boolean): ListItem<C, J>[] {
  return [...lists.leftovers, ...lists.thisMonth.filter((i) => i.copy.state === 'todo'), ...(withNext ? lists.nextMonth.filter((i) => i.copy.state === 'todo') : [])]
}

/** Done and skipped copies of a year, grouped by the month they were due, newest month first. */
export function closedByMonth<C extends CopyLite, J extends JobLite>(jobs: J[], copies: C[], year: number): { year: number; month: number; items: ListItem<C, J>[] }[] {
  const jobOf = new Map(jobs.map((j) => [j.id, j]))
  const groups = new Map<number, ListItem<C, J>[]>()
  for (const copy of copies) {
    if (copy.year !== year || copy.state === 'todo') continue
    const job = jobOf.get(copy.template_id)
    if (!job) continue
    const k = ym(copy.year, copy.month)
    groups.set(k, [...(groups.get(k) ?? []), { copy, job, ...windowOf(copy, job) }])
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([k, items]) => ({ ...fromYm(k), items: items.sort(byJob) }))
}

/** A copy's result for the year report: missed once its window is over and it was never done or skipped. */
export function copyResult(copy: Pick<CopyLite, 'state'>, end: number, now: number): 'done' | 'skipped' | 'missed' | 'open' {
  if (copy.state === 'done') return 'done'
  if (copy.state === 'skipped') return 'skipped'
  return end < now ? 'missed' : 'open'
}

/** Who closed how many, most done first. Skips are counted apart: a skip is a decision, not the work. */
export function personCounts(copies: Pick<CopyLite, 'state' | 'completed_by'>[]): { userId: string; done: number; skipped: number }[] {
  const by = new Map<string, { userId: string; done: number; skipped: number }>()
  for (const c of copies) {
    if (c.state === 'todo' || !c.completed_by) continue
    const r = by.get(c.completed_by) ?? { userId: c.completed_by, done: 0, skipped: 0 }
    if (c.state === 'done') r.done++
    else r.skipped++
    by.set(c.completed_by, r)
  }
  return [...by.values()].sort((a, b) => b.done - a.done || b.skipped - a.skipped)
}

type TaskLite = { id: string; status: string; due_at: string | null; assignee_ids: string[]; source?: string | null; source_ref?: string | null }

/** The tasks handed out for each copy, by copy id. */
export function tasksByCopy<T extends TaskLite>(tasks: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of tasks) if (t.source === 'monthly' && t.source_ref) m.set(t.source_ref, [...(m.get(t.source_ref) ?? []), t])
  return m
}

/** Everyone on a copy's tasks, once each. */
export const assigneesOf = (tasks: TaskLite[] | undefined) => [...new Set((tasks ?? []).flatMap((t) => t.assignee_ids))]

/**
 * Open and overdue tasks per person, for the meeting's "Tasks by person". A
 * task with two people on it counts for both — it is on both their lists.
 */
export function taskLoad(tasks: TaskLite[], userIds: string[], now: Date): { userId: string; open: number; overdue: number }[] {
  const rows = new Map(userIds.map((id) => [id, { userId: id, open: 0, overdue: 0 }]))
  for (const t of tasks) {
    if (t.status !== 'open') continue
    const late = t.due_at != null && new Date(t.due_at) < now
    for (const id of t.assignee_ids) {
      const r = rows.get(id)
      if (!r) continue
      r.open++
      if (late) r.overdue++
    }
  }
  return [...rows.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue)
}
