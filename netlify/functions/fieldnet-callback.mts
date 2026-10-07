import {
  admin,
  decryptToken,
  encryptToken,
  fieldnetConfig,
  fieldnetGet,
  fieldnetTokenRequest,
  listFrom,
  fieldnetRedirectUri,
} from './_fieldnet.mts'
import { siteUrl } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// OAuth redirect target. FieldNET redirects the browser here with ?code&state.
// No auth header (top-level browser redirect) — the stored state is the CSRF
// check and the stored PKCE verifier proves this is the same client. Exchanges
// the code, records the org, marks connected, then bounces to /integrations.
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

  if (err) return back(`fieldnet_error=${encodeURIComponent(err)}`)
  if (!code || !state) return back('fieldnet_error=missing_code')

  const cfg = fieldnetConfig()
  if (!cfg) return back('fieldnet_error=not_configured')

  const sb = admin()
  const { data: acct } = await sb
    .from('integration_accounts')
    .select('oauth_state, oauth_code_verifier')
    .eq('provider', 'fieldnet')
    .single()
  if (!acct || acct.oauth_state !== state) return back('fieldnet_error=bad_state')
  const verifier = await decryptToken(acct.oauth_code_verifier).catch(() => acct.oauth_code_verifier)
  if (!verifier) return back('fieldnet_error=missing_verifier')

  try {
    const tok = await fieldnetTokenRequest(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: fieldnetRedirectUri(),
        code_verifier: verifier,
      },
      cfg.clientId,
      cfg.clientSecret,
    )

    // Record which FieldNET organization we're linked to (best-effort).
    let orgId: string | null = null
    let orgName: string | null = null
    try {
      const orgs = listFrom(await fieldnetGet(tok.access_token, '/organizations')) as {
        id?: string
        name?: string
      }[]
      orgId = orgs[0]?.id ?? null
      orgName = orgs[0]?.name ?? null
    } catch {
      // org fetch may not be permitted yet; still store tokens
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
        oauth_code_verifier: null,
        connected_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'fieldnet')

    return back('fieldnet_connected=1')
  } catch (e) {
    await sb
      .from('integration_accounts')
      .update({
        status: 'error',
        last_error: (e as Error).message,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'fieldnet')
    return back(`fieldnet_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`)
  }
}
