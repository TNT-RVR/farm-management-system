import type { SupabaseClient } from '@supabase/supabase-js'
import { fieldnetAccessToken, fieldnetGet, listFrom } from '../functions/_fieldnet.mts'
import { areaWeightedDepth, type AppliedFeature } from './fieldnet-sync-core.ts'
import { addDays, eachDay, monthsIn } from '../../src/lib/date-range.ts'

// Historical applied-irrigation backfill.
//
// The live sync (fieldnet-sync-core) can only ever record forward: it diffs a
// per-pivot cumulative watermark taken at the start of today, so it started
// producing irrigation_events the day that code shipped and knows nothing about
// the season before it. That left the AIMM balance crediting no water at all
// from planting through to August, which makes every depletion curve before
// then wrong rather than merely incomplete.
//
// FieldNET's /applied-irrigation takes an arbitrary from/to, so the past is
// recoverable — but NOT by asking for one day at a time.
//
// areaWeightedDepth divides by the degrees present in the RESPONSE, and a
// one-day window only contains the arc the pivot actually swept that day. A
// pivot covering 140 degrees at 25 mm therefore reports 25 mm as the field
// average, when the field itself received 25 x 140/360, about 10 mm. Across a
// two- or three-day rotation that compounds, and the first version of this
// backfill over-counted every field by 1.85x to 2.91x against the live sync.
//
// So this differences cumulative windows instead, which is what the live sync
// does and why the live sync is right: over a window long enough to contain a
// full rotation the denominator IS the whole circle, so the figure is a true
// field average. A day is then cum(day) - cum(day before it).
//
// Differencing also handles partial-circle "window wiper" pivots for free.
// Dividing by a hard 360 would have under-counted those by however much of the
// circle they never visit, and would have needed the wiper angles to fix.

/** One request per pivot per day is the expensive part; keep a lid on it. */
const CONCURRENCY = 5

/** Below this, a day is noise (dew on the sensor, a rounding tail) not a pass. */
const MIN_MM = 0.5

export type BackfillResult = {
  ok: boolean
  pivots: number
  daysProbed: number
  monthsSkipped: number
  written: number
  skippedExisting: number
  errors: string[]
  detail: string
}

