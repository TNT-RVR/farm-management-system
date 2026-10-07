import { createClient } from '@supabase/supabase-js'
import { hydrateSecrets } from '../shared/secrets.ts'

// Tells the login screen whether an email has an account, so it can show
// "no account with that email" vs "wrong password" (this is an invite-only
// internal app, so email enumeration isn't a concern). Never reveals anything
// else about the account.
//   GET /api/auth-check-email?email=<email>
export const config = { path: '/api/auth-check-email' }

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const email = new URL(req.url).searchParams.get('email')?.trim().toLowerCase()
  const json = (b: unknown) =>
    new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } })
  if (!email || !url || !serviceKey) return json({ exists: null })
  try {
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })
    const { data } = await sb.from('users').select('id').ilike('email', email).maybeSingle()
    return json({ exists: Boolean(data) })
  } catch {
    return json({ exists: null })
  }
}
