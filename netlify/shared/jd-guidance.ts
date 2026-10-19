import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDeereLine } from '../../src/lib/guidance-lines.ts'

/**
 * Guidance lines from John Deere Operations Center into jd_guidance_lines
 * (Sam, 17 Oct 2026: the lines with "Combine" in the name go to the
 * combines). READ-ONLY toward Deere: GET only, nothing is ever sent back.
 *
 * The table mirrors Deere per field: a line is written only when its data
 * hash changed (so the audit log does not fill with no-op refreshes), and a
 * line Deere no longer lists for a field is deleted here. Every line is kept,
 * combine or not; the download picks the combine ones.
 */

type JdList<T> = { values?: T[]; links?: { rel: string; uri: string }[] }

export type GuidanceSyncResult = { fields: number; lines: number; written: number; removed: number; errors: string[] }

async function listAll<T>(token: string, path: string, get: (token: string, url: string) => Promise<unknown>): Promise<T[]> {
  const out: T[] = []
  let url: string | null = path
  for (let i = 0; i < 50 && url; i++) {
    const page = (await get(token, url)) as JdList<T>
    out.push(...(page.values ?? []))
    url = page.links?.find((l) => l.rel === 'nextPage')?.uri ?? null
  }
  return out
}

export async function syncGuidanceLines(
  sb: SupabaseClient,
  token: string,
  orgId: string,
  get: (token: string, url: string) => Promise<unknown>,
): Promise<GuidanceSyncResult> {
  const result: GuidanceSyncResult = { fields: 0, lines: 0, written: 0, removed: 0, errors: [] }
  const { data: fields, error } = await sb.from('fields').select('id, name, jd_field_id').eq('active', true).not('jd_field_id', 'is', null)
  if (error) throw new Error(`fields: ${error.message}`)

  for (const field of fields ?? []) {
    result.fields++
    try {
      const raw = await listAll<unknown>(token, `/platform/organizations/${orgId}/fields/${field.jd_field_id}/guidanceLines`, get)
      const lines = raw.map(parseDeereLine).filter((l): l is NonNullable<typeof l> => l !== null)
      result.lines += lines.length

      const { data: had, error: hErr } = await sb.from('jd_guidance_lines').select('id, jd_line_id, data_hash, field_id').eq('field_id', field.id)
      if (hErr) throw new Error(hErr.message)
      const byId = new Map((had ?? []).map((h) => [h.jd_line_id as string, h]))

      const changed = lines.filter((l) => byId.get(l.jdLineId)?.data_hash !== l.hash)
      if (changed.length) {
        const { error: uErr } = await sb.from('jd_guidance_lines').upsert(
          changed.map((l) => ({
            field_id: field.id,
            jd_line_id: l.jdLineId,
            name: l.name,
            line_type: l.lineType,
            jd_type: l.jdType,
            archived: l.archived,
            heading_deg: l.headingDeg,
            geometry: l.geometry,
            data_hash: l.hash,
            jd_modified_at: l.modifiedAt,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: 'jd_line_id' },
        )
        if (uErr) throw new Error(uErr.message)
        result.written += changed.length
      }

      const seen = new Set(lines.map((l) => l.jdLineId))
      const gone = (had ?? []).filter((h) => !seen.has(h.jd_line_id as string)).map((h) => h.id as string)
      if (gone.length) {
        const { error: dErr } = await sb.from('jd_guidance_lines').delete().in('id', gone)
        if (dErr) throw new Error(dErr.message)
        result.removed += gone.length
      }
    } catch (e) {
      result.errors.push(`${field.name}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  return result
}
