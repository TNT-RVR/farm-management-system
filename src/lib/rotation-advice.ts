import {
  checkPlacement,
  preferenceFor,
  type CropInfo,
  type SuccessionMap,
  type SuccessionNotes,
  type Violation,
} from './rotation'

/**
 * What the app thinks of each crop on one field-year, in words.
 *
 * The planner used to say only "this breaks a rule" in red. Sam, 28 Oct
 * 2026: tick the crops you are weighing up and an info button says what it
 * makes of them, "as well as a recommended one they may not have selected".
 * So the same rules that colour a cell are also read out as a sentence each:
 * what follows what (the farm's own rotation sheet), the return interval, how
 * long since the field last carried it, and anything the label says.
 *
 * Pure: the view hands in the field's crop sets and the rules.
 */
export type Verdict = 'recommended' | 'possible' | 'caution' | 'no_go'

export type CropAdvice = {
  cropId: string
  name: string
  verdict: Verdict
  /** Plain sentences, strongest first. */
  reasons: string[]
  /** Seasons since the field last carried it; null if never in the years given. */
  sinceGrown: number | null
  violations: Violation[]
}

const VERDICT_RANK: Record<Verdict, number> = { recommended: 0, possible: 1, caution: 2, no_go: 3 }

/** How far back a field's own history is read for "it was here in 2024". */
const LOOK_BACK = 6

/** One past answer: a crop put forward, taken or turned down, and why. */
export type PastChoice = {
  cropId: string
  afterCropId: string | null
  accepted: boolean
  reason: string | null
  year: number
}

export type AdviceInput = {
  year: number
  /** year → the crops the field carried (a split field carries several). */
  cropSets: Map<number, Set<string>>
  crops: CropInfo[]
  cropMap: Map<string, CropInfo>
  succession: SuccessionMap
  notes?: SuccessionNotes
  /**
   * What the farm has said about these crops before (rotation_feedback). A
   * reason typed in last winter is not a rule, so it never blocks a crop and
   * never clears a rule that does: it moves a crop one step within what the
   * rules already allow, and says so in words.
   */
  past?: PastChoice[]
}

/** The crops on the field the year before, which the farm's sheet rates against. */
function previous(cropSets: Map<number, Set<string>>, year: number): string[] {
  return [...(cropSets.get(year - 1) ?? [])]
}

function lastGrown(
  cropSets: Map<number, Set<string>>,
  year: number,
  cropId: string,
): number | null {
  for (let back = 1; back <= LOOK_BACK; back++) {
    if (cropSets.get(year - back)?.has(cropId)) return back
  }
  return null
}

/** One crop, judged on this field-year. */
export function adviseCrop(cropId: string, input: AdviceInput): CropAdvice {
  const { year, cropSets, cropMap, succession, notes } = input
  const name = cropMap.get(cropId)?.name ?? 'This crop'
  const violations = checkPlacement(cropId, year, cropSets, cropMap, succession, notes)
  const blocking = violations.filter((v) => v.kind !== 'caution')
  const sinceGrown = lastGrown(cropSets, year, cropId)
  const reasons: string[] = []

  // What the farm's own sheet says about following each of last year's crops.
  const prev = previous(cropSets, year)
  const prefs = prev.map((p) => ({ prev: p, pref: preferenceFor(succession, p, cropId) }))
  for (const { prev: p, pref } of prefs) {
    const prevName = cropMap.get(p)?.name ?? 'last year’s crop'
    const note = notes?.get(`${p}>${cropId}`)?.notes
    if (pref === 'recommended')
      reasons.push(`The rotation sheet recommends it after ${prevName}.${note ? ` ${note}` : ''}`)
    else if (pref === 'no_go')
      reasons.push(`The sheet says never after ${prevName}.${note ? ` ${note}` : ''}`)
    else if (pref === 'caution')
      reasons.push(`The sheet allows it after ${prevName} with care.${note ? ` ${note}` : ''}`)
    else if (pref === 'possible')
      reasons.push(`It will do after ${prevName}.${note ? ` ${note}` : ''}`)
  }
  if (!prev.length)
    reasons.push(
      `Nothing is recorded on this field in ${year - 1}, so there is nothing for it to follow.`,
    )

  // Everything the placement check found, in its own words.
  for (const v of violations) reasons.push(v.message)

  if (sinceGrown == null)
    reasons.push(`The field has not carried it in the last ${LOOK_BACK} seasons.`)
  else if (sinceGrown === 1) reasons.push('It was on this field last year.')
  else reasons.push(`It was last on this field ${sinceGrown} seasons ago.`)

  const recommended =
    prefs.length > 0 && prefs.every((p) => p.pref === 'recommended') && !violations.length
  let verdict: Verdict = blocking.length
    ? 'no_go'
    : violations.length || prefs.some((p) => p.pref === 'caution')
      ? 'caution'
      : recommended
        ? 'recommended'
        : 'possible'

  // What was said about this crop after the same crop before. Newest first.
  const said = (input.past ?? [])
    .filter((c) => c.cropId === cropId && prev.includes(c.afterCropId ?? ''))
    .sort((a, b) => b.year - a.year)
  const lastSaid = said[0]
  if (lastSaid) {
    const afterName = cropMap.get(lastSaid.afterCropId ?? '')?.name ?? 'that'
    reasons.unshift(
      `${lastSaid.accepted ? 'You chose it' : 'You turned it down'} after ${afterName} for ${lastSaid.year}${
        lastSaid.reason ? `: \u201c${lastSaid.reason}\u201d` : '.'
      }`,
    )
    // A reason is a preference, not a rule: it moves the verdict one step
    // inside what the rules allow and never past 'caution'.
    if (verdict === 'recommended' && !lastSaid.accepted) verdict = 'possible'
    else if (verdict === 'possible' && lastSaid.accepted) verdict = 'recommended'
  }

  return { cropId, name, verdict, reasons, sinceGrown, violations }
}

