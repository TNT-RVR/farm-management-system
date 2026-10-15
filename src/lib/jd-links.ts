import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * A pass on the Work list, opened in Operations Center.
 *
 * Deere's API gives every field operation its ids — the organisation, the
 * field, the operation itself — and no browser address. The address is learned
 * from one example: somebody pastes the link of any record from Operations
 * Center, the ids in it are swapped for placeholders, and the template is kept
 * on the farm. Every pass then links by filling its own ids back in.
 */
export type OpsCenterIds = { org: string | null; field: string | null; operation: string }

const idFrom = (uri: string | undefined, after: string): string | null => {
  if (!uri) return null
  const i = uri.indexOf(after)
  if (i < 0) return null
  return uri.slice(i + after.length).split('/')[0] || null
}

/** The ids off a synced operation's raw links. */
export function opsCenterIds(
  op: { jd_id: string; raw: unknown },
): OpsCenterIds {
  const links = ((op.raw as { links?: { rel?: string; uri?: string }[] } | null)?.links ?? [])
  const rel = (r: string) => links.find((l) => l.rel === r)?.uri
  return {
    org: idFrom(rel('organization') ?? rel('field'), '/organizations/'),
    field: idFrom(rel('field'), '/fields/'),
    operation: op.jd_id,
  }
}

export const PLACEHOLDERS = ['{org}', '{field}', '{operation}'] as const

/**
 * Turn a pasted Operations Center address into a template.
 *
 * Every id known to the app is tried against the address; the operation id is
 * the one that has to be there, or the link is to something other than a
 * pass. Org and field are swapped when present, so an address that carries
 * only the operation still works.
 */
export function templateFromExample(
  url: string,
  known: { orgs: string[]; fields: string[]; operations: string[] },
): { template: string; operation: string } | null {
  let t = url.trim()
  if (!/^https?:\/\//i.test(t)) return null
  const op = known.operations.find((id) => id && t.includes(id))
  if (!op) return null
  t = t.split(op).join('{operation}')
  for (const f of known.fields) if (f && t.includes(f)) t = t.split(f).join('{field}')
  for (const o of known.orgs) if (o && t.includes(o)) t = t.split(o).join('{org}')
  return { template: t, operation: op }
}

/** The address of one pass, or null when the template needs an id this pass lacks. */
export function workLink(template: string | null | undefined, ids: OpsCenterIds): string | null {
  if (!template) return null
  if (template.includes('{org}') && !ids.org) return null
  if (template.includes('{field}') && !ids.field) return null
  return template
    .replace(/\{operation\}/g, ids.operation)
    .replace(/\{field\}/g, ids.field ?? '')
    .replace(/\{org\}/g, ids.org ?? '')
}

export function useJdWorkTemplate() {
  return useQuery({
    queryKey: ['jd_work_url'],
    queryFn: async () => {
      // maybeSingle: no farm row on a new install until Farm setup or a first field makes one.
      const { data, error } = await supabase.from('farms').select('id, jd_work_url').limit(1).maybeSingle()
      if (error) throw error
      return data as { id: string; jd_work_url: string | null } | null
    },
    staleTime: 10 * 60_000,
  })
}

export function useSetJdWorkTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, jd_work_url }: { id: string; jd_work_url: string | null }) => {
      const { error } = await supabase.from('farms').update({ jd_work_url }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_work_url'] }),
  })
}
