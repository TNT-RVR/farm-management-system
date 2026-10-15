import { admin, encryptToken, gdConfig, gdRedirectUri, gdTokenRequest, siteUrl } from './_google-drive.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn } from '../shared/oauth-return.ts'

// Where Google sends the browser back with ?code&state. No session header on
// a top-level redirect: the stored state is the check. Saves the tokens and
// names the account, then lands where the sign-in began.
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } })

export default async (req: Request) => {
  await hydrateSecrets()
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err = url.searchParams.get('error')
  const back = (q: string) => redirect(`${oauthReturn(siteUrl(), state)}${q}`)

  if (err) return back(`gd_error=${encodeURIComponent(err)}`)
  if (!code || !state) return back('gd_error=missing_code')
  if (!gdConfig()) return back('gd_error=not_configured')

  const sb = admin()
  const { data: acct } = await sb.from('integration_accounts').select('oauth_state').eq('provider', 'google_drive').single()
  if (!acct || acct.oauth_state !== state) return back('gd_error=bad_state')

  try {
    const tok = await gdTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: gdRedirectUri() })
    if (!tok.refresh_token) return back('gd_error=no_refresh_token')
    // Whose Drive it is, for the card. Best effort.
    let who: string | null = null
    try {
      const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', { headers: { Authorization: `Bearer ${tok.access_token}` } })
      const j = (await r.json()) as { user?: { emailAddress?: string; displayName?: string } }
      who = j.user?.emailAddress ?? j.user?.displayName ?? null
    } catch {
      /* the name is a nicety */
    }
    const now = new Date()
    await sb
      .from('integration_accounts')
      .update({
        status: 'connected',
        access_token: await encryptToken(tok.access_token),
        refresh_token: await encryptToken(tok.refresh_token),
        token_expires_at: new Date(now.getTime() + tok.expires_in * 1000).toISOString(),
        external_org_name: who,
        oauth_state: null,
        connected_at: now.toISOString(),
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq('provider', 'google_drive')
    await sb.from('integration_health').update({ enabled: true }).eq('source_key', 'google_drive_backup')
    return back('gd_connected=1')
  } catch (e) {
    await sb.from('integration_accounts').update({ status: 'error', last_error: (e as Error).message.slice(0, 300), oauth_state: null }).eq('provider', 'google_drive')
    return back(`gd_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`)
  }
}
