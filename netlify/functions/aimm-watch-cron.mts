import { runScheduled } from './aimm-watch.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Scheduled half of the monthly AIMM source check. Setup's "Check now" button needs the HTTP
// half reachable, and a function declaring a schedule is not.
//
// Invokes the shared body in-process, bypassing the HTTP manager check that
// every real HTTP caller must now pass. One body, two callers, no drift.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const res = await runScheduled()
  console.log('aimm-watch:', await res.clone().text())
  return res
}

export const config = { schedule: '0 13 1 * *' } // monthly, 1st @ 13:00 UTC
