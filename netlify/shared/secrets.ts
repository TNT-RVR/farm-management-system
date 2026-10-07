import { SETUP_KEY_NAMES } from '../../src/lib/setup-keys.ts'

/**
 * Keys entered on Farm setup, loaded into the function before it runs.
 *
 * Every function calls hydrateSecrets() first thing. It reads the saved keys
 * from app_secrets and puts each into process.env — only where Netlify's own
 * environment does not already have one, so a key set in Netlify always wins
 * and a farm set up that way sees no change. The rest of the code keeps
 * reading process.env exactly as it always has.
 *
 * Read once per warm instance and kept five minutes, so a busy function does
 * not ask the database every call, and a key changed in the app reaches every
 * function within five minutes. A key cleared in the app is taken back out.
 */

const TTL = 5 * 60_000
let loadedAt = 0
/** Names this module put into process.env, so a later load can take them back. */
const fromApp = new Set<string>()

export async function hydrateSecrets(): Promise<void> {
  if (Date.now() - loadedAt < TTL) return
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    const names = [...SETUP_KEY_NAMES].join(',')
    const res = await fetch(`${url}/rest/v1/app_secrets?select=key,value&key=in.(${names})`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return
    const rows = (await res.json()) as { key: string; value: string }[]
    // The farm's own context from Farm setup rides along: time zone, province
    // and description, read by src/lib/farm-context.ts. Same rule as the keys —
    // an environment variable set in Netlify wins.
    const farm = await fetch(`${url}/rest/v1/farm_setup?select=farm_name,time_zone,province,farm_description,retailer_name,irrigation_district_name,main_ranch_id,features,support_email&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ farm_name: string | null; time_zone: string | null; province: string | null; farm_description: string | null; retailer_name: string | null; irrigation_district_name: string | null; main_ranch_id: string | null; features: unknown; support_email: string | null }[]>) : []))
      .catch(() => [])
    const f = farm[0]
    if (f) {
      rows.push({ key: 'FARM_NAME', value: f.farm_name?.trim() ?? '' })
      rows.push({ key: 'FARM_TZ', value: f.time_zone ?? '' })
      rows.push({ key: 'FARM_PROVINCE', value: f.province ?? '' })
      rows.push({ key: 'FARM_DESCRIPTION', value: f.farm_description?.trim() ?? '' })
      rows.push({ key: 'FARM_RETAILER', value: f.retailer_name?.trim() ?? '' })
      rows.push({ key: 'FARM_DISTRICT', value: f.irrigation_district_name?.trim() ?? '' })
      rows.push({ key: 'FARM_MAIN_RANCH_ID', value: f.main_ranch_id ?? '' })
      rows.push({ key: 'FARM_SUPPORT_EMAIL', value: f.support_email?.trim() ?? '' })
      // The feature switches, for farmFeatureOn(). Present (even as {}) only
      // when a setup row exists; absent means a fresh install.
      rows.push({ key: 'FARM_FEATURES', value: JSON.stringify(f.features ?? {}) })
    }
    for (const k of fromApp) delete process.env[k]
    fromApp.clear()
    for (const r of rows) {
      if (process.env[r.key] || !r.value) continue
      process.env[r.key] = r.value
      fromApp.add(r.key)
    }
    loadedAt = Date.now()
  } catch {
    // The database being unreachable must not take a function down with it:
    // it runs on whatever Netlify's environment has, as it always did.
  }
}

/** Was this key put there by hydrateSecrets (the app), rather than by Netlify? */
export const savedInApp = (name: string) => fromApp.has(name)
