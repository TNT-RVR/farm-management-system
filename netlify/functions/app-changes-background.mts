import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'
import { lastWeekStart, writeWeek } from '../shared/app-changes.ts'

// Writes the "what changed in the app" summary for one week (a Monday), for
// the What's new page and the Monday meeting. Background: the model reads a
// busy week's two hundred commits. Woken by app-changes-cron (Monday morning)
// or by a manager's "Write it now" (/api/app-changes-run), with the worker key.
export default async (req: Request) => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!workerKey || req.headers.get('x-worker-key') !== workerKey) return new Response('Not authorised', { status: 403 })
  if (!apiKey || !url || !serviceKey) return new Response('Not configured', { status: 500 })

  const { weekStart } = (await req.json().catch(() => ({}))) as { weekStart?: string }
  const week = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : lastWeekStart()
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const r = await writeWeek(sb, week, apiKey)
    return new Response(`${week}: ${r.items} changes from ${r.commits} commits`, { status: 200 })
  } catch (e) {
    await sb
      .from('app_change_weeks')
      .upsert({ week_start: week, week_end: week, status: 'error', error: (e as Error).message.slice(0, 400) }, { onConflict: 'week_start', ignoreDuplicates: false })
    return new Response((e as Error).message, { status: 200 })
  }
}
