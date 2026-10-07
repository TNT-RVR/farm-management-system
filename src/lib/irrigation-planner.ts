/**
 * This week's irrigation plan, one field at a time: when the soil reaches the
 * irrigate trigger, how long the pivot needs for a lap, so when it has to be
 * started, and whether the forecast rain makes it worth waiting.
 *
 * Pure arithmetic only — the Planner card reads the tables and hands rows in.
 *
 * Times are "wall clock" milliseconds: a local Edmonton date and time written
 * as if it were UTC. The balance is kept in local dates, and doing the sums in
 * wall time means a crossing on "Oct 3" is Oct 3 whatever zone the browser or
 * the test runner is in. Format them with timeZone 'UTC' (see fmtWall*).
 */
import type { WaterBalanceRow } from './irrigation'
import { farmTz } from './farm-context'

export type PlanBalance = Pick<
  WaterBalanceRow,
  'field_id' | 'zone_id' | 'date' | 'is_forecast' | 'avail_100_mm' | 'taw_mm' | 'raw_mm' | 'etc_mm' | 'status'
>
export type PlanWeather = { date: string; precip_mm: number | null; precip_prob: number | null }
export type PlanPivot = {
  /** FieldNET raw.run_time_100_percent: seconds for a full revolution at 100%. */
  run100S: number | null
  /** FieldNET raw.application_depth_at_full_speed: gross INCHES at 100%. */
  depth100In: number | null
  arcStartDeg: number | null
  arcEndDeg: number | null
  /** Real depth = panel depth × this (a catch-can or meter check). */
  depthCorrection: number | null
  /** field_pivots.time_to_full_circle_h, for a pivot FieldNET does not describe. */
  timeToFullCircleH: number | null
  /** field_pivots.application_efficiency. */
  efficiency: number | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The rules, in one place so the info popover quotes the same numbers. */
export const PLAN_RULES = {
  /** Biggest gross depth one pass is planned for — beyond it water runs off or goes deep. */
  maxPassGrossMm: 25,
  defaultEfficiency: 0.85,
  /** Slowest and fastest panel settings the plan will suggest. */
  minSpeed: 0.05,
  maxSpeed: 1,
  /** Rain-hold window, and the share of the planned net depth it must cover. */
  rainWindowH: 48,
  holdShare: 0.6,
  /** A day this likely and this wet before the start-by is worth watching. */
  watchProb: 70,
  watchMm: 10,
  /** "This week". */
  horizonDays: 7,
  /** Days of recent ETc averaged for days-left and the extrapolation. */
  etcDays: 7,
} as const

// ---------------------------------------------------------------------------
// Wall-clock time
// ---------------------------------------------------------------------------

/** Midnight at the start of a local ISO date, in wall ms. */
export const wallOfDate = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
/** The local ISO date a wall time falls on. */
export const isoOfWall = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** What the clock on the wall in Edmonton says at this instant, in wall ms. */
export function edmontonWallMs(d: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: farmTz(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
}

export const fmtWallDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
/** Rounded DOWN to the hour: a start-by is a deadline, so never show it later than it is. */
export const fmtWallTime = (ms: number) =>
  new Date(Math.floor(ms / HOUR) * HOUR).toLocaleString('en-CA', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  })

// ---------------------------------------------------------------------------
// The balance
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

/** The irrigate trigger: available water at which the crop starts to need it (TAW − RAW). */
export function thresholdOf(r: Pick<PlanBalance, 'taw_mm' | 'raw_mm'>): number | null {
  const taw = num(r.taw_mm)
  const raw = num(r.raw_mm)
  return taw == null || raw == null ? null : taw - raw
}

/** Water above the trigger (negative once past it). */
function marginOf(r: PlanBalance): number | null {
  const a = num(r.avail_100_mm)
  const t = thresholdOf(r)
  return a == null || t == null ? null : a - t
}

export type PlanSeries = {
  /** Null = the whole field; otherwise the zone the plan is for. */
  zoneId: string | null
  /** How many zones the field has, when it is zoned. */
  zoneCount: number
  actual: PlanBalance[]
  forecast: PlanBalance[]
}

/**
 * The one series a field is planned from. The whole-field rows when there are
 * any; on a zoned field, the zone closest to (or furthest past) its trigger
 * today — the pivot is started for the driest ground.
 */
export function pickSeries(rows: PlanBalance[]): PlanSeries | null {
  if (!rows.length) return null
  const byZone = new Map<string, PlanBalance[]>()
  for (const r of rows) {
    const k = r.zone_id ?? ''
    const list = byZone.get(k)
    if (list) list.push(r)
    else byZone.set(k, [r])
  }
  const split = (zid: string, list: PlanBalance[], zoneCount: number): PlanSeries | null => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const actual = sorted.filter((r) => !r.is_forecast)
    const last = actual.at(-1)
    if (!last) return null
    // A forecast row on or before the last actual day is left over from an
    // earlier run; only days after the soil's known state are a forecast.
    const forecast = sorted.filter((r) => r.is_forecast && r.date > last.date)
    return { zoneId: zid || null, zoneCount, actual, forecast }
  }
  const whole = byZone.get('')
  if (whole) {
    const s = split('', whole, 0)
    if (s) return s
  }
  const zones = [...byZone.entries()].filter(([k]) => k !== '')
  let best: PlanSeries | null = null
  let bestMargin = Infinity
  for (const [zid, list] of zones) {
    const s = split(zid, list, zones.length)
    if (!s) continue
    const m = marginOf(s.actual.at(-1)!) ?? Infinity
    if (!best || m < bestMargin) {
      best = s
      bestMargin = m
    }
  }
  return best
}

