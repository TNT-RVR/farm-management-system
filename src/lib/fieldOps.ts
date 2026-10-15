import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type FieldOperation = Database['public']['Tables']['jd_field_operations']['Row']

/** Deere's per-pass product record. A tank mix nests its carrier and components. */
export type OpRate = { value?: number; unitId?: string }
export type OpComponent = { name?: string; rate?: OpRate; productType?: string; guid?: string }
export type OpProduct = {
  name?: string
  tankMix?: boolean
  rate?: OpRate
  carrier?: OpComponent
  components?: OpComponent[]
}

/**
 * One pass's products with repeats folded together.
 *
 * When the mix is changed partway through a job, Deere lists the same named
 * mix again within the one record — Tator burn four times on Ray Daltons
 * in July 2025 — each with the whole job's area. Costed entry by entry, that
 * put four jobs' worth of Armory on one field. Entries with the same name are
 * one mix: their components are merged by product, at the average rate (Deere
 * does not say how much ground each variant covered).
 */
export function mergeMixEntries(products: OpProduct[]): OpProduct[] {
  const byName = new Map<string, OpProduct[]>()
  const order: string[] = []
  for (const p of products) {
    const k = (p.name ?? '').trim().toLowerCase()
    if (!byName.has(k)) {
      byName.set(k, [])
      order.push(k)
    }
    byName.get(k)!.push(p)
  }
  const avg = (rates: (OpRate | undefined)[]): OpRate | undefined => {
    const ok = rates.filter((r): r is OpRate => r?.value != null)
    if (!ok.length) return rates[0]
    const unit = ok[0].unitId
    const same = ok.filter((r) => r.unitId === unit)
    return { ...ok[0], value: same.reduce((a, r) => a + Number(r.value), 0) / same.length }
  }
  return order.map((k) => {
    const group = byName.get(k)!
    if (group.length === 1) return group[0]
    const comps = new Map<string, OpComponent[]>()
    for (const p of group)
      for (const c of p.components ?? []) {
        const ck = c.guid ?? (c.name ?? '').trim().toLowerCase()
        if (!comps.has(ck)) comps.set(ck, [])
        comps.get(ck)!.push(c)
      }
    const first = group[0]
    return {
      ...first,
      rate: avg(group.map((p) => p.rate)),
      carrier: first.carrier ? { ...first.carrier, rate: avg(group.map((p) => p.carrier?.rate)) } : undefined,
      components: [...comps.values()].map((cs) => ({ ...cs[0], rate: avg(cs.map((c) => c.rate)) })),
    }
  })
}

/**
 * The whole payload Deere returns for one pass.
 *
 * The columns on `jd_field_operations` are a flattened summary — they keep only
 * the first machine and its first operator, and they have nowhere to put seed
 * varieties or the tillage implement. `raw` has all of it, so the full history
 * reads from there rather than from the columns.
 */
export type OpOperator = { name?: string; operatorId?: string; guid?: string }
export type OpMachine = {
  /** Deere's own label for the machine — "Sprayer", "8R 250". */
  name?: string
  vin?: string
  machineId?: number
  erid?: string
  operators?: OpOperator[]
}
export type OpVariety = {
  name?: string
  brand?: string
  productType?: string
  productId?: string
}
export type OpTillage = { tillageType?: string; depth?: OpRate }
export type OpRaw = {
  id?: string
  fieldOperationType?: string
  cropSeason?: string | number
  startDate?: string
  endDate?: string
  modifiedTime?: string
  treatedCropName?: string
  cropName?: string
  adaptMachineType?: string
  products?: OpProduct[]
  varieties?: OpVariety[]
  tillageProducts?: OpTillage[]
  fieldOperationMachines?: OpMachine[]
}

/**
 * Deere's unit ids read like `gal1ac-1` (gallons per acre) and `ml1ac-1`.
 * Rendered as-is where unknown rather than guessed at — a mis-labelled rate on a
 * spray record is worse than an unfamiliar one.
 */
const UNIT_LABEL: Record<string, string> = {
  'gal1ac-1': 'gal/ac',
  'l1ac-1': 'L/ac',
  'ml1ac-1': 'mL/ac',
  'lb1ac-1': 'lb/ac',
  'kg1ac-1': 'kg/ac',
  'oz1ac-1': 'oz/ac',
  'g1ac-1': 'g/ac',
  'seeds1ac-1': 'seeds/ac',
  'bu1ac-1': 'bu/ac',
  gal: 'gal',
  l: 'L',
}
export const unitLabel = (id?: string) => (id ? (UNIT_LABEL[id] ?? id) : '')

