import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentFill, type FillMove } from './bin-fill'
import { loadInBin } from './bin-loads'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { REFERENCE_STALE_MS } from './stale'
import type { CropPlanRow, CropRow } from './queries'
import { cutFor, cutLabel, estimateYield, type EstimatedYield, type YieldCut } from './yield-estimate'
import { applyVarietyToCrop, varietyLookup, type VarietySettingRow } from './crop-variety-settings'

export type BinRow = Database['public']['Tables']['bins']['Row']
export type BinAllocationRow = Database['public']['Tables']['bin_allocations']['Row']

/** Convert a crop's planned production to bushels using its test weight. */
export function productionToBushels(
  crop: CropRow,
  totalInCropUnit: number,
): { bushels: number | null; note?: string } {
  switch (crop.yield_unit) {
    case 'bu':
      return { bushels: totalInCropUnit }
    case 'lbs':
      if (!crop.test_weight_lb_per_bu)
        return { bushels: null, note: 'no test weight — set one on the crop to estimate bins' }
      return { bushels: totalInCropUnit / crop.test_weight_lb_per_bu }
    default:
      // cwt / ton / MT / ac aren't stored in grain bins
      return { bushels: null, note: `${crop.yield_unit} not stored in grain bins` }
  }
}

/** One year's departure from a crop's own bin setting. */
export type CropBinOverride = {
  crop_id: string
  needs_bins: boolean | null
  stored_bu: number | null
  note: string | null
}

export type BinEstimateLine = {
  /** False where the crop never enters a bin; its line is informational only. */
  needsBins: boolean
  /** True where this year's figure came from an override, not the crop default. */
  overridden: boolean
  /** Bushels this year's override says need a bin, or null for all of it. */
  storedBu: number | null
  crop: CropRow
  fieldCount: number
  /** The fields this crop is planned on, for "which ones?" */
  fieldIds: string[]
  /** What the crop is expected to make, before any part-of-it override (after yield cuts). */
  estimatedBu: number | null
  /** The low and high ends of that, where a yield range is set; null otherwise. */
  estimatedLowBu: number | null
  estimatedHighBu: number | null
  /** Bushels the yield cuts took off, and why, by field. */
  cutBu: number
  cuts: { fieldId: string; label: string }[]
  productionBu: number | null
  policy: CropRow['bin_policy']
  allocatedBins: number
  allocatedCapacityBu: number
  /**
   * Bushels of this crop sitting in a bin right now.
   *
   * The estimate used to compare the whole crop against the whole capacity of
   * the bins allocated to it, whatever was in them (Sam, 27 Oct 2026: "the
   * assessment is off as it takes allocation over what was actually binned").
   * A bin is not a promise: once grain is in it, what is still to come is the
   * question, and the space left over is space the farm actually has.
   */
  binnedBu: number
  /** What is still to come off: the stored figure less what is already binned. */
  toComeBu: number | null
  /** Room left in the bins allocated to it — the empty half of a part-full bin counts. */
  freeInAllocatedBu: number
  neededBins: number | null // segregated policies
  shortfallBins: number | null
  shortfallBu: number | null // mixable
  summary: string
  note?: string
}

/**
 * Bin estimator (SPEC §6). Per crop with a plan:
 *  - mixable: production bushels vs allocated bin capacity → shortfall in bu + bins
 *  - segregate_by_field: one bin per planted field, regardless of volume
 *  - segregate_by_variety: one bin per variety
 */
/**
 * How many bins a set of segregated fields takes, out of the bins you have.
 *
 * ONE SHARED POOL, not a sum of independent answers. Sizing each field against
 * the whole yard separately lets all three canola fields "use" the same pair of
 * 5,800 bushel fertiliser bins and reports five bins where six are needed —
 * which is the same class of error as counting one bin per field, just quieter.
 * Bins are consumed as they are assigned.
 *
 * BIGGEST FIELD FIRST, because otherwise a 60 acre field takes a 5,800 bushel
 * bin and the 140 acre field behind it is left splitting across three small
 * ones.
 *
 * And for each field, the LAST bin is the smallest one the remainder fits in,
 * not the biggest available. Moreaus' 9,800 bushels is 5,800 + 4,000, not two
 * 5,800s: taking the largest every time burns the big bins on remainders and is
 * not what anybody does in the yard.
 *
 * Fields with no yield are left out rather than counted as one bin — a zero is
 * a missing yield or a missing boundary, and "1 bin" hides that behind a
 * plausible number.
 */
export type FieldNeed = {
  fieldId: string
  bushels: number | null
  /**
   * Room already standing open for this field — the empty half of a bin that
   * holds nothing but its grain. Taken before the field draws another bin,
   * because that is what happens in the yard.
   */
  ownRoom?: number
}

