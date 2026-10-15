import { admin, anydoAuthorizeUrl, anydoClientId, json, makeChallenge, makeVerifier, requireUser } from './_anydo.mts'
import { encryptToken } from './_fieldnet.mts'

// Starts one person's Any.do sign-in (OAuth 2.1, PKCE). Any active user may
// connect their own Any.do; the state and verifier wait on their own
// anydo_tokens row, which no browser can read.
export default async (req: Request) => {
  const sb = admin()
  const userId = await requireUser(req, sb)
  if (!userId) return json({ error: 'Sign in first' }, 401)
  try {
    const clientId = await anydoClientId(sb)
    const state = crypto.randomUUID()
    const verifier = makeVerifier()
    const challenge = await makeChallenge(verifier)
    const { error } = await sb.from('anydo_tokens').upsert(
      { user_id: userId, oauth_state: state, oauth_verifier: await encryptToken(verifier), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    if (error) throw error
    await sb.from('anydo_connections').upsert({ user_id: userId, status: 'pending', updated_at: new Date().toISOString() }, { onConflict: 'user_id', ignoreDuplicates: true })
    return json({ authorizeUrl: anydoAuthorizeUrl(clientId, state, challenge) })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}
