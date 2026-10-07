import { createClient } from '@supabase/supabase-js'
import { judgeProbe } from '../../src/lib/probeHealth.ts'
import { MANAGER_ROLES } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// Integration / data-feed health monitor. Runs hourly on a schedule (a manager
// can also trigger it manually via POST). For each enabled source it either
// probes the upstream feed (river) or checks the heartbeat our own sync jobs
// left behind, decides ok/stale/error, and — when a source crosses INTO a bad
// state (or recovers) — alerts every manager in-app + push via fn_notify_managers.
// The schedule lives in integration-health-cron.mts, NOT here: Netlify answers 403
// with an empty body to any HTTP request for a function carrying a `schedule`
// export, before the handler runs. Declaring both is what silently broke the
// manual trigger for this job.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

type HealthRow = {
  id: string
  source_key: string
  label: string
  category: string
  check_kind: string
  stale_after_min: number
  status: string
  detail: string | null
  last_success_at: string | null
  last_checked_at: string | null
  data_at: string | null
  consecutive_fail: number
  alerted: boolean
  enabled: boolean
}

const minutesSince = (iso: string | null): number | null =>
  iso == null ? null : (Date.now() - new Date(iso).getTime()) / 60000

/** Probe the WSC realtime feed for the newest reading's timestamp. */
async function probeRiver(): Promise<{ dataAt: string | null; detail: string }> {
  const res = await fetch(
    'https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json' +
      '&STATION_NUMBER=05AD007&sortby=-DATETIME&limit=1',
  )
  if (!res.ok) throw new Error(`WSC returned ${res.status}`)
  const j = (await res.json()) as { features?: { properties: Record<string, unknown> }[] }
  const p = j.features?.[0]?.properties
  if (!p?.DATETIME) throw new Error('WSC returned no readings')
  const q = p.DISCHARGE == null ? '—' : `${p.DISCHARGE} m³/s`
  return { dataAt: p.DATETIME as string, detail: `Latest reading ${q}` }
}

/**
 * Shared body for both callers. `req` is null ONLY for the in-process call from
 * the -cron sibling, which is not reachable over HTTP and is therefore the one
 * caller allowed to skip the manager check.
 */
