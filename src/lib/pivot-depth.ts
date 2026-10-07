/**
 * Is a pivot really putting down what FieldNET says?
 *
 * Every FieldNET depth the irrigation model uses comes from the panel's depth
 * chart (`application_depth_at_full_speed`, inches gross at 100% speed). That
 * chart is only as good as the flow and area the panel was set up with. This
 * module cross-checks it against flow × time ÷ area, and turns a field check
 * (catch cans, a flow meter) into the per-pivot `depth_correction` multiplier.
 *
 * Pure maths only — no React, no Supabase.
 */
import { pivotArc } from './pivot-sectors'

export const L_PER_USGAL = 3.78541
export const M2_PER_ACRE = 4046.86
export const MM_PER_IN = 25.4
export const L_PER_M3 = 1000

export const CORRECTION_MIN = 0.5
export const CORRECTION_MAX = 1.5

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pos = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

/** What we read from `fieldnet_systems.raw`, in FieldNET's own units. */
export type PanelSetup = {
  /** Gross inches at 100% speed (FieldNET's depth chart). */
  depth100In: number | null
  /** Seconds per full revolution at 100% speed. */
  runTime100S: number | null
  /** US gpm as configured on the panel. */
  flowGpm: number | null
  /** Wetted length, m (falls back to system length). */
  wetM: number | null
  /** Irrigated area as configured, acres. */
  areaAc: number | null
  partialStart: number | null
  partialEnd: number | null
  commStatus: string | null
  lastUpdated: string | null
}

export function readPanel(raw: unknown): PanelSetup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    depth100In: pos(r.application_depth_at_full_speed),
    runTime100S: pos(r.run_time_100_percent),
    flowGpm: pos(r.reporting_flow),
    wetM: pos(r.system_length_wet) ?? pos(r.system_length),
    areaAc: pos(r.irrigated_area),
    partialStart: num(r.partial_start_angle),
    partialEnd: num(r.partial_end_angle),
    commStatus: typeof r.communication_status === 'string' ? r.communication_status : null,
    lastUpdated: typeof r.last_updated === 'string' ? r.last_updated : null,
  }
}

/** Share of a full circle the pivot waters: 1 for a full circle (FieldNET's 0/0). */
export function arcFraction(start: number | null | undefined, end: number | null | undefined): number {
  return pivotArc(start, end).span / 360
}

export type AreaSource = 'record' | 'fieldnet' | 'radius'
export type Area = { acres: number; source: AreaSource }

/**
 * The irrigated area: the farm's own pivot record first, then FieldNET's
 * configured area, then π·r² of the wetted length scaled to the watered arc.
 */
export function irrigatedArea(o: {
  recordAcres?: number | null
  fieldnetAcres?: number | null
  wetM?: number | null
  arcFrac?: number
}): Area | null {
  const rec = pos(o.recordAcres)
  if (rec) return { acres: rec, source: 'record' }
  const fn = pos(o.fieldnetAcres)
  if (fn) return { acres: fn, source: 'fieldnet' }
  const r = pos(o.wetM)
  if (r) return { acres: (Math.PI * r * r * (o.arcFrac ?? 1)) / M2_PER_ACRE, source: 'radius' }
  return null
}

/**
 * Gross mm one pass puts down at 100% speed from flow alone:
 * flow (US gpm → L/min) × minutes to cross the watered arc ÷ area (m²).
 * One litre over one square metre is one millimetre.
 *
 * `run_time_100_percent` is a full revolution, so a partial pivot crosses its
 * arc in `runTime × arcFrac` — and its area is the arc's, so a full circle and
 * a part circle with the same flow per metre give the same depth.
 */
export function flowDepthMm(gpm: number | null | undefined, runTime100S: number | null | undefined, acres: number | null | undefined, arcFrac = 1): number | null {
  const q = pos(gpm)
  const t = pos(runTime100S)
  const a = pos(acres)
  if (!q || !t || !a || !(arcFrac > 0)) return null
  const litres = q * L_PER_USGAL * (t / 60) * arcFrac
  return litres / (a * M2_PER_ACRE)
}

export type Verdict = 'consistent' | 'check' | 'likely_wrong'

/** Within ±5% consistent, 5–15% check, beyond 15% likely wrong. */
export function verdictFor(ratio: number | null | undefined): Verdict | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null
  const off = Math.abs(ratio - 1)
  if (off <= 0.05 + 1e-9) return 'consistent'
  if (off <= 0.15 + 1e-9) return 'check'
  return 'likely_wrong'
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  consistent: 'consistent',
  check: 'check',
  likely_wrong: 'likely wrong',
}

export function ratioOf(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !(b > 0) || !Number.isFinite(a)) return null
  return a / b
}

