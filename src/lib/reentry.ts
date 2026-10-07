/**
 * Restricted entry intervals — when it is safe to walk back into a field.
 *
 * A label gives a number of hours after spraying during which nobody should be
 * in the crop without protective equipment. The app already knows what was
 * applied, to which field and when; the labels already carry the interval. This
 * joins them.
 *
 * The rule this file exists to enforce: an interval that is NOT KNOWN is never
 * reported as safe. Most products here have no label read yet, and a screen
 * that showed them as clear would be worse than no screen at all — it would be
 * a safety assurance nobody checked.
 */

import { rowsForCrop } from './cropLabelMatch'

export type AppliedEvent = {
  fieldId: string | null
  fieldName: string | null
  /** When the sprayer left the field. */
  appliedAt: string
  productName: string
  /**
   * The longest interval on the label, whatever activity it covers. Null where
   * no label has been read for this product.
   */
  reentryHours: number | null
  /**
   * The interval for ordinary field work — scouting, irrigation, equipment.
   * This is what the warnings run on. Null where the label has not been read
   * against the two-interval instruction yet, in which case the longest one is
   * used instead and the warning is merely early, never late.
   */
  reentryFieldHours?: number | null
  reentryNote?: string | null
  /**
   * The crop that was in the field, as John Deere records it — 'CARROTS',
   * 'CORN_WET'. Null where it is not known, which simply means the per-crop
   * intervals below cannot be used.
   */
  crop?: string | null
  /**
   * Per-crop intervals off the label, where it states them by crop. Lorox L
   * gives potatoes 4 days, carrots 8 days to scout and celery 10 — one number
   * for the product cannot hold that.
   */
  cropIntervals?: CropInterval[]
}

export type CropInterval = {
  /** The crop as the LABEL names it: 'Potatoes', 'Sweet Corn'. */
  crop: string
  reentryHours: number | null
  reentryFieldHours: number | null
}

export type ReentryState = 'restricted' | 'clear' | 'unknown'

export type ReentryStatus = {
  state: ReentryState
  /** When the interval ends. Null when it is not known. */
  clearAt: Date | null
  /** Hours still to run, rounded up. Zero once clear. */
  hoursLeft: number
}

/** How long after an application an event still counts as worth showing. */
export const RECENT_DAYS = 7

/**
 * Which of the two intervals governs.
 *
 * The field interval, whenever the label gave one — that is the whole point of
 * having two, and it is chosen by which activity it covers rather than by
 * being the smaller number. A label that sets six days for scouting and twelve
 * hours for everything else has a field interval of six days, and this returns
 * six days.
 *
 * Missing means fall back to the longest interval on the label. A label read
 * before this farm knew to ask the question has no field figure, and warning
 * for longer than necessary is the failure worth having.
 */
export function effectiveReentryHours(
  event: Pick<AppliedEvent, 'reentryHours' | 'reentryFieldHours' | 'crop' | 'cropIntervals'>,
): number | null {
  // A label that states the interval by crop is answering a more specific
  // question than the whole-label figure, so it wins where the crop is known
  // and matched. Where several rows match one crop, the longest of them: within
  // a crop, being cautious is free.
  const matched = rowsForCrop(event.crop, event.cropIntervals ?? [])
  if (matched.length) {
    const perCrop = matched
      .map((r) => r.reentryFieldHours ?? r.reentryHours)
      .filter((h): h is number => h != null)
    if (perCrop.length) return Math.max(...perCrop)
  }
  // No crop row, or none that says anything: the whole-label figure. Never
  // shorter, never null-because-unmatched — an unmatched crop is a reason to
  // wait longer, not a reason to stop asking.
  return event.reentryFieldHours ?? event.reentryHours
}

export function statusFor(
  event: Pick<
    AppliedEvent,
    'appliedAt' | 'reentryHours' | 'reentryFieldHours' | 'crop' | 'cropIntervals'
  >,
  now: Date = new Date(),
): ReentryStatus {
  const applied = new Date(event.appliedAt)
  if (Number.isNaN(applied.getTime()))
    return { state: 'unknown', clearAt: null, hoursLeft: 0 }

  // No label read means no answer, and no answer is not "clear". It stays
  // unknown for as long as it would plausibly still matter, then stops
  // shouting — a field sprayed a month ago is not a re-entry question.
  const hours = effectiveReentryHours(event)
  if (hours == null) {
    const daysSince = (now.getTime() - applied.getTime()) / 86_400_000
    return {
      state: daysSince <= RECENT_DAYS ? 'unknown' : 'clear',
      clearAt: null,
      hoursLeft: 0,
    }
  }

  const clearAt = new Date(applied.getTime() + hours * 3_600_000)
  const msLeft = clearAt.getTime() - now.getTime()
  return {
    state: msLeft > 0 ? 'restricted' : 'clear',
    clearAt,
    hoursLeft: msLeft > 0 ? Math.ceil(msLeft / 3_600_000) : 0,
  }
}

export type FieldReentry = {
  fieldId: string
  fieldName: string
  state: ReentryState
  /** The event driving the verdict — the one that clears last. */
  worst: AppliedEvent | null
  status: ReentryStatus
  /** Everything applied recently, newest first. */
  events: (AppliedEvent & { status: ReentryStatus })[]
}

/** Restricted beats unknown beats clear — the worst news wins. */
const RANK: Record<ReentryState, number> = { restricted: 2, unknown: 1, clear: 0 }

/**
 * The verdict for each field, from everything sprayed on it recently.
 *
 * A field takes the worst state of anything applied to it: two products with a
 * four-hour interval and one unread label is a field somebody has to think
 * about, not a field that is clear.
 */
export function byField(events: AppliedEvent[], now: Date = new Date()): FieldReentry[] {
  const cutoff = now.getTime() - RECENT_DAYS * 86_400_000
  const groups = new Map<string, FieldReentry>()

  for (const e of events) {
    if (!e.fieldId) continue
    const applied = new Date(e.appliedAt)
    if (Number.isNaN(applied.getTime()) || applied.getTime() < cutoff) continue

    const status = statusFor(e, now)
    const entry = groups.get(e.fieldId) ?? {
      fieldId: e.fieldId,
      fieldName: e.fieldName ?? 'Unnamed field',
      state: 'clear' as ReentryState,
      worst: null,
      status,
      events: [],
    }
    entry.events.push({ ...e, status })

    const better = RANK[status.state] > RANK[entry.state]
    // Within the same state, the one that clears last is the one that matters.
    const later =
      RANK[status.state] === RANK[entry.state] &&
      (status.clearAt?.getTime() ?? 0) > (entry.status.clearAt?.getTime() ?? 0)
    if (better || later || entry.worst == null) {
      if (better || later) {
        entry.state = status.state
        entry.status = status
        entry.worst = e
      } else if (entry.worst == null) {
        entry.worst = e
      }
    }
    groups.set(e.fieldId, entry)
  }

  for (const entry of groups.values())
    entry.events.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))

  return [...groups.values()].sort(
    (a, b) => RANK[b.state] - RANK[a.state] || a.fieldName.localeCompare(b.fieldName),
  )
}

/** "4 hours", "2 days 3 hours" — plain enough to read at a gate. */
export function describeWait(hours: number): string {
  if (hours <= 0) return 'clear'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return `${days} day${days === 1 ? '' : 's'}${rest ? ` ${rest} hour${rest === 1 ? '' : 's'}` : ''}`
}
