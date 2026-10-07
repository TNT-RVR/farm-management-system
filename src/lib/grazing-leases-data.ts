import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import { fetchAll } from '@/lib/reports/framework'
import { prefillReturn, toDisposition, toStockReturn, type Disposition, type EventLike, type HerdLike, type PrefillSource, type StockReturn } from '@/lib/grazing-leases'

/**
 * Reading and saving the grazing leases and their stock returns. The loaders
 * are plain async functions so the Reports page's gather uses the very same
 * reads as the Grazing leases page.
 */

export async function loadDispositions(): Promise<Disposition[]> {
  const { data, error } = await supabase.from('grazing_dispositions').select('*').order('sort_order').order('disposition_no')
  if (error) throw error
  return (data ?? []).map((r) => toDisposition(r as unknown as Record<string, unknown>))
}

export const dispositionsQuery = () => ({ queryKey: ['grazing_dispositions'] as const, queryFn: loadDispositions })

export function useDispositions() {
  return useQuery(dispositionsQuery())
}

/** Every year's return for one lease, newest first. */
export async function loadReturns(dispositionId: string): Promise<StockReturn[]> {
  const { data, error } = await supabase.from('grazing_disposition_returns').select('*').eq('disposition_id', dispositionId).order('year', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => toStockReturn(r as unknown as Record<string, unknown>))
}

export function useStockReturns(dispositionId: string | null) {
  return useQuery({
    queryKey: ['grazing_disposition_returns', dispositionId],
    enabled: Boolean(dispositionId),
    queryFn: () => loadReturns(dispositionId!),
  })
}

/**
 * What the app knows that a blank return can start from: the ranch's Herd
 * tab, the grazing events on the lease's pastures (with the eShepherd mob
 * each came from), the ranch's calving month and brand, and the other leases.
 */
