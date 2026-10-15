/**
 * The moisture grain settles at in a given air: its equilibrium moisture
 * content (EMC). Dry, warm air pulls grain down towards a low EMC; damp, cool
 * night air pushes it back up towards a high one.
 *
 * The starting point for the dry-down (Sam, 9 Oct 2026), not the answer: the
 * farm's own readings then tune how fast each crop moves towards it.
 *
 * Canola, wheat, barley, peas and oats are PAMI's charts ("Equilibrium
 * Moisture Content Charts for Grain Storage Management", Prairie Agricultural
 * Machinery Institute), built from ASAE D245.5 with the Modified Henderson
 * model (Modified Chung-Pfost for oats). Corn is the Modified Chung-Pfost
 * equation for shelled corn in ASAE D245.6 (Chen and Morey). Dry beans have no
 * published constants that could be checked, so beans and other pulses use the
 * peas chart, the nearest crop PAMI covers, and the card says so.
 *
 * Moisture is percent, wet basis: what the meter reads.
 */

export type EmcGroup = 'canola' | 'wheat' | 'barley' | 'oats' | 'peas' | 'corn'

const T_ROWS = [-2, 2, 5, 8, 10, 13, 15, 18, 22, 26, 28]
const RH_COLS = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]

const TABLES: Record<Exclude<EmcGroup, 'corn'>, number[][]> = {
  canola: [
    [6.7, 7.5, 8.2, 8.9, 9.7, 10.5, 11.3, 12.2, 13.2, 14.3, 15.7],
    [6.4, 7.0, 7.7, 8.4, 9.1, 9.9, 10.7, 11.6, 12.5, 13.6, 14.9],
    [6.1, 6.8, 7.4, 8.1, 8.8, 9.5, 10.3, 11.1, 12.0, 13.1, 14.3],
    [5.9, 6.5, 7.1, 7.8, 8.5, 9.2, 9.9, 10.7, 11.6, 12.6, 13.8],
    [5.7, 6.3, 7.0, 7.6, 8.3, 8.9, 9.7, 10.5, 11.3, 12.3, 13.5],
    [5.5, 6.1, 6.7, 7.3, 8.0, 8.6, 9.4, 10.1, 11.0, 11.9, 13.1],
    [5.4, 6.0, 6.6, 7.2, 7.8, 8.5, 9.2, 9.9, 10.7, 11.7, 12.8],
    [5.2, 5.8, 6.4, 7.0, 7.6, 8.2, 8.9, 9.6, 10.4, 11.3, 12.4],
    [5.0, 5.6, 6.1, 6.7, 7.3, 7.9, 8.5, 9.3, 10.0, 10.9, 12.0],
    [4.8, 5.4, 5.9, 6.5, 7.0, 7.6, 8.2, 8.9, 9.7, 10.5, 11.6],
    [4.8, 5.3, 5.8, 6.3, 6.9, 7.5, 8.1, 8.8, 9.5, 10.4, 11.4],
  ],
  wheat: [
    [11.5, 12.2, 13.0, 13.7, 14.5, 15.3, 16.0, 16.9, 17.7, 18.7, 19.8],
    [11.1, 11.9, 12.6, 13.4, 14.1, 14.9, 15.6, 16.4, 17.3, 18.2, 19.3],
    [10.9, 11.7, 12.4, 13.1, 13.8, 14.6, 15.3, 16.1, 17.0, 17.9, 19.0],
    [10.7, 11.5, 12.2, 12.9, 13.6, 14.3, 15.1, 15.8, 16.7, 17.6, 18.7],
    [10.6, 11.3, 12.0, 12.7, 13.4, 14.2, 14.9, 15.7, 16.5, 17.4, 18.5],
    [10.4, 11.1, 11.8, 12.5, 13.2, 13.9, 14.6, 15.4, 16.2, 17.1, 18.2],
    [10.3, 11.0, 11.7, 12.4, 13.1, 13.8, 14.5, 15.2, 16.1, 17.0, 18.0],
    [10.1, 10.8, 11.5, 12.2, 12.9, 13.6, 14.3, 15.0, 15.8, 16.7, 17.7],
    [9.9, 10.6, 11.3, 11.9, 12.6, 13.3, 14.0, 14.7, 15.5, 16.4, 17.4],
    [9.7, 10.4, 11.1, 11.7, 12.4, 13.0, 13.7, 14.4, 15.2, 16.1, 17.1],
    [9.6, 10.3, 11.0, 11.6, 12.3, 12.9, 13.6, 14.3, 15.1, 15.9, 16.9],
  ],
  barley: [
    [8.9, 9.6, 10.3, 11.0, 11.7, 12.4, 13.1, 13.9, 14.8, 15.8, 16.9],
    [8.8, 9.5, 10.2, 10.9, 11.6, 12.3, 13.0, 13.8, 14.7, 15.6, 16.7],
    [8.7, 9.4, 10.1, 10.8, 11.5, 12.2, 12.9, 13.7, 14.6, 15.5, 16.6],
    [8.7, 9.4, 10.0, 10.7, 11.4, 12.1, 12.9, 13.6, 14.5, 15.4, 16.5],
    [8.6, 9.3, 10.0, 10.7, 11.4, 12.1, 12.8, 13.6, 14.4, 15.4, 16.5],
    [8.6, 9.3, 9.9, 10.6, 11.3, 12.0, 12.7, 13.5, 14.3, 15.3, 16.4],
    [8.5, 9.2, 9.9, 10.6, 11.2, 11.9, 12.7, 13.5, 14.3, 15.2, 16.3],
    [8.5, 9.2, 9.8, 10.5, 11.2, 11.9, 12.6, 13.4, 14.2, 15.1, 16.2],
    [8.4, 9.1, 9.7, 10.4, 11.1, 11.8, 12.5, 13.3, 14.1, 15.0, 16.1],
    [8.3, 9.0, 9.7, 10.3, 11.0, 11.7, 12.4, 13.2, 14.0, 14.9, 16.0],
    [8.3, 9.0, 9.6, 10.3, 11.0, 11.6, 12.4, 13.1, 13.9, 14.8, 15.9],
  ],
  peas: [
    [9.5, 10.7, 12.0, 13.3, 14.6, 16.0, 17.5, 19.1, 20.9, 22.9, 25.2],
    [9.4, 10.6, 11.8, 13.0, 14.4, 15.7, 17.2, 18.8, 20.6, 22.5, 24.9],
    [9.2, 10.4, 11.6, 12.9, 14.2, 15.6, 17.0, 18.6, 20.3, 22.3, 24.6],
    [9.1, 10.3, 11.5, 12.7, 14.0, 15.4, 16.8, 18.4, 20.1, 22.1, 24.4],
    [9.1, 10.2, 11.4, 12.6, 13.9, 15.3, 16.7, 18.2, 20.0, 21.9, 24.2],
    [8.9, 10.1, 11.3, 12.5, 13.8, 15.1, 16.5, 18.1, 19.7, 21.7, 23.9],
    [8.9, 10.0, 11.2, 12.4, 13.7, 15.0, 16.4, 17.9, 19.6, 21.5, 23.8],
    [8.8, 9.9, 11.1, 12.3, 13.5, 14.8, 16.2, 17.7, 19.4, 21.3, 23.6],
    [8.6, 9.8, 10.9, 12.1, 13.3, 14.6, 16.0, 17.5, 19.1, 21.0, 23.2],
    [8.5, 9.6, 10.7, 11.9, 13.1, 14.4, 15.8, 17.2, 18.9, 20.8, 23.0],
    [8.4, 9.5, 10.7, 11.8, 13.0, 14.3, 15.7, 17.1, 18.8, 20.6, 22.8],
  ],
  // PAMI's 26 and 28 °C oat rows fall to half the 22 °C row, which no
  // isotherm does; they are left out and anything warmer reads the 22 °C row.
  oats: [
    [9.8, 10.3, 10.8, 11.3, 11.9, 12.4, 13.0, 13.7, 14.4, 15.3, 16.3],
    [9.4, 10.0, 10.5, 11.0, 11.5, 12.1, 12.7, 13.4, 14.1, 15.0, 16.0],
    [9.2, 9.7, 10.2, 10.8, 11.3, 11.9, 12.5, 13.1, 13.9, 14.7, 15.8],
    [9.0, 9.5, 10.0, 10.5, 11.1, 11.6, 12.2, 12.9, 13.7, 14.5, 15.6],
    [8.8, 9.3, 9.8, 10.4, 10.9, 11.5, 12.1, 12.8, 13.5, 14.4, 15.5],
    [8.6, 9.1, 9.6, 10.2, 10.7, 11.3, 11.9, 12.6, 13.3, 14.2, 15.3],
    [8.4, 9.0, 9.5, 10.0, 10.6, 11.2, 11.8, 12.4, 13.2, 14.1, 15.2],
    [8.2, 8.8, 9.3, 9.8, 10.4, 11.0, 11.6, 12.3, 13.0, 13.9, 15.0],
    [8.0, 8.5, 9.0, 9.6, 10.1, 10.7, 11.4, 12.0, 12.8, 13.7, 14.8],
  ],
}

