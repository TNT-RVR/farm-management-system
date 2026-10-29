import { createHash, timingSafeEqual } from 'node:crypto'
import { hydrateSecrets } from '../shared/secrets.ts'
import { admin } from './_jd.mts'
import { appUrl } from './_anydo.mts'
import { farmTz } from '../../src/lib/farm-context.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * GET /api/my-tasks?token=… — one person's open tasks, for a phone widget.
 *
 * iPhone and Android give web apps no home-screen widgets, so a free widget
 * app (Scriptable on iPhone, KWGT on Android) reads this instead (Sam,
 * 24 Oct 2026). The widget app has no sign-in, so the secret in the link is
 * the only key: made in Settings → My account → This device & apps, kept in
 * task_feed_tokens only as its sha256, replaced or turned off from the same
 * card. It reads, never writes, and only ever the token owner's own tasks —
 * there is deliberately no parameter that names a person or a task.
 *
 * ?format=text gives plain lines for widgets that only show text.
 */

const CORS = {
  // Widget apps fetch from no origin of ours; the token is the only key.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
}

const MAX_TASKS = 25
// last_used_at is for the person's "last used" line, not an audit trail: a
// widget refreshing every few minutes needn't write every time.
const TOUCH_EVERY_MS = 5 * 60_000

const TOKEN_RE = /^[0-9a-f]{48}$/

// One answer for a missing, malformed, unknown or turned-off link, so the
// endpoint never says whether a token exists.
const denied = () =>
  new Response(JSON.stringify({ error: 'This link does not work. Make a new one in Settings.' }), {
    status: 401,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })

type Task = { id: string; title: string; due: string | null; overdue: boolean; field?: string; url: string }

/** "Oct 26" in the farm's time zone, for the text format. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: farmTz() })

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { ...CORS, Allow: 'GET, OPTIONS' } })

  await hydrateSecrets()
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Not configured', { status: 500, headers: CORS })
  }

  const params = new URL(req.url).searchParams
  const token = (params.get('token') ?? '').trim().toLowerCase()
  if (!TOKEN_RE.test(token)) return denied()
  const textFormat = params.get('format') === 'text'

  // Looked up by hash, never by the secret itself: what the database (and its
  // index timing) sees is a sha256 that can't be turned back into a link.
  const hash = createHash('sha256').update(token).digest('hex')
  const db = admin()
  const { data: row } = await db
    .from('task_feed_tokens')
    .select('user_id, token_hash, last_used_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!row) return denied()
  const a = Buffer.from(row.token_hash as string, 'utf8')
  const b = Buffer.from(hash, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return denied()

  const userId = row.user_id as string
  const { data: user } = await db.from('users').select('full_name, email, active, role').eq('id', userId).maybeSingle()
  // Someone who has left the farm keeps no window into it.
  if (!user || !isStaff(user)) return denied()

  const now = Date.now()
  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at as string) : 0
  if (now - lastUsed > TOUCH_EVERY_MS) {
    await db.from('task_feed_tokens').update({ last_used_at: new Date(now).toISOString() }).eq('user_id', userId)
  }

  const { data: rows, error } = await db
    .from('tasks_with_assignees')
    .select('id, title, due_at, field_id, created_at')
    .eq('status', 'open')
    .contains('assignee_ids', [userId])
  if (error) return new Response('Could not read tasks', { status: 502, headers: CORS })

  const open = rows ?? []
  const isOverdue = (due: string | null) => !!due && Date.parse(due) < now
  // Overdue first (oldest first), then by due date, then undated, newest first.
  open.sort((x, y) => {
    const dx = x.due_at ? Date.parse(x.due_at) : null
    const dy = y.due_at ? Date.parse(y.due_at) : null
    if (dx != null && dy != null) return dx - dy
    if (dx != null) return -1
    if (dy != null) return 1
    return Date.parse(y.created_at) - Date.parse(x.created_at)
  })
  const shown = open.slice(0, MAX_TASKS)

  const fieldIds = [...new Set(shown.map((t) => t.field_id).filter((v): v is string => !!v))]
  const fieldNames = new Map<string, string>()
  if (fieldIds.length) {
    const { data: fields } = await db.from('fields').select('id, name').in('id', fieldIds)
    for (const f of fields ?? []) fieldNames.set(f.id as string, f.name as string)
  }

  const base = appUrl()
  const tasks: Task[] = shown.map((t) => {
    const field = t.field_id ? fieldNames.get(t.field_id) : undefined
    return {
      id: t.id,
      title: t.title,
      due: t.due_at,
      overdue: isOverdue(t.due_at),
      ...(field ? { field } : {}),
      url: `${base}/tasks/${t.id}`,
    }
  })
  const overdue = open.filter((t) => isOverdue(t.due_at)).length
  const name = (user.full_name as string | null)?.trim() || (user.email as string | null)?.split('@')[0] || 'My tasks'
  const updatedAt = new Date(now).toISOString()

  if (textFormat) {
    const lines = [
      `${name}: ${open.length} open${overdue ? `, ${overdue} overdue` : ''}`,
      ...tasks.map(
        (t) =>
          `${t.overdue ? '! ' : '- '}${t.title}${t.due ? ` (${t.overdue ? 'was due ' : ''}${shortDate(t.due)})` : ''}${t.field ? ` · ${t.field}` : ''}`,
      ),
    ]
    if (!tasks.length) lines.push('Nothing open.')
    return new Response(lines.join('\n'), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(JSON.stringify({ name, updatedAt, open: open.length, overdue, tasks }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
