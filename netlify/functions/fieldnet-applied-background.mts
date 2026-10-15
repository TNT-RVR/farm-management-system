import { admin, requireManager } from './_fieldnet.mts'
import { rebuildApplied } from '../shared/fieldnet-applied.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

// Rebuild FieldNET applied water by local day and degree. Hourly from
// fieldnet-applied-cron for the last couple of days (worker key), or a
// manager's backfill of a whole season. Background: a season is a request per
// pivot per day, well past what an ordinary function may hold open.
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  const sb = admin()
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  if (!byWorker && !(await requireManager(req, sb))) return new Response('Forbidden', { status: 403 })
  const u = new URL(req.url)
  const to = u.searchParams.get('to') ?? localToday()
  const from = u.searchParams.get('from') ?? addDays(to, -2)
  const res = await rebuildApplied(sb, { from, to, onlyFieldnetId: u.searchParams.get('pivot') ?? undefined })
  console.log('fieldnet applied:', JSON.stringify(res))
  const detail = `${from}..${to}: ${res.events} day(s) of water on ${res.pivots} pivots, ${res.passes} passes${res.offline.length ? `; offline: ${res.offline.join(', ')}` : ''}`
  if (res.errors.length && !res.events) {
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: res.errors.slice(0, 3).join('; ').slice(0, 300), last_checked_at: new Date().toISOString() })
      .eq('source_key', 'fieldnet_applied')
  } else {
    await sb.rpc('record_integration_heartbeat', { p_key: 'fieldnet_applied', p_detail: detail.slice(0, 300), p_data_at: null })
  }
  // A panel gone quiet in season is worth a phone call: tell managers once,
  // on the 7 am run, while it is fresh (two to three days silent).
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: farmTz(), hour: 'numeric', hour12: false }))
  const month = Number(localToday().slice(5, 7))
  if (byWorker && hour === 7 && month >= 4 && month <= 10) {
    const { data: pivots } = await sb.from('fieldnet_systems').select('name, field_id, panel_last_seen, comms_status').not('field_id', 'is', null)
    for (const p of pivots ?? []) {
      const seen = p.panel_last_seen ? Date.parse(p.panel_last_seen as string) : null
      const age = seen == null ? null : (Date.now() - seen) / 864e5
      if (p.comms_status === 'offline' && age != null && age >= 2 && age < 3) {
        await sb.rpc('fn_notify_managers', {
          p_kind: 'fieldnet_offline',
          p_title: `Pivot panel offline: ${p.name}`,
          p_body: `${p.name} has not reported to FieldNET since ${(p.panel_last_seen as string).slice(0, 10)}. Water it applies is not being recorded — log passes by hand until it is back.`,
          p_link: `/irrigation?field=${p.field_id}`,
        })
      }
    }
  }
  return new Response('ok')
}
