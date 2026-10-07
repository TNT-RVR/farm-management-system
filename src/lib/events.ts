/**
 * Conferences and trade shows worth the trip.
 *
 * The scoring here encodes what this operation actually is: irrigated row crop
 * in southern Alberta, cattle on two ranches, and leafcutter bees for alfalfa
 * seed pollination. That last one matters more than it looks — leafcutters are
 * a seed-production and pollination business with nothing in common with
 * honeybees, so an apiculture conference about hives, colonies and queens is a
 * near-miss rather than a hit, and is scored as one.
 */

export type EventStatus =
  | 'watching'
  | 'interested'
  | 'registered'
  | 'attending'
  | 'attended'
  | 'skipped'

export type FarmEvent = {
  id: string
  name: string
  organiser: string | null
  url: string | null
  starts_on: string | null
  ends_on: string | null
  registration_deadline: string | null
  early_bird_deadline: string | null
  venue: string | null
  city: string | null
  region: string | null
  country: string
  cost: number | null
  early_bird_cost: number | null
  currency: string
  cost_notes: string | null
  categories: string[]
  why_go: string | null
  relevance: number | null
  status: EventStatus
  travel_notes: string | null
  series_key?: string | null
  recurrence?: 'annual' | 'biennial' | 'none' | null
}

/** The categories the pull is allowed to use, so filters stay a closed set. */
export const EVENT_CATEGORIES = [
  'irrigation',
  'crop',
  'agronomy',
  'cattle',
  'leafcutter',
  'alfalfa-seed',
  'ag-tech',
  'equipment',
  'business',
  'soil',
  'potato',
  'pulse',
] as const

/**
 * Where the operation is, for judging how far a trip is.
 *
 * Southern Alberta. Anything in the province is a drive, the rest of the
 * prairies is a long drive, and everything else is a flight — which is the
 * distinction that actually decides whether a two-day show is worth it.
 */
export type Reach = 'local' | 'province' | 'prairies' | 'canada' | 'international'

const PRAIRIE_REGIONS = ['saskatchewan', 'manitoba', 'sk', 'mb']
/** The corner of Alberta the ranch farms in — an easy day trip. */
const LOCAL_CITIES = ['lethbridge', 'taber', 'east ranch', 'medicine hat', 'brooks', 'coaldale']

export function reachOf(e: Pick<FarmEvent, 'city' | 'region' | 'country'>): Reach {
  const city = (e.city ?? '').toLowerCase()
  const region = (e.region ?? '').toLowerCase()
  const country = (e.country ?? '').toLowerCase()
  if (country && country !== 'canada') return 'international'
  if (LOCAL_CITIES.some((c) => city.includes(c))) return 'local'
  if (region === 'alberta' || region === 'ab') return 'province'
  if (PRAIRIE_REGIONS.includes(region)) return 'prairies'
  return 'canada'
}

/**
 * How well an event fits, 0-100.
 *
 * Two halves: what it is about, and how far away it is. Subject carries most of
 * the weight — a genuinely relevant conference is worth flying to and a general
 * farm show down the road often is not — but distance breaks the many ties
 * among events that are all broadly about growing crops on the prairies.
 */
const SUBJECT_WEIGHT: Record<string, number> = {
  irrigation: 30,
  'alfalfa-seed': 30,
  leafcutter: 30,
  agronomy: 20,
  crop: 18,
  soil: 18,
  cattle: 18,
  potato: 15,
  pulse: 15,
  equipment: 12,
  'ag-tech': 12,
  business: 8,
}

const REACH_BONUS: Record<Reach, number> = {
  local: 25,
  province: 18,
  prairies: 10,
  canada: 4,
  international: 0,
}

export function scoreEvent(e: Pick<FarmEvent, 'categories' | 'city' | 'region' | 'country'>): number {
  // The best two subjects, not the sum of all of them. An event tagged with
  // eight categories is a general trade show, not eight times as relevant.
  const subjects = e.categories
    .map((c) => SUBJECT_WEIGHT[c] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 2)
  const subject = (subjects[0] ?? 0) + (subjects[1] ?? 0) * 0.5
  return Math.max(0, Math.min(100, Math.round(subject + REACH_BONUS[reachOf(e)])))
}

// ---------------------------------------------------------------------------
// Dates and deadlines

/** Days from today to an ISO date. Negative once it has passed. */
export function daysUntil(iso: string | null, today: Date = new Date()): number | null {
  if (!iso) return null
  const then = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((then.getTime() - start.getTime()) / 86_400_000)
}

export function isUpcoming(e: Pick<FarmEvent, 'starts_on' | 'ends_on'>, today = new Date()): boolean {
  // An event runs until its last day, so a three-day show is still "on" on day
  // two. With no end date the start date stands in for it.
  const last = e.ends_on ?? e.starts_on
  const days = daysUntil(last, today)
  return days == null ? false : days >= 0
}