export function planBinsForFields(
  needs: FieldNeed[],
  sizes: number[],
): { total: number; perField: Map<string, number> } {
  const perField = new Map<string, number>()
  const pool = [...sizes].filter((c) => c > 0).sort((a, b) => a - b)
  const largest = pool.length ? pool[pool.length - 1] : 0

  const sized = needs
    .filter((n) => n.bushels != null && Number.isFinite(n.bushels) && n.bushels > 0)
    .sort((a, b) => (b.bushels as number) - (a.bushels as number))

  let total = 0
  for (const n of sized) {
    let left = (n.bushels as number) - (n.ownRoom ?? 0)
    let bins = 0
    while (left > 0) {
      if (!pool.length) {
        // Out of bins. Still an honest number: this is storage the farm does
        // not have, which is the answer the page is being asked for.
        bins += largest > 0 ? Math.ceil(left / largest) : 1
        break
      }
      // The smallest bin the rest of the field fits in, if there is one.
      const fits = pool.findIndex((c) => c >= left)
      const take = fits >= 0 ? pool.splice(fits, 1)[0] : (pool.pop() as number)
      left -= take
      bins++
    }
    perField.set(n.fieldId, Math.max(0, bins))
    total += Math.max(0, bins)
  }
  return { total, perField }
}

/**
 * A season's plans with split fields broken into their crop areas.
 *
 * A field split on the map (Whitfield: corn on 31 ac, potatoes on the rest) has
 * one plan row naming one crop, and counting that row would put the whole
 * field down as that crop. Each crop area stands in for the plan instead, as
 * its own crop and acres — at the plan's yield where it is the plan's crop,
 * and the crop's default yield otherwise.
 */
export function plansWithZones<
  P extends {
    field_id: string
    crop_id: string
    crop_year: number
    planned_acres: number | null
    yield_per_acre_override: number | null
    yield_basis?: string | null
    yield_low?: number | null
    yield_high?: number | null
  },
>(
  plans: P[],
  zones: { id: string; field_id: string; crop_year: number; crop_id: string; acres: number | string | null }[],
  cropYear: number,
): P[] {
  const byField = new Map<string, typeof zones>()
  for (const z of zones) {
    if (z.crop_year !== cropYear) continue
    const list = byField.get(z.field_id) ?? []
    list.push(z)
    byField.set(z.field_id, list)
  }
  const out: P[] = []
  for (const p of plans) {
    const zs = byField.get(p.field_id)
    if (!zs?.length) {
      out.push(p)
      continue
    }
    for (const z of zs) {
      // The area growing the plan's own crop keeps the plan's yield, its
      // harvest label and its range; another crop starts from its own.
      const same = z.crop_id === p.crop_id
      out.push({
        ...p,
        id: `zone:${z.id}`,
        crop_id: z.crop_id,
        planned_acres: z.acres == null ? null : Number(z.acres),
        yield_per_acre_override: same ? p.yield_per_acre_override : null,
        ...('yield_basis' in p ? { yield_basis: same ? p.yield_basis : null } : {}),
        ...('yield_low' in p ? { yield_low: same ? p.yield_low : null } : {}),
        ...('yield_high' in p ? { yield_high: same ? p.yield_high : null } : {}),
        // The plan's variety is its own crop's; another crop's area has none.
        ...('variety' in p ? { variety: same ? p.variety : null } : {}),
      })
    }
  }
  return out
}

/** The crop area a plansWithZones row stands for, or null for a whole-field plan. */
export const zoneIdOf = (p: { id: string }): string | null => (p.id.startsWith('zone:') ? p.id.slice(5) : null)

/** A plan row's estimated yield per acre — its range and any cut — in the crop's own unit. */
export function planYieldEstimate(p: CropPlanRow, crop: CropRow, cuts?: YieldCut[]): EstimatedYield {
  return estimateYield({
    expected: p.yield_per_acre_override ?? crop.default_yield_per_acre ?? null,
    typed: p.yield_per_acre_override != null && !p.yield_basis,
    harvested: Boolean(p.yield_basis),
    plan: { low: p.yield_low, high: p.yield_high },
    crop: { low: crop.yield_low_per_acre, high: crop.yield_high_per_acre },
    cut: cutFor(cuts, { fieldId: p.field_id, cropYear: p.crop_year, cropId: p.crop_id, zoneId: zoneIdOf(p) }),
  })
}

/** Everything the estimate uses beyond the crops, the plans, the bins and the plan for them. */
export type BinEstimateInputs = {
  /** This year's per-crop overrides, keyed by crop id. */
  overrideByCrop?: Map<string, CropBinOverride>
  /**
   * Bins with something already in them — last year's durum in #2, say.
   *
   * Excluded from the ladder this year's crop is sized against, because a bin
   * that is full is not storage you have. It is NOT excluded from allocated
   * capacity: an allocation onto an occupied bin is still an allocation, and
   * hiding it would turn a conflict somebody should see into a silent one.
   */
  occupiedBinIds?: Set<string>
  /** This year's cuts to estimated yields (hail, disease). */
  cuts?: YieldCut[]
  /** Varieties' own figures: a plan's variety brings its own normal yield and test weight. */
  varieties?: readonly VarietySettingRow[]
  /**
   * What is in each bin now. Without it the estimate reads the plan alone and
   * every allocated bin counts as empty, which is right in April and wrong
   * from the first load of the harvest on.
   */
  onHand?: readonly BinOnHand[]
  /** Bushels of each field's grain in a bin now, for the crops kept field by field. */
  binnedByField?: ReadonlyMap<string, number>
  /** The fields whose grain is in each bin now — a bin with one field's grain has room for more of it. */
  fieldsInBin?: ReadonlyMap<string, string[]>
}

