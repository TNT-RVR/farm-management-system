import type { SupabaseClient } from '@supabase/supabase-js'
import { harvestNudges, type NudgeField } from '../../src/lib/harvest-nudge.ts'
import { farmTz } from '../../src/lib/farm-context.ts'
import { MANAGER_ROLES } from '../functions/_jd.mts'

/**
 * Daily through harvest: ask whether a field whose scale has gone quiet is
 * off, carrying the date of the last load (src/lib/harvest-nudge.ts says why).
 *
 * De-duped on (source, source_ref) like the irrigation to-do, so a field is
 * asked about once and the question updates rather than multiplies. The
 * question retires itself the moment the field is marked finished — including
 * when the last load is marked at the scale, because that writes the finish
 * record through fn_bin_load_marks_harvest.
 */
export async function runHarvestNudges(
  sb: SupabaseClient,
): Promise<{ asked: number; retired: number }> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })
  const year = Number(today.slice(0, 4))

  const { data, error } = await sb
    .from('field_season_progress')
    .select('field_id, field_name, crop_name, acres, loads, last_load_on, harvest_finished, counts_for_harvest')
    .eq('crop_year', year)
  if (error) throw error

  const fields: NudgeField[] = (data ?? []).map((r) => ({
    fieldId: r.field_id as string,
    name: (r.field_name as string) ?? 'a field',
    cropName: (r.crop_name as string | null) ?? null,
    acres: r.acres == null ? null : Number(r.acres),
    loads: Number(r.loads ?? 0),
    lastLoadOn: (r.last_load_on as string | null) ?? null,
    harvestFinished: Boolean(r.harvest_finished),
    countsForHarvest: Boolean(r.counts_for_harvest),
  }))

  const { ask, retire } = harvestNudges(fields, today)

  // Auto-generated to-dos are attributed to an active manager: the pipeline
  // has no auth.uid(), and fn_audit needs somebody.
  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .in('role', MANAGER_ROLES)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  const managerId = (mgr?.id as string | undefined) ?? null

  const { data: open } = await sb
    .from('tasks')
    .select('id, source_ref')
    .eq('source', 'harvest_finish')
    .eq('status', 'open')
  const openByField = new Map<string, string>(
    (open ?? []).map((t) => [t.source_ref as string, t.id as string]),
  )

  let asked = 0
  for (const n of ask) {
    const existing = openByField.get(n.fieldId)
    if (existing) {
      await sb.from('tasks').update({ title: n.title, description_md: n.description }).eq('id', existing)
    } else if (managerId) {
      await sb.from('tasks').insert({
        title: n.title,
        description_md: n.description,
        field_id: n.fieldId,
        created_by: managerId,
        source: 'harvest_finish',
        source_ref: n.fieldId,
        crop_year: year,
      })
      asked++
    }
  }

  let retired = 0
  for (const fieldId of retire) {
    const existing = openByField.get(fieldId)
    if (!existing) continue
    await sb.from('tasks').delete().eq('id', existing)
    retired++
  }

  await sb.rpc('record_integration_heartbeat', {
    p_key: 'harvest_nudges',
    p_detail: `${ask.length} fields quiet at the scale, ${asked} asked, ${retired} retired`,
    p_data_at: null,
  })

  return { asked, retired }
}
