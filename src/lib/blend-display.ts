import { LB_PER_TONNE, type BlendLine } from './blend'

/** A blend rate as the Blends table prints it: one decimal under 10 lb, whole above. */
export const printedRate = (lbPerAc: number) => (lbPerAc < 10 ? Math.round(lbPerAc * 10) / 10 : Math.round(lbPerAc))

/**
 * A blend's rate and tonnage, added up from the figures its lines print.
 *
 * Summed unrounded, 156 + 77 + 20 printed under "Rate 252" and 4.6 + 2.3 + 0.6
 * under "7.4 t" (batch 4 page walk). Each line is rounded the way it is shown,
 * then added, so the total is the sum of the column above it.
 */
export function blendTotalsAsPrinted(lines: BlendLine[], acres: number) {
  const lineTonnes = lines.map((l) => Math.round(((l.lbPerAc * acres) / LB_PER_TONNE) * 10) / 10)
  const rate = lines.reduce((s, l) => s + printedRate(l.lbPerAc), 0)
  const tonnes = Math.round(lineTonnes.reduce((s, t) => s + t, 0) * 10) / 10
  return { rate, tonnes, lineTonnes }
}