/** Which chart a crop reads, from its name. Null for a crop with none (potatoes, forage). */
export function emcGroupFor(cropName: string | null | undefined): EmcGroup | null {
  const n = (cropName ?? '').toLowerCase()
  if (/canola|rapeseed|mustard/.test(n)) return 'canola'
  if (/corn|maize/.test(n)) return 'corn'
  if (/barley/.test(n)) return 'barley'
  if (/\boats?\b/.test(n)) return 'oats'
  if (/wheat|durum|triticale|rye/.test(n)) return 'wheat'
  if (/bean|pea|lentil|chickpea|faba/.test(n)) return 'peas'
  return null
}

/** In words, for the card: whose chart this crop's starting point comes from. */
export function emcSourceNote(group: EmcGroup, cropName: string | null | undefined): string {
  if (group === 'corn') return 'ASABE D245.6 equation for shelled corn'
  const chart = `PAMI's ${group} chart (ASAE D245.5)`
  return group === 'peas' && /bean/i.test(cropName ?? '') ? `${chart}, the nearest published one to dry beans` : chart
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Bilinear read of a chart, held at its temperature ends and carried on in a straight line past its humidity ends. */
function readTable(rows: number[][], tC: number, rh: number): number {
  const ts = T_ROWS.slice(0, rows.length)
  const t = Math.min(ts[ts.length - 1], Math.max(ts[0], tC))
  let i = ts.findIndex((_x, k) => k < ts.length - 1 && t <= ts[k + 1])
  if (i < 0) i = ts.length - 2
  const ft = (t - ts[i]) / (ts[i + 1] - ts[i])
  const row = (r: number[]) => {
    const last = RH_COLS.length - 1
    if (rh <= RH_COLS[0]) return r[0] - ((RH_COLS[0] - rh) * (r[1] - r[0])) / 5
    if (rh >= RH_COLS[last]) return r[last] + ((rh - RH_COLS[last]) * (r[last] - r[last - 1])) / 5
    const j = Math.min(last - 1, Math.floor((rh - RH_COLS[0]) / 5))
    return lerp(r[j], r[j + 1], (rh - RH_COLS[j]) / 5)
  }
  return lerp(row(rows[i]), row(rows[i + 1]), ft)
}

/** Modified Chung-Pfost, shelled corn (ASAE D245.6): dry basis, then wet. */
function cornEmc(tC: number, rh: number): number {
  const A = 374.34
  const B = 0.18662
  const C = 31.696
  const r = Math.min(0.97, Math.max(0.1, rh / 100))
  const db = -Math.log((-(tC + C) * Math.log(r)) / A) / B
  return (100 * db) / (100 + db)
}

/**
 * The moisture (% wet basis) grain of this group settles at in air of this
 * temperature (°C) and relative humidity (%). Kept between 2% and 30%: the
 * charts stop at 35-85% RH and the line past them is a reasonable guess, not
 * a measurement.
 */
export function emc(group: EmcGroup, tC: number, rhPct: number): number {
  const rh = Math.min(100, Math.max(0, rhPct))
  const v = group === 'corn' ? cornEmc(tC, rh) : readTable(TABLES[group], tC, rh)
  return Math.min(30, Math.max(2, v))
}
