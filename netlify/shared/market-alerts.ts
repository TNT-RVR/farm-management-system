import type { SupabaseClient } from '@supabase/supabase-js'

// Price watches: "tell me if canola goes over $760".
//
// The whole design problem here is the SECOND week. A price that crosses a line
// and then stays there is still over the line next Friday, and an alert that
// fires again every week is an alert nobody reads by the third one. So a watch
// disarms itself when it fires and only re-arms when the price comes back
// through — one notification per crossing, not per observation.

type Alert = {
  id: string
  series_id: string
  direction: 'above' | 'below'
  threshold: number
  label: string | null
  armed: boolean
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Whether a reading is on the far side of the line. */
export function crossed(value: number, direction: 'above' | 'below', threshold: number): boolean {
  return direction === 'above' ? value >= threshold : value <= threshold
}

export async function runMarketAlerts(
  sb: SupabaseClient,
): Promise<{ checked: number; fired: number; rearmed: number; detail: string }> {
  const { data: alerts } = await sb.from('market_alerts').select('*').eq('active', true)
  if (!alerts?.length) return { checked: 0, fired: 0, rearmed: 0, detail: 'no active watches' }

  let fired = 0
  let rearmed = 0
  const messages: string[] = []

  for (const raw of alerts as unknown as Alert[]) {
    const { data: last } = await sb
      .from('market_prices')
      .select('observed_on, value')
      .eq('series_id', raw.series_id)
      .not('value', 'is', null)
      .order('observed_on', { ascending: false })
      .limit(1)
    const value = num(last?.[0]?.value as number | string | null)
    if (value == null) continue

    const isOver = crossed(value, raw.direction, raw.threshold)

    if (isOver && raw.armed) {
      const { data: series } = await sb
        .from('market_series')
        .select('name, unit')
        .eq('id', raw.series_id)
        .single()
      const name = raw.label ?? (series?.name as string) ?? 'A price'
      messages.push(
        `${name} is ${raw.direction} ${raw.threshold} — now ${value} ${series?.unit ?? ''}`.trim(),
      )
      await sb
        .from('market_alerts')
        .update({
          armed: false,
          last_fired_at: new Date().toISOString(),
          last_fired_value: value,
        })
        .eq('id', raw.id)
      fired++
    } else if (!isOver && !raw.armed) {
      // Back on the near side: ready to tell them next time.
      await sb.from('market_alerts').update({ armed: true }).eq('id', raw.id)
      rearmed++
    }
  }

  // Reuses the notification path the integration watchdog already uses, so a
  // price alert reaches the same people by the same route as a stale feed.
  if (messages.length > 0) {
    // fn_notify_managers is the real function; this called 'notify_managers',
    // which never existed, so every price alert fired into nothing.
    const { error: notifyErr } = await sb.rpc('fn_notify_managers', {
      p_kind: 'market_alert',
      p_title: messages.length === 1 ? 'Price alert' : `${messages.length} price alerts`,
      p_body: messages.join('\n'),
      p_link: '/plan?tab=markets',
    })
    if (notifyErr) console.warn('[market-alerts] notify failed: ' + notifyErr.message)
  }

  return {
    checked: alerts.length,
    fired,
    rearmed,
    detail: `${alerts.length} watched, ${fired} fired, ${rearmed} re-armed`,
  }
}
