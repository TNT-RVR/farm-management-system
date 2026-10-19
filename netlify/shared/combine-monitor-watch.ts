import type { SupabaseClient } from '@supabase/supabase-js'
import { changeList, changeSummary } from '../../src/lib/combine-monitor.ts'
import { loadCombineStates } from '../../src/lib/combine-monitor-state.ts'

/**
 * Tell the managers when a combine's display goes out of date (Sam, 17 Oct
 * 2026): since it was last marked loaded, a field came onto a combine crop,
 * a boundary, name or "Combine" guidance line changed, or a field went off
 * the combine crops or stopped being farmed (to take off: advice only).
 *
 * Hourly, and at most once per load: the load row's alerted_at is set when
 * the notice goes, and stays set until someone marks the combine loaded
 * again (a new row). A morning of boundary edits therefore makes one notice
 * per combine, not one per edit, and the Combines page's badge carries the
 * running count after that. A combine never marked loaded has nothing to
 * compare with and is left alone.
 */
export async function runCombineMonitorWatch(sb: SupabaseClient, cropYear = new Date().getFullYear()): Promise<{ checked: number; alerted: string[] }> {
  // The crop year the app opens on (the calendar year). Fields with nothing
  // planned for it yet are neither added nor taken off, so the new year does
  // not set every combine off on 1 January.
  const states = await loadCombineStates(sb, cropYear)
  const alerted: string[] = []
  for (const s of states) {
    if (!s.load || s.load.alerted_at || !s.changes.length) continue
    const name = s.machine.name ?? 'A combine'
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'combine_out_of_date',
      p_title: `${name}: ${changeSummary(s.changes)}`,
      p_body: `Its display is behind the app: ${changeList(s.changes)}.`,
      p_link: '/combine?tab=monitor',
      p_details: { equipment_id: s.machine.id, load_id: s.load.id, fields: s.changes.map((c) => ({ field_id: c.fieldId, kinds: c.kinds })) },
    })
    if (error) {
      console.warn(`[combine-monitor] notify failed for ${name}: ${error.message}`)
      continue
    }
    const { error: uErr } = await sb.from('combine_monitor_loads').update({ alerted_at: new Date().toISOString() }).eq('id', s.load.id)
    if (uErr) console.warn(`[combine-monitor] could not mark ${name} alerted: ${uErr.message}`)
    alerted.push(name)
  }
  return { checked: states.length, alerted }
}
