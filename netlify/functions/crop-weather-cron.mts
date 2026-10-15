import { admin } from './_jd.mts'
import { runCropWeatherWatch } from '../shared/crop-weather-watch.ts'
import { runFreezeWatch } from '../shared/freeze-watch.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Frost and heat by crop stage, every morning at 6:30 (12:30 UTC) and again at
// 4:30 in the afternoon, so an evening frost forecast is heard before dark. A
// warning already sent is not sent again (crop_weather_alerts).
//
// Also the freeze watch: checklists due before the first hard freeze
// (winterizing). Each runs on its own, so one failing doesn't stop the other.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const out: Record<string, unknown> = {}
  let failed = false
  for (const [name, run] of [
    ['crops', () => runCropWeatherWatch(sb)],
    ['freeze', () => runFreezeWatch(sb)],
  ] as const) {
    try {
      const r = await run()
      out[name] = r
      console.log(`${name}:`, r.detail)
    } catch (e) {
      failed = true
      out[name] = { error: (e as Error).message }
      console.error(`${name} failed:`, (e as Error).message)
    }
  }
  // Once nothing is left standing the crop check returns before its own
  // heartbeat, which used to make this job look dead all winter.
  if (!failed) {
    const detail = Object.values(out).map((r) => (r as { detail?: string }).detail).filter(Boolean).join(' · ')
    await sb.rpc('record_integration_heartbeat', { p_key: 'crop_weather', p_detail: detail, p_data_at: null })
  }
  return new Response(JSON.stringify(out), { status: failed ? 500 : 200, headers: { 'Content-Type': 'application/json' } })
}

export const config = { schedule: '30 12,22 * * *' }