export function estimateBins(
  crops: CropRow[],
  plans: CropPlanRow[],
  bins: BinRow[],
  allocations: BinAllocationRow[],
  acresFor: (fieldId: string) => number | null,
  more: BinEstimateInputs = {},
): BinEstimateLine[] {
  const { overrideByCrop, occupiedBinIds, cuts, varieties, onHand, binnedByField, fieldsInBin } = more
  const varietyOf = varietyLookup(varieties)
  const cropById = new Map(crops.map((c) => [c.id, c]))
  const activeBins = bins.filter((b) => b.active)
  const capById = new Map(activeBins.map((b) => [b.id, b.capacity_bu]))
  const activeById = new Map(activeBins.map((b) => [b.id, b]))
  // What is in each bin, and of it what belongs to which crop.
  const inBin = new Map<string, number>()
  const binnedByCrop = new Map<string, number>()
  for (const o of onHand ?? []) {
    inBin.set(o.bin_id, (inBin.get(o.bin_id) ?? 0) + o.onhand_bu)
    if (o.crop_id) binnedByCrop.set(o.crop_id, (binnedByCrop.get(o.crop_id) ?? 0) + o.onhand_bu)
  }
  /** The room left in a bin. Its whole capacity where nothing says otherwise. */
  const roomIn = (b: BinRow) => Math.max(0, b.capacity_bu - (inBin.get(b.id) ?? 0))
  const avgCapacity =
    activeBins.length > 0
      ? activeBins.reduce((s, b) => s + b.capacity_bu, 0) / activeBins.length
      : 0
  // Largest first, so sizing a field walks the real yard rather than an
  // average. The yard is not uniform — 4,000 bushel grain bins, a pair of
  // 5,800 bushel fertiliser bins, and some 400s — and an average of them all
  // describes no bin that exists.
  //
  // EMPTY bins, because this ladder sizes the crops kept field by field and
  // such a field cannot be augered in on top of another one's grain — that is
  // the whole policy. The room left over a field's own grain is set aside for
  // that field instead (ownRoom below), so a half-filled bin is half a bin of
  // storage for the field already in it and none at all for anybody else.
  const binSizes: number[] = []
  /** Room standing open for one field, in the bins holding only its grain. */
  const ownRoom = new Map<string, number>()
  for (const b of activeBins) {
    if (occupiedBinIds?.has(b.id)) continue
    const room = roomIn(b)
    if (room <= 0) continue
    const held = (inBin.get(b.id) ?? 0) > 0.5
    const fields = fieldsInBin?.get(b.id) ?? []
    if (!held) binSizes.push(room)
    // A bin with two fields' grain in it already is nobody's room.
    else if (fields.length === 1) ownRoom.set(fields[0], (ownRoom.get(fields[0]) ?? 0) + room)
  }
  binSizes.sort((a, b) => b - a)

  // group plans by crop
  const plansByCrop = new Map<string, CropPlanRow[]>()
  for (const p of plans) {
    const list = plansByCrop.get(p.crop_id) ?? []
    list.push(p)
    plansByCrop.set(p.crop_id, list)
  }

  const lines: BinEstimateLine[] = []
  for (const [cropId, cropPlans] of plansByCrop) {
    const crop = cropById.get(cropId)
    if (!crop) continue
    // An archived crop is one somebody has retired. Its plans stay on the books
    // for the year they were made — deleting them would rewrite history — but
    // it has no place in a list of what needs a bin this season. Summer Fallow
    // is the case that prompted this: retired, still carrying plans, and
    // needing no storage by definition.
    if (crop.active === false) continue

    // The crop setting is the default; this year's override wins where it
    // exists. Only an explicit true or false overrides — null means nobody said
    // anything about this year, not "no".
    const ov = overrideByCrop?.get(cropId)
    const binned = ov?.needs_bins ?? crop.needs_bins !== false

    // A crop that never enters a bin is not a storage problem. Counting alfalfa
    // tonnage, or potatoes that leave on a truck from the field, against bin
    // capacity makes the farm look short of storage it does not need — which is
    // the one number this page exists to get right. Kept as a LINE so it is
    // visible and can be toggled back, rather than vanishing from the list.
    if (!binned) {
      lines.push({
        crop,
        fieldCount: new Set(cropPlans.map((p) => p.field_id)).size,
        fieldIds: [...new Set(cropPlans.map((p) => p.field_id))],
        estimatedBu: null,
        estimatedLowBu: null,
        estimatedHighBu: null,
        cutBu: 0,
        cuts: [],
        productionBu: 0,
        policy: crop.bin_policy,
        allocatedBins: 0,
        allocatedCapacityBu: 0,
        binnedBu: binnedByCrop.get(cropId) ?? 0,
        toComeBu: null,
        freeInAllocatedBu: 0,
        neededBins: 0,
        shortfallBins: 0,
        shortfallBu: 0,
        summary:
          // A crop nobody expected to bin, with grain in the bins. Said out
          // loud rather than left as a line reading "not stored in bins" over
          // eight thousand bushels of it (Sam, 27 Oct 2026).
          (binnedByCrop.get(cropId) ?? 0) > 0.5
            ? `${Math.round(binnedByCrop.get(cropId) ?? 0).toLocaleString()} bu of it is in the bins, although it is marked as not binned.`
            : ov?.needs_bins === false
              ? `Not binned this year${ov.note ? ` — ${ov.note}` : ''}.`
              : 'Not stored in bins — baled or shipped direct from the field.',
        note: undefined,
        needsBins: false,
        overridden: ov?.needs_bins === false,
        storedBu: null,
      })
      continue
    }

    const alloc = allocations.filter((a) => a.crop_id === cropId)
    const allocatedBins = alloc.length
    const allocatedCapacityBu = alloc.reduce((s, a) => s + (capById.get(a.bin_id) ?? 0), 0)
    // The room its own bins still have. Equal to their capacity before harvest,
    // and the number that matters once the grain starts coming in.
    const freeInAllocatedBu = alloc.reduce((s, a) => {
      const b = activeById.get(a.bin_id)
      return s + (b ? roomIn(b) : 0)
    }, 0)
    const allocatedBinsWithRoom = alloc.filter((a) => {
      const b = activeById.get(a.bin_id)
      // A bin the estimate cannot see is left as it was: counted.
      return !b || roomIn(b) > 1
    }).length
    const binnedBu = binnedByCrop.get(cropId) ?? 0
    const fieldCount = new Set(cropPlans.map((p) => p.field_id)).size

    // Each plan's yield per acre: its range, after any cut for hail or disease.
    // The crop as the plan's variety grows it: its normal yield and test weight.
    const est = cropPlans.map((p) => {
      const vc = applyVarietyToCrop(crop, varietyOf(crop.id, p.variety))
      return { p, vc, acres: p.planned_acres ?? acresFor(p.field_id) ?? 0, y: planYieldEstimate(p, vc, cuts) }
    })
    /** Bushels over some plans, each at its own variety's test weight; null (and why) if any cannot convert. */
    const bushelsOf = (rows: typeof est, amount: (e: (typeof est)[number]) => number): { bushels: number | null; note?: string } => {
      if (!rows.length) return productionToBushels(crop, 0)
      let sum = 0
      for (const e of rows) {
        const c = productionToBushels(e.vc, amount(e))
        if (c.bushels == null) return c
        sum += c.bushels
      }
      return { bushels: sum }
    }
    const total = (pick: (y: EstimatedYield) => number | null) => bushelsOf(est, (e) => e.acres * (pick(e.y) ?? 0))
    const conv = total((y) => y.expected)
    const ranged = est.some((e) => e.y.low !== e.y.high)
    const estimatedLowBu = ranged ? total((y) => y.low).bushels : null
    const estimatedHighBu = ranged ? total((y) => y.high).bushels : null
    const cutRows = est.filter((e) => e.y.cutPct > 0 && e.y.cut)
    const cutBu = (cutRows.length ? bushelsOf(cutRows, (e) => e.acres * ((e.y.before.expected ?? 0) - (e.y.expected ?? 0))).bushels : 0) ?? 0
    const cutList = cutRows.map((e) => ({ fieldId: e.p.field_id, label: cutLabel(e.y.cut!) }))
    // What has to FIT IN A BIN, which is not the same as what is grown. Where
    // only part of the corn is binned and the rest goes straight to the plant,
    // sizing storage against the whole crop invents a shortfall.
    const storedBu = ov?.stored_bu == null ? null : Number(ov.stored_bu)
    const productionBu = storedBu ?? conv.bushels
    const note = conv.note
    // Storage is only needed for what has not been put away yet.
    const toComeBu = productionBu == null ? null : Math.max(0, productionBu - binnedBu)
    const inSoFar = binnedBu > 0.5 ? `${Math.round(binnedBu).toLocaleString()} bu in the bins` : ''

    let neededBins: number | null = null
    let shortfallBins: number | null = null
    let shortfallBu: number | null = null
    let summary: string

    if (crop.bin_policy === 'segregate_by_field') {
      // ONE BIN PER FIELD IS A FLOOR, NOT AN ANSWER, and reporting it as the
      // answer was wrong on exactly the fields that matter. Moreaus makes about
      // 9,800 bushels of canola against 4,000 bushel bins: it needs three, and
      // the old line said one. Keeping fields apart means no bin holds two
      // fields — it says nothing about a field fitting in one bin.
      //
      // So each field is sized on its own and the counts are added. A field
      // cannot borrow space from another field's bin, which is the whole point
      // of the policy, so summing per field is the correct arithmetic rather
      // than a conservative one.
      // A field cut to nothing (hailed out) needs no bin, rather than the one
      // an unsized field is given.
      //
      // Sized on what is still in the field, field by field: a field already
      // augered away needs no more bins, and the bin it went into is counted
      // as the part of it that is left.
      const needs = est
        .filter((e) => !(e.y.cutPct >= 100))
        .map((e) => {
          const grown = productionToBushels(e.vc, e.acres * (e.y.expected ?? 0)).bushels
          const already = binnedByField?.get(e.p.field_id) ?? 0
          return {
            fieldId: e.p.field_id,
            bushels: grown == null ? null : Math.max(0, grown - already),
            ownRoom: ownRoom.get(e.p.field_id) ?? 0,
            done: grown != null && already > 0.5 && grown - already <= 0.5,
          }
        })
      const plan = planBinsForFields(needs, binSizes)
      // A field nobody could size still needs somewhere to go, so it counts as
      // one rather than disappearing out of the total. A field whose grain is
      // already in a bin does not.
      const unsized = needs.filter((n) => !n.done && !plan.perField.has(n.fieldId)).length
      neededBins = plan.total + unsized
      // Against the allocated bins that still have room in them: a full one is
      // not somewhere the rest of the crop can go.
      shortfallBins = Math.max(0, neededBins - allocatedBinsWithRoom)
      const fieldsIn = needs.filter((n) => n.done).length

      // Named where it is more than one, because "7 bins for 3 fields" invites
      // the reader to think something has gone wrong with the arithmetic.
      const counts = [...plan.perField.values()]
      const splits = counts.filter((n) => n > 1).length
      const biggest = counts.length ? Math.max(...counts) : 1
      const detail =
        splits > 0
          ? ` ${splits === 1 ? 'One field needs' : `${splits} fields need`} more than one bin${biggest > 1 ? ` — the largest takes ${biggest}` : ''}.`
          : ''
      const fieldsLeft = fieldCount - fieldsIn
      const out = `${fieldsLeft} ${fieldsLeft === 1 ? 'field' : 'fields'} still out`
      const binWord = (n: number) => `${n} bin${n === 1 ? '' : 's'}`
      const fieldWord = (n: number) => `${n} field${n === 1 ? '' : 's'}`
      // A bin set aside for this crop with somebody else's grain in it is not
      // somewhere the crop can go, and the line has to say so — #20 is held
      // for the Corteva canola and is full of corn.
      const noRoom = allocatedBins - allocatedBinsWithRoom
      const fullNote =
        noRoom === 0
          ? ''
          : allocatedBins === 1
            ? ' Its one bin is full.'
            : noRoom === allocatedBins
              ? ` All ${allocatedBins} of its bins are full.`
              : ` ${noRoom} of its ${allocatedBins} bins ${noRoom === 1 ? 'is' : 'are'} full.`
      summary =
        // Before the harvest the question is the plan: bins needed against
        // bins set aside. Once grain is going in it is what is left to come,
        // which is a different sentence and not the same arithmetic.
        binnedBu <= 0.5
          ? shortfallBins > 0
            ? `${binWord(neededBins)} for ${fieldWord(fieldCount)} kept apart, ${allocatedBins} allocated. Short ${shortfallBins}.${detail}${fullNote}`
            : `${binWord(allocatedBins)} allocated across ${fieldWord(fieldCount)}, none shared. Covered.${detail}`
          : neededBins === 0
            ? `All of it is in the bins — ${Math.round(binnedBu).toLocaleString()} bu across ${binWord(allocatedBins)}, none shared.`
            : shortfallBins > 0
              ? `${inSoFar}. ${binWord(neededBins)} more for ${out}, ${allocatedBinsWithRoom} allocated with room. Short ${shortfallBins}.${detail}${fullNote}`
              : `${inSoFar}. ${binWord(neededBins)} more for ${out}, covered.${detail}`
    } else if (crop.bin_policy === 'segregate_by_variety') {
      const varieties = new Set(cropPlans.map((p) => p.variety ?? '—')).size
      neededBins = varieties
      shortfallBins = Math.max(0, neededBins - allocatedBins)
      summary =
        shortfallBins > 0
          ? `Needs ${neededBins} bins for ${varieties} varieties, ${allocatedBins} allocated. Short ${shortfallBins}.`
          : `${neededBins} bins for ${varieties} varieties — covered.${inSoFar ? ` ${inSoFar}.` : ''}`
    } else {
      // mixable
      if (productionBu == null || toComeBu == null) {
        summary = note ?? 'Not bin-stored.'
      } else {
        // What is still to come against the room left, not the whole crop
        // against the whole of the bins it was promised.
        shortfallBu = Math.max(0, toComeBu - freeInAllocatedBu)
        shortfallBins = avgCapacity > 0 ? Math.ceil(shortfallBu / avgCapacity) : null
        const room = `${Math.round(freeInAllocatedBu).toLocaleString()} bu room`
        summary =
          shortfallBu > 0
            ? `${Math.round(toComeBu).toLocaleString()} bu still to come vs ${room} — short ${Math.round(shortfallBu).toLocaleString()} bu${shortfallBins != null ? ` (~${shortfallBins} bins)` : ''}.${inSoFar ? ` ${inSoFar}.` : ''}`
            : toComeBu <= 0.5 && binnedBu > 0.5
              ? `All of it is in the bins — ${Math.round(binnedBu).toLocaleString()} bu, with ${room} to spare.`
              : `${Math.round(toComeBu).toLocaleString()} bu still to come vs ${room} — covered.${inSoFar ? ` ${inSoFar}.` : ''}`
      }
    }

    lines.push({
      crop,
      fieldCount,
      fieldIds: [...new Set(cropPlans.map((p) => p.field_id))],
      estimatedBu: conv.bushels,
      estimatedLowBu,
      estimatedHighBu,
      cutBu,
      cuts: cutList,
      productionBu,
      policy: crop.bin_policy,
      allocatedBins,
      allocatedCapacityBu,
      binnedBu,
      toComeBu,
      freeInAllocatedBu,
      neededBins,
      shortfallBins,
      shortfallBu,
      summary,
      note,
      needsBins: true,
      overridden: storedBu != null,
      storedBu,
    })
  }
  return lines.sort((a, b) => a.crop.name.localeCompare(b.crop.name))
}

