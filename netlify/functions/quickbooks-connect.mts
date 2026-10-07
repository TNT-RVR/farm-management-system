import { admin, json, qbConfig, qbEnvironment, qbRedirectUri, requireFinance, QB_AUTHORIZE, QB_SCOPES } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// Starts the QuickBooks sign-in. Owners and finance access only. Stores a
// random state (the CSRF check the callback compares) and which environment
// the keys are for, then hands the browser Intuit's authorize URL.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const cfg = qbConfig()
  if (!cfg) {
    return json({ error: 'QuickBooks keys are not set. Add the Client ID and secret under Settings → Farm setup → Keys.' }, 501)
  }
  const sb = admin()
  const userId = await requireFinance(req, sb)
  if (!userId) return json({ error: 'Only owners and finance users can connect QuickBooks' }, 403)

  // ?from=setup: started on Farm setup's keys card, so the callback lands back there.
  const state = oauthState(new URL(req.url).searchParams.get('from'))
  const { data: acct } = await sb.from('integration_accounts').select('meta').eq('provider', 'quickbooks').single()
  await sb
    .from('integration_accounts')
    .update({
      oauth_state: state,
      connected_by: userId,
      meta: { ...(acct?.meta ?? {}), environment: qbEnvironment() },
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'quickbooks')

  const authorizeUrl =
    `${QB_AUTHORIZE}?` +
    new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      scope: QB_SCOPES,
      redirect_uri: qbRedirectUri(),
      state,
    }).toString()
  return json({ authorizeUrl, environment: qbEnvironment() })
}
