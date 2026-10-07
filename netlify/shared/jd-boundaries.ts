import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pulling field boundaries from John Deere.
 *
 * The Deere boundaries are the ones driven with GPS, so they are the accurate
 * shape and the app follows them rather than the other way round. Every
 * per-acre figure in the app — input cost, breakeven, fertiliser rate, yield —
 * divides by the area of these polygons, so a boundary that has drifted out of
 * step is wrong everywhere at once and quietly.
 *
 * Replacement goes through replace_boundary_if_changed, which does two things
 * this cannot do from here: it compares the incoming shape against the stored
 * one within a tolerance, so nightly runs do not pile up identical versions,
 * and it respects fields.boundary_locked for any field pinned to a hand-drawn
 * shape.
 */

type JdList<T> = { values?: T[]; links?: { rel: string; uri: string }[] }
type JdPoint = { lat: number; lon: number }
type JdRing = { points?: JdPoint[]; passable?: boolean }
type JdMultiPolygon = { rings?: JdRing[] }
type JdBoundary = { id: string; active?: boolean; multipolygons?: JdMultiPolygon[] }

export type BoundarySyncResult = {
  checked: number
  replaced: { field: string; from: number | null; to: number | null }[]
  created: string[]
  unchanged: number
  locked: string[]
  errors: string[]
}

async function listAll<T>(
  token: string,
  path: string,
  get: (token: string, url: string) => Promise<unknown>,
): Promise<T[]> {
  const out: T[] = []
  let url: string | null = path
  for (let i = 0; i < 50 && url; i++) {
    const page = (await get(token, url)) as JdList<T>
    out.push(...(page.values ?? []))
    const next = page.links?.find((l) => l.rel === 'nextPage')?.uri
    url = next ?? null
  }
  return out
}

/** JD multipolygons (rings of {lat,lon}) → GeoJSON MultiPolygon, or null. */
export function toGeoJson(b: JdBoundary): unknown | null {
  const polys: number[][][][] = []
  for (const mp of b.multipolygons ?? []) {
    const rings: number[][][] = []
    for (const ring of mp.rings ?? []) {
      const pts = (ring.points ?? []).map((p) => [p.lon, p.lat] as number[])
      if (pts.length >= 3) {
        // Deere does not always close the ring; GeoJSON requires it.
        if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])
          pts.push(pts[0])
        rings.push(pts)
      }
    }
    if (rings.length) polys.push(rings)
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
}

export async function syncBoundaries(
  sb: SupabaseClient,
  token: string,
  orgId: string,
  get: (token: string, url: string) => Promise<unknown>,
): Promise<BoundarySyncResult> {
  const result: BoundarySyncResult = {
    checked: 0,
    replaced: [],
    created: [],
    unchanged: 0,
    locked: [],
    errors: [],
  }

  // Only fields already linked to Deere. Creating fields is the full sync's
  // job; this one keeps existing shapes honest and nothing else.
  const { data: fields, error } = await sb
    .from('fields')
    .select('id, name, jd_field_id')
    .not('jd_field_id', 'is', null)
  if (error) throw new Error(`fields: ${error.message}`)

  for (const field of fields ?? []) {
    result.checked++
    try {
      const boundaries = await listAll<JdBoundary>(
        token,
        `/platform/organizations/${orgId}/fields/${field.jd_field_id}/boundaries`,
        get,
      )
      const active = boundaries.find((b) => b.active) ?? boundaries[0]
      const geo = active ? toGeoJson(active) : null
      if (!geo) continue

      // The area before, so a change can be reported as a number rather than
      // as the word "changed" — acres are what people will want to check.
      const { data: before } = await sb
        .from('field_boundaries')
        .select('acres')
        .eq('field_id', field.id)
        .is('valid_to', null)
        .maybeSingle()

      const { data: outcome, error: rpcError } = await sb.rpc('replace_boundary_if_changed', {
        p_field_id: field.id,
        p_geojson: geo,
        p_source: 'jd_import',
      })
      if (rpcError) {
        result.errors.push(`${field.name}: ${rpcError.message.slice(0, 120)}`)
        continue
      }

      if (outcome === 'locked') result.locked.push(field.name)
      else if (outcome === 'unchanged' || outcome === 'empty') result.unchanged++
      else if (outcome === 'created') result.created.push(field.name)
      else if (outcome === 'replaced') {
        const { data: after } = await sb
          .from('field_boundaries')
          .select('acres')
          .eq('field_id', field.id)
          .is('valid_to', null)
          .maybeSingle()
        result.replaced.push({
          field: field.name,
          from: before?.acres == null ? null : Number(before.acres),
          to: after?.acres == null ? null : Number(after.acres),
        })
      }
    } catch (e) {
      result.errors.push(`${field.name}: ${(e as Error).message.slice(0, 120)}`)
    }
  }

  return result
}