/**
 * The room left in the yard (Sam, 27 Oct 2026: "there is wasted space not
 * being shown as available").
 *
 * "Unallocated" counted whole bins nobody had claimed and nothing else, so the
 * 4,711 bushels left over the canola and the 7,684 over the corn — space that
 * is there, in bins with grain in them — never appeared anywhere. A yard with
 * 17,900 bushels of empty bins and 30,219 bushels of actual room read as the
 * first number.
 *
 * A bin holding a previous year's grain is left out: its room is not room until
 * somebody hauls that grain away.
 */
export function yardRoom(
  bins: readonly BinRow[],
  onHand?: readonly BinOnHand[],
  occupiedBinIds?: Set<string>,
): {
  /** Bushels of space, over every bin that has any. */
  roomBu: number
  /** Of that, the space in bins that already have grain in them. */
  inUseRoomBu: number
  /** Bins with nothing in them at all. */
  emptyBins: number
  /** Bins with room to spare but something in them already. */
  partBins: number
  /** Bins full to their capacity. */
  fullBins: number
} {
  const inBin = new Map<string, number>()
  for (const o of onHand ?? []) inBin.set(o.bin_id, (inBin.get(o.bin_id) ?? 0) + o.onhand_bu)
  let roomBu = 0
  let inUseRoomBu = 0
  let emptyBins = 0
  let partBins = 0
  let fullBins = 0
  for (const b of bins) {
    if (!b.active || occupiedBinIds?.has(b.id)) continue
    const held = inBin.get(b.id) ?? 0
    const room = Math.max(0, b.capacity_bu - held)
    roomBu += room
    if (held <= 0.5) emptyBins++
    else if (room > 1) {
      partBins++
      inUseRoomBu += room
    } else fullBins++
  }
  return { roomBu, inUseRoomBu, emptyBins, partBins, fullBins }
}

