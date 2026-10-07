import { TONNE_PER_BU } from './markets'

// Basis: the gap between the local cash price and the futures board.
//
// It is where a selling decision actually lives. The board is the same for
// everyone; basis is what THIS elevator, in THIS week, is prepared to pay over
// or under it. A wide basis means the local market is buying cheaply against the
// board and there is reason to wait; a narrow one means it is paying up and the
// carry is being handed to you.
//
// Everything here converts explicitly. A CBOT wheat contract is US dollars per
// bushel and an Alberta elevator bid is Canadian dollars per tonne, and those
// two numbers differ by a factor of about fifty — subtracting them raw would
// produce a "basis" that is really just the unit mismatch.

/** US dollars per bushel to Canadian dollars per tonne. */
export function usdBuToCadTonne(
  usdPerBu: number,
  commodity: string,
  cadPerUsd: number,
): number | null {
  const buPerTonne = TONNE_PER_BU[commodity.toLowerCase()]
  if (!buPerTonne || !Number.isFinite(cadPerUsd) || cadPerUsd <= 0) return null
  return usdPerBu * buPerTonne * cadPerUsd
}

export type BasisPoint = {
  /** The local cash bid, in the same units as `futuresEquivalent`. */
  cash: number
  futuresEquivalent: number
  /** Cash minus the board. Negative means the local market is under it. */
  basis: number
  unit: string
}

/**
 * Basis for a crop whose futures are already in our units.
 *
 * ICE canola trades in Canadian dollars per tonne, exactly as an Alberta
 * elevator quotes it, so this one needs no conversion at all — which is why
 * canola basis is the most trustworthy number on the page.
 */
export function sameUnitBasis(cash: number, futures: number, unit: string): BasisPoint {
  return { cash, futuresEquivalent: futures, basis: cash - futures, unit }
}

/** Basis for a crop quoted in US dollars per bushel against a CAD/tonne bid. */
export function crossUnitBasis(
  cashCadPerTonne: number,
  futuresUsdPerBu: number,
  commodity: string,
  cadPerUsd: number,
): BasisPoint | null {
  const equivalent = usdBuToCadTonne(futuresUsdPerBu, commodity, cadPerUsd)
  if (equivalent == null) return null
  return {
    cash: cashCadPerTonne,
    futuresEquivalent: equivalent,
    basis: cashCadPerTonne - equivalent,
    unit: '$/tonne',
  }
}

/**
 * What a feedlot's board price works out to in Alberta dollars.
 *
 * A buyer bidding on Prairie Creek's calves starts from the CME feeder board in US
 * dollars and converts at the day's rate. What they actually offer is that,
 * less basis. Showing the conversion separately makes it obvious when a move in
 * the local price was really a move in the dollar — which happens more often
 * than anyone expects.
 */
export function cashEquivalent(cmeUsdPerCwt: number, cadPerUsd: number): number | null {
  if (!Number.isFinite(cadPerUsd) || cadPerUsd <= 0) return null
  return cmeUsdPerCwt * cadPerUsd
}

/**
 * Where a basis sits against its own history, and what that suggests.
 *
 * Deliberately worded as an observation rather than an instruction. The app can
 * say the basis is unusually wide; it cannot know whether this farm needs the
 * cash flow this month.
 */
export function basisVerdict(
  current: number,
  history: number[],
): { percentile: number; note: string } | null {
  if (history.length < 8) return null
  const below = history.filter((h) => h <= current).length
  const percentile = Math.round((below / history.length) * 100)
  const note =
    percentile >= 75
      ? 'Narrower than usual — the local market is paying up against the board.'
      : percentile <= 25
        ? 'Wider than usual — the local market is buying under the board.'
        : 'About normal for this market.'
  return { percentile, note }
}
