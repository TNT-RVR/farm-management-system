/**
 * Whether a field's watering is finished for the season — worked out rather
 * than ticked.
 *
 * `field_crop_seasons.irrigation_done_at` exists for one reason: to stop the
 * irrigation to-dos once the pivot is shut off and drained, because the water
 * balance cannot know that and goes on asking. It was a tick box on two
 * screens, and by the end of 2026 it was being used as a mute switch rather
 * than a record: twelve of sixteen fields were ticked on 31 Aug 2026 in one
 * sitting, and FieldNET then logged pivot passes on five of them — Whitfield as
 * late as 8 Oct, six weeks after the box said the season was over.
 *
 * Three rules, and all three are things the app already knows:
 *
 *  1. a pivot pass after the flag means the flag is wrong. Clear it, whoever
 *     set it. The to-dos come back, which is the right answer while the pivot
 *     is still going round;
 *  2. harvest recorded means watering is over. Nobody needs to be asked;
 *  3. past the crop's maturity with the pivot quiet for a week is as close to
 *     "shut off for the year" as the data gets. Set it, and say so — the note
 *     is what lets somebody disagree with it.
 *
 * A person can still mark it by hand, and nothing here overrules them except
 * rule 1, which is not an opinion but a pivot that ran.
 */

/** A pivot quiet this long past maturity is shut off for the year. */
export const QUIET_DAYS = 7

export type WateringFacts = {
  /** field_crop_seasons.irrigation_done_at, as a farm day or timestamp. */
  doneAt?: string | null
  doneSource?: 'person' | 'auto' | null
  /** field_season_progress.harvest_finished. */
  harvestFinished?: boolean
  /** field_season_outlook.maturity_on — the farm day the crop matured. */
  maturityOn?: string | null
  /** The farm day the newest FieldNET pass that applied water ended. */
  lastPassOn?: string | null
  /** Today, as a farm day. */
  today: string
}

export type WateringDecision =
  | { action: 'set'; note: string }
  | { action: 'clear'; note: string }
  | null

const day = (v: string | null | undefined): string | null => v?.slice(0, 10) || null

/** Whole days from a to b, both farm days. Negative when b is before a. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0
}

export function decideWateringDone(f: WateringFacts): WateringDecision {
  const today = day(f.today)
  if (!today) return null
  const doneOn = day(f.doneAt)
  const lastPass = day(f.lastPassOn)
  const matured = day(f.maturityOn)

  // 1. The pivot ran after the season was called finished. Harvest recorded
  //    is the one thing that outranks it: a pass logged after the combine
  //    went through is somebody flushing a line, not irrigating a crop.
  if (doneOn && lastPass && lastPass > doneOn && !f.harvestFinished) {
    return {
      action: 'clear',
      note: `A pivot pass on ${lastPass} came after the season was marked finished on ${doneOn}.`,
    }
  }

  if (doneOn) return null

  // 2. Harvest is recorded: there is nothing left to water.
  if (f.harvestFinished) return { action: 'set', note: 'Harvest is recorded as finished.' }

  // 3. Past maturity, and the pivot has been quiet for a week.
  if (matured && today > matured) {
    const quietFor = lastPass ? daysBetween(lastPass, today) : null
    if (quietFor == null) {
      return {
        action: 'set',
        note: `Past maturity on ${matured}; no pivot pass recorded this season.`,
      }
    }
    if (quietFor >= QUIET_DAYS) {
      return {
        action: 'set',
        note: `Past maturity on ${matured}; the pivot has not run since ${lastPass}.`,
      }
    }
  }

  return null
}