/** Just enough of a bin to sort a yard list. */
type Placeable = { name: string; site: string | null }

/** #2 before #10. A plain name sort puts #10, #11, #12 ahead of #2. */
export function binNumber(name: string): number {
  const m = name.match(/#\s*(\d+)/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

export function byYardThenNumber(a: Placeable, b: Placeable): number {
  const site = (a.site ?? '').localeCompare(b.site ?? '')
  if (site !== 0) return site
  const n = binNumber(a.name) - binNumber(b.name)
  return n !== 0 ? n : a.name.localeCompare(b.name)
}

/**
 * What is actually in each bin right now, from the grain movements ledger.
 *
 * Separate from allocations: an allocation is a plan for the year ("#7 is for
 * the pinto beans"), on-hand is the running total of what has been augered in
 * and hauled out. The bin drawing needs the second one — a fill line drawn from
 * a plan would show every bin full on the first of May.
 */
export type BinOnHand = { bin_id: string; crop_id: string | null; onhand_bu: number }

/**
 * One bin's movements, for working out what is in it lot by lot (bin-fill.ts):
 * which field's grain a move out of it would carry.
 */
export type BinProduct = { bin_id: string; product: string; tonnes: number }

/**
 * What a bin holds that is not a crop: fertilizer, counted in tonnes (Sam,
 * 26 Oct 2026). Kept apart from the bushels — a bin reads in the unit of what
 * is actually in it, and the two are never added together.
 */
export function useBinProducts() {
  return useQuery({
    // Under ['bins', 'onhand'] so a save that refreshes the bushels refreshes this.
    queryKey: ['bins', 'onhand', 'products'],
    queryFn: async (): Promise<Map<string, BinProduct[]>> => {
      const { data, error } = await supabase
        .from('grain_movements')
        .select('bin_id, product, tonnes, movement_type')
        .not('tonnes', 'is', null)
      if (error) throw error
      const by = new Map<string, Map<string, number>>()
      for (const m of data ?? []) {
        const name = (m.product ?? '').trim() || 'Fertilizer'
        const out = m.movement_type === 'transfer_out' || m.movement_type === 'delivery_out' || m.movement_type === 'shrink'
        const t = (Number(m.tonnes) || 0) * (out ? -1 : 1)
        const inBin = by.get(m.bin_id) ?? new Map<string, number>()
        inBin.set(name, (inBin.get(name) ?? 0) + t)
        by.set(m.bin_id, inBin)
      }
      const res = new Map<string, BinProduct[]>()
      for (const [bin, items] of by) {
        const kept = [...items].filter(([, t]) => t > 0.001).map(([product, tonnes]) => ({ bin_id: bin, product, tonnes }))
        if (kept.length) res.set(bin, kept.sort((a, b) => b.tonnes - a.tonnes))
      }
      return res
    },
  })
}

export function useBinMovements(binId: string | null | undefined) {
  return useQuery({
    queryKey: ['bins', 'movements', binId],
    enabled: !!binId,
    queryFn: async (): Promise<FillMove[]> => {
      const { data, error } = await supabase
        .from('grain_movements')
        .select('movement_type, bushels, moved_at, created_at, field_id, ticket_number')
        .eq('bin_id', binId!)
      if (error) throw error
      return (data ?? []) as FillMove[]
    },
  })
}

export function useBinOnHand() {
  return useQuery({
    queryKey: ['bins', 'onhand'],
    queryFn: async (): Promise<BinOnHand[]> => {
      const { data, error } = await supabase.from('bin_grain_onhand').select('*')
      if (error) throw error
      return (data ?? []).map((r) => ({
        bin_id: String(r.bin_id),
        crop_id: r.crop_id == null ? null : String(r.crop_id),
        onhand_bu: Number(r.onhand_bu) || 0,
      }))
    },
  })
}

/**
 * The fields the grain in each bin actually came from, off the weigh-ins and
 * Adds that named one (the latest crop year's, biggest first) — to set beside
 * the plan, which only says where a field's grain was meant to go.
 */
export function useBinFieldsIn() {
  return useQuery({
    // Under ['bins', 'onhand'] so every save that refreshes on-hand refreshes this.
    queryKey: ['bins', 'onhand', 'fields'],
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await supabase
        .from('grain_movements')
        .select('bin_id, field_id, crop_year, bushels, movement_type, moved_at, created_at, ticket_number')
        .order('bin_id')
      if (error) throw error
      // What is in it NOW, not everything ever put in it: grain leaves oldest
      // first (bin-fill.ts), so a bin whose earlier field was hauled out no
      // longer names it. #21 kept saying Moreau after its 5,496 bu went to #22
      // (Sam, 23 Oct 2026). The same rule the bin's own pop-up uses.
      const byBin = new Map<string, FillMove[]>()
      for (const m of data ?? []) byBin.set(m.bin_id, [...(byBin.get(m.bin_id) ?? []), m as FillMove])
      const out = new Map<string, string[]>()
      for (const [bin, moves] of byBin) {
        const bu = new Map<string, number>()
        for (const lot of currentFill(moves)) if (lot.fieldId) bu.set(lot.fieldId, (bu.get(lot.fieldId) ?? 0) + lot.bushels)
        if (bu.size) out.set(bin, [...bu].sort((a, b) => b[1] - a[1]).map(([id]) => id))
      }
      return out
    },
  })
}

/**
 * Bushels of each field's grain sitting in a bin right now, by field.
 *
 * The estimate needs it for the crops kept field by field: Moreaus' canola is
 * in #21 and #22, so Moreaus needs no more bins, and counting its whole yield
 * against the yard again is how the page reports a shortfall that was dealt
 * with three weeks ago.
 */
export function useBinnedByField() {
  return useQuery({
    // Under ['bins', 'onhand'] so every save that refreshes on-hand refreshes this.
    queryKey: ['bins', 'onhand', 'field-bushels'],
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('grain_movements')
        .select('bin_id, field_id, crop_year, bushels, movement_type, moved_at, created_at, ticket_number')
        .order('bin_id')
      if (error) throw error
      const byBin = new Map<string, FillMove[]>()
      for (const m of data ?? []) byBin.set(m.bin_id, [...(byBin.get(m.bin_id) ?? []), m as FillMove])
      const out = new Map<string, number>()
      // What is in each bin NOW, lot by lot — grain leaves oldest first, the
      // same rule the bin's own list uses.
      for (const moves of byBin.values())
        for (const lot of currentFill(moves))
          if (lot.fieldId) out.set(lot.fieldId, (out.get(lot.fieldId) ?? 0) + lot.bushels)
      return out
    },
  })
}

