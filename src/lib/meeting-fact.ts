import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { localDate } from './date-range'
import {
  FARM_FACTS,
  STOCK_PER_MONTH,
  candidatesForWeek,
  factForWeek,
  unusedForMonth,
  type FactTopic,
  type FarmFact,
} from './farm-facts'

/**
 * The fact for this week, chosen so it is never one that has been read out.
 *
 * "Never repeat" cannot be computed from a date — it is a fact about what the
 * whole crew has already heard, over years — so the choice is made in the
 * database and the client only says which facts would SUIT this month. The log
 * of what has been used lives in one small table.
 *
 * Everybody at the meeting therefore sees the same fact, it does not change
 * when the second person opens the page, and it does not change on Wednesday.
 *
 * The library is two lists joined: the reviewed one in the repo, and the ones
 * the top-up job has written since (meeting_facts). Never repeating means the
 * library is consumed, so something has to keep refilling it — see
 * netlify/shared/meeting-facts-core.ts.
 */
export type WeeklyFact =
  | { state: 'fact'; fact: FarmFact; offline: boolean }
  /** Every fact suiting this month has already been read out. */
  | { state: 'exhausted'; suitable: number }
  | { state: 'loading' }

type WrittenRow = {
  id: string
  topic: FactTopic
  title: string
  body: string
  so_what: string
  months: number[] | null
  source_url: string | null
}

const asFact = (r: WrittenRow): FarmFact => ({
  id: r.id,
  topic: r.topic,
  title: r.title,
  body: r.body,
  soWhat: r.so_what,
  months: r.months ?? [],
  sourceUrl: r.source_url ?? undefined,
  written: true,
})

/** The facts written since the app shipped. Retired ones are gone for good. */
export function writtenFactsQuery() {
  return {
    queryKey: ['meeting_facts', 'written'],
    queryFn: async (): Promise<FarmFact[]> => {
      const { data, error } = await supabase
        .from('meeting_facts')
        .select('id, topic, title, body, so_what, months, source_url')
        .is('retired_at', null)
      if (error) throw error
      return ((data ?? []) as unknown as WrittenRow[]).map(asFact)
    },
  }
}

/**
 * The whole library.
 *
 * The repo facts come first, so while the written ones are still loading — or
 * cannot be loaded at all — there is already a library to work from rather than
 * an empty screen.
 */
export function useFactLibrary(): { library: FarmFact[]; settled: boolean; fetching: boolean } {
  // A short staleness window, and re-read on every mount. The week's fact is
  // chosen from the WHOLE library in the database, so a browser holding a list
  // from ten minutes ago can be handed the id of a fact it has never seen —
  // which happens the moment somebody else's top-up lands.
  const { data, isLoading, isFetching } = useQuery({
    ...writtenFactsQuery(),
    staleTime: 60_000,
    refetchOnMount: 'always',
  })
  return { library: [...FARM_FACTS, ...(data ?? [])], settled: !isLoading, fetching: isFetching }
}

/** Every fact id that has ever been read out. */
export function useUsedFactIds() {
  return useQuery({
    queryKey: ['meeting_fact', 'used'],
    // Re-read on every mount. It is one small column, and it is the number the
    // screen shows and the top-up decides on — a cached copy taken in the
    // second between a fact being freed and the week being reassigned reports
    // the whole library as unread until it expires.
    staleTime: 60_000,
    refetchOnMount: 'always',
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('meeting_fact_log').select('fact_id')
      if (error) throw error
      return new Set((data ?? []).map((r) => (r as { fact_id: string }).fact_id))
    },
  })
}

function weekCandidates(weekOf: string, skipped: string[], library: FarmFact[]): FarmFact[] {
  const skip = new Set(skipped)
  return candidatesForWeek(localDate(weekOf), library).filter((f) => !skip.has(f.id))
}

