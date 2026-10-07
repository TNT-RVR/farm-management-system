import { admin, fieldnetAccessToken, fieldnetGet, json, listFrom } from './_fieldnet.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// Read-only pivot activity: condenses /irrigation-controllers/{id}/history into
// status-change events for the timeline on the field page. Any active user may
// view (the field page itself is visible to all active users).
type HistoryRow = {
  timestamp?: string
  status?: string | null
  direction?: string | null
  is_irrigating?: boolean | null
  plan?: string | null
  position?: number | null
  pressure?: number | null
  depth?: number | null
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return json({ error: 'id required' }, 400)
  const sb = admin()

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = jwt ? await getUserMfa(sb, jwt) : { data: { user: null } }
  if (!au.user) return json({ error: 'auth required' }, 401)
  const { data: prof } = await sb.from('users').select('active').eq('id', au.user.id).single()
  if (!prof?.active) return json({ error: 'inactive user' }, 403)

  try {
    const token = await fieldnetAccessToken(sb)
    const raw = listFrom(await fieldnetGet(token, `/irrigation-controllers/${id}/history`)) as HistoryRow[]
    const sorted = raw
      .filter((h) => h.timestamp)
      .sort((a, b) => (a.timestamp! < b.timestamp! ? -1 : 1))
    // Emit an event whenever the reported status changes.
    const events: HistoryRow[] = []
    let last: string | null | undefined
    for (const h of sorted) {
      if (h.status !== last) {
        events.push({
          timestamp: h.timestamp,
          status: h.status,
          direction: h.direction,
          is_irrigating: h.is_irrigating,
          plan: h.plan,
          position: typeof h.position === 'number' ? Math.round(h.position) : null,
          pressure: h.pressure,
        })
        last = h.status
      }
    }
    return json({ events: events.slice(-40).reverse() })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
}
