import { useSyncExternalStore } from 'react'

/**
 * Metric/Imperial display toggle for the Irrigation views. Everything is stored
 * metric (mm, ha, m, L/s, °C — the FAO-56 / AIMM native units); this only
 * converts for display. Persisted in localStorage and shared across components
 * via a tiny external store so the toggle updates every view at once.
 */
export type UnitSystem = 'metric' | 'imperial'
const KEY = 'rvr.units'

const listeners = new Set<() => void>()
/**
 * The farm's own units (Farm setup), used until a person picks their own on
 * the toggle. Set by useApplyFarmSetup once the setup has loaded.
 */
let farmDefault: UnitSystem = 'metric'
export function setFarmUnitDefault(u: UnitSystem) {
  if (u === farmDefault) return
  farmDefault = u
  listeners.forEach((l) => l())
}
function getSnapshot(): UnitSystem {
  try {
    return (localStorage.getItem(KEY) as UnitSystem) || farmDefault
  } catch {
    return farmDefault
  }
}
export function setUnitSystem(u: UnitSystem) {
  localStorage.setItem(KEY, u)
  listeners.forEach((l) => l())
}
export function useUnitSystem(): UnitSystem {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot,
    () => 'metric',
  )
}

const MM_PER_IN = 25.4
const HA_PER_AC = 0.404686
const M_PER_FT = 0.3048
const LS_PER_GPM = 0.0630902
const PSI_PER_BAR = 14.5038

/** Convert a stored-metric value to the active unit system + format it. */
export const conv = {
  depth: (mm: number | null | undefined, u: UnitSystem, digits = 1) =>
    mm == null ? '—' : u === 'metric' ? mm.toFixed(digits) : (mm / MM_PER_IN).toFixed(digits),
  depthUnit: (u: UnitSystem) => (u === 'metric' ? 'mm' : 'in'),
  area: (ha: number | null | undefined, u: UnitSystem, digits = 1) =>
    ha == null ? '—' : u === 'metric' ? ha.toFixed(digits) : (ha / HA_PER_AC).toFixed(digits),
  areaUnit: (u: UnitSystem) => (u === 'metric' ? 'ha' : 'ac'),
  length: (m: number | null | undefined, u: UnitSystem, digits = 0) =>
    m == null ? '—' : u === 'metric' ? m.toFixed(digits) : (m / M_PER_FT).toFixed(digits),
  lengthUnit: (u: UnitSystem) => (u === 'metric' ? 'm' : 'ft'),
  flow: (ls: number | null | undefined, u: UnitSystem, digits = 0) =>
    ls == null ? '—' : u === 'metric' ? ls.toFixed(1) : (ls / LS_PER_GPM).toFixed(digits),
  flowUnit: (u: UnitSystem) => (u === 'metric' ? 'L/s' : 'GPM'),
  temp: (c: number | null | undefined, u: UnitSystem, digits = 0) =>
    c == null ? '—' : u === 'metric' ? c.toFixed(digits) : (c * 1.8 + 32).toFixed(digits),
  tempUnit: (u: UnitSystem) => (u === 'metric' ? '°C' : '°F'),
  // FieldNET reports pressure in bar; the FieldNET app itself shows psi.
  pressure: (bar: number | null | undefined, u: UnitSystem, digits = 0) =>
    bar == null ? '—' : u === 'metric' ? bar.toFixed(2) : (bar * PSI_PER_BAR).toFixed(digits),
  pressureUnit: (u: UnitSystem) => (u === 'metric' ? 'bar' : 'psi'),
}

/** Raw numeric depth conversion (for charts). */
export function depthValue(mm: number, u: UnitSystem): number {
  return u === 'metric' ? mm : mm / MM_PER_IN
}
/** Parse a user-entered depth (in the active unit) back to stored mm. */
export function depthToMm(value: number, u: UnitSystem): number {
  return u === 'metric' ? value : value * MM_PER_IN
}
