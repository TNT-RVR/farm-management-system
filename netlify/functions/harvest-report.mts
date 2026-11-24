import { admin, json, requireManager } from './_jd.mts'
import { gatherHarvestReport, ownerEmails, renderHarvestReport, reportRecipients, sendReportEmail } from '../shared/harvest-report.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// A field's season report on demand (field page → Agronomist card). Managers.
// Body: { fieldId, year, send?: boolean }. Without send it returns the email
// to preview and who it would go to; with send it emails each of the field's
// report contacts now, copying the owners, and logs each send.
export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Not allowed' }, 403)
  const { fieldId, year, send } = (await req.json().catch(() => ({}))) as { fieldId?: string; year?: number; send?: boolean }
  if (!fieldId || !Number.isInteger(year)) return json({ error: 'A field and a year are needed.' }, 400)
  try {
    const mail = renderHarvestReport(await gatherHarvestReport(sb, fieldId, year!))
    const recipients = await reportRecipients(sb, fieldId)
    const owners = await ownerEmails(sb)
    if (!send) return json({ ...mail, to: recipients.map((r) => `${r.name} <${r.email}>`), cc: owners })
    if (!recipients.length) return json({ error: 'Nobody on this field takes the report: link a contact with an email first.' }, 400)
    const results = []
    for (const r of recipients) {
      const res = await sendReportEmail(mail, r.email, { cc: owners, replyTo: owners })
      await sb.from('harvest_report_sends').insert({
        field_id: fieldId,
        crop_year: year,
        contact_id: r.contactId,
        email: r.email,
        kind: 'manual',
        ok: res.ok,
        error: res.ok ? null : res.error,
        resend_id: res.ok ? res.id : null,
        sent_by: userId,
      })
      results.push({ to: r.email, ok: res.ok, error: res.ok ? undefined : res.error })
    }
    return json({ results })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}
