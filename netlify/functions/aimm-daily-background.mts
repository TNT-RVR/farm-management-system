import { admin, requireManager } from './_fieldnet.mts'
import { syncFieldRain } from '../shared/field-rain.ts'
import { rebuildApplied } from '../shared/fieldnet-applied.ts'
import { runScheduled } from './irrigation-sync.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

// The morning AIMM run, in order: rain at each field for the last few days
// (the 6 am radar totals are out by 8), FieldNET water for the last three
// days, then the balance. The balance used to run at 6 am on whatever rain
// the model had; now it waits for the measured rain and the day's water.
//
// ?from=YYYY-MM-DD backfills rain from that date (a season is ~3000 samples,
// a few minutes) before the balance runs; ?fieldnet=season re-derives the
// whole season of FieldNET water too; ?skipFieldnet=1 leaves FieldNET alone.
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
  const today = localToday()
  const rainFrom = u.searchParams.get('from') ?? addDays(today, -4)
  const rain = await syncFieldRain(sb, { from: rainFrom, to: addDays(today, -1) })
  console.log('field rain:', JSON.stringify(rain))
  if (rain.written > 0) {
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'field_rain',
      p_detail: `${rain.fields} fields from ${rainFrom}: ${rain.written} rows, ${rain.missing} samples missing`.slice(0, 300),
      p_data_at: null,
    })
  } else {
    await sb
      .from('integration_health')
      .update({ status: 'error', detail: `No rain written (${rain.missing} missing) ${rain.errors.join('; ')}`.slice(0, 300), last_checked_at: new Date().toISOString() })
      .eq('source_key', 'field_rain')
  }
  if (u.searchParams.get('skipFieldnet') !== '1') {
    const fnFrom = u.searchParams.get('fieldnet') === 'season' ? `${today.slice(0, 4)}-04-01` : addDays(today, -3)
    try {
      const applied = await rebuildApplied(sb, { from: fnFrom, to: today })
      console.log('fieldnet applied:', JSON.stringify(applied))
    } catch (e) {
      console.error('fieldnet applied failed:', (e as Error).message)
    }
  }
  const res = await runScheduled()
  console.log('balance:', await res.clone().text())
  return new Response('ok')
}
