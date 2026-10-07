import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { needsWrite, type StoredReading } from '../shared/plc-write'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * The one door between the on-site PLC agent and this database.
 *
 * The agent posts what it read and what it is; it gets back the writes that are
 * waiting for it. That is the whole protocol.
 *
 * It exists so the service-role key does not have to. The agent runs on a shop
 * PC that people use for other things, and a key that can read and write every
 * table in the business has no business sitting in an environment variable
 * there. A shared secret that can only reach this endpoint is a much smaller
 * thing to lose.
 */

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const agentSecret = process.env.PLC_AGENT_SECRET

type Value = number | boolean | string | null

type Reading = {
  tag: string
  value: Value
  quality?: 'good' | 'bad'
  error?: string | null
  raw?: number[] | null
  readAt: string
}

type Body = {
  device: { key: string; label?: string; host?: string; port?: number; unitId?: number }
  agent?: {
    version?: string
    host?: string
    connectionState?: string
    lastPollAt?: string
    tagsGood?: number
    tagsBad?: number
    reconnects?: number
    failures?: number
    lastError?: string | null
  }
  tags?: {
    name: string
    label?: string
    description?: string
    area: string
    address: number
    type: string
    unit?: string
    writable?: boolean
    min?: number
    max?: number
  }[]
  readings?: Reading[]
  history?: Reading[]
  results?: { id: string; status: 'done' | 'failed'; error?: string | null; readback?: Value }[]
}

/** Split a loosely typed value into the three typed columns. */
function columns(value: Value, prefix: 'value' | 'readback') {
  return {
    [`${prefix}_num`]: typeof value === 'number' ? value : null,
    [`${prefix}_bool`]: typeof value === 'boolean' ? value : null,
    [`${prefix}_text`]: typeof value === 'string' ? value : null,
  }
}

async function currentReadings(
  sb: SupabaseClient,
  deviceId: string,
): Promise<Map<string, StoredReading> | null> {
  const { data, error } = await sb
    .from('plc_readings')
    .select('tag, value_num, value_bool, value_text, quality, raw, read_at')
    .eq('device_id', deviceId)
  // Cannot tell what is stored: write everything, as before.
  if (error || !data) return null
  return new Map((data as StoredReading[]).map((r) => [r.tag, r]))
}

