import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { remindPrograms } from '../shared/fert-signals.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { farmTimeIs, farmTimeLabel, type FarmTime } from '../../src/lib/farm-clock.ts'

// Early-order deadlines: a reminder to managers a week out, once, and any
// programme past its date marked passed. Daily at 7 am on the farm's clock.
const WHEN: FarmTime = { hours: [7] }

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  // Every hour; acts only at its time on the farm's clock (Farm setup's time zone).
  if (!farmTimeIs(WHEN)) return new Response(`Not yet: runs ${farmTimeLabel(WHEN)}`)
  const sb = admin()
  let detail: string
  try {
    const r = await remindPrograms(sb)
    detail = `${r.reminded} reminded, ${r.passed} passed`
  } catch (e) {
    detail = `failed: ${(e as Error).message.slice(0, 120)}`
  }
  await sb.rpc('record_integration_heartbeat', { p_key: 'fert_reminders', p_detail: detail, p_data_at: new Date().toISOString() })
  console.log('Fertilizer reminders:', detail)
  return new Response(detail)
}

export const config: Config = { schedule: '0 * * * *' }
