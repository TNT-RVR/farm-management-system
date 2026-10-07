import type { SupabaseClient } from '@supabase/supabase-js'

// Cattle-side alerts (spec §9.5).
//
// The same confirmation discipline as the crop side: an anomaly is a pending
// row before it is a to-do, and only a second observation turns it into one.
// Grass moves slowly, so a single reading that says a paddock crossed a
// threshold is far more likely to be a thin cloud than a real change overnight.
//
// Two of these are transitions, not states, and that distinction is the whole
// design. "This paddock is ready" is true of half the ranch in June and is not
// worth telling anyone. "This paddock BECAME ready since you last looked" is a
// rotation decision. So each alert fires on the crossing and then goes quiet.

/** How far the forage runway may fall before it is a feed decision (§9.5). */
export const RUNWAY_WARNING_RATIO = 0.35

export type CattleAlertResult = { raised: number; cleared: number; detail: string }

type ReadinessRow = {
  pasture_id: string
  name: string
  readiness: string
  readiness_reason: string
  forage_index: number | string | null
  regrowth_per_day: number | string | null
  cattle_on_now: boolean | null
  days_since_look: number | null
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Whether a paddock's state is worth telling someone about right now.
 *
 * Returns the alert type, or null. Ordered by urgency: a paddock that is both
 * overgrazed and has cattle on it needs moving, and saying so twice in two
 * different alerts would halve the weight of each.
 */
export function cattleAlertFor(row: {
  readiness: string
  regrowthPerDay: number | null
  cattleOnNow: boolean
}): 'pasture_overgrazed' | 'regrowth_negative_while_stocked' | 'pasture_ready' | null {
  if (row.readiness === 'overgrazed') return 'pasture_overgrazed'
  // Going backwards WITH cattle on it is drought or overstocking (§9.5), and it
  // is the one that gets worse every day it is not acted on.
  if (row.cattleOnNow && row.regrowthPerDay != null && row.regrowthPerDay < -0.002) {
    return 'regrowth_negative_while_stocked'
  }
  // Only a paddock standing empty is worth flagging as ready; one with cattle
  // already on it is not a rotation decision.
  if (!row.cattleOnNow && (row.readiness === 'ready' || row.readiness === 'optimal')) {
    return 'pasture_ready'
  }
  return null
}

/** Plain words for the to-do, per §9.5. */
export function cattleAlertCopy(
  type: NonNullable<ReturnType<typeof cattleAlertFor>>,
  name: string,
  reason: string,
): { title: string; description: string } {
  switch (type) {
    case 'pasture_overgrazed':
      return {
        title: `Move cattle off ${name}`,
        description: `${reason}\n\nStanding forage is below the residual floor. Grazing past this point costs next year's growth as well as this year's, and the paddock needs rest rather than a shorter graze.`,
      }
    case 'regrowth_negative_while_stocked':
      return {
        title: `${name} is going backwards with cattle on it`,
        description: `${reason}\n\nThe forage trend has turned negative while the herd is still on this paddock — the cattle are taking more than it is growing. That is drought or overstocking, and it does not correct itself.`,
      }
    case 'pasture_ready':
      return {
        title: `${name} is ready to graze`,
        description: `${reason}\n\nWorth considering in the rotation. The ranked list on the Cattle page shows how it compares with the others and why.`,
      }
  }
}

/**
 * Raise, confirm and retire the cattle-side alerts.
 *
 * Mirrors the crop side deliberately: pending on first sight, confirmed and
 * turned into a to-do on the second, lapsed if it goes away. Grass changes over
 * weeks, so anything that appears and vanishes between two looks was weather.
 */
export async function runCattleAlerts(sb: SupabaseClient): Promise<CattleAlertResult> {
  const { data, error } = await sb.from('pasture_readiness_now').select('*')
  if (error) throw new Error(`reading readiness: ${error.message}`)

  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .eq('active', true)
    .in('role', ['owner', 'manager'])
    .limit(1)
    .maybeSingle()

  let raised = 0
  let cleared = 0
  const notes: string[] = []

  for (const r of (data ?? []) as ReadinessRow[]) {
    // A stale look cannot support a state change. Better to say nothing than to
    // move cattle on a fortnight-old reading.
    if ((r.days_since_look ?? 99) > 14) continue

    const type = cattleAlertFor({
      readiness: r.readiness,
      regrowthPerDay: num(r.regrowth_per_day),
      cattleOnNow: !!r.cattle_on_now,
    })

    for (const candidate of [
      'pasture_overgrazed',
      'regrowth_negative_while_stocked',
      'pasture_ready',
    ] as const) {
      const { data: open } = await sb
        .from('sat_alerts')
        .select('id, status, first_seen_on')
        .eq('subject_id', r.pasture_id)
        .eq('alert_type', candidate)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle()

      const today = new Date().toISOString().slice(0, 10)

      if (type === candidate) {
        if (!open) {
          await sb.from('sat_alerts').insert({
            subject_type: 'pasture',
            subject_id: r.pasture_id,
            alert_type: candidate,
            status: 'pending',
            first_seen_on: today,
            magnitude: num(r.forage_index) ?? 0,
            observed_ndvi: num(r.forage_index),
          })
        } else if (open.status === 'pending' && today > open.first_seen_on) {
          const copy = cattleAlertCopy(candidate, r.name, r.readiness_reason)
          let taskId: string | null = null
          if (mgr?.id) {
            const { data: task } = await sb
              .from('tasks')
              .insert({
                title: copy.title,
                description_md: copy.description,
                created_by: mgr.id,
                source: 'satellite',
                source_ref: r.pasture_id,
                crop_year: Number(today.slice(0, 4)),
              })
              .select('id')
              .single()
            taskId = (task?.id as string) ?? null
          }
          await sb
            .from('sat_alerts')
            .update({
              status: 'confirmed',
              confirmed_on: today,
              task_id: taskId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', open.id)
          raised++
          notes.push(`${r.name} ${candidate}`)
        }
      } else if (open?.status === 'pending') {
        await sb
          .from('sat_alerts')
          .update({ status: 'lapsed', updated_at: new Date().toISOString() })
          .eq('id', open.id)
        cleared++
      }
    }
  }

  return {
    raised,
    cleared,
    detail:
      `cattle alerts: ${raised} raised, ${cleared} lapsed` +
      (notes.length ? ` · ${notes.join('; ')}` : ''),
  }
}
