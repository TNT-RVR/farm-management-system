import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Monthly bale temperature and moisture checks (migration 20261007050000):
 * a couple of bales of each kind probed, every reading logged, the log printed
 * for the insurer after a hay fire. The tables are read through an untyped
 * handle and shaped into exact types here.
 */
const db = supabase as unknown as SupabaseClient

/**
 * Core temperature bands for stored hay, the extension-service rule of thumb
 * (Penn State, Alberta Agriculture): heating is normal for the first weeks;
 * past 52 °C it wants watching, past 66 °C it is close to firing, past 79 °C
 * there are likely hot spots and the fire department is the call — do not
 * pull bales apart, which lets air in.
 */
export const TEMP_BANDS = [
  { max: 52, level: 'ok', label: 'Normal' },
  { max: 66, level: 'watch', label: 'Watch — check again daily' },
  { max: 79, level: 'danger', label: 'Danger — check every few hours, keep off the stack' },
  { max: Infinity, level: 'fire', label: 'Fire risk — call the fire department' },
] as const

export type RiskLevel = 'ok' | 'watch' | 'danger' | 'fire'

export function tempRisk(c: number | null | undefined): (typeof TEMP_BANDS)[number] | null {
  if (c == null || !Number.isFinite(c)) return null
  return TEMP_BANDS.find((b) => c < b.max) ?? TEMP_BANDS[TEMP_BANDS.length - 1]
}

/** Safe-storage moisture by bale form: denser bales need drier hay. */
export const MOISTURE_LIMIT: Record<string, number> = { small_square: 20, round: 18, big_square: 16 }

export function moistureRisk(pct: number | null | undefined, form: string | null | undefined): { level: 'ok' | 'watch'; limit: number } | null {
  if (pct == null || !Number.isFinite(pct)) return null
  const limit = MOISTURE_LIMIT[form ?? ''] ?? 20
  return { level: pct > limit ? 'watch' : 'ok', limit }
}

/** The worse of the two, for one colour per reading. */
export function readingRisk(r: { temp_c: number | null; moisture_pct: number | null; bale_form: string | null }): RiskLevel {
  const t = tempRisk(r.temp_c)?.level ?? 'ok'
  const m = moistureRisk(r.moisture_pct, r.bale_form)?.level ?? 'ok'
  const order: RiskLevel[] = ['ok', 'watch', 'danger', 'fire']
  return order[Math.max(order.indexOf(t), order.indexOf(m))]
}

export const RISK_STYLE: Record<RiskLevel, string> = {
  ok: 'bg-green-100 text-green-800',
  watch: 'bg-amber-100 text-amber-800',
  danger: 'bg-orange-200 text-orange-900',
  fire: 'bg-red-600 text-white',
}

export const cToF = (c: number) => (c * 9) / 5 + 32
export const fToC = (f: number) => ((f - 32) * 5) / 9

/** A feed type's bale form, from how it is counted. */
export const formOf = (unit: string | null | undefined): string | null =>
  unit === 'round' ? 'round' : unit === 'big_square' ? 'big_square' : unit === 'small_square' || unit === 'square' ? 'small_square' : null

export type BaleFeed = { id: string; name: string; default_unit: string | null; category: string | null }
export type BaleReading = {
  id?: string
  feed_type_id: string | null
  feed_name: string | null
  bale_form: string | null
  stack: string | null
  bale_label: string | null
  temp_c: number | null
  moisture_pct: number | null
  probe_depth_in: number | null
  notes: string | null
  sort_order: number
}
export type BaleCheck = {
  id: string
  checked_on: string
  checked_by: string | null
  ranch_id: string | null
  location: string | null
  air_temp_c: number | null
  notes: string | null
  bale_check_readings: BaleReading[]
}

/** The feeds that come in bales: hay, green feed, straw and bedding. */
export function useBaleFeeds() {
  return useQuery({
    queryKey: ['bale_feeds'],
    queryFn: async (): Promise<BaleFeed[]> => {
      const { data, error } = await supabase.from('feed_types').select('id, name, default_unit, category, is_bedding, archived, sort_order').order('sort_order')
      if (error) throw error
      return ((data ?? []) as (BaleFeed & { is_bedding: boolean; archived: boolean })[]).filter(
        (f) => !f.archived && (f.is_bedding || ['hay', 'greenfeed', 'straw'].includes(f.category ?? '')),
      )
    },
  })
}

export function useBaleChecks(from: string, to: string) {
  return useQuery({
    queryKey: ['bale_checks', from, to],
    queryFn: async (): Promise<BaleCheck[]> => {
      const { data, error } = await db
        .from('bale_checks')
        .select('id, checked_on, checked_by, ranch_id, location, air_temp_c, notes, bale_check_readings(id, feed_type_id, feed_name, bale_form, stack, bale_label, temp_c, moisture_pct, probe_depth_in, notes, sort_order)')
        .gte('checked_on', from)
        .lte('checked_on', to)
        .order('checked_on', { ascending: false })
      if (error) throw error
      return ((data ?? []) as BaleCheck[]).map((c) => ({ ...c, bale_check_readings: [...c.bale_check_readings].sort((a, b) => a.sort_order - b.sort_order) }))
    },
  })
}

export function useSaveBaleCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c: { checked_on: string; ranch_id: string | null; location: string | null; air_temp_c: number | null; notes: string | null; readings: BaleReading[] }) => {
      const { data, error } = await db
        .from('bale_checks')
        .insert({ checked_on: c.checked_on, ranch_id: c.ranch_id, location: c.location, air_temp_c: c.air_temp_c, notes: c.notes })
        .select('id')
        .single()
      if (error) throw error
      const id = (data as { id: string }).id
      const rows = c.readings.map((r, i) => ({ ...r, id: undefined, check_id: id, sort_order: i }))
      if (rows.length) {
        const { error: rErr } = await db.from('bale_check_readings').insert(rows)
        if (rErr) {
          await db.from('bale_checks').delete().eq('id', id)
          throw rErr
        }
      }
      return id
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bale_checks'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeleteBaleCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('bale_checks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bale_checks'] }),
  })
}