/**
 * Bushels in each bin from loads marked as an estimate, nobody weighed them
 * (Sam, 9 Oct 2026), so the bin's figure can say it is partly a guess.
 */
export function useEstimatedByBin() {
  return useQuery({
    // Under ['bins', 'onhand'] so a saved load refreshes it with the bin figures.
    queryKey: ['bins', 'onhand', 'estimates'],
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('bin_loads')
        .select('bin_id, overflow_bin_id, first_bin_bu, bushels, net_kg')
        .eq('estimated', true)
        .not('bin_id', 'is', null)
      if (error) throw error
      const out = new Map<string, number>()
      // A load split across two bins counts its share in each.
      for (const l of data ?? [])
        for (const b of [l.bin_id, l.overflow_bin_id].filter((x): x is string => !!x)) out.set(b, (out.get(b) ?? 0) + loadInBin(l, b).bushels)
      return out
    },
  })
}

export function binsQuery() {
  return {
    queryKey: ['bins'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bins').select('*')
      if (error) throw error
      // Sorted here rather than by the database, because the order wanted is
      // #1, #2, #3 and a name sort gives #1, #10, #11, #12, #2. Doing it in the
      // query means every screen that reads bins — the yard list, the moisture
      // tester's bin picker, the air alerts — agrees without each remembering.
      return [...data].sort(byYardThenNumber)
    },
    staleTime: REFERENCE_STALE_MS,
  }
}

