import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { HailBand } from './hail-report'

export type HailInspection = {
  id: string
  inspection_number: string
  field_id: string | null
  match_confidence: 'exact' | 'section' | null
  land_location: string
  crop_label: string | null
  damage_date: string | null
  report_date: string | null
  loss_notice_date: string | null
  adjuster: string | null
  acres: number | null
  loss_pct: number | null
  bands: HailBand[] | null
  source: string | null
  status: 'pending' | 'applied' | 'rejected'
  applied_at: string | null
  created_at: string
}

export function hailInspectionsQuery() {
  return {
    queryKey: ['hail_inspections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hail_inspections')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as HailInspection[]
    },
  }
}

export function useHailInspections() {
  return useQuery(hailInspectionsQuery())
}

/** How many are waiting on somebody — for the badge on the fields page. */
export function usePendingHailCount() {
  return useQuery({
    queryKey: ['hail_inspections', 'pending'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('hail_inspections')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      if (error) throw error
      return count ?? 0
    },
  })
}

export function useHailInspectionActions() {
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['hail_inspections'] })
    // The field list reads hail events, and applying one creates it.
    void qc.invalidateQueries({ queryKey: ['field_hail_events'] })
  }

  const apply = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('fn_apply_hail_inspection', { p_id: id })
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('hail_inspections')
        .update({ status: 'rejected' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  /** Point a report at the right field when the legal description did not. */
  const setField = useMutation({
    mutationFn: async (v: { id: string; fieldId: string }) => {
      const { error } = await supabase
        .from('hail_inspections')
        .update({ field_id: v.fieldId, match_confidence: 'exact' })
        .eq('id', v.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { apply, reject, setField }
}

/** Send a PDF through the same path an emailed one takes. */
export async function uploadHailReport(file: File, who: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/hail-report-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'Content-Type': 'application/pdf',
      'x-uploaded-by': who,
    },
    body: file,
  })
  const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
  if (!res.ok) throw new Error(body.error ?? body.detail ?? `Upload failed (${res.status})`)
  return body as { detail: string; status: string; fieldName: string | null }
}
