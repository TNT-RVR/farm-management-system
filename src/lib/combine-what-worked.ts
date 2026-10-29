import { SETTINGS, type SettingKey } from './combine'
import { farmTz } from './farm-context'
import { gradeFor, hasBands, type MoistureBands } from './moisture'
import type { UsedSettings } from './combine-start'

/**
 * What worked (Sam, 17 Oct 2026): every loss check keeps the settings, the
 * machine, the grain moisture and the weather it was taken under
 * (combine_loss_checks, 20261017050000), so the farm's own checks can say
 * which settings lost least, and in what conditions.
 *
 * Pure. Read by the "What worked" table (pages/combine/WhatWorked.tsx) and
 * the Conditions & suggestions card (pages/combine/ConditionsAdvice.tsx),
 * which shows the lowest-loss settings in similar conditions as a history
 * line beside its rules. The AI recommendations (the card's "Ask Claude",
 * /api/combine-advice) are to use this same history: pass them
 * lowestLossInSimilar's answer and the rows behind it, never a new rule.
 */

/** A loss check with the snapshot it was taken under. Numbers may come back from the database as strings. */
export type LossHistoryRow = Partial<Record<SettingKey, number | string | null>> & {
  id: string
  checked_at: string
  crop_key: string
  field_id: string | null
  equipment_id?: string | null
  operator?: string | null
  header_type?: string | null
  loss_bu_per_acre: number | string
  loss_pct: number | string | null
  moisture_pct?: number | string | null
  moisture_from?: string | null
  /** { temp_c, rh, wind_kmh, ... } as field_work_records keeps it. */
  weather?: unknown
}

export type Conditions = { moisturePct: number | null; rh: number | null; tempC: number | null; windKmh: number | null }

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function conditionsOf(r: LossHistoryRow): Conditions {
  const w = (r.weather && typeof r.weather === 'object' ? r.weather : {}) as Record<string, unknown>
  return { moisturePct: num(r.moisture_pct), rh: num(w.rh), tempC: num(w.temp_c), windKmh: num(w.wind_kmh) }
}

/** The settings a check was taken at, as numbers; blanks left out. */
export function settingsOf(r: LossHistoryRow): Partial<Record<SettingKey, number>> {
  const out: Partial<Record<SettingKey, number>> = {}
  for (const s of SETTINGS) {
    const v = num(r[s.key])
    if (v != null) out[s.key] = v
  }
  return out
}

export const hasSettings = (r: LossHistoryRow) => Object.keys(settingsOf(r)).length > 0

/** Lower is better: by share of the crop where both have one, else bushels an acre. */
export function compareLoss(a: LossHistoryRow, b: LossHistoryRow): number {
  const pa = num(a.loss_pct)
  const pb = num(b.loss_pct)
  if (pa != null && pb != null && pa !== pb) return pa - pb
  return (num(a.loss_bu_per_acre) ?? Infinity) - (num(b.loss_bu_per_acre) ?? Infinity) || b.checked_at.localeCompare(a.checked_at)
}

/* ── Similar conditions ───────────────────────────────────────────────── */

/** How close two checks' conditions must be to count as "similar". */
export const SIMILAR = {
  /** Grain moisture, points, when the crop has no moisture bands. */
  moisturePts: 1.5,
  /** Within one band (dry / tough / wet), still no further apart than this. */
  moistureBandPts: 2.5,
  /** Relative humidity, points. */
  rhPts: 15,
} as const

/**
 * Same moisture band (the crop's dry / tough / wet, where it has bands) and
 * near the same moisture, and near the same humidity. Both need the moisture
 * and the RH known: a check without them is not evidence about conditions.
 */
export function similarConditions(a: Conditions, b: Conditions, bands?: MoistureBands | null): boolean {
  if (a.moisturePct == null || b.moisturePct == null || a.rh == null || b.rh == null) return false
  const dm = Math.abs(a.moisturePct - b.moisturePct)
  if (bands && hasBands(bands)) {
    if (gradeFor(bands, a.moisturePct) !== gradeFor(bands, b.moisturePct) || dm > SIMILAR.moistureBandPts) return false
  } else if (dm > SIMILAR.moisturePts) return false
  return Math.abs(a.rh - b.rh) <= SIMILAR.rhPts
}

export type LowestLoss = {
  /** The lowest-loss check taken in similar conditions. */
  best: LossHistoryRow
  settings: Partial<Record<SettingKey, number>>
  /** How many checks of this crop, with settings, were in similar conditions. */
  similar: number
}

/**
 * The settings that lost least in conditions like these: the farm's own
 * history, not a rule. Null when no check of the crop with settings was
 * taken in similar conditions. The single best check is returned whole —
 * settings work together, so averaging two good checks can make a bad one.
 */
export function lowestLossInSimilar(rows: readonly LossHistoryRow[], opts: { cropKey: string; now: Conditions; bands?: MoistureBands | null }): LowestLoss | null {
  const matches = rows.filter((r) => r.crop_key === opts.cropKey && hasSettings(r) && similarConditions(conditionsOf(r), opts.now, opts.bands))
  if (!matches.length) return null
  const best = [...matches].sort(compareLoss)[0]
  return { best, settings: settingsOf(best), similar: matches.length }
}