export type DeadlineWarning = {
  kind: 'early_bird' | 'registration'
  on: string
  daysLeft: number
}

/**
 * The next deadline worth a nudge.
 *
 * Early bird first when both are live: it is the one that costs money to miss,
 * and it always falls first. Past deadlines are not warnings.
 */
export function nextDeadline(
  e: Pick<FarmEvent, 'early_bird_deadline' | 'registration_deadline'>,
  today = new Date(),
): DeadlineWarning | null {
  const candidates: DeadlineWarning[] = []
  const eb = daysUntil(e.early_bird_deadline, today)
  const reg = daysUntil(e.registration_deadline, today)
  if (e.early_bird_deadline && eb != null && eb >= 0)
    candidates.push({ kind: 'early_bird', on: e.early_bird_deadline, daysLeft: eb })
  if (e.registration_deadline && reg != null && reg >= 0)
    candidates.push({ kind: 'registration', on: e.registration_deadline, daysLeft: reg })
  if (!candidates.length) return null
  return candidates.sort((a, b) => a.daysLeft - b.daysLeft)[0]
}

/** What you would pay today — the early-bird price only while it is still open. */
export function priceToday(e: FarmEvent, today = new Date()): number | null {
  const eb = daysUntil(e.early_bird_deadline, today)
  if (e.early_bird_cost != null && eb != null && eb >= 0) return e.early_bird_cost
  return e.cost
}

/** "14-16 Nov 2026", or "14 Nov 2026" for a one-day event. */
export function dateRange(e: Pick<FarmEvent, 'starts_on' | 'ends_on'>): string {
  if (!e.starts_on) return 'Dates to confirm'
  const fmt = (iso: string, withMonth = true, withYear = true) => {
    const d = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return iso
    const day = d.getDate()
    const month = d.toLocaleString('en-CA', { month: 'short' })
    return [String(day), withMonth ? month : null, withYear ? String(d.getFullYear()) : null]
      .filter(Boolean)
      .join(' ')
  }
  if (!e.ends_on || e.ends_on === e.starts_on) return fmt(e.starts_on)
  const sameMonth = e.starts_on.slice(0, 7) === e.ends_on.slice(0, 7)
  return `${fmt(e.starts_on, !sameMonth, false)}–${fmt(e.ends_on)}`
}

/** Upcoming events under one heading per month, soonest first. */
export function groupByMonth(events: FarmEvent[]): { month: string; events: FarmEvent[] }[] {
  const out = new Map<string, FarmEvent[]>()
  for (const e of [...events].sort((a, b) => (a.starts_on ?? '9999').localeCompare(b.starts_on ?? '9999'))) {
    const key = e.starts_on?.slice(0, 7) ?? 'unscheduled'
    const list = out.get(key) ?? []
    list.push(e)
    out.set(key, list)
  }
  return [...out.entries()].map(([month, list]) => ({ month, events: list }))
}

// ---------------------------------------------------------------------------
// Recurring events

/**
 * The key that ties every year's edition of one conference together.
 *
 * The year comes off the end, because that is the only part that changes:
 * "Alberta Beef Industry Conference 2026" and its 2027 edition are the same
 * event, and a list that shows both — one of them long over — is a list nobody
 * can plan from.
 */