/** Average daily ETc over the last few actual days (null when none recorded). */
export function recentEtc(actual: PlanBalance[], days: number = PLAN_RULES.etcDays): number | null {
  const vals = actual
    .slice(-days)
    .map((r) => num(r.etc_mm))
    .filter((v): v is number => v != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export type Crossing =
  /** Already at or past the trigger. */
  | { kind: 'now'; ms: number }
  /** Inside the forecast. */
  | { kind: 'forecast'; ms: number }
  /** Past the forecast's end, run on at the recent ETc. */
  | { kind: 'extrapolated'; ms: number }
  /** No ETc to run on with, or no soil figures. */
  | { kind: 'none'; ms: null }

/**
 * When the field reaches its trigger if nothing is applied. A balance row is
 * the soil at the END of its day, so a crossing between two rows is placed in
 * proportion to how far each was from the trigger rather than at midnight.
 */
export function findCrossing(series: PlanSeries, etcPerDay: number | null, nowMs: number): Crossing {
  const latest = series.actual.at(-1)
  if (!latest) return { kind: 'none', ms: null }
  const m0 = marginOf(latest)
  if (m0 == null) return { kind: 'none', ms: null }
  if (m0 <= 0) return { kind: 'now', ms: nowMs }
  let prevEnd = wallOfDate(latest.date) + DAY
  let prevMargin = m0
  for (const r of series.forecast) {
    const m = marginOf(r)
    if (m == null) continue
    const end = wallOfDate(r.date) + DAY
    if (m <= 0) {
      const f = prevMargin / (prevMargin - m)
      return { kind: 'forecast', ms: Math.max(nowMs, prevEnd + f * (end - prevEnd)) }
    }
    prevEnd = end
    prevMargin = m
  }
  if (etcPerDay == null || etcPerDay <= 0) return { kind: 'none', ms: null }
  return { kind: 'extrapolated', ms: Math.max(nowMs, prevEnd + (prevMargin / etcPerDay) * DAY) }
}

// ---------------------------------------------------------------------------
// The pivot
// ---------------------------------------------------------------------------

/** Share of a circle the pivot waters: 1 for a full circle, or arc unknown. */
export function arcFraction(start: number | null, end: number | null): number {
  if (start == null || end == null) return 1
  const deg = (((end - start) % 360) + 360) % 360
  // 0/360, or start = end, both mean "round and round".
  return deg === 0 ? 1 : deg / 360
}

export type Lap = {
  source: 'fieldnet' | 'pivot' | 'unknown'
  lapHours: number | null
  /** Panel speed that puts the target down; null when FieldNET can't say. */
  speedPct: number | null
  /** Real gross depth at that speed (after the clamp and the depth correction). */
  appliedGrossMm: number | null
  arc: number
}

/** Efficiency as a fraction; some rows were keyed as a percent. */
export function efficiencyOf(e: number | null | undefined): number {
  const v = num(e)
  if (v == null || v <= 0) return PLAN_RULES.defaultEfficiency
  return v > 1 ? v / 100 : v
}

/**
 * One lap at the speed that applies the target gross depth.
 *
 * FieldNET gives the depth and the lap time at 100%. Depth is inversely
 * proportional to speed, so the speed for depth D is depth100 / D, and the lap
 * takes run100 / speed — scaled down for a pivot that only sweeps part of the
 * circle. The panel's depth is multiplied by the pivot's measured correction
 * first, so the speed asked for puts down the real target, not the nominal one.
 */
export function lapPlan(p: PlanPivot | null, targetGrossMm: number): Lap {
  const arc = arcFraction(p?.arcStartDeg ?? null, p?.arcEndDeg ?? null)
  const run100 = num(p?.run100S)
  const depth100In = num(p?.depth100In)
  if (run100 && run100 > 0 && depth100In && depth100In > 0 && targetGrossMm > 0) {
    const correction = num(p?.depthCorrection) || 1
    const real100 = depth100In * 25.4 * correction
    const s = Math.min(PLAN_RULES.maxSpeed, Math.max(PLAN_RULES.minSpeed, real100 / targetGrossMm))
    return {
      source: 'fieldnet',
      lapHours: (run100 / 3600 / s) * arc,
      speedPct: s * 100,
      appliedGrossMm: real100 / s,
      arc,
    }
  }
  const full = num(p?.timeToFullCircleH)
  if (full && full > 0) return { source: 'pivot', lapHours: full * arc, speedPct: null, appliedGrossMm: null, arc }
  return { source: 'unknown', lapHours: null, speedPct: null, appliedGrossMm: null, arc }
}

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------

/** Hours of a local day that fall inside [fromMs, toMs]. */
function overlapH(dayIso: string, fromMs: number, toMs: number): number {
  const a = Math.max(wallOfDate(dayIso), fromMs)
  const b = Math.min(wallOfDate(dayIso) + DAY, toMs)
  return Math.max(0, b - a) / HOUR
}

export type RainWindow = {
  /** Σ chance × depth, weighted by how much of each day is in the window. Null when no day has a chance yet. */
  expectedMm: number | null
  /** Forecast depth in the window, whatever its chance. */
  totalMm: number
  /** The highest chance of a wet day in the window, and the last wet day. */
  maxProb: number | null
  lastWetDay: string | null
  /** A wet day in the window has no chance figure yet. */
  unknown: boolean
}

export function rainWindow(days: PlanWeather[], fromMs: number, toMs: number): RainWindow {
  let expected = 0
  let anyProb = false
  let total = 0
  let maxProb: number | null = null
  let lastWet: string | null = null
  let unknown = false
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const share = overlapH(d.date, fromMs, toMs) / 24
    if (share <= 0) continue
    const mm = num(d.precip_mm) ?? 0
    const prob = num(d.precip_prob)
    total += mm * share
    if (prob != null) {
      anyProb = true
      expected += (prob / 100) * mm * share
    }
    if (mm > 0.2) {
      lastWet = d.date
      if (prob == null) unknown = true
      else maxProb = Math.max(maxProb ?? 0, prob)
    }
  }
  return { expectedMm: anyProb ? expected : null, totalMm: total, maxProb, lastWetDay: lastWet, unknown }
}

/** The first day before the deadline at least this likely and this wet. */
export function watchDay(days: PlanWeather[], fromMs: number, toMs: number): PlanWeather | null {
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (overlapH(d.date, fromMs, toMs) <= 0) continue
    const prob = num(d.precip_prob)
    const mm = num(d.precip_mm)
    if (prob != null && mm != null && prob >= PLAN_RULES.watchProb && mm >= PLAN_RULES.watchMm) return d
  }
  return null
}

