import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'

/**
 * Spray records nobody has vouched for: typed into Operations Center by hand
 * with no area and no product logged — a plan that may never have happened
 * (Cotegra on #0, 28 Jul 2026; Viatude on Kellers, 17 Jul). They count for
 * nothing until a manager says yes, and "no" removes them for good.
 */
export function UnconfirmedSprays({ fieldId }: { fieldId?: string }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['jd_field_operations', 'unconfirmed', fieldId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('jd_unconfirmed_operations', { p_field: fieldId ?? null })
      if (error) throw error
      return data ?? []
    },
  })
  const answer = useMutation({
    mutationFn: async (v: { id: string; applied: boolean }) => {
      const { error } = await supabase.rpc('jd_confirm_operation', { p_id: v.id, p_applied: v.applied })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jd_field_operations'] }),
  })
  if (!data?.length) return null
  return (
    <div role="alert" className="mb-3 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        {data.length === 1 ? 'A spray record needs confirming' : `${data.length} spray records need confirming`}
      </p>
      <p className="mt-0.5 text-xs text-red-800">
        Entered by hand in Operations Center with no acres and no product logged. Not counted anywhere until someone says it was sprayed.
      </p>
      <ul className="mt-2 space-y-1.5">
        {data.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{new Date(o.started_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {!fieldId && (
              <Link to={`/fields/${o.field_id}/work`} className="underline">
                {o.field_name}
              </Link>
            )}
            <span className="text-red-800">{o.product ?? 'application'}</span>
            {isMgr ? (
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ id: o.id, applied: true })}
                  className="inline-flex items-center gap-1 rounded-md border border-green-600 bg-white px-2 py-0.5 text-xs font-semibold text-green-800 hover:bg-green-50"
                >
                  <Check className="h-3.5 w-3.5" /> It was sprayed
                </button>
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() => confirm('Remove this record? It will not come back on the next Deere sync.') && answer.mutate({ id: o.id, applied: false })}
                  className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  <X className="h-3.5 w-3.5" /> Not sprayed — remove
                </button>
              </span>
            ) : (
              <span className="ml-auto text-xs text-red-700">a manager needs to confirm</span>
            )}
          </li>
        ))}
      </ul>
      {answer.error && <p className="mt-1 text-xs text-red-700">{(answer.error as Error).message}</p>}
    </div>
  )
}
