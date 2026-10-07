import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * A paddock as a traffic light: can the cows go on it?
 *
 * Red, yellow, green off three things the farm already tracks — the
 * satellite's forage index, the rest since the last move-out against the
 * paddock's minimum, and whether cattle are on it now — plus whether it has
 * been grazed at all this season, which is what makes an untouched paddock
 * green even without a rest count.
 */
export type Light = 'red' | 'yellow' | 'green' | 'grey'

export type ReadinessRow = {
  pasture_id: string
  name: string
  readiness: 'overgrazed' | 'not_ready' | 'ready' | 'optimal' | 'overmature' | null
  readiness_reason: string | null
  forage_index: number | null
  days_rested: number | null
  min_rest_days: number | null
  cattle_on_now: boolean | null
  days_since_look: number | null
}

export const LIGHT_COLOUR: Record<Light, string> = {
  red: '#dc2626',
  yellow: '#f59e0b',
  green: '#16a34a',
  grey: '#9ca3af',
}

export const LIGHT_LABEL: Record<Light, string> = {
  red: 'Not now',
  yellow: 'Borderline',
  green: 'Good to graze',
  grey: 'No look yet',
}

export function trafficLight(
  row: ReadinessRow | undefined,
  grazedThisSeason: boolean,
): { light: Light; why: string } {
  if (!row || row.readiness == null) return { light: 'grey', why: 'No satellite look of this paddock yet.' }
  if (row.cattle_on_now) return { light: 'red', why: 'Cattle are on it now.' }
  if (row.readiness === 'overgrazed') return { light: 'red', why: 'Standing forage is below the residual floor.' }
  const rested = row.days_rested
  const min = row.min_rest_days ?? 0
  if (rested != null && rested < min) {
    return { light: 'red', why: `Only ${rested} days rested of ${min} needed.` }
  }
  const restNote = grazedThisSeason
    ? rested != null
      ? `${rested} days rested`
      : 'grazed this season'
    : 'not grazed yet this season'
  if (row.readiness === 'not_ready') {
    return { light: 'yellow', why: `Forage is thin (index ${row.forage_index?.toFixed(2) ?? '—'}) · ${restNote}.` }
  }
  if (row.readiness === 'overmature') {
    return { light: 'yellow', why: `Plenty of bulk but quality is falling · ${restNote}.` }
  }
  if ((row.days_since_look ?? 0) > 14) {
    return { light: 'yellow', why: `Looks ready, but the last satellite look is ${row.days_since_look} days old · ${restNote}.` }
  }
  return {
    light: 'green',
    why: `${row.readiness === 'optimal' ? 'Well fed and still growing' : 'Enough forage and adequately rested'} · ${restNote}.`,
  }
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** Every paddock's readiness, occupied ones included (the rotation order leaves those out). */
export function useReadinessNow() {
  return useQuery({
    queryKey: ['pasture-readiness-now'],
    queryFn: async (): Promise<ReadinessRow[]> => {
      const { data, error } = await supabase.from('pasture_readiness_now').select('*')
      if (error) throw error
      return (data ?? []).map((r) => {
        const x = r as Record<string, unknown>
        return {
          pasture_id: String(x.pasture_id),
          name: String(x.name),
          readiness: (x.readiness as ReadinessRow['readiness']) ?? null,
          readiness_reason: (x.readiness_reason as string) ?? null,
          forage_index: num(x.forage_index),
          days_rested: num(x.days_rested),
          min_rest_days: num(x.min_rest_days),
          cattle_on_now: Boolean(x.cattle_on_now),
          days_since_look: num(x.days_since_look),
        }
      })
    },
    staleTime: 10 * 60_000,
  })
}

/** Paddocks with a grazing event that started this calendar year. */
export function useGrazedThisSeason(year = new Date().getFullYear()) {
  return useQuery({
    queryKey: ['grazed-this-season', year],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('grazing_events')
        .select('pasture_id')
        .gte('turned_in_on', `${year}-01-01`)
      if (error) throw error
      return new Set((data ?? []).map((r) => r.pasture_id as string))
    },
    staleTime: 10 * 60_000,
  })
}
