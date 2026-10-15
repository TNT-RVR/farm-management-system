import { admin, jdAccessToken, jdGet, json, requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// One-way John Deere → app sync (manager-only): pulls fields, current
// boundaries, and harvest field-operations into fields / field_boundaries /
// crop_history. Idempotent via fields.jd_field_id.
//
// NOTE: the exact JD Axiom JSON shapes (boundary rings, fieldOperations) are
// handled defensively below and should be confirmed against a real sandbox
// response on the first live connect — unparseable records are skipped and
// counted, never crash the sync.

type JdList<T> = { values?: T[]; links?: { rel: string; uri: string }[] }
type JdPoint = { lat: number; lon: number }
type JdRing = { points?: JdPoint[]; passable?: boolean }
type JdMultiPolygon = { rings?: JdRing[] }
type JdBoundary = { id: string; active?: boolean; multipolygons?: JdMultiPolygon[] }
type JdField = { id: string; name: string }

async function jdListAll<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = path
  for (let i = 0; i < 50 && url; i++) {
    const page: JdList<T> = await jdGet<JdList<T>>(token, url)
    out.push(...(page.values ?? []))
    const next = page.links?.find((l) => l.rel === 'nextPage')?.uri
    url = next ?? null
  }
  return out
}

/** JD multipolygons (rings of {lat,lon}) → GeoJSON MultiPolygon, or null. */
function toGeoJson(b: JdBoundary): unknown | null {
  const polys: number[][][][] = []
  for (const mp of b.multipolygons ?? []) {
    const rings: number[][][] = []
    for (const ring of mp.rings ?? []) {
      const pts = (ring.points ?? []).map((p) => [p.lon, p.lat] as number[])
      if (pts.length >= 3) {
        if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])
          pts.push(pts[0])
        rings.push(pts)
      }
    }
    if (rings.length) polys.push(rings)
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const userId = await requireManager(req, sb)
  if (!userId) return json({ error: 'Only active managers can sync' }, 403)

  const result = { fields: 0, boundaries: 0, cropHistory: 0, skipped: 0, dismissed: 0, errors: [] as string[] }

  try {
    const token = await jdAccessToken(sb)
    const { data: acct } = await sb
      .from('integration_accounts')
      .select('external_org_id')
      .eq('provider', 'john_deere')
      .single()
    let orgId = acct?.external_org_id as string | null
    if (!orgId) {
      const orgs = await jdGet<JdList<{ id: string }>>(token, '/platform/organizations')
      orgId = orgs.values?.[0]?.id ?? null
    }
    if (!orgId) throw new Error('No John Deere organization available')

    const { data: farm } = await sb.from('farms').select('id').limit(1).single()
    const jdFields = await jdListAll<JdField>(token, `/platform/organizations/${orgId}/fields`)
    // Fields somebody has deleted here. Deere still has them — a test entry, a
    // yard, one called "---" — and without this list the sync makes each of
    // them again the moment it cannot find a local field with that Deere id.
    // That is the loop where deleting a field achieves nothing at all.
    const { data: dismissedRows } = await sb.from('jd_dismissed_fields').select('jd_field_id')
    const dismissed = new Set((dismissedRows ?? []).map((r) => r.jd_field_id as string))

    for (const jf of jdFields) {
      try {
        // Match local field by jd id, then by name; create if new.
        let { data: field } = await sb
          .from('fields')
          .select('id')
          .eq('jd_field_id', jf.id)
          .maybeSingle()
        // Turned away before anything else is tried. Matching a dismissed
        // Deere field to a local one by NAME would be the same resurrection
        // wearing another field's clothes — and it would hang the junk field's
        // boundary on a real one.
        if (!field && dismissed.has(jf.id)) {
          result.dismissed++
          continue
        }
        if (!field) {
          const { data: byName } = await sb
            .from('fields')
            .select('id')
            .eq('name', jf.name)
            .maybeSingle()
          if (byName) {
            await sb.from('fields').update({ jd_field_id: jf.id }).eq('id', byName.id)
            field = byName
          } else {
            const { data: created } = await sb
              .from('fields')
              .insert({ farm_id: farm!.id, name: jf.name, jd_field_id: jf.id })
              .select('id')
              .single()
            field = created
            result.fields++
          }
        }
        if (!field) continue

        // Current boundary
        const boundaries = await jdListAll<JdBoundary>(
          token,
          `/platform/organizations/${orgId}/fields/${jf.id}/boundaries`,
        )
        const active = boundaries.find((b) => b.active) ?? boundaries[0]
        const geo = active ? toGeoJson(active) : null
        if (geo) {
          const { error } = await sb.rpc('replace_boundary', {
            p_field_id: field.id,
            p_geojson: geo,
            p_source: 'jd_import',
          })
          if (error) result.errors.push(`${jf.name} boundary: ${error.message}`)
          else result.boundaries++
        }
        // Crop history from field operations is left as a follow-up once the
        // real fieldOperations payload shape is confirmed (harvest yields vary
        // by machine/crop); skip-count it rather than write guessed data.
        result.skipped++
      } catch (e) {
        result.errors.push(`${jf.name}: ${(e as Error).message.slice(0, 120)}`)
      }
    }

    await sb
      .from('integration_accounts')
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: result.errors.length ? result.errors.slice(0, 3).join('; ') : null,
        status: 'connected',
        updated_at: new Date().toISOString(),
      })
      .eq('provider', 'john_deere')
    return json({ ok: true, ...result })
  } catch (e) {
    await sb
      .from('integration_accounts')
      .update({ status: 'error', last_error: (e as Error).message, updated_at: new Date().toISOString() })
      .eq('provider', 'john_deere')
    return json({ error: (e as Error).message, ...result }, 400)
  }
}
