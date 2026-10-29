import { useMemo } from 'react'
import { boundariesForYear, useAllBoundaries, useCropPlans, useCrops } from './queries'
import { useAllCropZones } from './cropZones'
import { useYieldCuts } from './yield-cuts'
import { useCropVarietySettings } from './crop-variety-settings-data'
import { hiddenYardNames, inHiddenYard, useBinYards } from './bin-yards'
import { useBinContents } from './bin-contents'
import {
  estimateBins,
  plansWithZones,
  useBinAllocations,
  useBinFieldsIn,
  useBinnedByField,
  useBinOnHand,
  useBins,
  useCropBinOverrides,
  yardRoom,
  type BinEstimateLine,
  type BinRow,
} from './bins'

/**
 * The bin estimate for a year, with everything it reads.
 *
 * In one place because two screens ask for it now: the estimator itself, and
 * the bin rules in Bin settings, where the tick, the policy and the bushels to
 * store moved (Sam, 27 Oct 2026). Two copies of this would drift, and the
 * one number the page exists to get right would quietly differ between them.
 */
export function useBinEstimate(cropYear: number): {
  lines: BinEstimateLine[]
  /** The bins the estimate counts: in use, and not in a hidden yard. */
  bins: BinRow[]
  /** Bins with something in them already, which is not storage this year. */
  occupiedBinIds: Set<string>
  /** The room the yard has left, counting the empty part of a part-full bin. */
  room: ReturnType<typeof yardRoom>
  /** Bins short across every crop. */
  shortBins: number
} {
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: allBoundaries } = useAllBoundaries()
  const { data: allBins } = useBins()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: contents } = useBinContents()
  const { data: zones } = useAllCropZones()
  const { data: cuts } = useYieldCuts(cropYear)
  const { data: varietySettings } = useCropVarietySettings()
  const { data: overrides } = useCropBinOverrides(cropYear)
  const { data: onHand } = useBinOnHand()
  const { data: fieldsIn } = useBinFieldsIn()
  const { data: binnedByField } = useBinnedByField()
  const { data: yards } = useBinYards()

  /**
   * Bins in a hidden yard (Creek Yard here) are out of the totals and the
   * storage the estimate sizes against: counting bins nobody fills as
   * available storage is the difference between "covered" and "short two
   * bins", and the wrong answer is the reassuring one.
   */
  const hidden = useMemo(() => hiddenYardNames(yards), [yards])
  const bins = useMemo(() => (allBins ?? []).filter((b) => !inHiddenYard(b, hidden)), [allBins, hidden])
  const occupiedBinIds = useMemo(() => new Set((contents ?? []).map((c) => c.bin_id)), [contents])

  const acresByField = useMemo(() => {
    const b = allBoundaries ? boundariesForYear(allBoundaries, cropYear) : []
    const m = new Map<string, number>()
    b.forEach((x) => m.set(x.field_id, x.acres))
    return m
  }, [allBoundaries, cropYear])

  const lines = useMemo(() => {
    if (!crops || !plans || !bins || !allocations) return []
    return estimateBins(
      crops,
      // A field split on the map counts as its crop areas, not its one plan.
      plansWithZones(plans, zones ?? [], cropYear),
      bins,
      allocations,
      (fid) => acresByField.get(fid) ?? null,
      {
        overrideByCrop: overrides,
        occupiedBinIds,
        cuts,
        varieties: varietySettings,
        // What is actually in the bins, so the estimate sizes what is still to
        // come against the room that is left (Sam, 27 Oct 2026).
        onHand,
        binnedByField,
        fieldsInBin: fieldsIn,
      },
    )
  }, [crops, plans, zones, cropYear, bins, allocations, acresByField, overrides, occupiedBinIds, cuts, varietySettings, onHand, binnedByField, fieldsIn])

  const room = useMemo(() => yardRoom(bins, onHand, occupiedBinIds), [bins, onHand, occupiedBinIds])
  const shortBins = useMemo(() => lines.reduce((s, l) => s + (l.shortfallBins ?? 0), 0), [lines])

  return { lines, bins, occupiedBinIds, room, shortBins }
}