/**
 * "2h 36m" — how long the machine was actually in the field.
 *
 * Null when there is nothing honest to report: no end time, or an end before the
 * start. Better blank than "0m", which reads as a pass that took no time.
 */
export function duration(start?: string, end?: string): string | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  // Days once it runs past two: Deere rolls several days of spraying into one
  // operation, and "312h 26m" is a number nobody converts in their head.
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}

/** How long a pass ran, in ms. 0 when there is nothing honest to measure. */
export function spanMs(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/**
 * Beyond this an "operation" is several days of spraying rolled into one
 * record, and any single weather reading covers a fraction of it.
 */
export const LONG_PASS_MS = 12 * 60 * 60 * 1000

export function formatRate(rate?: OpRate): string {
  if (!rate || rate.value == null) return '—'
  const v = rate.value.toLocaleString('en-CA', { maximumFractionDigits: 3 })
  return `${v} ${unitLabel(rate.unitId)}`.trim()
}

/** Completed work on one field, newest first. */
export function useFieldOperations(fieldId: string | null | undefined) {
  return useQuery({
    queryKey: ['jd_field_operations', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_field_operations')
        .select('*')
        .eq('field_id', fieldId!)
        .order('started_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/** Every field's work for one crop season, for the planned-vs-actual comparison. */
export function useSeasonOperations(season: number) {
  return useQuery({
    queryKey: ['jd_field_operations', 'season', season],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_field_operations')
        .select('*')
        .eq('crop_season', season)
      if (error) throw error
      return data
    },
  })
}

export function useSyncFieldOperations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/jd-operations-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? body.detail ?? 'Sync failed')
      return body as { operations: number; fields: number; detail: string }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
}

/**
 * Turn a pass away for good.
 *
 * The headstone is written first, with the reason, and the row deleted after:
 * the delete trigger lays a headstone of its own, but only this one carries
 * why. The sync reads the headstones and does not bring the pass back.
 */
export function useDismissOperation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { op: FieldOperation; reason: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const products = (v.op.products ?? []) as unknown as { name?: string }[]
      const summary = `${v.op.operation_type ?? 'operation'} ${(v.op.started_at ?? '').slice(0, 10)}${
        products[0]?.name ? ` · ${products[0].name}` : ''
      }`
      const { error } = await supabase.from('jd_dismissed_operations').upsert(
        { jd_id: v.op.jd_id, field_id: v.op.field_id, summary, reason: v.reason.trim() || null, dismissed_by: user?.id ?? null },
        { onConflict: 'jd_id' },
      )
      if (error) throw error
      const { error: e2 } = await supabase.from('jd_field_operations').delete().eq('id', v.op.id)
      if (e2) throw e2
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
}

/**
 * The passes on a field hidden as copies of another. Duplicates are invisible
 * to ordinary reads (RLS), so this is the only way to see them to undo one.
 */
export function useDuplicateOperations(fieldId: string | null | undefined) {
  return useQuery({
    queryKey: ['jd_field_operations', 'duplicates', fieldId],
    enabled: !!fieldId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('jd_duplicate_operations', { p_field: fieldId! })
      if (error) throw error
      return (data ?? []) as FieldOperation[]
    },
  })
}

/** Mark a pass as a copy of another (`of`), or say it is its own job (`of: null`). */
export function useSetDuplicate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; of: string | null }) => {
      const { error } = await supabase.rpc('jd_set_duplicate', { p_id: v.id, p_of: v.of as string })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
}

/** The acres a pass is costed on, set by hand; null goes back to Deere's. */
export function useSetCostAcres() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; acres: number | null }) => {
      const { error } = await supabase.from('jd_field_operations').update({ cost_acres_override: v.acres }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
}

/**
 * Ask for the sprayer's clock to be read now rather than on the next sync.
 *
 * A background function: Deere builds the per-point export for minutes, so
 * this returns at once and the sittings appear on the next load of the page.
 */
export function useReadSessions() {
  return useMutation({
    mutationFn: async (v: { jdId?: string; season?: number }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const q = new URLSearchParams()
      if (v.jdId) q.set('op', v.jdId)
      if (v.season) q.set('season', String(v.season))
      const res = await fetch(`/.netlify/functions/jd-op-sessions-background?${q}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok && res.status !== 202) throw new Error(`Could not start: ${res.status}`)
    },
  })
}
