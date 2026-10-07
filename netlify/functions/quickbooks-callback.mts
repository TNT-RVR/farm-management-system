import { admin, encryptToken, qbConfig, qbEnvironment, qbGet, qbRedirectUri, qbTokenRequest } from './_quickbooks.mts'
import { siteUrl } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { oauthReturn, oauthState } from '../shared/oauth-return.ts'

// Where Intuit sends the browser back, with ?code&state&realmId. No session
// header on a top-level redirect: the stored state is the check. Exchanges the
// code, names the company, turns its health watch on, starts the first sync,
// and lands on Integrations.
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } })

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const realmId = url.searchParams.get('realmId')
  const err = url.searchParams.get('error')
  const back = (q: string) => redirect(`${oauthReturn(siteUrl(), state)}${q}`)

  if (err) return back(`qb_error=${encodeURIComponent(err)}`)
  if (!code || !state || !realmId) return back('qb_error=missing_code')
  const cfg = qbConfig()
  if (!cfg) return back('qb_error=not_configured')

  const sb = admin()
  const { data: acct } = await sb.from('integration_accounts').select('oauth_state, meta').eq('provider', 'quickbooks').single()
  if (!acct || acct.oauth_state !== state) return back('qb_error=bad_state')
  const environment = acct.meta?.environment === 'sandbox' ? 'sandbox' : qbEnvironment()

  try {
    const tok = await qbTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: qbRedirectUri() }, cfg.clientId, cfg.clientSecret)

    let companyName: string | null = null
    let country: string | null = null
    try {
      const info = await qbGet<{ CompanyInfo?: { CompanyName?: string; Country?: string } }>(
        { realmId, environment, token: tok.access_token },
        `companyinfo/${realmId}`,
      )
      companyName = info.CompanyInfo?.CompanyName ?? null
      country = info.CompanyInfo?.Country ?? null
    } catch {
      // The name is a nicety; the tokens are what matter.
    }

    const now = new Date()
    await sb
      .from('integration_accounts')
      .update({
        status: 'connected',
        access_token: await encryptToken(tok.access_token),
        refresh_token: await encryptToken(tok.refresh_token),
        token_expires_at: new Date(now.getTime() + tok.expires_in * 1000).toISOString(),
        external_org_id: realmId,
        external_org_name: companyName,
        oauth_state: null,
        connected_at: now.toISOString(),
        last_error: null,
        meta: {
          ...(acct.meta ?? {}),
          environment,
          country,
          refresh_expires_at: tok.x_refresh_token_expires_in ? new Date(now.getTime() + tok.x_refresh_token_expires_in * 1000).toISOString() : null,
          // A different company than last time starts its sync from scratch.
          full_sync_needed: true,
        },
        updated_at: now.toISOString(),
      })
      .eq('provider', 'quickbooks')

    await sb.from('integration_health').update({ enabled: true }).eq('source_key', 'quickbooks')

    // First sync now, in the background; the page shows its progress.
    const workerKey = process.env.JOB_WORKER_KEY
    if (workerKey) {
      await fetch(`${siteUrl()}/.netlify/functions/quickbooks-sync-background`, {
        method: 'POST',
        headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => {})
    }
    return back('qb_connected=1')
  } catch (e) {
    await sb
      .from('integration_accounts')
      .update({ status: 'error', last_error: (e as Error).message.slice(0, 300), updated_at: new Date().toISOString() })
      .eq('provider', 'quickbooks')
    return back(`qb_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`)
  }
}