export function seriesKeyFor(name: string): string {
  return name
    .replace(/\s*(19|20)\d{2}\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type NextEdition = {
  /** The edition to show. Null when nothing is dated at all. */
  event: FarmEvent | null
  /** Every edition of this series, newest first. */
  editions: FarmEvent[]
  /**
   * When the next one is expected, where no future edition is recorded yet.
   * Worked out from the most recent past edition, so it is a pattern rather
   * than a fact — the UI has to say so.
   */
  estimatedOn: string | null
  pastCount: number
}

const YEARS_PER: Record<string, number> = { annual: 1, biennial: 2, none: 0 }

/**
 * Project a past date forward until it lands in the future.
 *
 * Keeps the month and day and steps whole years, which is how these events
 * actually behave — AIDA is the first week of February whatever the year.
 */
export function projectForward(
  iso: string,
  step: number,
  today: Date = new Date(),
): string | null {
  if (step <= 0) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // Bounded: a date twenty years stale should give up rather than loop.
  for (let i = 0; i < 40; i++) {
    if (d.getTime() >= cutoff.getTime()) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    d.setFullYear(d.getFullYear() + step)
  }
  return null
}

/**
 * Which edition of a series to show, and when the next one is expected.
 *
 * The soonest edition that has not finished yet. Once it passes, the next one
 * takes its place on its own — and when none is recorded, the date is projected
 * from the last one so the event does not silently vanish off the list in the
 * months between the old page coming down and the new one going up.
 */
export function nextEdition(editions: FarmEvent[], today: Date = new Date()): NextEdition {
  const sorted = [...editions].sort((a, b) =>
    (b.starts_on ?? '').localeCompare(a.starts_on ?? ''),
  )
  const upcoming = sorted.filter((e) => isUpcoming(e, today))
  // Soonest first among those still to come.
  upcoming.sort((a, b) => (a.starts_on ?? '9999').localeCompare(b.starts_on ?? '9999'))

  const past = sorted.filter((e) => e.starts_on && !isUpcoming(e, today))
  const undated = sorted.filter((e) => !e.starts_on)

  if (upcoming.length) {
    return { event: upcoming[0], editions: sorted, estimatedOn: null, pastCount: past.length }
  }

  // Nothing upcoming. Project from the most recent edition that had a date.
  const latest = past[0]
  const step = YEARS_PER[latest?.recurrence ?? 'annual'] ?? 1
  const estimatedOn = latest?.starts_on ? projectForward(latest.starts_on, step, today) : null

  return {
    event: latest ?? undated[0] ?? null,
    editions: sorted,
    estimatedOn,
    pastCount: past.length,
  }
}

/** Fold a flat list of editions into one entry per conference. */
export function bySeries(events: FarmEvent[], today: Date = new Date()): NextEdition[] {
  const groups = new Map<string, FarmEvent[]>()
  for (const e of events) {
    const key = e.series_key ?? seriesKeyFor(e.name)
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  return [...groups.values()]
    .map((list) => nextEdition(list, today))
    .sort((a, b) => {
      // Whatever is happening soonest, whether it is confirmed or projected.
      const ad = a.event && isUpcoming(a.event, today) ? a.event.starts_on : a.estimatedOn
      const bd = b.event && isUpcoming(b.event, today) ? b.event.starts_on : b.estimatedOn
      return (ad ?? '9999').localeCompare(bd ?? '9999')
    })
}

/**
 * What belongs on a Monday agenda.
 *
 * Two lists, split by whether a decision is needed now or later.
 *
 * "This month" is anything the meeting has to act on in the next few weeks —
 * an event happening, OR a registration deadline closing. Those were two
 * sections and it read as repetition, because a deadline IS the thing you act
 * on this month; whether the conference itself is in three weeks or in March
 * does not change that. Each row already carries its own deadline line, so one
 * list loses nothing.
 *
 * "Next six months" is the booking question, and needs the longer horizon:
 * travel for a February conference gets arranged in the autumn.
 */
export type MeetingItem = {
  series: NextEdition
  event: FarmEvent
  /** The date it happens, confirmed or projected. */
  on: string | null
  projected: boolean
  daysAway: number | null
  deadline: DeadlineWarning | null
  /** Why it is on the near list: it is happening, or its deadline is closing. */
  reason: 'happening' | 'deadline' | null
}

export type MeetingLists = {
  /** Happening, or with a deadline closing, inside `nearDays`. */
  soon: MeetingItem[]
  /** Further out than `nearDays` but inside `farDays`. Nothing to do yet. */
  later: MeetingItem[]
}

export function meetingItems(
  events: FarmEvent[],
  nearDays: number,
  farDays: number,
  today: Date = new Date(),
): MeetingLists {
  const soon: MeetingItem[] = []
  const later: MeetingItem[] = []

  for (const series of bySeries(events, today)) {
    const event = series.event
    if (!event || event.status === 'skipped') continue

    const on = series.estimatedOn ?? (isUpcoming(event, today) ? event.starts_on : null)
    const daysAway = daysUntil(on, today)
    const deadline = nextDeadline(event, today)

    const happeningSoon = daysAway != null && daysAway >= 0 && daysAway <= nearDays
    const deadlineSoon = deadline != null && deadline.daysLeft <= nearDays

    const item: MeetingItem = {
      series,
      event,
      on,
      projected: series.estimatedOn != null,
      daysAway,
      deadline,
      reason: happeningSoon ? 'happening' : deadlineSoon ? 'deadline' : null,
    }

    if (happeningSoon || deadlineSoon) soon.push(item)
    else if (daysAway != null && daysAway > nearDays && daysAway <= farDays) later.push(item)
  }

  // Sorted by whichever comes first — the event or its deadline — because that
  // is the order the decisions actually arrive in.
  const urgency = (i: MeetingItem) =>
    Math.min(
      i.daysAway != null && i.daysAway >= 0 ? i.daysAway : Number.POSITIVE_INFINITY,
      i.deadline ? i.deadline.daysLeft : Number.POSITIVE_INFINITY,
    )
  soon.sort((a, b) => urgency(a) - urgency(b))
  later.sort((a, b) => (a.daysAway ?? 0) - (b.daysAway ?? 0))
  return { soon, later }
}
