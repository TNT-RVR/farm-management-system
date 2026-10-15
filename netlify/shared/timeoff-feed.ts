import type { SupabaseClient } from '@supabase/supabase-js'
import { parseIcs, readTimeOff } from '../../src/lib/ics.ts'

/**
 * The calendar subscription link for approved staff time off.
 *
 * Any iCalendar feed of all-day events works; most HR and payroll systems
 * offer one on their time-off page.
 */
function feedUrl(): string | undefined {
  return process.env.TIMEOFF_ICS_URL
}

/**
 * Read the time-off calendar into the time_off table.
 *
 * Replaces by uid: a request withdrawn at the source disappears here too,
 * which a merge would never manage. Reports to the health board either way,
 * so a feed that stops answering — a link that was regenerated, say — is an
 * alert and not a calendar that quietly stops showing who is away.
 */
export async function syncTimeOff(sb: SupabaseClient): Promise<{ ok: boolean; events: number; detail: string }> {
  const feed = feedUrl()
  if (!feed) {
    const detail = 'TIMEOFF_ICS_URL is not set'
    await sb.from('integration_health').update({ status: 'error', detail, last_checked_at: new Date().toISOString() }).eq('source_key', 'timeoff_calendar')
    return { ok: false, events: 0, detail }
  }
  const url = feed.replace(/^webcal:/i, 'https:')
  let text: string
  try {
    const res = await fetch(url, { headers: { Accept: 'text/calendar' } })
    if (!res.ok) throw new Error(`the calendar answered ${res.status}`)
    text = await res.text()
  } catch (e) {
    const detail = `Could not read the feed: ${(e as Error).message.slice(0, 120)}`
    await sb.from('integration_health').update({ status: 'error', detail, last_checked_at: new Date().toISOString() }).eq('source_key', 'timeoff_calendar')
    return { ok: false, events: 0, detail }
  }

  const events = parseIcs(text).filter((e) => e.allDay && e.end)
  const now = new Date().toISOString()
  const rows = events.map((e) => {
    const r = readTimeOff(e.summary, e.description)
    return {
      uid: e.uid,
      who: r.who,
      kind: r.kind,
      summary: e.summary,
      reason: r.reason,
      starts_on: e.start,
      ends_on: e.end as string,
      hours: r.hours,
      synced_at: now,
    }
  })
  if (rows.length) {
    const { error } = await sb.from('time_off').upsert(rows, { onConflict: 'uid' })
    if (error) throw new Error(error.message)
  }
  // Anything not in the feed any more was withdrawn.
  const keep = rows.map((r) => r.uid)
  const { error: delErr } = keep.length
    ? await sb.from('time_off').delete().not('uid', 'in', `(${keep.map((u) => `"${u}"`).join(',')})`)
    : await sb.from('time_off').delete().neq('uid', '')
  if (delErr) throw new Error(delErr.message)

  const newest = rows.reduce<string | null>((m, r) => (m && m > r.starts_on ? m : r.starts_on), null)
  const detail = `${rows.length} time-off entries from the calendar`
  await sb.rpc('record_integration_heartbeat', { p_key: 'timeoff_calendar', p_detail: detail, p_data_at: newest ? `${newest}T00:00:00Z` : null })
  return { ok: true, events: rows.length, detail }
}
