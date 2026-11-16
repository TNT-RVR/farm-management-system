/**
 * The database the research-library scripts read and write.
 *
 * Two ways in, because these scripts are run in two different places.
 *
 * A farm running its own copy of this app already has its project URL and
 * service_role key to hand — they are two of the five settings SETUP.md puts
 * into Netlify — so the plain route is to read them from the environment.
 * That is the only route the published copy has, and the one documented in
 * docs/RESEARCH-LIBRARY.md.
 *
 * The farm this was built on has neither variable in its shell and a Supabase
 * management token instead, which can fetch the service_role key itself. That
 * path lives in scripts/_token.mjs, which is not published, so it is imported
 * only if it is there and only when the variables are not set.
 *
 * Either way a script gets the same thing: a supabase-js client with
 * service_role rights, which reaches the private research-library bucket and
 * sees every row whatever the row-level policies say. Keep that key in the
 * shell you run these from, never in a file in the repository.
 */
import { createClient } from '@supabase/supabase-js'

/** The bucket the PDFs live in. Created by the schema; made here if missing. */
export const BUCKET = 'research-library'

const URL_VARS = ['SUPABASE_URL', 'VITE_SUPABASE_URL']
const KEY_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']

function firstSet(names) {
  for (const name of names) {
    const value = (process.env[name] ?? '').trim()
    if (value) return { name, value }
  }
  return null
}

const client = (url, key) => createClient(url, key, { auth: { persistSession: false } })

/**
 * This farm's own shortcut: a management token, and the service_role key read
 * through it. Returns null where scripts/_token.mjs is not in the checkout,
 * which is every copy but the original.
 */
async function viaManagementToken() {
  let helper
  try {
    helper = await import('./_token.mjs')
  } catch {
    return null
  }
  const { token, from } = helper.readToken()
  const res = await fetch(`https://api.supabase.com/v1/projects/${helper.PROJECT}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not read the project's API keys (${res.status}). Token from ${from}.`)
  const key = (await res.json()).find((k) => k.name === 'service_role')?.api_key
  if (!key) throw new Error('The project has no service_role key in the management API.')
  return {
    sb: client(`https://${helper.PROJECT}.supabase.co`, key),
    from: `${helper.PROJECT}, reached with the token in ${from}`,
  }
}

/**
 * A client with service_role rights, and a line saying which database it
 * reached and how — worth printing, because a harvest writes thousands of rows
 * and "which project was that?" is a bad question to ask afterwards.
 */
export async function researchDb() {
  const url = firstSet(URL_VARS)
  const key = firstSet(KEY_VARS)
  if (url && key) {
    return {
      sb: client(url.value, key.value),
      from: `${url.value.replace(/^https?:\/\//, '')} (from ${url.name})`,
    }
  }

  const managed = await viaManagementToken()
  if (managed) return managed

  console.error('No database to work with. The research scripts need your Supabase project:')
  console.error('')
  console.error('  SUPABASE_URL=https://<your project ref>.supabase.co')
  console.error('  SUPABASE_SERVICE_ROLE_KEY=<the service_role key>')
  console.error('')
  console.error('Both are in Supabase under Project Settings → API — the same two SETUP.md')
  console.error('puts into Netlify. The service_role key reads and writes everything, so set')
  console.error('it in the shell you run this from and keep it out of the repository.')
  if (key && !url) console.error(`\n(${key.name} is set; the URL is the one missing.)`)
  if (url && !key) console.error(`\n(${url.name} is set; the service_role key is the one missing.)`)
  process.exit(1)
}

/**
 * Make sure the papers have somewhere to go.
 *
 * The schema creates this bucket, so usually there is nothing to do. It is
 * checked anyway because the alternative is a harvest that downloads a few
 * hundred PDFs and records every one of them as a failure.
 */
export async function ensureBucket(sb, id = BUCKET) {
  const { data } = await sb.storage.getBucket(id)
  if (data) return false
  const { error } = await sb.storage.createBucket(id, {
    public: false,
    fileSizeLimit: 262_144_000,
    allowedMimeTypes: ['application/pdf'],
  })
  // Another worker making it at the same moment is not a problem.
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`The ${id} bucket is missing and could not be made: ${error.message}`)
  }
  return true
}