/**
 * Rank every crop for a field-year: best first.
 *
 * Ties break on how long since the field carried it — a crop it has not seen
 * for six years beats one it grew two years ago — then on the name, so the
 * order never shuffles between renders.
 */
export function rankCrops(input: AdviceInput): CropAdvice[] {
  return input.crops
    .map((c) => adviseCrop(c.id, input))
    .sort(
      (a, b) =>
        VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
        (b.sinceGrown ?? LOOK_BACK + 1) - (a.sinceGrown ?? LOOK_BACK + 1) ||
        a.name.localeCompare(b.name),
    )
}

export type RotationAdvice = {
  /** Every crop judged for this field-year, best first. */
  ranked: CropAdvice[]
  /** The crops ticked for this field-year, in the order they were ticked. */
  picked: CropAdvice[]
  /** The best of the ticked ones, or null when none is ticked. */
  bestPicked: CropAdvice | null
  /** The best crop that is NOT ticked, when it beats what is ticked. */
  alsoConsider: CropAdvice | null
}

/**
 * The advice behind a cell's info button: what the ticked crops look like, and
 * the one worth a thought that is not ticked.
 *
 * `alsoConsider` is held back unless it actually beats the ticked crops — a
 * suggestion that is no better than the plan is noise, and the point of the
 * button is to be worth opening.
 */
export function adviseCell(picked: string[], input: AdviceInput): RotationAdvice {
  const ranked = rankCrops(input)
  const byId = new Map(ranked.map((a) => [a.cropId, a]))
  const pickedAdvice = picked.map((id) => byId.get(id) ?? adviseCrop(id, input))
  const bestPicked =
    pickedAdvice.length > 0
      ? [...pickedAdvice].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])[0]
      : null
  const outside = ranked.find((a) => !picked.includes(a.cropId) && a.verdict !== 'no_go') ?? null
  const better =
    outside && (!bestPicked || VERDICT_RANK[outside.verdict] < VERDICT_RANK[bestPicked.verdict])
  return { ranked, picked: pickedAdvice, bestPicked, alsoConsider: better ? outside : null }
}

/* ------------------------------------------- the same crop two years running */

/**
 * What to ask before planning a crop on top of itself.
 *
 * Sam, 28 Oct 2026: "if we plan to do a crop two years in a row but that
 * doesnt match our rules ask if we actually want to do that and if so then ask
 * if we want to change the rule to match what we are doing." So the planner
 * stops once, says which rule it is and by how much, and offers to move the
 * rule rather than leaving the plan quietly red for four years.
 *
 * Null for anything that is not a repeat, and for a repeat the rules already
 * allow (a perennial stand inside its years, a crop with max_in_a_row above
 * one): those need no question.
 */
export type RepeatQuestion = {
  cropId: string
  cropName: string
  /** Seasons it will have run, this one included. */
  run: number
  /** What the crop may do today. */
  allowedInARow: number
  minReturnYears: number
  /** The rules it breaks, in their own words. */
  breaks: string[]
  /** Which rule could be moved to match what is being planned. */
  fix: 'in_a_row' | 'succession' | null
}

export function repeatQuestion(cropId: string, input: AdviceInput): RepeatQuestion | null {
  const { year, cropSets, cropMap, succession } = input
  const crop = cropMap.get(cropId)
  if (!crop) return null
  if (!cropSets.get(year - 1)?.has(cropId)) return null

  const violations = checkPlacement(cropId, year, cropSets, cropMap, succession, input.notes)
  const breaking = violations.filter((v) => v.kind !== 'caution')
  if (!breaking.length) return null

  let run = 1
  for (let y = year - 1; y >= year - 12 && cropSets.get(y)?.has(cropId); y--) run++

  // A stand that has reached its years is a different conversation (take it
  // out), not "let it run one more" — the rule to move is the stand's own.
  const standMax = crop.stand_max_years ?? null
  const fix: RepeatQuestion['fix'] =
    standMax != null && standMax > 0
      ? null
      : breaking.some((v) => v.kind === 'succession')
        ? 'succession'
        : 'in_a_row'

  return {
    cropId,
    cropName: crop.name,
    run,
    allowedInARow: crop.max_in_a_row ?? 1,
    minReturnYears: crop.min_return_years,
    breaks: breaking.map((v) => v.message),
    fix,
  }
}
