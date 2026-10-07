import type { Config } from '@netlify/functions'
import { admin } from './_jd.mts'
import { runDtnFertilizerSync } from '../shared/market-dtn.ts'
import { evaluateBuySignals } from '../shared/fert-signals.ts'
import { runNRatioWatch } from '../shared/n-ratio-watch.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// DTN publishes the week's retail fertilizer prices on Wednesdays. Read on
// Thursday morning, and again Saturday in case Wednesday's article was late
// — the upsert makes a repeat cost nothing.
//
// The schedule lives here and NOT on the -sync sibling: a function declaring
// one cannot also be reached over HTTP.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  const result = await runDtnFertilizerSync(sb, { take: 2 })
  console.log('DTN fertilizer sync:', JSON.stringify(result))
  // Then the buy window: a notification the week a product falls into the
  // cheapest third of its range.
  try {
    const signals = await evaluateBuySignals(sb)
    console.log('Buy signals:', JSON.stringify(signals))
  } catch (e) {
    console.log('Buy signals failed:', (e as Error).message)
  }
  // And whether N has moved against the crops enough to re-solve the N rates.
  try {
    const watch = await runNRatioWatch(sb)
    console.log('N ratio watch:', watch.detail)
  } catch (e) {
    console.log('N ratio watch failed:', (e as Error).message)
  }
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}

export const config: Config = { schedule: '0 13 * * 4,6' }
