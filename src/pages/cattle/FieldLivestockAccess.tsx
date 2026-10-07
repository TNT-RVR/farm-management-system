import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type Row = { id: string; name: string; grazed_after_harvest: boolean; open_to_pasture: boolean; grazing_note: string | null }

/**
 * Which crop fields cattle get onto: grazed once the crop is off, or not
 * fenced off from the pasture around them. Either makes a spray whose label
 * restricts grazing or feeding worth an alert on that field, whatever the
 * crop; only a field open to its pasture counts cattle in that pasture as on it.
 */
export function FieldLivestockAccess({ isManager }: { isManager: boolean }) {
  const qc = useQueryClient()
  const { data: fields } = useQuery({
    queryKey: ['fields', 'livestock_access'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fields')
        .select('id, name, grazed_after_harvest, open_to_pasture, grazing_note')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Row[]
    },
  })
  const set = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Row, 'grazed_after_harvest' | 'open_to_pasture'>> }) => {
      const { error } = await supabase.from('fields').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fields', 'livestock_access'] })
      void qc.invalidateQueries({ queryKey: ['grazing-restrictions'] })
    },
  })
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-900">Cattle on crop fields</h2>
      <p className="mt-0.5 text-xs text-gray-600">
        Tick where cattle get onto a field. A spray whose label restricts grazing or feeding then raises an alert there whatever the crop, and cattle in a pasture
        count as on a field only when the field is open to that pasture.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-1 pr-2 font-medium">Field</th>
              <th className="py-1 pr-2 text-center font-medium">Grazed after harvest</th>
              <th className="py-1 pr-2 text-center font-medium">Open to the pasture</th>
              <th className="py-1 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(fields ?? []).map((f) => (
              <tr key={f.id}>
                <td className="py-1 pr-2 text-gray-800">{f.name}</td>
                {(['grazed_after_harvest', 'open_to_pasture'] as const).map((k) => (
                  <td key={k} className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={f[k]}
                      disabled={!isManager || set.isPending}
                      onChange={(e) => set.mutate({ id: f.id, patch: { [k]: e.target.checked } })}
                      aria-label={`${f.name}: ${k === 'grazed_after_harvest' ? 'grazed after harvest' : 'open to the pasture'}`}
                    />
                  </td>
                ))}
                <td className="py-1 text-gray-500">{f.grazing_note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {set.isError && <p className="mt-1 text-xs text-red-700">{(set.error as Error).message}</p>}
    </section>
  )
}
