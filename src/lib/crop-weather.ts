/**
 * Frost and heat, judged against what the crop is doing.
 *
 * A 31 °C day is nothing to corn in June and costs canola pods in flower; a
 * −1 °C night is nothing to a stubble field and kills standing dry beans. The
 * stage comes from days after planting — rough, but the planting dates are
 * real (Deere seeding passes) and the windows are wide.
 *
 * Windows and thresholds, in days after planting (DAP) and °C:
 *  - Canola flowering ~45–75 DAP: heat blast at 29.5 °C and up (Canola
 *    Council — pods abort over ~29.5 °C); killing frost −2 °C before maturity.
 *  - Wheat, durum and barley heading/flowering ~50–70 DAP: 32 °C and up.
 *  - Dry beans flowering ~40–65 DAP: 32 °C and up (blossom drop); frost 0 °C
 *    kills the plant at any stage before harvest.
 *  - Corn silking ~70–90 DAP: 35 °C and up; frost 0 °C before maturity
 *    (black layer, ~120 DAP here).
 *  - Potatoes tuber bulking ~60–110 DAP: 30 °C and up (tuber growth stalls);
 *    frost −1 °C on the canopy.
 */

export type StageRule = {
  match: RegExp
  heat?: { from: number; to: number; atOrAbove: number; why: string }
  frost?: { untilDap: number; atOrBelow: number; why: string }
}

export const STAGE_RULES: StageRule[] = [
  { match: /canola/i, heat: { from: 45, to: 75, atOrAbove: 29.5, why: 'canola in flower aborts pods over about 29.5 °C' }, frost: { untilDap: 110, atOrBelow: -2, why: 'frost before canola matures shrivels the seed and leaves it green' } },
  { match: /durum|wheat|barley/i, heat: { from: 50, to: 70, atOrAbove: 32, why: 'heat at heading and flowering blanks kernels' } },
  { match: /bean/i, heat: { from: 40, to: 65, atOrAbove: 32, why: 'beans drop blossoms in heat' }, frost: { untilDap: 150, atOrBelow: 0, why: 'standing dry beans are killed at 0 °C' } },
  { match: /corn/i, heat: { from: 70, to: 90, atOrAbove: 35, why: 'heat at silking hurts pollination' }, frost: { untilDap: 120, atOrBelow: 0, why: 'frost before black layer stops the kernels filling' } },
  { match: /potato/i, heat: { from: 60, to: 110, atOrAbove: 30, why: 'tuber bulking stalls in heat' }, frost: { untilDap: 150, atOrBelow: -1, why: 'frost kills the canopy and can reach shallow tubers' } },
]

export type CropAlert = { kind: 'heat' | 'frost'; date: string; temp: number; dap: number; why: string }

/**
 * The alerts for one field over a forecast. Nothing once harvest has started,
 * and nothing for a crop with no rule (green feed, alfalfa, stubble).
 */
export function cropAlerts(args: {
  crop: string | null | undefined
  plantedOn: string | null
  harvestStarted: boolean
  forecast: { date: string; tmax: number | null; tmin: number | null }[]
}): CropAlert[] {
  if (args.harvestStarted || !args.plantedOn || /buckwheat/i.test(args.crop ?? '')) return []
  const rule = STAGE_RULES.find((r) => r.match.test(args.crop ?? ''))
  if (!rule) return []
  const planted = Date.parse(`${args.plantedOn}T12:00:00Z`)
  const out: CropAlert[] = []
  for (const d of args.forecast) {
    const dap = Math.round((Date.parse(`${d.date}T12:00:00Z`) - planted) / 86_400_000)
    if (dap < 0) continue
    if (rule.heat && d.tmax != null && dap >= rule.heat.from && dap <= rule.heat.to && d.tmax >= rule.heat.atOrAbove) {
      out.push({ kind: 'heat', date: d.date, temp: d.tmax, dap, why: rule.heat.why })
    }
    if (rule.frost && d.tmin != null && dap <= rule.frost.untilDap && d.tmin <= rule.frost.atOrBelow) {
      out.push({ kind: 'frost', date: d.date, temp: d.tmin, dap, why: rule.frost.why })
    }
  }
  return out
}