export function useBins() {
  return useQuery(binsQuery())
}

export function useBinAllocations(cropYear: number) {
  return useQuery({
    queryKey: ['bin_allocations', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bin_allocations')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  })
}

/** Which switches a bin offers, and whether each is running. */
export type BinRun = Pick<BinRow, 'has_aeration' | 'has_heater' | 'aeration_on' | 'heater_on'>

/**
 * Switch a bin's fan or heater on or off. Writing to a bin is otherwise a
 * manager's job; this one goes through fn_set_bin_run so whoever is standing
 * at the bin can flip it, and nothing else on the bin can be touched that way.
 *
 * The switch shows its new state at once rather than after the round trip —
 * it is a light switch, and a light switch that waits reads as broken.
 */
export function useSetBinRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, aeration, heater }: { id: string; aeration?: boolean; heater?: boolean }) => {
      const { error } = await supabase.rpc('fn_set_bin_run', {
        p_bin: id,
        p_aeration: aeration ?? null,
        p_heater: heater ?? null,
      })
      if (error) throw error
    },
    onMutate: async ({ id, aeration, heater }) => {
      // The two lists of bins themselves. Everything else under ['bins'] is a
      // different shape — on-hand bushels, a Map of fields — and must be left alone.
      const keys = [['bins'], ['bins', 'located']] as const
      for (const key of keys) await qc.cancelQueries({ queryKey: key, exact: true })
      const before = keys.map((key) => [key, qc.getQueryData(key)] as const)
      const patch = <T extends { id: string } & BinRun>(rows: T[] | undefined) =>
        rows?.map((b) =>
          b.id !== id
            ? b
            : {
                ...b,
                aeration_on: b.has_aeration ? (aeration ?? b.aeration_on) : false,
                heater_on: b.has_heater ? (heater ?? b.heater_on) : false,
              },
        )
      for (const key of keys) qc.setQueryData(key, patch)
      return { before }
    },
    onError: (_e, _v, c) => {
      for (const [key, data] of c?.before ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['bins'], exact: true })
      void qc.invalidateQueries({ queryKey: ['bins', 'located'], exact: true })
    },
  })
}

