import { admin, decryptToken, json, qbConfig, requireFinance, QB_REVOKE } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Disconnect: revoke the refresh token at Intuit (which also ends the access
// token) and forget both here. The synced rows stay — they are the record of
// what the books said — and a reconnect to the same company carries on.
export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireFinance(req, sb))) return json({ error: 'Only owners and finance users can disconnect QuickBooks' }, 403)

  const { data: acct } = await sb.from('integration_accounts').select('refresh_token').eq('provider', 'quickbooks').single()
  const cfg = qbConfig()
  const refresh = await decryptToken(acct?.refresh_token).catch(() => null)
  let revoked = false
  if (cfg && refresh) {
    const res = await fetch(QB_REVOKE, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: refresh }),
    }).catch(() => null)
    revoked = Boolean(res?.ok)
  }

  await sb
    .from('integration_accounts')
    .update({ status: 'disconnected', access_token: null, refresh_token: null, token_expires_at: null, oauth_state: null, last_error: null, updated_at: new Date().toISOString() })
    .eq('provider', 'quickbooks')
  await sb.from('integration_health').update({ enabled: false }).eq('source_key', 'quickbooks')
  return json({ ok: true, revoked })
}
