import {
  admin,
  jdConfig,
  json,
  JD_AUTHORIZE,
  jdRedirectUri,
  JD_SCOPES,
  requireManager,
} from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// Starts the John Deere OAuth authorization-code flow. Manager-only. Returns
// the authorize URL for the browser to redirect to; a random state is stored
// on the integration row for the callback to verify (CSRF protection).
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const cfg = jdConfig()
  if (!cfg) {
    return json(
      { error: 'John Deere app not configured. Set JD_CLIENT_ID and JD_CLIENT_SECRET.' },
      501,
    )
  }
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Only active managers can connect integrations' }, 403)

  // ?from=setup: started on Farm setup's keys card, so the callback lands back there.
  const state = oauthState(new URL(req.url).searchParams.get('from'))
  await sb
    .from('integration_accounts')
    .update({ oauth_state: state, connected_by: userId, updated_at: new Date().toISOString() })
    .eq('provider', 'john_deere')

  const authorizeUrl =
    `${JD_AUTHORIZE}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: jdRedirectUri(),
      scope: JD_SCOPES,
      state,
    }).toString()

  return json({ authorizeUrl })
}