/** The panel's depth at a given speed: speed is percent-timer, so depth scales as 1/speed. */
export function panelMmAtSpeed(depth100Mm: number | null | undefined, speedPct: number | null | undefined): number | null {
  const d = pos(depth100Mm)
  const s = pos(speedPct)
  if (!d || !s) return null
  return d / (s / 100)
}

/** Correction = what really went down ÷ what the panel says. */
export function impliedCorrection(measuredMm: number | null | undefined, panelMm: number | null | undefined): number | null {
  const m = pos(measuredMm)
  const p = pos(panelMm)
  if (!m || !p) return null
  return m / p
}

/** Round to 0.01 and keep inside the 0.5–1.5 the database allows. */
export function clampCorrection(x: number): number {
  const r = Math.round(x * 100) / 100
  return Math.min(CORRECTION_MAX, Math.max(CORRECTION_MIN, r))
}

/**
 * Season water the correction moves. The FieldNET rebuild writes corrected
 * depths (panel x correction) into irrigation_events, so the panel's own
 * figure is stored / correction and the correction moved stored - that. Signed.
 */
export function seasonEffectMm(storedGrossMm: number, correction: number): number {
  if (!(correction > 0)) return 0
  return storedGrossMm - storedGrossMm / correction
}

export type MeterUnit = 'usgal' | 'm3'

/**
 * A flow-meter reading turned into depth.
 *
 * `volume` over `hours` gives the real flow. `onFieldMm` is that volume spread
 * over the irrigated area (what went down in those hours). `perPassMm` is what
 * one pass at `speedPct` puts down at that real flow — the number to compare
 * with the panel's depth at the same speed. Needs the revolution time for that.
 */
export function meterToDepth(o: {
  volume: number
  unit: MeterUnit
  hours: number
  acres: number | null | undefined
  runTime100S?: number | null
  arcFrac?: number
  speedPct?: number | null
}): { gpm: number; litresPerS: number; onFieldMm: number | null; perPassMm: number | null } | null {
  const v = pos(o.volume)
  const h = pos(o.hours)
  if (!v || !h) return null
  const litres = o.unit === 'm3' ? v * L_PER_M3 : v * L_PER_USGAL
  const litresPerS = litres / (h * 3600)
  const gpm = (litresPerS * 60) / L_PER_USGAL
  const a = pos(o.acres)
  const onFieldMm = a ? litres / (a * M2_PER_ACRE) : null
  const at100 = flowDepthMm(gpm, o.runTime100S, a, o.arcFrac ?? 1)
  const perPassMm = at100 != null ? panelMmAtSpeed(at100, o.speedPct ?? 100) : null
  return { gpm, litresPerS, onFieldMm, perPassMm }
}

/** FieldNET's panel has stopped reporting: offline and silent for more than two days. */
export function panelOffline(commStatus: string | null | undefined, lastUpdated: string | null | undefined, now: number): boolean {
  if (commStatus !== 'offline' || !lastUpdated) return false
  const t = Date.parse(lastUpdated)
  return Number.isFinite(t) && now - t > 2 * 864e5
}

export type FlowCheck = { label: 'fieldnet' | 'record'; gpm: number; mm: number; ratio: number; verdict: Verdict }

/** Everything the screen shows for one pivot, from its panel setup and the farm's record. */
export function assessPivot(panel: PanelSetup, record: { gpm?: number | null; acres?: number | null } | null) {
  const arcFrac = arcFraction(panel.partialStart, panel.partialEnd)
  const panelMm = panel.depth100In != null ? panel.depth100In * MM_PER_IN : null
  const area = irrigatedArea({ recordAcres: record?.acres, fieldnetAcres: panel.areaAc, wetM: panel.wetM, arcFrac })
  const flows: FlowCheck[] = []
  const add = (label: FlowCheck['label'], gpm: number | null) => {
    if (!gpm) return
    const mm = flowDepthMm(gpm, panel.runTime100S, area?.acres, arcFrac)
    const ratio = ratioOf(mm, panelMm)
    const verdict = verdictFor(ratio)
    if (mm != null && ratio != null && verdict) flows.push({ label, gpm, mm, ratio, verdict })
  }
  const fnGpm = pos(panel.flowGpm)
  const recGpm = pos(record?.gpm)
  add('fieldnet', fnGpm)
  // The farm's record only when it says something different (more than 0.5%).
  if (recGpm && (!fnGpm || Math.abs(recGpm - fnGpm) / fnGpm > 0.005)) add('record', recGpm)
  const flowGap = fnGpm && recGpm ? recGpm / fnGpm - 1 : null
  return { arcFrac, panelMm, area, flows, flowGap }
}