export async function loadPrefillSource(d: Disposition, year: number, others: Disposition[]): Promise<PrefillSource> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const ranch = d.ranch_id
  const [herd, events, plan, ranchRow, pastures] = await Promise.all([
    ranch
      ? fetchAll<HerdLike>((a, b) => supabase.from('herd_counts').select('class_name, head_count, avg_weight_lb, feed_class, graze_start, graze_end, sort_order').eq('ranch_id', ranch).order('sort_order').order('id').range(a, b))
      : Promise.resolve([] as HerdLike[]),
    d.pasture_ids.length
      ? fetchAll<Omit<EventLike, 'mob'> & { id: string; notes: string | null; eshepherd_activation_id: string | null }>((a, b) =>
          supabase
            .from('grazing_events')
            .select('id, pasture_id, head_count, avg_animal_weight_lb, turned_in_on, moved_out_on, notes, eshepherd_activation_id')
            .in('pasture_id', d.pasture_ids)
            .lte('turned_in_on', to)
            .or(`moved_out_on.is.null,moved_out_on.gte.${from}`)
            .order('turned_in_on')
            .order('id')
            .range(a, b),
        )
      : Promise.resolve([]),
    ranch ? supabase.from('feed_plans').select('calving_month').eq('ranch_id', ranch).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ranch ? supabase.from('ranches').select('brand, brand_location, owner_name').eq('id', ranch).maybeSingle() : Promise.resolve({ data: null, error: null }),
    d.pasture_ids.length ? supabase.from('pastures').select('id, name').in('id', d.pasture_ids) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ])
  if (plan.error) throw plan.error
  if (ranchRow.error) throw ranchRow.error
  if (pastures.error) throw pastures.error

  // The mob each event came from: the eShepherd activation, else the note the import leaves.
  const actIds = [...new Set(events.map((e) => e.eshepherd_activation_id).filter((x): x is string => !!x))]
  const mobs = new Map<string, string>()
  if (actIds.length) {
    const { data, error } = await supabase.from('eshepherd_activations').select('id, mob').in('id', actIds)
    if (error) throw error
    for (const a of data ?? []) mobs.set(a.id, a.mob)
  }
  const plan0 = plan.data as { calving_month: number | null } | null
  const r = ranchRow.data as { brand: string | null; brand_location: string | null; owner_name: string | null } | null
  return {
    herd,
    events: events.map((e) => ({
      pasture_id: e.pasture_id,
      head_count: e.head_count,
      avg_animal_weight_lb: e.avg_animal_weight_lb,
      turned_in_on: e.turned_in_on,
      moved_out_on: e.moved_out_on,
      mob: (e.eshepherd_activation_id && mobs.get(e.eshepherd_activation_id)) || e.notes?.replace(/^eShepherd · /, '') || null,
    })),
    pastureNames: new Map(((pastures.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
    calvingMonth: plan0?.calving_month ?? null,
    ranchBrand: r ? { brand: r.brand, location: r.brand_location, owner: r.owner_name } : null,
    others,
  }
}

export function usePrefillSource(d: Disposition | null, year: number, others: Disposition[]) {
  return useQuery({
    queryKey: ['grazing_lease_prefill', d?.id, d?.pasture_ids.join(','), year],
    enabled: Boolean(d),
    queryFn: () => loadPrefillSource(d!, year, others),
    staleTime: 60_000,
  })
}

/** The ranch's mapped pastures, to mark which lie inside a lease. */
export function useRanchPastures(ranchId: string | null) {
  return useQuery({
    queryKey: ['grazing_lease_pastures', ranchId],
    queryFn: async () => {
      let q = supabase.from('grazing_pastures').select('pasture_id, name, ranch_id').not('pasture_id', 'is', null)
      if (ranchId) q = q.eq('ranch_id', ranchId)
      const { data, error } = await q.order('sort_order')
      if (error) throw error
      const seen = new Set<string>()
      // grazing_pastures.pasture_id is in the database but not in the hand-kept types.
      return ((data ?? []) as unknown as { pasture_id: string; name: string }[]).filter((p) => !seen.has(p.pasture_id) && seen.add(p.pasture_id)).map((p) => ({ id: p.pasture_id, name: p.name }))
    },
  })
}

/**
 * One lease and year as the form shows it: the saved return, or a new one
 * filled from the app. For the report, which has no page state to start from.
 */
export async function loadStockReturnForm(dispositionId: string, year: number): Promise<{ disposition: Disposition; ret: StockReturn; saved: boolean; ranchName: string | null }> {
  const all = await loadDispositions()
  const d = all.find((x) => x.id === dispositionId)
  if (!d) throw new Error('That grazing lease is not there any more.')
  const [returns, ranch] = await Promise.all([
    loadReturns(d.id),
    d.ranch_id ? supabase.from('ranches').select('name').eq('id', d.ranch_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const ranchName = (ranch.data as { name: string } | null)?.name ?? null
  const saved = returns.find((r) => r.year === year)
  if (saved) return { disposition: d, ret: saved, saved: true, ranchName }
  const src = await loadPrefillSource(d, year, all)
  const p = prefillReturn(d, year, src)
  return { disposition: p.disposition, ret: p.ret, saved: false, ranchName }
}

/** Save the lease's details and the year's return together: the form is one page. */
export function useSaveStockReturn() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ disposition: d, ret, userId }: { disposition: Disposition; ret: StockReturn; userId: string | null }) => {
      const now = new Date().toISOString()
      const { error: de } = await supabase
        .from('grazing_dispositions')
        .update({
          holder_name: d.holder_name,
          holder_address: d.holder_address,
          expiry_date: d.expiry_date || null,
          key_land: d.key_land,
          billable_aum: d.billable_aum,
          capacity_aum: d.capacity_aum,
          return_to: d.return_to,
          return_phone: d.return_phone,
          return_fax: d.return_fax,
          pasture_unit: d.pasture_unit,
          pasture_ids: d.pasture_ids,
          other_lands: d.other_lands as unknown as Json,
          brands: d.brands as unknown as Json,
          calving_months: d.calving_months,
          signer_name: d.signer_name,
          phone: d.phone,
          email: d.email,
          notes: d.notes,
          updated_at: now,
        })
        .eq('id', d.id)
      if (de) throw de
      const { data, error } = await supabase
        .from('grazing_disposition_returns')
        .upsert(
          {
            disposition_id: d.id,
            year: ret.year,
            grazed: ret.grazed,
            livestock: ret.livestock as unknown as Json,
            weights: ret.weights as unknown as Json,
            owned: ret.owned,
            owned_explain: ret.owned_explain,
            hay_cut: ret.hay_cut,
            hay: ret.hay as unknown as Json,
            feed_supplied: ret.feed_supplied,
            feed: ret.feed as unknown as Json,
            other_fenced: ret.other_fenced,
            had_losses: ret.had_losses,
            losses: ret.losses as unknown as Json,
            declared: ret.declared,
            signed_on: ret.signed_on || null,
            status: ret.status,
            filed_on: ret.filed_on || null,
            prefilled: ret.prefilled as unknown as Json,
            notes: ret.notes,
            updated_at: now,
            updated_by: userId,
          },
          { onConflict: 'disposition_id,year' },
        )
        .select('*')
        .single()
      if (error) throw error
      return toStockReturn(data as unknown as Record<string, unknown>)
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['grazing_dispositions'] })
      void qc.invalidateQueries({ queryKey: ['grazing_disposition_returns', v.disposition.id] })
    },
  })
}

/** The standing facts the lease list edits; the rest are kept on the return worksheet. */
export type DispositionFields = Pick<
  Disposition,
  'disposition_no' | 'ranch_id' | 'holder_name' | 'expiry_date' | 'key_land' | 'billable_aum' | 'capacity_aum' | 'active' | 'notes'
>

/**
 * Add a lease, or correct one (Sam, 7 Oct 2026: leases were only picked
 * from a list, so a new or renewed one needed a migration). A new lease goes
 * to the end of the order.
 */
export function useSaveDisposition() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, fields, sortOrder }: { id?: string; fields: DispositionFields; sortOrder?: number }) => {
      const { error } = id
        ? await supabase
            .from('grazing_dispositions')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', id)
        : await supabase.from('grazing_dispositions').insert({ ...fields, sort_order: sortOrder ?? 0 })
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new Error(`There is already a lease numbered ${fields.disposition_no}.`)
        throw error
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['grazing_dispositions'] }),
  })
}

/** Delete a lease and every year's stock return filed for it (the returns cascade). */
export function useDeleteDisposition() {
  const qc = useQueryClient()
  return useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('grazing_dispositions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grazing_dispositions'] })
      void qc.invalidateQueries({ queryKey: ['grazing_disposition_returns'] })
    },
  })
}