function useAssignedFactId(weekOf: string, skipped: string[], library: FarmFact[], ready: boolean) {
  const candidates = weekCandidates(weekOf, skipped, library)
  return useQuery({
    // Skipped ids are in the key: a skip changes which candidates are offered,
    // so it has to be a different question rather than a stale answer. The
    // library size is in it too, because a top-up that lands mid-week adds
    // candidates this week could legitimately use.
    queryKey: ['meeting_fact', weekOf, skipped.join(','), library.length],
    // Waits for the written facts, so a month whose repo facts are all used up
    // does not flash "exhausted" before the rest of the library arrives.
    enabled: ready,
    // Minutes rather than never. The answer is stable by design — the week's
    // row is already written — so a refetch cannot change what anybody is
    // looking at, and `never` means a cached answer that is wrong for any
    // reason survives in a persisted cache until the library length changes.
    // That is exactly how a stale "every fact has been read out" ended up on
    // screen next to "16 left for September".
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('assign_meeting_fact', {
        p_week: weekOf,
        p_candidates: candidates.map((f) => f.id),
        p_reassign: false,
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
  })
}

export function useWeeklyFact(weekOf: string, skipped: string[] = []): WeeklyFact {
  const { library, settled, fetching } = useFactLibrary()
  const { data, isLoading, isError } = useAssignedFactId(weekOf, skipped, library, settled)

  // No network, or the log could not be read. A meeting still gets a fact that
  // suits the month — it just cannot promise this one is new, and the screen
  // says so rather than pretending.
  const fallback = (): WeeklyFact => {
    const f = factForWeek(localDate(weekOf), skipped.length, library)
    return f ? { state: 'fact', fact: f, offline: true } : { state: 'loading' }
  }

  if (isError) return fallback()
  if (isLoading || !settled) return { state: 'loading' }
  // Null is the real answer: every candidate has been read out.
  if (!data) return { state: 'exhausted', suitable: weekCandidates(weekOf, skipped, library).length }

  const fact = library.find((f) => f.id === data)
  if (fact) return { state: 'fact', fact, offline: false }
  // The week points at a fact this browser does not have — somebody else's
  // top-up wrote it since this library was read. Not exhaustion, and saying so
  // would be the most alarming possible way to report a stale cache.
  return fetching ? { state: 'loading' } : fallback()
}

/**
 * "Not this week" — hand the week to the next suitable fact.
 *
 * The skipped one goes back in the pool rather than being marked used, so
 * skipping costs nothing and it can come round again later.
 */
export function useSkipFact(weekOf: string) {
  const qc = useQueryClient()
  const { library } = useFactLibrary()
  return useMutation({
    mutationFn: async (skipped: string[]) => {
      const { data, error } = await supabase.rpc('assign_meeting_fact', {
        p_week: weekOf,
        p_candidates: weekCandidates(weekOf, skipped, library).map((f) => f.id),
        p_reassign: true,
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['meeting_fact'] }),
  })
}

/**
 * Drop a written fact for good.
 *
 * The answer to the one thing that is worse in a library that refills itself
 * than in one typed by hand: a fact that is wrong, being read out now. One
 * press takes it out of the pool permanently and frees the week, so the next
 * read shows a different one. Only applies to written facts — the reviewed
 * library is changed in a diff.
 */
export function useRetireFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('retire_meeting_fact', { p_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meeting_fact'] })
      void qc.invalidateQueries({ queryKey: ['meeting_facts'] })
    },
  })
}

export type FactStock = {
  /** Facts for this month that have not been read out. */
  left: number
  /** Unused facts in the whole library. */
  remaining: number
  total: number
  /** This month is running down and more should be written. */
  thin: boolean
}

/**
 * How much is left, for this month and altogether.
 *
 * The number that matters at a meeting is THIS MONTH'S, not the library's: the
 * seasons mean a February fact does nothing for a September Monday, so a
 * library of two hundred can still be empty on the day.
 */
export function useFactStock(weekOf: string): FactStock | undefined {
  const { library, settled } = useFactLibrary()
  const { data: used } = useUsedFactIds()
  if (!settled || !used) return undefined
  const month = localDate(weekOf).getMonth() + 1
  const left = unusedForMonth(library, used, month).length
  return {
    left,
    remaining: library.filter((f) => !used.has(f.id)).length,
    total: library.length,
    thin: left < STOCK_PER_MONTH,
  }
}

/**
 * Ask for more facts when this month is running thin.
 *
 * A backstop, not the normal path: the weekly cron is what usually keeps the
 * library ahead. This is what happens if that has quietly stopped — the meeting
 * page itself asks, weeks before the month could actually run out, and nobody
 * has to have noticed anything.
 *
 * A query rather than an effect so it de-duplicates across renders on its own,
 * and it never retries: a failed top-up is the cron's problem to fix next week,
 * not something to hammer at from a browser.
 */
export function useKeepStocked(weekOf: string, thin: boolean) {
  const month = weekOf.slice(0, 7)
  return useQuery({
    queryKey: ['meeting_facts', 'topup', month],
    enabled: thin,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      // A background function: it answers 202 at once and writes for the next
      // minute or two. Nothing here waits for it, because nothing needs it
      // today — the facts it writes are for weeks from now.
      // The function's own path rather than the /api/* rewrite: what makes it
      // asynchronous is the -background suffix on the function name, and that
      // is not something to route through a redirect and hope.
      const res = await fetch('/.netlify/functions/meeting-facts-topup-background', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      return res.ok || res.status === 202
    },
  })
}