export type Advice =
  | { kind: 'hold'; prob: number | null; mm: number; byDay: string | null; expectedMm: number }
  | { kind: 'watch'; prob: number; mm: number; day: string }
  | { kind: 'irrigate'; rainUnknown: boolean }
  | { kind: 'none' }

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

export type FieldPlan = {
  fieldId: string
  zoneId: string | null
  zoneCount: number
  /** The latest actual day the plan starts from. */
  asOf: string
  status: string | null
  availMm: number | null
  thresholdMm: number | null
  tawMm: number | null
  etcMm: number | null
  /** Days until the trigger at the recent ETc; 0 once past it. */
  daysLeft: number | null
  crossing: Crossing
  /** Net depth the pass is planned for, and the gross that delivers it. */
  targetNetMm: number | null
  targetGrossMm: number | null
  efficiency: number
  lap: Lap
  /** Latest moment the pivot can start and finish its lap before the trigger. */
  startByMs: number | null
  needsWater: boolean
  advice: Advice
}

export function planField(a: {
  fieldId: string
  rows: PlanBalance[]
  pivot: PlanPivot | null
  weather: PlanWeather[]
  nowMs: number
}): FieldPlan | null {
  const series = pickSeries(a.rows)
  if (!series) return null
  const latest = series.actual.at(-1)!
  const etc = recentEtc(series.actual)
  const avail = num(latest.avail_100_mm)
  const threshold = thresholdOf(latest)
  const taw = num(latest.taw_mm)
  const raw = num(latest.raw_mm)
  const daysLeft = avail != null && threshold != null && etc != null && etc > 0 ? Math.max(0, (avail - threshold) / etc) : null
  const crossing = findCrossing(series, etc, a.nowMs)

  // The pass refills to field capacity from where the soil will be when it
  // starts: today's deficit if it is already past the trigger, else the
  // deficit at the trigger (RAW) — a field with plenty in it today will still
  // have dried that far by the time the pivot goes on.
  const efficiency = efficiencyOf(a.pivot?.efficiency)
  let targetNet: number | null = null
  let targetGross: number | null = null
  if (taw != null && avail != null) {
    const deficitNow = Math.max(0, taw - avail)
    const net = crossing.kind === 'now' || raw == null ? deficitNow : Math.max(deficitNow, raw)
    targetGross = Math.min(PLAN_RULES.maxPassGrossMm, net / efficiency)
    targetNet = targetGross * efficiency
  }
  const lap = lapPlan(a.pivot, targetGross ?? PLAN_RULES.maxPassGrossMm)
  const startByMs =
    crossing.ms == null ? null : crossing.kind === 'now' ? a.nowMs : lap.lapHours == null ? null : crossing.ms - lap.lapHours * HOUR
  // The deadline that matters this week: the start-by, or the crossing itself
  // when the lap time isn't known.
  const deadline = startByMs ?? crossing.ms
  const needsWater = deadline != null && deadline <= a.nowMs + PLAN_RULES.horizonDays * DAY

  let advice: Advice = { kind: 'none' }
  if (needsWater) {
    const w = rainWindow(a.weather, a.nowMs, a.nowMs + PLAN_RULES.rainWindowH * HOUR)
    const watch = deadline != null && deadline > a.nowMs ? watchDay(a.weather, a.nowMs, deadline) : null
    if (w.expectedMm != null && targetNet != null && targetNet > 0 && w.expectedMm >= PLAN_RULES.holdShare * targetNet) {
      advice = { kind: 'hold', prob: w.maxProb, mm: w.totalMm, byDay: w.lastWetDay, expectedMm: w.expectedMm }
    } else if (watch) {
      advice = { kind: 'watch', prob: Number(watch.precip_prob), mm: Number(watch.precip_mm), day: watch.date }
    } else {
      advice = { kind: 'irrigate', rainUnknown: w.unknown }
    }
  }

  return {
    fieldId: a.fieldId,
    zoneId: series.zoneId,
    zoneCount: series.zoneCount,
    asOf: latest.date,
    status: latest.status,
    availMm: avail,
    thresholdMm: threshold,
    tawMm: taw,
    etcMm: etc,
    daysLeft,
    crossing,
    targetNetMm: targetNet,
    targetGrossMm: targetGross,
    efficiency,
    lap,
    startByMs,
    needsWater,
    advice,
  }
}

