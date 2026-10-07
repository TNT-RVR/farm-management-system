import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Approved time off from the time-off calendar, one row per request. `ends_on` is exclusive. */
export type TimeOff = {
  uid: string
  who: string
  kind: string
  summary: string
  reason: string | null
  starts_on: string
  ends_on: string
  hours: number | null
}

export function timeOffQuery() {
  return {
    queryKey: ['time_off'],
    queryFn: async (): Promise<TimeOff[]> => {
      const { data, error } = await supabase.from('time_off').select('*').order('starts_on')
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, hours: r.hours == null ? null : Number(r.hours) })) as TimeOff[]
    },
    staleTime: 30 * 60_000,
  }
}

export function useTimeOff() {
  return useQuery(timeOffQuery())
}

/** Every calendar day a request covers, YYYY-MM-DD. */
export function daysOff(t: Pick<TimeOff, 'starts_on' | 'ends_on'>): string[] {
  const out: string[] = []
  const d = new Date(`${t.starts_on}T00:00:00`)
  const end = new Date(`${t.ends_on}T00:00:00`)
  for (let i = 0; i < 60 && d < end; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** "Doug Olsen off · 8 h · Dentist" */
export function timeOffLabel(t: TimeOff): string {
  const bits = [`${t.who} off`]
  if (t.hours != null && t.hours < 8) bits.push(`${t.hours} h`)
  if (t.kind && !/^paid time off$/i.test(t.kind)) bits.push(t.kind.toLowerCase())
  return bits.join(' · ')
}

export function useSyncTimeOff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/timeoff-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not read the time-off calendar')
      return body
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['time_off'] }),
  })
}

/**
 * Who is away in the week starting `monday` (YYYY-MM-DD), for the meeting.
 *
 * One line per person per request, with the days it covers inside the week:
 * "Mon–Tue", "Thu", "all week". A request that started last week and runs
 * into this one still counts, because they are still away.
 */
export type AwayThisWeek = { who: string; when: string; hours: number | null; reason: string | null; kind: string }

export function awayThisWeek(timeOff: TimeOff[], monday: string): AwayThisWeek[] {
  const week: string[] = []
  const d = new Date(`${monday}T00:00:00`)
  for (let i = 0; i < 7; i++) {
    week.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }
  const dayName = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-CA', { weekday: 'short' })
  const out: AwayThisWeek[] = []
  for (const t of timeOff) {
    const days = daysOff(t).filter((x) => week.includes(x))
    if (!days.length) continue
    const when =
      days.length >= 7
        ? 'all week'
        : days.length === 1
          ? dayName(days[0])
          : `${dayName(days[0])}–${dayName(days[days.length - 1])}`
    out.push({ who: t.who, when, hours: t.hours, reason: t.reason, kind: t.kind })
  }
  return out.sort((a, b) => a.who.localeCompare(b.who))
}