/** Run tasks with a bounded number in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export async function runFieldnetBackfill(
  sb: SupabaseClient,
  opts: { from: string; to: string },
): Promise<BackfillResult> {
  const result: BackfillResult = {
    ok: true, pivots: 0, daysProbed: 0, monthsSkipped: 0,
    written: 0, skippedExisting: 0, errors: [], detail: '',
  }

  const { data: systems, error: sysErr } = await sb
    .from('fieldnet_systems')
    .select('fieldnet_id, name, field_id')
    .not('field_id', 'is', null)

  if (sysErr) {
    result.ok = false
    result.detail = `read systems FAILED: ${sysErr.message}`
    return result
  }
  const pivots = systems ?? []
  result.pivots = pivots.length
  if (!pivots.length) {
    result.detail = 'no FieldNET pivots are linked to a field'
    return result
  }

  // Never overwrite what the live sync already recorded: it saw the day as it
  // happened, this only reconstructs it. Existing refs are left alone.
  const { data: existing } = await sb
    .from('irrigation_events')
    .select('fieldnet_ref')
    .not('fieldnet_ref', 'is', null)
  const haveRef = new Set((existing ?? []).map((e) => e.fieldnet_ref as string))

  const token = await fieldnetAccessToken(sb)

  const depthFor = async (fieldnetId: string, from: string, to: string) => {
    const feats = listFrom(
      await fieldnetGet(token, `/irrigation-systems/${fieldnetId}/applied-irrigation?from=${from}&to=${to}`),
    ) as AppliedFeature[]
    return areaWeightedDepth(feats)
  }

  type Job = { fieldnetId: string; fieldId: string; name: string; date: string }
  const jobs: Job[] = []

  // Coarse pass first. A pivot that applied nothing across a whole month does
  // not need thirty more requests to prove it, and April/May are mostly dry
  // here — this is what keeps the run inside a background function's budget.
  for (const p of pivots) {
    const fieldnetId = p.fieldnet_id as string
    const fieldId = p.field_id as string
    const name = (p.name as string) ?? fieldnetId
    for (const m of monthsIn(opts.from, opts.to)) {
      const days = eachDay(m.start, m.end).filter((d) => !haveRef.has(`${fieldnetId}:${d}`))
      if (!days.length) {
        result.skippedExisting += eachDay(m.start, m.end).length
        continue
      }
      try {
        const monthMm = await depthFor(fieldnetId, m.start, m.end)
        if (monthMm < MIN_MM) {
          result.monthsSkipped++
          continue
        }
      } catch (e) {
        // A failed probe must not silently drop the month — fall through and
        // let the per-day pass decide, rather than assuming it was dry.
        result.errors.push(`${name} ${m.key} probe: ${(e as Error).message.slice(0, 80)}`)
      }
      for (const date of days) jobs.push({ fieldnetId, fieldId, name, date })
    }
  }

  const rows: {
    field_id: string
    date: string
    gross_mm: number
    source: string
    fieldnet_ref: string
  }[] = []

  // Every cumulative window starts here. January is before any irrigation, so
  // the running total genuinely begins at zero — anchoring mid-season would make
  // the first day a bare one-day window and reintroduce the very error this
  // avoids.
  const anchor = `${opts.from.slice(0, 4)}-01-01`

  // A day needs the cumulative at its own end AND at the previous day's end.
  // Consecutive days share boundaries, so this is about one request per day
  // rather than two, and it stays correct when a dry month leaves a gap.
  const boundaries = new Map<string, Set<string>>()
  for (const j of jobs) {
    if (!boundaries.has(j.fieldnetId)) boundaries.set(j.fieldnetId, new Set())
    const set = boundaries.get(j.fieldnetId)!
    set.add(j.date)
    set.add(addDays(j.date, -1))
  }

  const cumJobs: { fieldnetId: string; name: string; day: string }[] = []
  const nameOf = new Map(jobs.map((j) => [j.fieldnetId, j.name]))
  for (const [fieldnetId, set] of boundaries) {
    for (const day of set) cumJobs.push({ fieldnetId, name: nameOf.get(fieldnetId) ?? fieldnetId, day })
  }

  const cum = new Map<string, number>() // `${fieldnetId}:${day}` -> mm through end of day
  await pool(cumJobs, CONCURRENCY, async (c) => {
    result.daysProbed++
    try {
      // Cumulative from the anchor through the END of `day`.
      const mm = await depthFor(c.fieldnetId, anchor, addDays(c.day, 1))
      cum.set(`${c.fieldnetId}:${c.day}`, mm)
    } catch (e) {
      if (result.errors.length < 10) {
        result.errors.push(`${c.name} ${c.day}: ${(e as Error).message.slice(0, 80)}`)
      }
    }
  })

  for (const j of jobs) {
    const today = cum.get(`${j.fieldnetId}:${j.date}`)
    const yesterday = cum.get(`${j.fieldnetId}:${addDays(j.date, -1)}`)
    // A missing boundary means one of the two requests failed. Skip rather than
    // guess: half a difference is a wrong number, not a partial one.
    if (today == null || yesterday == null) continue
    // Cumulative should only rise. A dip means a FieldNET-side reset or a
    // reporting correction, not negative irrigation.
    const mm = Math.min(100, Math.max(0, today - yesterday))
    if (mm >= MIN_MM) {
      rows.push({
        field_id: j.fieldId,
        date: j.date,
        gross_mm: Math.round(mm * 10) / 10,
        source: 'fieldnet',
        fieldnet_ref: `${j.fieldnetId}:${j.date}`,
      })
    }
  }

  // One write at the end rather than per day: 1600 probes producing a few
  // hundred rows should not be a few hundred round trips to Postgres.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb
      .from('irrigation_events')
      .upsert(chunk, { onConflict: 'fieldnet_ref' })
    if (error) {
      result.ok = false
      result.errors.push(`write: ${error.message.slice(0, 120)}`)
    } else {
      result.written += chunk.length
    }
  }

  result.detail =
    `${result.written} day(s) of applied water written across ${result.pivots} pivot(s)` +
    ` from ${opts.from} to ${opts.to}` +
    ` [${result.daysProbed} day-probes, ${result.monthsSkipped} dry month(s) skipped,` +
    ` ${result.skippedExisting} already recorded]` +
    (result.errors.length ? ` ERRORS: ${result.errors.slice(0, 3).join('; ')}` : '')

  return result
}
