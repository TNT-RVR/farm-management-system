import { runScheduled } from './integration-health.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Scheduled half of the hourly feed-health evaluation. A manager re-checking a feed by hand needs
// the HTTP half reachable, and a function declaring a schedule is not.
//
// Invokes the shared body in-process, bypassing the HTTP manager check that
// every real HTTP caller must now pass. One body, two callers, no drift.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const res = await runScheduled()
  console.log('integration-health:', await res.clone().text())
  return res
}

export const config = { schedule: '15 * * * *' } // hourly at :15