async function handle(req: Request | null) {
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Every HTTP caller must prove it is an active manager. Treating a missing
  // Authorization header as "this must be the scheduler" was only safe while
  // Netlify refused to route HTTP here; it is reachable now, so an absent or
  // bad token falls through to the 403 below rather than running the job.
  if (req) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: au } = await getUserMfa(sb, jwt)
    const { data: prof } = au.user
      ? await sb.from('users').select('role, active').eq('id', au.user.id).single()
      : { data: null }
    if (!prof || !MANAGER_ROLES.includes(prof.role) || !prof.active)
      return new Response(JSON.stringify({ error: 'Managers only' }), { status: 403 })
  }

  const { data: rows } = await sb.from('integration_health').select('*').eq('enabled', true)
  const now = new Date().toISOString()
  const summary: { source: string; status: string; alerted?: string }[] = []

  for (const listed of (rows ?? []) as HealthRow[]) {
    // Read again just before judging: a job that reported in since the list
    // was read (the pasture move-out check stamps at 13:15, the same minute
    // this runs) must not be judged — or written back — on the old row.
    // On 6 Oct 2026 that wrote the 5 Oct success back over the 6 Oct one, and
    // the next day the job looked 48 h stale though it had run every morning.
    const { data: fresh } = await sb.from('integration_health').select('*').eq('id', listed.id).maybeSingle()
    const r = (fresh ?? listed) as HealthRow
    let status = r.status
    let detail: string | null = null
    let dataAt = r.data_at
    let lastSuccess = r.last_success_at
    let fail = r.consecutive_fail

    try {
      if (r.check_kind === 'probe' && r.source_key === 'river_flow') {
        // A failed request is not the same thing as a feed that has stopped.
        // WSC returns a 502 now and again; alerting on that woke a phone at
        // the ranch about a reading twenty minutes old. What decides is the
        // AGE OF THE READING — see judgeProbe.
        let fetchError: string | null = null
        let probeDetail: string | undefined
        try {
          const probe = await probeRiver()
          dataAt = probe.dataAt
          probeDetail = probe.detail
        } catch (e) {
          fetchError = (e as Error).message
        }
        const verdict = judgeProbe({
          dataAt,
          staleAfterMin: r.stale_after_min,
          fetchError,
          detail: probeDetail,
        })
        status = verdict.status
        detail = verdict.detail
        if (status === 'ok') {
          // A degraded poll keeps the feed healthy but does not count as a
          // success: last_success_at is when the feed last actually answered,
          // and overwriting it here would hide a run of failures.
          if (!verdict.degraded) {
            lastSuccess = now
            fail = 0
          }
        }
      } else if (r.check_kind === 'reported') {
        // The source judged itself and wrote the answer here; this only notices
        // SILENCE.
        //
        // Needed because the heartbeat rule below cannot express "has reported
        // in, and has never once been healthy". It reads a null last_success_at
        // as "no first run yet" and stays quiet, which is right for a job
        // waiting on credentials and exactly wrong for the invoice chain, whose
        // real state on the day it was built was a gap that had stood for a
        // year. Under the heartbeat rule that alarm would have sat on 'unknown'
        // for ever — silent about the very thing it was added to catch.
        const quiet = minutesSince(r.last_checked_at)
        if (quiet == null) {
          status = 'unknown'
          detail = 'Awaiting the first report'
        } else if (quiet > r.stale_after_min) {
          status = 'stale'
          detail = `No report in ${Math.round(quiet / 60)} h`
        } else {
          // Reported recently: whatever it concluded stands.
          status = r.status
          detail = r.detail
        }
      } else {
        // Heartbeat sources: healthy if our job reported success recently enough.
        const age = minutesSince(r.last_success_at)
        if (age == null) {
          status = 'unknown' // never reported yet — don't alert
          detail = 'Awaiting first successful run'
        } else if (age > r.stale_after_min) {
          status = 'stale'
          detail = `No successful run in ${Math.round(age / 60)} h`
        } else {
          status = 'ok'
          detail = `Last run ${Math.round(age / 60)} h ago`
        }
      }
    } catch (e) {
      status = 'error'
      detail = (e as Error).message
    }

    const bad = status === 'stale' || status === 'error'
    if (bad) fail = r.consecutive_fail + 1

    // Alert on the transition INTO a bad state; notify recovery when it clears.
    let alerted = r.alerted
    if (bad && !r.alerted) {
      await sb.rpc('fn_notify_managers', {
        p_kind: 'integration_alert',
        p_title: `⚠ ${r.label}: ${status}`,
        p_body: detail ?? 'A monitored data feed needs attention.',
        p_link: '/integrations',
        p_details: {
          source_key: r.source_key,
          label: r.label,
          check_kind: r.check_kind,
          status,
          detail,
          last_success_at: lastSuccess,
          data_at: dataAt,
          stale_after_min: r.stale_after_min,
          consecutive_fail: fail,
        },
      })
      alerted = true
      summary.push({ source: r.source_key, status, alerted: 'raised' })
    } else if (!bad && r.alerted && status === 'ok') {
      await sb.rpc('fn_notify_managers', {
        p_kind: 'integration_alert',
        p_title: `✓ ${r.label}: recovered`,
        p_body: detail ?? 'The feed is healthy again.',
        p_link: '/integrations',
        p_details: { source_key: r.source_key, label: r.label, status, detail },
      })
      alerted = false
      summary.push({ source: r.source_key, status, alerted: 'recovered' })
    } else {
      summary.push({ source: r.source_key, status })
    }

    // Only the probe learns a success or a data time here. For a job's
    // heartbeat those belong to the job (record_integration_heartbeat), so
    // they are left out of the write rather than written back as read.
    const probed = r.check_kind === 'probe'
    await sb
      .from('integration_health')
      .update({
        status,
        detail,
        ...(probed ? { data_at: dataAt, last_success_at: lastSuccess } : {}),
        last_checked_at: now,
        consecutive_fail: fail,
        alerted,
        updated_at: now,
      })
      .eq('id', r.id)
  }

  return new Response(JSON.stringify({ ok: true, checked: summary.length, ran_at: now, summary }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  return handle(req)
}

/** In-process entry for the scheduled sibling. Never exposed over HTTP. */
export const runScheduled = () => handle(null)
