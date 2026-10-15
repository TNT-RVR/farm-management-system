import type { Config } from '@netlify/functions'
import { admin, jdAccessToken, jdGet, MANAGER_ROLES } from './_jd.mts'
import { syncBoundaries } from '../shared/jd-boundaries'
import { hydrateSecrets } from '../shared/secrets.ts'

// Follow the John Deere boundaries.
//
// They are the ones driven with GPS, so they are the accurate shape and the app
// tracks them rather than the other way round. Daily rather than hourly: a
// boundary changes when somebody redrives a headland, which is a few times a
// year, and every per-acre figure in the app is computed from these polygons.
//
// Nothing is written unless a shape actually moved — replace_boundary_if_changed
// compares within a tolerance, because GPS coordinates wobble in the last
// digits between exports and equality would report a change every night.
export const config: Config = { schedule: '20 11 * * *' } // 05:20 at the ranch

export default async () => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const sb = admin()

  try {
    const token = await jdAccessToken(sb)
    const { data: acct } = await sb
      .from('integration_accounts')
      .select('external_org_id')
      .eq('provider', 'john_deere')
      .single()
    let orgId = (acct?.external_org_id as string | null) ?? null
    if (!orgId) {
      const orgs = await jdGet<{ values?: { id: string }[] }>(token, '/platform/organizations')
      orgId = orgs.values?.[0]?.id ?? null
    }
    if (!orgId) throw new Error('No John Deere organization available')

    const result = await syncBoundaries(sb, token, orgId, (t, url) => jdGet(t, url))

    // A boundary moving changes the acres, and the acres are the denominator of
    // every cost, rate and yield on that field. That is worth telling somebody
    // about; "nothing moved" is not.
    if (result.replaced.length || result.created.length || result.errors.length) {
      const { data: managers } = await sb
        .from('users')
        .select('id')
        .in('role', MANAGER_ROLES)
        .eq('active', true)

      const moved = result.replaced
        .map(
          (r) =>
            `${r.field} ${r.from?.toFixed(2) ?? '?'} → ${r.to?.toFixed(2) ?? '?'} ac`,
        )
        .join('; ')

      const rows = (managers ?? []).map((m) => ({
        user_id: m.id,
        kind: 'jd_boundary',
        title: result.replaced.length
          ? `${result.replaced.length} field boundary change(s) from John Deere`
          : 'John Deere boundary sync had a problem',
        body:
          (moved ? `${moved}. ` : '') +
          (result.created.length ? `New: ${result.created.join(', ')}. ` : '') +
          (result.errors.length ? `Errors: ${result.errors.join('; ')}` : '') +
          (result.replaced.length
            ? 'Per-acre costs and rates on those fields have changed with them.'
            : ''),
        link: '/fields',
      }))
      if (rows.length) await sb.from('notifications').insert(rows)
    }

    // Report in, so a run that stops happening becomes visible instead of
    // being mistaken for "no boundaries changed".
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'jd_boundaries',
      p_detail:
        `${result.checked} field(s) checked, ${result.replaced.length} changed, ` +
        `${result.unchanged} unchanged` +
        (result.locked.length ? `, ${result.locked.length} locked` : '') +
        (result.errors.length ? `, ${result.errors.length} error(s)` : ''),
      p_data_at: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
