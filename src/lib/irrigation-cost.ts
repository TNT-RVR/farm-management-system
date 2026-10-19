/**
 * What one irrigation costs on one pivot — Sam, 16 Oct 2026, the Calculator's
 * Irrigation cost tab: an amount of water in, its cost, hours, kWh and how
 * much of the allotment or licence it takes out.
 *
 * Not a new model. The pumping is pivot-cost.ts depthCosts — the sum the pivot
 * pages and the water review use: gallons for the depth over the irrigated
 * acres, hours at the pivot's flow, kWh at its share of the pump's horsepower
 * over 90% motor efficiency, dollars at the farm's power price. This file only
 * turns the amount typed into inches, adds the labour, and reads it against
 * the allotment (water-allocation.ts) and the licence share.
 */
import { depthCosts } from './pivot-cost'

export const MM_PER_IN = 25.4

export type WaterUnit = 'in' | 'mm' | 'af'

/** The amount typed, as inches over the pivot's irrigated acres. */
export function inchesFrom(value: number, unit: WaterUnit, acres: number | null): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  if (unit === 'in') return value
  if (unit === 'mm') return value / MM_PER_IN
  return acres && acres > 0 ? (value * 12) / acres : null
}

/** Whether we pay to run a pivot, and why not when we don't. */
export function pivotRunsOnUs(p: { operated_by: string | null; not_used: boolean | null }): { ok: true } | { ok: false; why: string } {
  if (p.not_used) return { ok: false, why: 'never run — the field counts as dryland' }
  if (p.operated_by) return { ok: false, why: `${p.operated_by} runs this pivot and its pump, so its power is not on our bills` }
  return { ok: true }
}

export type IrrigationCost = {
  inches: number
  mm: number
  acreFeet: number
  /** What reaches the soil at the pivot's application efficiency. */
  intoSoilIn: number | null
  hours: number
  kwh: number | null
  power: number | null
  labour: number | null
  total: number | null
  perAcre: number | null
  perAcreInch: number | null
  /** What the water itself is worth (farms.water_value_af); shown, not added: it is not cash. */
  waterValue: number | null
  /** Share of the season's allotment this application takes, and where the season stands after it. */
  allotment: { allottedIn: number; pct: number; usedIn: number | null; afterPct: number | null } | null
  licence: { shareAf: number; pct: number; usedAf: number | null; afterPct: number | null } | null
}

export function irrigationCost(o: {
  acres: number | null
  gpm: number | null
  hp: number | null
  pricePerKwh: number
  inches: number | null
  efficiency?: number | null
  wage?: number | null
  labourHours?: number | null
  waterValueAf?: number | null
  allottedIn?: number | null
  licenceAf?: number | null
  /** Already pumped this season, gross inches over the pivot. */
  usedIn?: number | null
}): IrrigationCost | null {
  const { acres, inches } = o
  if (!acres || acres <= 0 || inches == null || !(inches > 0)) return null
  const row = depthCosts({ acres, gpm: o.gpm, hp: o.hp, pricePerKwh: o.pricePerKwh, waterValueAf: o.waterValueAf, depths: [inches] })?.[0]
  if (!row) return null
  const labour = o.wage != null && o.labourHours != null && o.labourHours > 0 ? o.wage * o.labourHours : null
  const total = row.cost == null ? null : row.cost + (labour ?? 0)
  const acreFeet = (acres * inches) / 12
  const used = o.usedIn != null && o.usedIn >= 0 ? o.usedIn : null
  const allotted = o.allottedIn != null && o.allottedIn > 0 ? o.allottedIn : null
  const share = o.licenceAf != null && o.licenceAf > 0 ? o.licenceAf : null
  const usedAf = used != null ? (acres * used) / 12 : null
  return {
    inches,
    mm: inches * MM_PER_IN,
    acreFeet,
    intoSoilIn: o.efficiency != null && o.efficiency > 0 ? inches * o.efficiency : null,
    hours: row.hours,
    kwh: row.kwh,
    power: row.cost,
    labour,
    total,
    perAcre: total == null ? null : total / acres,
    perAcreInch: total == null ? null : total / acres / inches,
    waterValue: row.waterValue,
    allotment: allotted ? { allottedIn: allotted, pct: (inches / allotted) * 100, usedIn: used, afterPct: used != null ? ((used + inches) / allotted) * 100 : null } : null,
    licence: share ? { shareAf: share, pct: (acreFeet / share) * 100, usedAf, afterPct: usedAf != null ? ((usedAf + acreFeet) / share) * 100 : null } : null,
  }
}
