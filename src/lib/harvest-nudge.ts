/**
 * "Is this field off?" — asked, instead of waited for.
 *
 * Marking a field finished is the one harvest record nothing can infer: the
 * combines are 2008–2012 CR9090s and report nothing, so where seeding fills
 * itself in from the Deere tractors, harvest does not. What happens instead
 * is that it gets batched: on 27 Oct 2026 five fields were marked finished in
 * one sitting, weeks after the last load came off some of them.
 *
 * A field with loads on it and none for a few days is almost certainly off.
 * So raise it as a to-do carrying the date of the last load, which makes
 * saying yes one tap and puts the finish on the right day. A blank form at
 * the end of the season is what produces a batch.
 *
 * The to-do is retired by itself once the field is marked finished — the
 * caller deletes it, the same way the irrigation to-do retires when it rains.
 */

/** Days of silence at the scale before the question is worth asking. */
export const QUIET_LOADS_DAYS = 3

export type NudgeField = {
  fieldId: string
  name: string
  cropName?: string | null
  acres?: number | null
  loads: number
  lastLoadOn: string | null
  harvestFinished: boolean
  countsForHarvest: boolean
}

export type Nudge = {
  fieldId: string
  title: string
  description: string
  /** The farm day to date the finish, offered in the to-do. */
  lastLoadOn: string
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0
}

/**
 * Which fields to ask about, and which open questions to retire.
 *
 * `today` is a farm day. A field is asked about once; the caller de-dupes on
 * (source, source_ref) exactly as the irrigation to-do does.
 */
export function harvestNudges(
  fields: NudgeField[],
  today: string,
): { ask: Nudge[]; retire: string[] } {
  const ask: Nudge[] = []
  const retire: string[] = []

  for (const f of fields) {
    // Finished, or never ours to finish: nothing to ask, and any standing
    // question is stale.
    if (f.harvestFinished || !f.countsForHarvest) {
      retire.push(f.fieldId)
      continue
    }
    // Nothing has crossed the scale, so there is no date to offer and no
    // reason to think it is done. The board is where those are picked up.
    if (!f.loads || !f.lastLoadOn) continue

    const quietFor = daysBetween(f.lastLoadOn.slice(0, 10), today)
    if (quietFor < QUIET_LOADS_DAYS) continue

    const acres = f.acres != null && f.acres > 0 ? `${Math.round(f.acres)} ac` : null
    ask.push({
      fieldId: f.fieldId,
      title: `Is ${f.name} off?`,
      description: [
        `${f.loads} load${f.loads === 1 ? '' : 's'} weighed off ${f.name}`,
        f.cropName ? ` (${f.cropName}${acres ? `, ${acres}` : ''})` : acres ? ` (${acres})` : '',
        `, and nothing since ${f.lastLoadOn.slice(0, 10)} — ${quietFor} days.`,
        '\n\nIf it is off, mark it finished on Seeding & harvest progress: the "Off',
        '" button there dates the finish the day of the last load, which is the date the',
        ' irrigation balance, the field yield and the AFSC production report all read.',
        '\n\nIf there is more to come, leave it; this asks again once the scale goes quiet.',
      ].join(''),
      lastLoadOn: f.lastLoadOn.slice(0, 10),
    })
  }

  return { ask, retire }
}
