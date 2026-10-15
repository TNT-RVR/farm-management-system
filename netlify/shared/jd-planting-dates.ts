import type { SupabaseClient } from '@supabase/supabase-js'
import { farmTz } from '../../src/lib/farm-context.ts'

// Deere seeding passes → field_crop_seasons.planting_date, which is what sets
// every Kc stage boundary in the AIMM balance.
//
// Reads jd_field_operations (already synced by jd-operations-core) rather than
// calling Deere again: the operations sync runs every 30 minutes, so a seeding
// pass closed in the cab is in our table long before anyone opens Setup.

/** Southern Alberta. A pass closed at 21:00 local is still that day's seeding. */
const farmDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })

export type PlantingSyncResult = {
  ok: boolean
  written: number       // rows given a date they did not have, or a changed one
  created: number       // season rows that did not exist at all
  keptManual: number    // a person's date left alone
  unchanged: number
  seedingOps: number    // matching operations read back from Deere's table
  fieldYears: number    // distinct field-years those resolved to
  errors: string[]
  detail: string
}

type OpRow = {
  field_id: string | null
  crop_season: number | null
  started_at: string | null
  operation_type: string | null
}

type SeasonRow = {
  id: string
  field_id: string
  crop_year: number
  planting_date: string | null
  planting_date_source: string | null
}

export async function syncPlantingDates(sb: SupabaseClient): Promise<PlantingSyncResult> {
  const now = new Date().toISOString()
  const result: PlantingSyncResult = {
    ok: true, written: 0, created: 0, keptManual: 0, unchanged: 0,
    seedingOps: 0, fieldYears: 0, errors: [], detail: '',
  }

  // Deere's live org reports lowercase 'seeding'; the case and the exact verb
  // are not contractual, so match loosely rather than miss a whole season.
  const { data: ops, error: opsErr } = await sb
    .from('jd_field_operations')
    .select('field_id, crop_season, started_at, operation_type')
    .or('operation_type.ilike.seeding,operation_type.ilike.planting')
    .is('duplicate_of', null)
    .not('field_id', 'is', null)
    .not('started_at', 'is', null)

  if (opsErr) {
    result.ok = false
    result.detail = `read operations FAILED: ${opsErr.message}`
    await heartbeat(sb, result)
    return result
  }
  result.seedingOps = (ops ?? []).length

  // Earliest seeding pass per field-year. A field seeded over two days emerges
  // from the first pass, and a re-seed should not push the stage clock later
  // than the crop that is actually standing.
  const earliest = new Map<string, { field_id: string; crop_year: number; date: string }>()
  for (const o of (ops ?? []) as OpRow[]) {
    if (!o.field_id || !o.started_at) continue
    const date = farmDate(o.started_at)
    // cropSeason is usually present; when it isn't, the season is the year the
    // ground was worked.
    const year = o.crop_season ?? Number(date.slice(0, 4))
    if (!Number.isFinite(year)) continue
    const key = `${o.field_id}:${year}`
    const prev = earliest.get(key)
    if (!prev || date < prev.date) {
      earliest.set(key, { field_id: o.field_id, crop_year: year, date })
    }
  }

  result.fieldYears = earliest.size
  if (earliest.size === 0) {
    result.detail =
      'no seeding operations matched — ' +
      'check jd_field_operations has rows with operation_type like seeding, a non-null field_id, and a started_at'
    await heartbeat(sb, result)
    return result
  }

  const years = [...new Set([...earliest.values()].map((v) => v.crop_year))]
  const { data: seasons, error: seasonErr } = await sb
    .from('field_crop_seasons')
    .select('id, field_id, crop_year, planting_date, planting_date_source')
    .in('crop_year', years)

  if (seasonErr) {
    result.ok = false
    result.detail = `read seasons FAILED: ${seasonErr.message}`
    await heartbeat(sb, result)
    return result
  }

  const byKey = new Map(
    ((seasons ?? []) as SeasonRow[]).map((s) => [`${s.field_id}:${s.crop_year}`, s]),
  )

  for (const [key, want] of earliest) {
    const existing = byKey.get(key)

    // A date a person typed outranks the machine. If the manager corrected it
    // because the monitor was logging the wrong field, the correction stands.
    if (existing?.planting_date_source === 'manual' && existing.planting_date) {
      result.keptManual++
      continue
    }

    if (existing) {
      if (existing.planting_date === want.date && existing.planting_date_source === 'john_deere') {
        result.unchanged++
        continue
      }
      const { error } = await sb
        .from('field_crop_seasons')
        .update({
          planting_date: want.date,
          planting_date_source: 'john_deere',
          planting_date_synced_at: now,
        })
        .eq('id', existing.id)
      if (error) {
        result.ok = false
        if (result.errors.length < 5) result.errors.push(`update ${key}: ${error.message.slice(0, 120)}`)
        continue
      }
      result.written++
    } else {
      // No season row yet — create one carrying the same defaults the Setup tab
      // writes, so the field appears there already dated.
      const { error } = await sb.from('field_crop_seasons').insert({
        field_id: want.field_id,
        crop_year: want.crop_year,
        planting_date: want.date,
        planting_date_source: 'john_deere',
        planting_date_synced_at: now,
        // Left null so the balance derives it from the pivot's flow and
        // irrigated acres rather than inheriting a placeholder.
        system_capacity_mm_day: null,
        application_efficiency: 0.85,
      })
      if (error) {
        result.ok = false
        if (result.errors.length < 5) result.errors.push(`insert ${key}: ${error.message.slice(0, 120)}`)
        continue
      }
      result.created++
      result.written++
    }
  }

  result.detail =
    `${result.written} planting date(s) from Deere` +
    ` · ${result.seedingOps} seeding op(s) → ${result.fieldYears} field-year(s)` +
    (result.created ? ` · ${result.created} new season row(s)` : '') +
    (result.keptManual ? ` · ${result.keptManual} manual kept` : '') +
    (result.unchanged ? ` · ${result.unchanged} already current` : '') +
    (result.errors.length ? ` · ERRORS: ${result.errors.join('; ')}` : '')

  await heartbeat(sb, result)
  return result
}

async function heartbeat(sb: SupabaseClient, r: PlantingSyncResult) {
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'jd_planting_dates',
    p_detail: r.detail,
    p_data_at: null,
  })
}