export function useBinMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['bins'] })
  const create = useMutation({
    mutationFn: async (bin: Database['public']['Tables']['bins']['Insert']) => {
      const { error } = await supabase.from('bins').insert(bin)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Database['public']['Tables']['bins']['Update']
    }) => {
      const { error } = await supabase.from('bins').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bins').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function useAllocationMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['bin_allocations', cropYear] })
  const upsert = useMutation({
    mutationFn: async (alloc: Database['public']['Tables']['bin_allocations']['Insert']) => {
      const { error } = await supabase
        .from('bin_allocations')
        .upsert(alloc, { onConflict: 'crop_year,bin_id' })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async ({ binId }: { binId: string }) => {
      const { error } = await supabase
        .from('bin_allocations')
        .delete()
        .eq('crop_year', cropYear)
        .eq('bin_id', binId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { upsert, remove }
}

/**
 * Whether a crop is stored in bins at all.
 *
 * Lives with the bin code rather than crop settings because this is where the
 * question gets asked — somebody looking at a storage shortfall wants to strike
 * the alfalfa off it there and then, not go hunting through settings.
 */
/** The bin policy is a fact about the crop, so it is edited wherever it shows. */
export function useSetCropBinPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, bin_policy }: { id: string; bin_policy: CropRow['bin_policy'] }) => {
      const { error } = await supabase.from('crops').update({ bin_policy }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crops'] }),
  })
}

export function useSetCropNeedsBins() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, needs_bins }: { id: string; needs_bins: boolean }) => {
      const { error } = await supabase.from('crops').update({ needs_bins }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['bins'] })
    },
  })
}

/** This year's overrides, and the means to set one. */
export function useCropBinOverrides(cropYear: number) {
  return useQuery({
    queryKey: ['crop_bin_overrides', cropYear],
    queryFn: async (): Promise<Map<string, CropBinOverride>> => {
      const { data, error } = await supabase
        .from('crop_bin_overrides')
        .select('crop_id, needs_bins, stored_bu, note')
        .eq('crop_year', cropYear)
      if (error) throw error
      const m = new Map<string, CropBinOverride>()
      for (const r of data ?? []) {
        const row = r as unknown as Record<string, unknown>
        m.set(String(row.crop_id), {
          crop_id: String(row.crop_id),
          needs_bins: (row.needs_bins as boolean | null) ?? null,
          stored_bu: row.stored_bu == null ? null : Number(row.stored_bu),
          note: (row.note as string) ?? null,
        })
      }
      return m
    },
  })
}

export function useSetCropBinOverride(cropYear: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      crop_id: string
      needs_bins?: boolean | null
      stored_bu?: number | null
      note?: string | null
    }) => {
      // An override that says nothing is not an override. Clearing both fields
      // deletes the row so the crop's own setting takes over again, rather than
      // leaving an empty record that reads as a deliberate choice.
      const empty = (v.needs_bins ?? null) === null && (v.stored_bu ?? null) === null && !v.note
      if (empty) {
        const { error } = await supabase
          .from('crop_bin_overrides')
          .delete()
          .eq('crop_year', cropYear)
          .eq('crop_id', v.crop_id)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('crop_bin_overrides').upsert(
        {
          crop_year: cropYear,
          crop_id: v.crop_id,
          needs_bins: v.needs_bins ?? null,
          stored_bu: v.stored_bu ?? null,
          note: v.note ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'crop_year,crop_id' },
      )
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crop_bin_overrides'] }),
  })
}
