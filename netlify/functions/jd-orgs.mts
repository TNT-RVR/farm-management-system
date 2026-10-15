import {
  admin,
  jdAccessToken,
  jdConfig,
  jdConnectionsRedirect,
  jdGet,
  jdNeedsOrgAccess,
  jdOrgNeedsConnection,
  json,
  requireManager,
  siteUrl,
  type JdOrg,
} from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// List the John Deere organizations this login can see, and choose which one the
// app syncs.
//
// This exists because a Deere account can hold several organizations — Prairie Creek
// Ranch and Grand Forks Gravel both sit under Sam's login — and the callback
// previously just took the first one it was handed, which is a coin flip. Syncing
// the gravel company's fields into the farm app is worse than not syncing at all.
//
//   GET  → { orgs: [{ id, name, needsConnection }], selectedId }
//   POST → { orgId } sets the organization the sync uses
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can manage the John Deere connection' }, 403)
  }
  const cfg = jdConfig()
  if (!cfg) return json({ error: 'John Deere app not configured' }, 501)

  const token = await jdAccessToken(sb)
  const body = await jdGet<{ values?: JdOrg[] }>(token, '/platform/organizations')
  const values = body.values ?? []

  if (req.method === 'POST') {
    const { orgId } = (await req.json().catch(() => ({}))) as { orgId?: string }
    const chosen = values.find((o) => o.id === orgId)
    if (!chosen) return json({ error: 'That organization is not available to this login' }, 400)
    const { data: cur } = await sb.from('integration_accounts').select('meta').eq('provider', 'john_deere').single()
    await sb
      .from('integration_accounts')
      .update({
        external_org_id: chosen.id,
        external_org_name: chosen.name ?? null,
        status: 'connected',
        last_error: null,
        meta: { ...((cur?.meta as Record<string, unknown> | null) ?? {}), needs_org_access: jdOrgNeedsConnection(chosen) },
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'john_deere')
    return json({ ok: true, id: chosen.id, name: chosen.name })
  }

  const { data: acct } = await sb
    .from('integration_accounts')
    .select('external_org_id, meta')
    .eq('provider', 'john_deere')
    .single()

  // Opening the John Deere panel refreshes the "not shared" flag from what
  // Deere says now, so a warning from an old sign-in cannot linger.
  const meta = (acct?.meta as Record<string, unknown> | null) ?? {}
  const needs = jdNeedsOrgAccess(values, acct?.external_org_id ?? null, jdConnectionsRedirect(values, cfg.clientId, `${siteUrl()}/integrations?jd_connected=1`))
  if (Boolean(meta.needs_org_access) !== needs) {
    await sb
      .from('integration_accounts')
      .update({ meta: { ...meta, needs_org_access: needs }, updated_at: new Date().toISOString() })
      .eq('provider', 'john_deere')
  }

  return json({
    orgs: values.map((o) => ({
      id: o.id,
      name: o.name,
      // A `connections` link means this org has NOT been shared with the app yet,
      // so anything under it will 403 until the user grants it.
      needsConnection: jdOrgNeedsConnection(o),
    })),
    selectedId: acct?.external_org_id ?? null,
    connectionsUrl: jdConnectionsRedirect(
      values,
      cfg.clientId,
      `${siteUrl()}/integrations?jd_connected=1`,
    ),
  })
}
