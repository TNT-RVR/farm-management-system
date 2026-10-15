import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type RanchRow = Database['public']['Tables']['ranches']['Row']

/** The manifest fields, in the order they are read off one. */
const FIELDS: { key: keyof RanchRow; label: string; hint?: string; wide?: boolean }[] = [
  { key: 'owner_name', label: 'Owner', hint: 'as it appears on the manifest' },
  { key: 'owner_phone', label: 'Phone' },
  { key: 'premises_id', label: 'Premises ID', hint: 'Alberta PID for this location' },
  { key: 'brand', label: 'Brand' },
  { key: 'brand_location', label: 'Brand location', hint: 'left rib, right hip' },
  { key: 'address', label: 'Address', wide: true },
]

function useRanchDetails() {
  return useQuery({
    queryKey: ['ranches'],
    queryFn: async (): Promise<RanchRow[]> => {
      const { data, error } = await supabase.from('ranches').select('*').order('sort_order')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Brand, premises ID and owner details, per ranch.
 *
 * These belong to a place and change about as often as a brand does, so they
 * live here rather than being retyped on every manifest. The manifest fills
 * itself from them and can also write back, which is how they get entered the
 * first time — but somebody looking for "where do I set the brand" should find
 * it in settings, which is what this is.
 */
export function BrandSettings({ isManager }: { isManager: boolean }) {
  const { data: ranches } = useRanchDetails()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({})

  const save = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, string | null> }) => {
      const { error } = await supabase
        .from('ranches')
        .update(patch as Database['public']['Tables']['ranches']['Update'])
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      setDraft((x) => {
        const next = { ...x }
        delete next[v.id]
        return next
      })
      void qc.invalidateQueries({ queryKey: ['ranches'] })
    },
  })

  const valueOf = (r: RanchRow, key: keyof RanchRow) => {
    const d = draft[r.id]?.[key as string]
    if (d !== undefined) return d
    const v = r[key]
    return v == null ? '' : String(v)
  }

  const edit = (id: string, key: string, v: string) =>
    setDraft((x) => ({ ...x, [id]: { ...(x[id] ?? {}), [key]: v } }))

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Brand &amp; premises</h2>
      <p className="mb-2 text-xs text-gray-500">The top half of every manifest — set once per ranch.</p>

      <div className="space-y-3">
        {(ranches ?? []).map((r) => {
          const dirty = Boolean(draft[r.id])
          return (
            <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-800">{r.name}</h3>
                {dirty && isManager && (
                  <button
                    onClick={() =>
                      save.mutate({
                        id: r.id,
                        patch: Object.fromEntries(
                          FIELDS.map((f) => [f.key, valueOf(r, f.key).trim() || null]),
                        ),
                      })
                    }
                    disabled={save.isPending}
                    className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                  >
                    {save.isPending ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <label
                    key={f.key as string}
                    className={
                      f.wide
                        ? 'text-[11px] font-medium text-gray-500 sm:col-span-3'
                        : 'text-[11px] font-medium text-gray-500'
                    }
                  >
                    {f.label}
                    <input
                      disabled={!isManager}
                      value={valueOf(r, f.key)}
                      onChange={(e) => edit(r.id, f.key as string, e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
                    />
                    {f.hint && (
                      <span className="mt-0.5 block text-[10px] font-normal text-gray-400">
                        {f.hint}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {save.error && <p className="mt-1 text-xs text-red-700">{(save.error as Error).message}</p>}
    </section>
  )
}
