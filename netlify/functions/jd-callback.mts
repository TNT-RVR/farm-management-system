import {
  admin,
  encryptToken,
  jdConfig,
  jdConnectionsRedirect,
  jdGet,
  jdTokenRequest,
  jdRedirectUri,
  siteUrl,
  type JdOrg,
} from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// OAuth redirect target. John Deere redirects the browser here with ?code&state.
// No auth header (it's a top-level browser redirect) — the state stored by
// jd-connect is the CSRF check. Exchanges the code, fetches the org, marks
// connected, then redirects back to the app's Integrations page.
function redirect(to: string) {
  return new Response(null, { status: 302, headers: { Location: to } })
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err = url.searchParams.get('error')
  const back = (q: string) => redirect(`${oauthReturn(siteUrl(), state)}${q}`)

  if (err) return back(`jd_error=${encodeURIComponent(err)}`)
  if (!code || !state) return back('jd_error=missing_code')

  const cfg = jdConfig()
  if (!cfg) return back('jd_error=not_configured')

  const sb = admin()
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('oauth_state')
    .eq('provider', 'john_deere')
    .single()
  if (!acct || acct.oauth_state !== state) return back('jd_error=bad_state')

  try {
    const tok = await jdTokenRequest(
      { grant_type: 'authorization_code', code, redirect_uri: jdRedirectUri() },
      cfg.clientId,
      cfg.clientSecret,
    )

    // Fetch the organizations to record which JD org we're linked to, and to
    // find out whether the user still has to share them with this application.
    let orgId: string | null = null
    let orgName: string | null = null
    let connectionsUrl: string | null = null
    try {
      const orgs = await jdGet<{ values?: JdOrg[] }>(
        tok.access_token,
        '/platform/organizations',
      )
      const values = orgs.values ?? []
      // Only auto-select when there is no ambiguity. A Deere login can hold
      // several organizations (the farm and the gravel company both sit under
      // Sam's account), and picking values[0] silently syncs whichever one
      // Deere happened to list first. With more than one, leave it unset and let
      // the user choose on the Integrations card.
      if (values.length === 1) {
        orgId = values[0]?.id ?? null
        orgName = values[0]?.name ?? null
      }
      // A `connections` link means this client has NOT been granted the org yet.
      connectionsUrl = jdConnectionsRedirect(
        values,
        cfg.clientId,
        `${oauthReturn(siteUrl(), state)}jd_connected=1`,
      )
    } catch {
      // org fetch can fail if the connection isn't enabled yet; still store tokens
    }

    await sb
      .from('integration_accounts')
      .update({
        status: 'connected',
        access_token: await encryptToken(tok.access_token),
        refresh_token: await encryptToken(tok.refresh_token ?? null),
        token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
        external_org_id: orgId,
        external_org_name: orgName,
        oauth_state: null,
        connected_at: new Date().toISOString(),
        last_error: null,
        meta: { needs_org_access: Boolean(connectionsUrl), connections_url: connectionsUrl },
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'john_deere')

    // Send the user straight on to pick organizations — without this step the
    // app is "connected" but every data endpoint returns nothing.
    if (connectionsUrl) return redirect(connectionsUrl)
    return back('jd_connected=1')
  } catch (e) {
    await sb
      .from('integration_accounts')
      .update({ status: 'error', last_error: (e as Error).message, updated_at: new Date().toISOString() })
      .eq('provider', 'john_deere')
    return back(`jd_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`)
  }
}
