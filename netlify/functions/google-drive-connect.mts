import { admin, gdConfig, gdRedirectUri, json, requireFinance, GD_AUTHORIZE, GD_SCOPES } from './_google-drive.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthState } from '../shared/oauth-return.ts'

// Starts the Google sign-in for the report backup. Owners and the farm's
// accountant only. Offline access with consent every time, so Google hands
// back a refresh token even to someone who connected before.
export default async (req: Request) => {
  await hydrateSecrets()
  const cfg = gdConfig()
  if (!cfg) return json({ error: 'Google Drive keys are not set. Add the Client ID and secret under Settings → Farm setup → Connections.' }, 501)
  const sb = admin()
  const userId = await requireFinance(req, sb)
  if (!userId) return json({ error: 'Only the owners and the farm’s accountant can connect the backup' }, 403)

  // ?from=setup: started on Farm setup's keys card, so the callback lands back there.
  const state = oauthState(new URL(req.url).searchParams.get('from'))
  await sb.from('integration_accounts').update({ oauth_state: state, connected_by: userId, updated_at: new Date().toISOString() }).eq('provider', 'google_drive')

  const authorizeUrl =
    `${GD_AUTHORIZE}?` +
    new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: gdRedirectUri(),
      response_type: 'code',
      scope: GD_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString()
  return json({ authorizeUrl })
}
