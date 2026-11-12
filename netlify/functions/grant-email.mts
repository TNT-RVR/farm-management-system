import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { farmName } from '../../src/lib/farm-context.ts'

// Sends the meeting-request email on a grant (Sam, 2 Nov 2026) through
// Resend. It goes from the sender's own address when that address is on the
// domain Resend sends for, so replies land in their inbox like any email they
// wrote; otherwise from noreply@ that domain with their address to reply to.
// They are copied either way, and the grant's notes record who was written to.
// Body: { grantId, to, subject, body }. Any active staff member.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async (req: Request) => {
  await hydrateSecrets()
  const key = process.env.RESEND_API_KEY
  const domain = process.env.RESEND_DOMAIN?.trim().replace(/^@/, '').toLowerCase()
  if (!key || !domain) {
    return Response.json({ error: 'Sending from the app needs a Resend key and domain in Settings → Connections → Email sender (Resend).', notConfigured: true }, { status: 501 })
  }
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const sb = admin()

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: au } = jwt ? await getUserMfa(sb, jwt) : { data: { user: null } }
  const user = au.user
  const { data: prof } = user ? await sb.from('users').select('role, active, full_name').eq('id', user.id).single() : { data: null }
  if (!user?.email || !prof?.active || prof.role === 'partner') return Response.json({ error: 'Not allowed' }, { status: 403 })

  const { grantId, to, subject, body } = (await req.json().catch(() => ({}))) as Record<string, string | undefined>
  const recipient = to?.trim()
  if (!grantId || !recipient || !EMAIL.test(recipient) || !subject?.trim() || !body?.trim()) {
    return Response.json({ error: 'A grant, a valid "to" address, a subject and a message are all needed.' }, { status: 400 })
  }
  const { data: grant } = await sb.from('grants').select('id, notes_md').eq('id', grantId).single()
  if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })

  const name = prof.full_name?.trim() || user.email
  const own = user.email.toLowerCase().endsWith(`@${domain}`)
  const from = own ? `${name} <${user.email}>` : `${name} via ${farmName()} <noreply@${domain}>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      cc: [user.email],
      reply_to: user.email,
      subject: subject.trim().slice(0, 300),
      text: body.slice(0, 20_000),
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    return Response.json({ error: `Resend would not send it (${res.status}): ${detail}` }, { status: 502 })
  }

  const day = new Date().toLocaleDateString('en-CA', { timeZone: process.env.FARM_TZ || 'America/Edmonton' })
  const line = `${day}: ${name} emailed ${recipient} asking for a meeting.`
  await sb
    .from('grants')
    .update({
      meeting_email_sent_at: new Date().toISOString(),
      notes_md: grant.notes_md?.trim() ? `${grant.notes_md.trim()}\n${line}` : line,
      updated_at: new Date().toISOString(),
    })
    .eq('id', grantId)
  return Response.json({ ok: true, from })
}