// ---------------------------------------------------------------------------
// The farm
// ---------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = { stress: 0, now: 1, soon: 2, ok: 3 }

/** When the pivot actually has to go on: the start-by, never earlier than now. */
export function effectiveStart(p: FieldPlan, nowMs: number): number | null {
  const t = p.startByMs ?? p.crossing.ms
  return t == null ? null : Math.max(nowMs, t)
}

/** Most urgent first: fields needing water by start time, then the rest by days left. */
export function sortPlans(plans: FieldPlan[], nowMs: number): FieldPlan[] {
  return [...plans].sort((a, b) => {
    if (a.needsWater !== b.needsWater) return a.needsWater ? -1 : 1
    const sa = effectiveStart(a, nowMs) ?? Infinity
    const sb = effectiveStart(b, nowMs) ?? Infinity
    if (sa !== sb) return sa - sb
    const ra = STATUS_RANK[a.status ?? ''] ?? 9
    const rb = STATUS_RANK[b.status ?? ''] ?? 9
    if (ra !== rb) return ra - rb
    return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)
  })
}

export type PumpClash = { pumpId: string; otherFieldId: string }

/**
 * Fields on one pump that both have to start within the same 24 hours. A pump
 * feeding two pivots at once splits its flow and neither lap runs to plan, so
 * these want staggering.
 */
