import type { SupabaseClient } from '@supabase/supabase-js'
import { runSoilAssessment } from './soil-assessment-core.ts'

/**
 * Writes every assessment that is missing or out of date.
 *
 * The point is that nobody waits. A write-up costs a model call and about a
 * minute; generating it when somebody opens the page means a minute of staring
 * at a spinner for something that could have been written the moment the report
 * landed. The sweep keeps them all written ahead of time, and the screen just
 * has them.
 *
 * "Out of date" is decided by soil_reports_needing_assessment, which compares a
 * hash of the samples and the surrounding crop plan. So a rotation change
 * rewrites the affected fields and nothing else — editing one crop plan does
 * not cost fifty-six model calls.
 */

/** Model calls in flight. Enough to get through a season in one run. */
const CONCURRENCY = 5

/** Stop before the platform kills the function mid-write. */
const BUDGET_MS = 12 * 60_000

export type SweepResult = {
  ok: boolean
  pending: number
  written: number
  failed: number
  ranOut: boolean
  errors: string[]
  detail: string
}

export async function runAssessmentSweep(
  sb: SupabaseClient,
  apiKey: string,
  model: string,
  opts: { limit?: number } = {},
): Promise<SweepResult> {
  const started = Date.now()
  const result: SweepResult = {
    ok: true, pending: 0, written: 0, failed: 0, ranOut: false, errors: [], detail: '',
  }

  const { data: todo, error } = await sb
    .from('soil_reports_needing_assessment')
    .select('report_id, crop_year')
    // Newest first: this year's advice is the advice somebody is about to act
    // on, and if the run is cut short the old years are the ones to lose.
    .order('crop_year', { ascending: false })
    .limit(opts.limit ?? 500)

  if (error) {
    return { ...result, ok: false, detail: `read queue failed: ${error.message}` }
  }
  const queue = (todo ?? []).map((r) => r.report_id as string)
  result.pending = queue.length

  /**
   * Report in. Called on EVERY successful sweep, including one with nothing to
   * do.
   *
   * This used to be called only after writing something, and the idle path
   * returned before reaching it. So the watchdog saw no heartbeat for three
   * hours and raised "no successful run in 9 h" while the job was in fact
   * running every hour and finding everything already current — an alarm that
   * fires precisely when the system is healthiest, which is how a board full of
   * alerts stops being read.
   */
  const heartbeat = async (detail: string) => {
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'soil_assessments',
      p_detail: detail,
      p_data_at: null,
    })
  }

  if (!queue.length) {
    result.detail = 'nothing to write'
    await heartbeat(result.detail)
    return result
  }

  let cursor = 0
  const worker = async () => {
    while (cursor < queue.length) {
      if (Date.now() - started > BUDGET_MS) {
        result.ranOut = true
        return
      }
      const id = queue[cursor++]
      try {
        const r = await runSoilAssessment(sb, id, apiKey, model)
        if (r.ok) result.written++
        else {
          result.failed++
          if (result.errors.length < 5) result.errors.push(r.detail.slice(0, 120))
        }
      } catch (e) {
        result.failed++
        if (result.errors.length < 5) result.errors.push((e as Error).message.slice(0, 120))
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  )

  result.ok = result.failed === 0
  result.detail =
    `${result.written} written of ${result.pending} pending` +
    (result.failed ? ` · ${result.failed} failed` : '') +
    (result.ranOut ? ' · ran out of time, rest will follow on the next sweep' : '') +
    (result.errors.length ? ` · ${result.errors.join('; ')}` : '')

  // Every run that executed reports in, failures and all — in the detail,
  // where they can be read on the integrations page. Withholding the heartbeat
  // on a run with one failed report made the board go stale three hours later
  // and page every manager, thirty-two times in a month, about a write-up that
  // the next sweep retried anyway. What the watchdog is for is the sweep
  // stopping; a report that failed once is not that.
  await heartbeat(result.detail)
  return result
}
