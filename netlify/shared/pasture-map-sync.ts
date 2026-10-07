import type { SupabaseClient } from '@supabase/supabase-js'
import { kmlPolygons, pastureShapes } from '../../src/lib/kml-polygons.ts'

/**
 * Keep the app's pastures in step with the Google My Maps they are drawn on:
 * the farm's map, and any ranch's own (ranches.mymaps_url — East Ranch has
 * its own). A shape in a pasture or fence layer named "Pasture …" becomes a
 * pasture the satellite reads, with its grazing-list row; on a ranch's own map
 * it belongs to that ranch, on the farm map to the ranch whose yard is nearer.
 * A redrawn one gets its new boundary. The database does the matching
 * (fn_sync_pastures_from_map) and never deletes.
 *
 * A map must be shared "anyone with the link"; Google answers an unshared one
 * with a sign-in page, which is reported rather than read as no pastures.
 */
export type PastureMapResult = { ok: boolean; detail: string; added: string[]; moved: string[] }

const midOf = (url: string | null | undefined) => {
  const m = /[?&]mid=([^&]+)/.exec(url ?? '')
  return m ? decodeURIComponent(m[1]) : null
}

export async function runPastureMapSync(sb: SupabaseClient): Promise<PastureMapResult> {
  const [{ data: farm }, { data: ranches }] = await Promise.all([
    sb.from('farms').select('mymaps_url').limit(1).maybeSingle(),
    sb.from('ranches').select('id, name, mymaps_url'),
  ])
  const maps: { label: string; mid: string; ranchId: string | null }[] = []
  const farmMid = midOf(farm?.mymaps_url as string | null)
  if (farmMid) maps.push({ label: 'farm map', mid: farmMid, ranchId: null })
  for (const r of ranches ?? []) {
    const mid = midOf(r.mymaps_url as string | null)
    if (mid && mid !== farmMid) maps.push({ label: `${r.name} map`, mid, ranchId: r.id as string })
  }
  if (!maps.length) return { ok: false, detail: 'no My Map linked', added: [], moved: [] }

  const parts: string[] = []
  const added: string[] = []
  const moved: string[] = []
  let failed = 0
  for (const m of maps) {
    try {
      const res = await fetch(`https://www.google.com/maps/d/kml?mid=${encodeURIComponent(m.mid)}&forcekml=1`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      })
      const body = await res.text()
      if (!res.ok || !body.includes('<kml')) {
        failed++
        parts.push(`${m.label}: could not be read (${res.status}) — is it shared "anyone with the link"?`)
        continue
      }
      const shapes = pastureShapes(kmlPolygons(body))
      if (!shapes.length) {
        parts.push(`${m.label}: no shapes named "Pasture …" in a pasture or fence layer yet`)
        continue
      }
      const features = shapes.map((s) => ({ name: s.name, geometry: { type: 'MultiPolygon', coordinates: s.coordinates } }))
      const { data, error } = await sb.rpc('fn_sync_pastures_from_map', { p_features: features, p_ranch_id: m.ranchId })
      if (error) {
        failed++
        parts.push(`${m.label}: ${error.message}`)
        continue
      }
      const r = data as { added: string[]; moved: string[]; unchanged: number; skipped: string[] }
      added.push(...r.added)
      moved.push(...r.moved)
      parts.push(
        `${m.label}: ${shapes.length} pastures, ${r.added.length} added, ${r.moved.length} redrawn, ${r.unchanged} unchanged` +
          (r.added.length ? ` (added ${r.added.join(', ')})` : '') +
          (r.moved.length ? ` (redrawn ${r.moved.join(', ')})` : '') +
          (r.skipped.length ? ` (could not read ${r.skipped.join(', ')})` : ''),
      )
    } catch (e) {
      failed++
      parts.push(`${m.label}: ${(e as Error).message}`)
    }
  }
  const detail = parts.join(' · ')
  // A run that read at least one map reports in; the detail names any that failed.
  if (failed < maps.length) await sb.rpc('record_integration_heartbeat', { p_key: 'pasture_map', p_detail: detail, p_data_at: null })
  return { ok: failed === 0, detail, added, moved }
}
