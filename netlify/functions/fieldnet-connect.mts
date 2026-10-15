import {
  admin,
  fieldnetConfig,
  json,
  makeChallenge,
  makeVerifier,
  requireManager,
  FIELDNET_AUTHORIZE,
  fieldnetRedirectUri,
  FIELDNET_SCOPES,
} from './_fieldnet.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// Starts the FieldNET OAuth 2.0 Authorization Code + PKCE flow. Manager-only.
// Stores a random state (CSRF) and the PKCE code_verifier on the fieldnet row,
// then returns the authorize URL for the browser to redirect to.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const cfg = fieldnetConfig()
  if (!cfg) {
    return json(
      { error: 'FieldNET app not configured. Set FIELDNET_CLIENT_ID and FIELDNET_CLIENT_SECRET.' },
      501,
    )
  }
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Only active managers can connect integrations' }, 403)

  // ?from=setup: started on Farm setup's keys card, so the callback lands back there.
  const state = oauthState(new URL(req.url).searchParams.get('from'))
  const verifier = makeVerifier()
  const challenge = await makeChallenge(verifier)

  await sb
    .from('integration_accounts')
    .update({
      oauth_state: state,
      oauth_code_verifier: verifier,
      connected_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'fieldnet')

  const authorizeUrl =
    `${FIELDNET_AUTHORIZE}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: fieldnetRedirectUri(),
      scope: FIELDNET_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()

  return json({ authorizeUrl })
}