function authorised(req: Request): boolean {
  if (!agentSecret) return false
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(agentSecret)
  // Compare the lengths first: timingSafeEqual throws on a mismatch, which
  // would itself leak the length through the error path.
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 500)
  if (!agentSecret) return json({ error: 'PLC_AGENT_SECRET is not set on this site' }, 500)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!authorised(req)) return json({ error: 'Bad agent secret' }, 401)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'Body is not JSON' }, 400)
  }
  if (!body?.device?.key) return json({ error: 'device.key is required' }, 400)

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
  const now = new Date().toISOString()

  // 1. The panel itself. Upserted rather than required to exist, so a new site
  //    is one env var on the agent and nothing at all in here — but only
  //    written when something about it changed. It was rewritten on every
  //    15-second poll: 230,000 identical updates by October.
  const devFields = {
    label: body.device.label ?? body.device.key,
    host: body.device.host ?? null,
    port: body.device.port ?? 502,
    unit_id: body.device.unitId ?? 1,
  }
  const { data: known } = await sb
    .from('plc_devices')
    .select('id, label, host, port, unit_id')
    .eq('key', body.device.key)
    .maybeSingle()
  let deviceId = known?.id as string | undefined
  const devChanged =
    !known ||
    known.label !== devFields.label ||
    known.host !== devFields.host ||
    known.port !== devFields.port ||
    known.unit_id !== devFields.unit_id
  if (devChanged) {
    const { data: device, error: deviceErr } = await sb
      .from('plc_devices')
      .upsert({ key: body.device.key, ...devFields, updated_at: now }, { onConflict: 'key' })
      .select('id')
      .single()
    if (deviceErr || !device) return json({ error: `device upsert: ${deviceErr?.message}` }, 500)
    deviceId = device.id as string
  }
  if (!deviceId) return json({ error: 'device upsert: no id' }, 500)

  // 2. The register map, when the agent sends one. Replaced as a set: a tag
  //    deleted from the map on the shop PC must disappear here too, or the app
  //    goes on offering a control for something that no longer exists.
  if (body.tags?.length) {
    const rows = body.tags.map((t) => ({
      device_id: deviceId,
      name: t.name,
      label: t.label ?? null,
      description: t.description ?? null,
      area: t.area,
      address: t.address,
      data_type: t.type,
      unit: t.unit ?? null,
      writable: t.writable ?? false,
      min_value: t.min ?? null,
      max_value: t.max ?? null,
      definition: t,
      updated_at: now,
    }))
    const { error } = await sb.from('plc_tags').upsert(rows, { onConflict: 'device_id,name' })
    if (error) return json({ error: `tag upsert: ${error.message}` }, 500)
    await sb
      .from('plc_tags')
      .delete()
      .eq('device_id', deviceId)
      .not('name', 'in', `(${body.tags.map((t) => `"${t.name.replace(/"/g, '')}"`).join(',')})`)
  }

  // 3. Current values.
  //
  // Good and bad readings are handled differently on purpose. A good one
  // replaces everything. A bad one records only that the attempt failed and
  // when — it must NOT overwrite the value, because "72 PSI, four minutes ago"
  // is far more use to somebody than a dash, and the age shown beside it is
  // what carries the warning. The row therefore keeps two clocks: read_at moves
  // on every attempt, last_good_at only when a value was really measured.
  const good = (body.readings ?? []).filter((r) => (r.quality ?? 'good') === 'good')
  const bad = (body.readings ?? []).filter((r) => (r.quality ?? 'good') !== 'good')

  if (good.length) {
    const prev = await currentReadings(sb, deviceId)
    const rows = good
      .map((r) => ({
        device_id: deviceId,
        tag: r.tag,
        ...columns(r.value, 'value'),
        quality: 'good',
        error: null,
        raw: r.raw ?? null,
        read_at: r.readAt,
        last_good_at: r.readAt,
        updated_at: now,
      }))
      .filter((row) => needsWrite(prev?.get(row.tag), row))
    if (rows.length) {
      const { error } = await sb.from('plc_readings').upsert(rows, { onConflict: 'device_id,tag' })
      if (error) return json({ error: `reading upsert: ${error.message}` }, 500)
    }
  }

  for (const r of bad) {
    // Update, never insert. A tag that has never been read successfully has no
    // row, and inventing an empty one would make "we have never heard this"
    // indistinguishable from "we heard it once and it has gone quiet".
    await sb
      .from('plc_readings')
      .update({ quality: 'bad', error: r.error ?? null, read_at: r.readAt, updated_at: now })
      .eq('device_id', deviceId)
      .eq('tag', r.tag)
  }

  // 4. History, which the agent has already thinned down to changes.
  if (body.history?.length) {
    const rows = body.history.map((r) => ({
      device_id: deviceId,
      tag: r.tag,
      ...columns(r.value, 'value'),
      quality: r.quality ?? 'good',
      read_at: r.readAt,
    }))
    const { error } = await sb.from('plc_reading_history').insert(rows)
    if (error) return json({ error: `history insert: ${error.message}` }, 500)
  }

  // 5. What the agent says about itself.
  const agent = body.agent ?? {}
  await sb.from('plc_agent_status').upsert(
    {
      device_id: deviceId,
      connection_state: agent.connectionState ?? 'unknown',
      agent_version: agent.version ?? null,
      agent_host: agent.host ?? null,
      last_seen_at: now,
      last_poll_at: agent.lastPollAt ?? now,
      tags_good: agent.tagsGood ?? null,
      tags_bad: agent.tagsBad ?? null,
      reconnects: agent.reconnects ?? null,
      failures: agent.failures ?? null,
      last_error: agent.lastError ?? null,
      updated_at: now,
    },
    { onConflict: 'device_id' },
  )

  // 6. Results of the writes handed out last time.
  for (const r of body.results ?? []) {
    await sb
      .from('plc_commands')
      .update({
        status: r.status,
        error: r.error ?? null,
        completed_at: now,
        ...columns(r.readback ?? null, 'readback'),
      })
      .eq('id', r.id)
      .eq('device_id', deviceId)
  }

  // 7. Commands that waited too long are dead, not delayed. An operator who got
  //    no response has already done something else by now, and firing the
  //    original an hour later moves equipment nobody is expecting to move.
  await sb
    .from('plc_commands')
    .update({ status: 'expired', completed_at: now, error: 'The agent was not reachable before this expired.' })
    .eq('device_id', deviceId)
    .in('status', ['pending', 'claimed'])
    .lt('expires_at', now)

  // 8. Hand out what is waiting. Claimed in the same breath, so two agents
  //    against one panel cannot both execute the same write.
  const { data: pending } = await sb
    .from('plc_commands')
    .select('id, tag, value_num, value_bool, value_text, attempts')
    .eq('device_id', deviceId)
    .eq('status', 'pending')
    .gte('expires_at', now)
    .order('requested_at')
    .limit(20)

  const commands = (pending ?? []).map((c) => ({
    id: c.id as string,
    tag: c.tag as string,
    value: (c.value_num ?? c.value_bool ?? c.value_text) as Value,
  }))
  if (commands.length) {
    await sb
      .from('plc_commands')
      .update({ status: 'claimed', claimed_at: now })
      .in('id', commands.map((c) => c.id))
  }

  // 9. Tell the health monitor the agent is alive. Its first call also enables
  //    the registry row, so nothing alerts about a panel that was never
  //    connected in the first place.
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'plc_agent',
    p_detail: `${body.device.key}: Modbus ${agent.connectionState ?? 'unknown'}, ${agent.tagsGood ?? 0} tags good, ${agent.tagsBad ?? 0} bad`,
    p_data_at: agent.lastPollAt ?? now,
  })

  return json({ ok: true, deviceId, commands })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
