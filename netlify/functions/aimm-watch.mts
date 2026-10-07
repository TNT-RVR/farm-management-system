import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { htmlTitle, lineDiff, looksGone, readableText } from '../../src/lib/watch-text.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// §15 "staying in sync with AIMM": periodically hash the AIMM/ACIS source
// pages and flag changes for human review. Runs on a schedule AND can be
// triggered manually by a manager. NEVER auto-applies formula/table changes —
// it only raises a notification so a person diffs and updates deliberately.
// The schedule lives in aimm-watch-cron.mts, NOT here: Netlify answers 403
// with an empty body to any HTTP request for a function carrying a `schedule`
// export, before the handler runs. Declaring both is what silently broke the
// manual trigger for this job.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

async function sha256(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const buf = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
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

  const { data: sources } = await sb.from('aimm_watch').select('*')
  const now = new Date().toISOString()
  const changed: string[] = []
  // What each changed source was, what it feeds, and what moved — carried on
  // the notification so its page can show the diff and the steps.
  const findings: Record<string, unknown>[] = []

  for (const s of sources ?? []) {
    try {
      const res = await fetch(s.url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      const contentType = res.headers.get('content-type') ?? ''
      const bytes = new Uint8Array(await res.arrayBuffer())
      const body = new TextDecoder().decode(bytes)
      const isHtml = contentType.includes('html')
      if (looksGone(res.status, isHtml ? body : null)) {
        // Gone is not "changed": the source has to be found again, and the
        // model may be reading stale data meanwhile. Say so once, on the turn.
        const msg = res.status >= 400 ? `The address answers ${res.status}` : `The page now reads "${htmlTitle(body)}"`
        if (s.status !== 'error') {
          changed.push(`${s.label} (gone)`)
          findings.push({ source: s.label, url: s.url, problem: 'gone', http_status: res.status, page_title: isHtml ? htmlTitle(body) : null, feeds: s.feeds })
        }
        await sb.from('aimm_watch').update({ last_checked: now, status: 'error', last_error: `${msg} — the source has moved or been taken down.` }).eq('id', s.id)
        continue
      }
      const text = readableText(body, contentType)
      // Text sources are fingerprinted on their readable text; binaries
      // (PDFs) on their bytes.
      const hash = text != null ? await sha256(text) : await sha256(bytes)
      // The first check under this scheme only records a baseline: the hash of
      // the old raw-HTML scheme can never match, and that is not news.
      const baseline = s.last_hash == null || (text != null && s.last_text == null)
      const isChange = !baseline && s.last_hash !== hash
      if (isChange) {
        changed.push(s.label)
        const diff = text != null && s.last_text ? lineDiff(s.last_text, text) : null
        findings.push({
          source: s.label,
          url: s.url,
          problem: 'changed',
          feeds: s.feeds,
          ...(diff ? { added: diff.added, removed: diff.removed, more_lines: diff.more } : { note: 'Binary file (PDF): the file itself changed; open it to see what is new.' }),
        })
      }
      await sb
        .from('aimm_watch')
        .update({
          last_hash: hash,
          last_checked: now,
          status: isChange ? 'changed' : 'ok',
          changed_at: isChange ? now : s.changed_at,
          last_error: null,
          ...(text != null ? { last_text: text.slice(0, 300_000), prev_text: isChange ? s.last_text : s.prev_text } : {}),
        })
        .eq('id', s.id)
    } catch (e) {
      await sb
        .from('aimm_watch')
        .update({ last_checked: now, status: 'error', last_error: (e as Error).message })
        .eq('id', s.id)
    }
  }

  // Notify managers when a source changed or went (a person reviews and
  // updates deliberately; nothing is applied automatically).
  if (changed.length) {
    await sb.rpc('fn_notify_managers', {
      p_kind: 'aimm_change',
      p_title: 'AIMM source changed — review needed',
      p_body: `Changed: ${changed.join('; ')}. Open for what changed and what to check.`,
      p_link: '/irrigation?view=setup',
      p_details: { findings },
    })
  }

  // Heartbeat for the integration-health monitor (this watch job ran).
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'aimm_watch',
    p_detail: `${sources?.length ?? 0} sources checked${changed.length ? ` · ${changed.length} changed` : ''}`,
    p_data_at: null,
  })

  return new Response(JSON.stringify({ ok: true, checked: sources?.length ?? 0, changed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}


export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  return handle(req)
}

/** In-process entry for the scheduled sibling. Never exposed over HTTP. */
export const runScheduled = () => handle(null)
