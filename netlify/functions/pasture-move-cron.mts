import { admin } from './_jd.mts'
import { runPastureMoveWatch } from '../shared/pasture-move-watch.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Should the herd come off its paddock? Every morning at 7:15 (13:15 UTC),
// after the pasture satellite run has had the night to read any new scene.
// One alert per paddock per three days (kind 'pasture_move'); the reasoning is
// in src/lib/pasture-move.ts.
export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  try {
    const r = await runPastureMoveWatch(admin())
    console.log('Pasture move:', r.detail)
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('Pasture move failed:', (e as Error).message)
    return new Response((e as Error).message, { status: 500 })
  }
}

export const config = { schedule: '15 13 * * *' }
