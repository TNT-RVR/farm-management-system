import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * The yard truck scale (Sam, 30 Sep 2026). The scale in the main shop yard
 * is shared with Grand Forks Gravel; its reader streams the live weight into
 * Gravel's Supabase project, and Gravel keeps the scale's own log.
 *
 * GET  — where to watch the live weight: the project address, its public anon
 *        key and the scale's id. Nothing secret; signed-in staff only all the
 *        same, so the address is not handed to anybody who asks.
 * POST { kind: 'full' | 'empty', loadId? } — take the weight on the scale now.
 *        Gravel's scale_capture_ext checks the reading is fresh, settled and
 *        on the deck, logs it, and returns its capture. The capture is copied
 *        into RVR's scale_captures (service role: a browser cannot make one
 *        up) and handed back; the weigh-in form then saves the load naming
 *        it, and the database holds the load's weight to the captured one.
 *
 * GRAVEL_SCALE_KEY is the farm's key on that scale. It never leaves this
 * function — not in a VITE_ variable, not in a reply.
 */

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

const device = () => process.env.GRAVEL_SCALE_DEVICE?.trim() || 'yard-scale'

type Capture = {
  id: string
  device_id: string
  kind: 'in' | 'out'
  weight_kg: number
  mode: string
  reading_at: string
}

export default async (req: Request) => {
  await hydrateSecrets()
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Not configured' }, 500)

  const sb = admin()
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = bearer ? await getUserMfa(sb, bearer) : { data: { user: null } }
  const { data: prof } = au.user
    ? await sb.from('users').select('active, role, full_name, email').eq('id', au.user.id).single()
    : { data: null }
  if (!au.user || !isStaff(prof)) return json({ error: 'Not authorised' }, 401)

  const gravelUrl = process.env.GRAVEL_SUPABASE_URL?.trim().replace(/\/+$/, '')
  const anon = process.env.GRAVEL_SUPABASE_ANON_KEY?.trim()

  if (req.method === 'GET') {
    if (!gravelUrl || !anon) return json({ configured: false })
    return json({
      configured: true,
      url: gravelUrl,
      anonKey: anon,
      device: device(),
      canCapture: Boolean(process.env.GRAVEL_SCALE_KEY?.trim()),
    })
  }
  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405)

  const scaleKey = process.env.GRAVEL_SCALE_KEY?.trim()
  if (!gravelUrl || !anon || !scaleKey) {
    return json({ error: 'The yard scale is not set up yet (Farm setup → Keys → Yard truck scale).' }, 501)
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: string; loadId?: string | null }
  if (body.kind !== 'full' && body.kind !== 'empty') return json({ error: 'kind must be full or empty' }, 400)
  const loadId =
    typeof body.loadId === 'string' && /^[0-9a-f-]{36}$/i.test(body.loadId) ? body.loadId : null

  // Gravel's in/out is the order the truck crossed: a grain truck comes in
  // full from the field and leaves empty.
  let res: Response
  try {
    res = await fetch(`${gravelUrl}/rest/v1/rpc/scale_capture_ext`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_key: scaleKey,
        p_kind: body.kind === 'full' ? 'in' : 'out',
        p_ref: loadId,
        p_by: prof?.full_name?.trim() || prof?.email || au.user.email || au.user.id,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    return json({ error: `The scale could not be reached: ${(e as Error).message}` }, 502)
  }
  const out = (await res.json().catch(() => ({}))) as Capture & { message?: string }
  if (!res.ok) {
    // Gravel's own words: offline, in motion, no weight, invalid key.
    const msg = out.message ?? `The scale said no (${res.status})`
    return json({ error: /invalid scale key/i.test(msg) ? 'The scale key was refused — ask for a new one.' : msg }, 409)
  }
  if (!out.id || !(Number(out.weight_kg) > 0)) return json({ error: 'The scale sent back no weight' }, 502)

  const { error } = await sb.from('scale_captures').upsert({
    id: out.id,
    device_id: out.device_id,
    kind: out.kind,
    weight_kg: Math.round(Number(out.weight_kg)),
    mode: out.mode,
    reading_at: out.reading_at,
    captured_by: au.user.id,
  })
  if (error) return json({ error: `The weight was taken but not recorded here: ${error.message}` }, 500)

  // A tared indicator shows a net: right for the indicator, wrong for a load
  // that takes the full and the empty apart.
  if (out.mode !== 'gross') {
    return json({ error: 'The scale is showing a net weight — set the indicator to gross and take it again.' }, 409)
  }
  return json({ id: out.id, weightKg: Math.round(Number(out.weight_kg)), readingAt: out.reading_at })
}

export const config = { path: '/api/scale' }
