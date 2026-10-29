/**
 * Where a field is in the season, in one word.
 *
 * The Fields list used to carry two tick boxes, Hail and Done watering, and
 * both were wrong in the data by the end of 2026 (Sam, 29 Oct 2026):
 * twelve fields were ticked done watering in one sitting on 31 Aug and
 * FieldNET then recorded pivot passes on five of them, the last on 8 Oct.
 * A box that is ticked in bulk records when somebody got tired of the to-dos,
 * not when the pivot stopped.
 *
 * So the column states what the rest of the app already knows instead of
 * asking. Each state is a claim the app can defend, and `why` is the evidence
 * — shown on the chip's tooltip, so a state that looks wrong can be argued
 * with rather than just re-ticked.
 */

export type FieldStateKey = 'no-crop' | 'growing' | 'water-off' | 'harvesting' | 'off'

export type FieldState = {
  key: FieldStateKey
  label: string
  /** The evidence, as a sentence. Empty for a field with no crop. */
  why: string
}

export type FieldStateFacts = {
  /** This year's crop, if the field has one. */
  cropName?: string | null
  /** A person said the last of it is away (field_season_progress.harvest_finished). */
  harvestFinished?: boolean
  /** Somebody is at it: a Deere pass, a hand record, or grain over the scale. */
  harvestStarted?: boolean
  /** The newest load off the field this year, as a farm day. */
  lastLoadOn?: string | null
  /** field_crop_seasons.irrigation_done_at — null when still watering. */
  wateringDoneAt?: string | null
  /** Who decided it: a person ticked it, or the app worked it out. */
  wateringDoneSource?: 'person' | 'auto' | null
  /** Why, when the app decided it. */
  wateringDoneNote?: string | null
  /** The field is on the irrigation schedule at all. Dryland has no season row. */
  irrigated?: boolean
}

/** "21 Oct" — short enough for a chip, unambiguous in a list of dates. */
export function shortDay(day: string | null | undefined): string | null {
  if (!day) return null
  // A farm day ('2026-10-21'), not a timestamp: parsed as UTC noon so the
  // local zone cannot shift it to the day before.
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * The field's state, most finished first.
 *
 * Harvest outranks watering because a combined field is not still being
 * watered whatever the flag says, and "off" is the more useful thing to read.
 */
export function fieldState(f: FieldStateFacts): FieldState {
  if (!f.cropName) return { key: 'no-crop', label: 'No crop', why: '' }

  if (f.harvestFinished) {
    const on = shortDay(f.lastLoadOn)
    return {
      key: 'off',
      label: 'Off',
      why: on ? `Harvest recorded; last load ${on}.` : 'Harvest recorded as finished.',
    }
  }

  if (f.harvestStarted) {
    const on = shortDay(f.lastLoadOn)
    return {
      key: 'harvesting',
      label: 'Harvesting',
      why: on
        ? `Started, nothing says it is off. Last load ${on}.`
        : 'Started, nothing says it is off.',
    }
  }

  if (f.wateringDoneAt) {
    const on = shortDay(f.wateringDoneAt)
    const note = f.wateringDoneNote?.trim()
    const how = f.wateringDoneSource === 'auto' ? (note || 'Worked out by the app') : 'Marked finished'
    return { key: 'water-off', label: 'Water off', why: on ? `${how} ${on}.` : `${how}.` }
  }

  return {
    key: 'growing',
    label: 'Growing',
    why: f.irrigated ? 'Still on the irrigation schedule.' : 'In crop; not irrigated.',
  }
}

/** Tailwind classes per state: green for off, amber while the work is on. */
export const FIELD_STATE_CLASS: Record<FieldStateKey, string> = {
  'no-crop': 'bg-gray-50 text-gray-400',
  growing: 'bg-emerald-50 text-emerald-700',
  'water-off': 'bg-sky-50 text-sky-700',
  harvesting: 'bg-amber-100 text-amber-800',
  off: 'bg-gray-100 text-gray-700',
}

/* ── Hail ─────────────────────────────────────────────────────────────────── */

export type HailSummary = {
  count: number
  /** The worst assessed loss across the year's events, when any was assessed. */
  worstLossPct: number | null
  /** The acres that went with the worst loss. */
  worstAcres: number | null
  /** The first day it hailed, as a farm day. */
  firstOn: string | null
}

/**
 * The year's hail on one field, as the list shows it.
 *
 * A tick box could not say this: a field can hail twice (6-Kellers hailed on
 * 7 July and again on 11 August 2026), and the figure that matters is the
 * assessed loss, which arrives weeks later on an AFSC inspection.
 */
export function hailSummary(
  events: { event_date: string | null; loss_pct: number | null; acres: number | null }[],
): HailSummary | null {
  if (!events.length) return null
  let worst: { loss: number; acres: number | null } | null = null
  let firstOn: string | null = null
  for (const e of events) {
    const loss = e.loss_pct == null ? null : Number(e.loss_pct)
    if (loss != null && Number.isFinite(loss) && (!worst || loss > worst.loss)) {
      worst = { loss, acres: e.acres == null ? null : Number(e.acres) }
    }
    const day = e.event_date?.slice(0, 10) ?? null
    if (day && (!firstOn || day < firstOn)) firstOn = day
  }
  return {
    count: events.length,
    worstLossPct: worst?.loss ?? null,
    worstAcres: worst?.acres ?? null,
    firstOn,
  }
}

/** "17% on 125 ac", "2 × since 7 Jul", "7 Jul" — whichever is known. */
export function hailLabel(s: HailSummary): string {
  const parts: string[] = []
  if (s.count > 1) parts.push(`${s.count} ×`)
  if (s.worstLossPct != null) {
    parts.push(s.worstAcres != null ? `${Math.round(s.worstLossPct)}% on ${Math.round(s.worstAcres)} ac` : `${Math.round(s.worstLossPct)}%`)
  } else {
    const on = shortDay(s.firstOn)
    if (on) parts.push(on)
  }
  return parts.join(' · ') || 'Hail'
}
