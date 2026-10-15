import { supabase } from './supabase'

/**
 * Reading yields by crop from crop_yields_v (migration 20261009030000):
 * crop_history for whole fields, one row per crop on a split field's year.
 * The view cannot carry PostgREST's `crops(...)` embed — it is a union — so
 * the crop is fetched and attached here under the same `crops` key, and code
 * written against the embed reads it unchanged.
 */
export async function yieldsWithCrops<T extends { crop_id: string | null }>(
  rows: { data: T[] | null; error: { message: string } | null },
  cropColumns: string,
): Promise<{ data: (T & { crops: Record<string, unknown> | null })[]; error: { message: string } | null }> {
  if (rows.error) return { data: [], error: rows.error }
  const list = rows.data ?? []
  const ids = [...new Set(list.map((r) => r.crop_id).filter((v): v is string => Boolean(v)))]
  if (!ids.length) return { data: list.map((r) => ({ ...r, crops: null })), error: null }
  const { data: crops, error } = await supabase.from('crops').select(`id, ${cropColumns}`).in('id', ids)
  if (error) return { data: [], error }
  const byId = new Map(((crops ?? []) as unknown as ({ id: string } & Record<string, unknown>)[]).map((c) => [c.id, c]))
  return { data: list.map((r) => ({ ...r, crops: r.crop_id ? (byId.get(r.crop_id) ?? null) : null })), error: null }
}