/* ── The table ────────────────────────────────────────────────────────── */

export type WhatWorkedRow = {
  row: LossHistoryRow
  settings: Partial<Record<SettingKey, number>>
  conditions: Conditions
  lossPct: number | null
  lossBu: number
  /** The lowest loss of the crop's checks with settings. */
  best: boolean
  /** At or under the crop's target loss. */
  underTarget: boolean
}

export type SortKey = 'date' | 'loss' | 'moisture' | 'temp' | 'rh' | 'wind' | SettingKey

/** The crop's checks that carry settings, each marked best / under target. Newest first. */
export function whatWorked(rows: readonly LossHistoryRow[], cropKey: string, targetLossPct: number | null): WhatWorkedRow[] {
  const mine = rows.filter((r) => r.crop_key === cropKey && hasSettings(r))
  const best = [...mine].sort(compareLoss)[0]
  return mine
    .map((r) => {
      const lossPct = num(r.loss_pct)
      return {
        row: r,
        settings: settingsOf(r),
        conditions: conditionsOf(r),
        lossPct,
        lossBu: num(r.loss_bu_per_acre) ?? 0,
        best: r === best,
        underTarget: targetLossPct != null && lossPct != null && lossPct <= targetLossPct,
      }
    })
    .sort((a, b) => b.row.checked_at.localeCompare(a.row.checked_at))
}

/** Sort the table by a column; blanks always last. */
export function sortWhatWorked(rows: readonly WhatWorkedRow[], key: SortKey, dir: 'asc' | 'desc'): WhatWorkedRow[] {
  const val = (r: WhatWorkedRow): number | string | null => {
    switch (key) {
      case 'date':
        return r.row.checked_at
      case 'loss':
        return r.lossPct ?? r.lossBu
      case 'moisture':
        return r.conditions.moisturePct
      case 'temp':
        return r.conditions.tempC
      case 'rh':
        return r.conditions.rh
      case 'wind':
        return r.conditions.windKmh
      default:
        return r.settings[key] ?? null
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return (typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)) * sign
  })
}

/* ── Prefill and moisture for a new check ─────────────────────────────── */

/**
 * Loss checks with settings as "what was run" rows, so the next check's
 * prefill (pickSettings) can start from the last check as well as from the
 * last Start a field / Field finished save: the operator who changed the fan
 * and checked again was running the new fan.
 */
export function lossChecksAsUsed(rows: readonly LossHistoryRow[], timeZone = farmTz()): UsedSettings[] {
  return rows
    .filter(hasSettings)
    .map((r) => ({
      id: `loss:${r.id}`,
      crop_key: r.crop_key,
      used_on: new Date(r.checked_at).toLocaleDateString('en-CA', { timeZone }),
      created_at: r.checked_at,
      field_id: r.field_id,
      equipment_id: r.equipment_id ?? null,
      ...settingsOf(r),
    }))
}

export type MoistureAt = { pct: number; from: string }

const farmDayHour = (iso: string, timeZone: string) => {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-CA', { timeZone })
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d)) % 24
  return { date, hour }
}

/** A meter test within this long of the check is the moisture at the time. */
export const TEST_NEAR_MS = 3 * 3_600_000
/** Failing the model, a test within this long is still better than nothing, and says how far off it was. */
export const TEST_FAR_MS = 24 * 3_600_000

/**
 * The grain moisture when a check was taken: a meter test on the field
 * within three hours, else the dry-down model's figure for that hour, else a
 * test within a day (saying how long before or after). Null with none.
 */
export function moistureForCheck(
  at: string,
  tests: readonly { tested_at: string; moisture_pct: number | string | null }[],
  hourly: readonly { date: string; hour: number; pct: number }[] = [],
  timeZone = farmTz(),
): MoistureAt | null {
  const t = Date.parse(at)
  let near: { pct: number; ms: number; at: string } | null = null
  for (const x of tests) {
    const pct = num(x.moisture_pct)
    const ms = Math.abs(Date.parse(x.tested_at) - t)
    if (pct == null || !Number.isFinite(ms)) continue
    if (!near || ms < near.ms) near = { pct, ms, at: x.tested_at }
  }
  const when = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { timeZone, hour: 'numeric', minute: '2-digit' })
  if (near && near.ms <= TEST_NEAR_MS) return { pct: near.pct, from: `meter test at ${when(near.at)}` }
  const { date, hour } = farmDayHour(at, timeZone)
  const model = hourly.find((h) => h.date === date && h.hour === hour)?.pct
  if (model != null && Number.isFinite(model)) return { pct: Math.round(model * 10) / 10, from: 'dry-down estimate' }
  if (near && near.ms <= TEST_FAR_MS) {
    const h = Math.round(near.ms / 3_600_000)
    return { pct: near.pct, from: `meter test ${h} h ${Date.parse(near.at) < t ? 'before' : 'after'}` }
  }
  return null
}