export function pumpClashes(
  plans: FieldPlan[],
  pumpOf: (fieldId: string) => string | null | undefined,
  nowMs: number,
): Map<string, PumpClash[]> {
  const out = new Map<string, PumpClash[]>()
  const due = plans
    .filter((p) => p.needsWater && p.advice.kind !== 'hold')
    .map((p) => ({ p, pump: pumpOf(p.fieldId), t: effectiveStart(p, nowMs) }))
    .filter((x): x is { p: FieldPlan; pump: string; t: number } => Boolean(x.pump) && x.t != null)
  for (const a of due)
    for (const b of due) {
      if (a === b || a.pump !== b.pump || Math.abs(a.t - b.t) >= DAY) continue
      const list = out.get(a.p.fieldId) ?? []
      list.push({ pumpId: a.pump, otherFieldId: b.p.fieldId })
      out.set(a.p.fieldId, list)
    }
  return out
}

/** The header line's figures: how many need water, and the next one to start. */
export function plannerSummary(plans: FieldPlan[], nowMs: number): { count: number; next: FieldPlan | null; nextMs: number | null } {
  const need = plans.filter((p) => p.needsWater)
  let next: FieldPlan | null = null
  let nextMs: number | null = null
  for (const p of need) {
    if (p.advice.kind === 'hold') continue
    const t = effectiveStart(p, nowMs)
    if (t != null && (nextMs == null || t < nextMs)) {
      next = p
      nextMs = t
    }
  }
  return { count: need.length, next, nextMs }
}
