import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { PastChoice, Verdict } from './rotation-advice'

/**
 * Why we chose what we chose.
 *
 * Sam, 28 Oct 2026: a recommendation can be answered yes or no with a reason
 * typed in, "and it logs that as information for the future to make it
 * smarter". The rows are read back two ways: beside the same crop-after-crop
 * pairing in the planner's advice, and as the farm's own reasoning in the
 * prompt the rotation advisor sends to Claude.
 */
export type RotationFeedback = {
  id: string
  field_id: string | null
  crop_year: number
  crop_id: string
  after_crop_id: string | null
  verdict: Verdict
  accepted: boolean
  reason: string | null
  created_at: string
}

export const ROTATION_FEEDBACK_KEY = ['rotation_feedback'] as const

export function useRotationFeedback() {
  return useQuery({
    queryKey: ROTATION_FEEDBACK_KEY,
    queryFn: async (): Promise<RotationFeedback[]> => {
      const { data, error } = await supabase
        .from('rotation_feedback')
        .select('id, field_id, crop_year, crop_id, after_crop_id, verdict, accepted, reason, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as RotationFeedback[]
    },
  })
}

export function useAddRotationFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      field_id: string | null
      crop_year: number
      crop_id: string
      after_crop_id: string | null
      verdict: Verdict
      accepted: boolean
      reason: string | null
    }) => {
      const { error } = await supabase.from('rotation_feedback').insert(v)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ROTATION_FEEDBACK_KEY }),
  })
}

/** What the planner hands the advice: one line a past answer. */
export function pastChoices(rows: RotationFeedback[]): PastChoice[] {
  return rows.map((r) => ({
    cropId: r.crop_id,
    afterCropId: r.after_crop_id,
    accepted: r.accepted,
    reason: r.reason,
    year: r.crop_year,
  }))
}

/**
 * The farm's own reasoning, as lines for a prompt. Newest first, trimmed to
 * what a prompt can carry.
 */
export function reasoningLines(
  rows: RotationFeedback[],
  nameOf: (id: string | null) => string,
  limit = 40,
): string[] {
  return rows
    .filter((r) => r.reason?.trim())
    .slice(0, limit)
    .map(
      (r) =>
        `${r.accepted ? 'Chose' : 'Turned down'} ${nameOf(r.crop_id)}${
          r.after_crop_id ? ` after ${nameOf(r.after_crop_id)}` : ''
        } for ${r.crop_year}: ${r.reason!.trim()}`,
    )
}
