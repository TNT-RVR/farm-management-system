import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Json } from './database.types'

/**
 * Scale tickets: one delivered load each, summed into the contract.
 *
 * The contract's "delivered" figure follows from the tickets (a trigger keeps
 * it), so the ticket is the thing to get right. Units follow the crop: corn is
 * bushels at 56 lb, beans are pounds — and a contract written in cwt is still
 * pounds underneath.
 */
export type ScaleTicket = {
  id: string
  crop_year: number
  crop_id: string | null
  contract_id: string | null
  bin_id: string | null
  buyer: string | null
  ticket_no: string | null
  delivered_on: string
  gross_lb: number | null
  tare_lb: number | null
  net_lb: number | null
  moisture_pct: number | null
  dockage_pct: number | null
  protein_pct?: number | null
  net_units: number | null
  unit: string | null
  notes: string | null
  extracted: Json | null
  /** The farm load this ticket settles, matched on arrival. */
  bin_load_id?: string | null
  /** The plant's receipt number, where it is not the ticket's (Bunge). */
  receipt_no?: string | null
  grade?: string | null
  driver?: string | null
  truck?: string | null
  /** Net less the dockage (clean-out); null until the dockage is known. */
  clean_net_lb?: number | null
  created_at: string
}

export const LB_PER_BU: Record<string, number> = {
  corn: 56,
  wheat: 60,
  durum: 60,
  barley: 48,
  oats: 34,
  canola: 50,
  peas: 60,
  soybeans: 60,
}

/** Pounds per bushel for a crop, by name. Null for a crop sold by weight. */
export function lbPerBushel(cropName: string | null | undefined): number | null {
  const n = (cropName ?? '').toLowerCase()
  for (const [k, v] of Object.entries(LB_PER_BU)) if (n.includes(k)) return v
  return null
}

/**
 * What counts against the contract, in the crop's unit.
 *
 * The ticket's own settlement figure wins when it prints one in the crop's
 * unit — the buyer has already applied their shrink and dockage, and that is
 * the number the cheque is written on. Otherwise it is worked from the net
 * weight: pounds as they are, bushels at the crop's test weight.
 */
export function netInUnit(
  t: { net_lb: number | null; net_stated?: number | null; net_stated_unit?: string | null },
  unit: string,
  cropName: string | null | undefined,
): number | null {
  const u = unit === 'cwt' ? 'lbs' : unit
  if (t.net_stated != null && t.net_stated_unit) {
    if (u === 'bu' && t.net_stated_unit === 'bu') return t.net_stated
    if (u === 'lbs' && t.net_stated_unit === 'lb') return t.net_stated
    if (u === 'lbs' && t.net_stated_unit === 'cwt') return t.net_stated * 100
    if (u === 'lbs' && t.net_stated_unit === 'kg') return t.net_stated * 2.20462
    if (u === 'lbs' && t.net_stated_unit === 'tonne') return t.net_stated * 2204.62
  }
  if (t.net_lb == null) return null
  if (u === 'lbs') return t.net_lb
  if (u === 'bu') {
    const per = lbPerBushel(cropName)
    return per ? t.net_lb / per : null
  }
  return null
}

export function scaleTicketsQuery(cropYear: number) {
  return {
    queryKey: ['scale_tickets', cropYear],
    queryFn: async (): Promise<ScaleTicket[]> => {
      const { data, error } = await supabase
        .from('scale_tickets')
        .select('*')
        .eq('crop_year', cropYear)
        .order('delivered_on', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ScaleTicket[]
    },
  }
}

export function useScaleTickets(cropYear: number) {
  return useQuery(scaleTicketsQuery(cropYear))
}

export function useScaleTicketMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['scale_tickets'] })
    void qc.invalidateQueries({ queryKey: ['contracts'] })
    void qc.invalidateQueries({ queryKey: ['bin_contents'] })
    // The bins' contents are read under this key; the one above matched nothing.
    void qc.invalidateQueries({ queryKey: ['bin_contents_current'] })
    // A ticket settles a farm load, and the load's plant figure shows beside it.
    void qc.invalidateQueries({ queryKey: ['bin_loads'] })
  }
  const save = useMutation({
    mutationFn: async (
      v: Omit<ScaleTicket, 'id' | 'created_at' | 'clean_net_lb'> & {
        /** Draw this many of the crop's units out of the bin it came from. */
        drawBin?: { binId: string; units: number } | null
      },
    ) => {
      const { drawBin, ...row } = v
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('scale_tickets')
        .insert({ ...row, created_by: user?.id ?? null })
      if (error) throw error
      if (drawBin) {
        // The open row for this bin comes down by what left on the truck.
        const { data: open } = await supabase
          .from('bin_contents')
          .select('id, bushels')
          .eq('bin_id', drawBin.binId)
          .is('emptied_on', null)
          .order('filled_on', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (open?.bushels != null) {
          const left = Math.max(0, Number(open.bushels) - drawBin.units)
          const { error: e2 } = await supabase
            .from('bin_contents')
            .update({ bushels: left, ...(left === 0 ? { emptied_on: row.delivered_on } : {}) })
            .eq('id', open.id)
          if (e2) throw e2
        }
      }
    },
    onSuccess: invalidate,
  })
  /**
   * Correct a saved ticket (Sam, 7 Oct 2026). The contract's delivered
   * figure follows in the database; the bin it was drawn from does not —
   * that was a one-off subtraction from the bin's contents when it was saved.
   */
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Omit<ScaleTicket, 'id' | 'created_at' | 'clean_net_lb'>> }) => {
      // Untyped: the generated Update type lists only the columns the app
      // used to change, and a correction can touch any of them.
      const { error } = await (supabase as unknown as SupabaseClient).from('scale_tickets').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scale_tickets').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { save, update, remove }
}
