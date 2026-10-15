import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useRanches, useSetRanch, type Ranch } from '@/lib/ranches'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

/**
 * Pastures come from Google My Maps: the farm's map, and any ranch's own
 * (East Ranch has one). Draw a pasture in a map's Pastures/Fence Lines layer,
 * name it "Pasture …", and it reaches the app the next morning, or now with
 * this button — read by the satellite and in its ranch's grazing list.
 */
export function PastureMapSync({ isManager }: { isManager: boolean }) {
  const qc = useQueryClient()
  const { data: ranches } = useRanches()
  const sync = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/pasture-map-sync', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
      const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `Failed: ${res.status}`)
      return body.detail ?? 'done'
    },
    onSuccess: () => {
      for (const k of ['pastures', 'grazing_pastures', 'pasture_map', 'pasture_forage_index']) void qc.invalidateQueries({ queryKey: [k] })
    },
  })
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">Pastures from the My Maps</h2>
          <HelpNote
            className="mt-0.5 text-xs text-gray-600"
            summary="Draw pastures in Google My Maps; they arrive here the next morning."
            title="How pastures come in from My Maps"
          >
            <p>
              Draw a pasture in a map&apos;s <b>Pastures/Fence Lines</b> layer and name it starting with &ldquo;Pasture&rdquo; (for example &ldquo;Pasture
              BI-1&rdquo;). The next morning it is in the app, in its ranch&apos;s grazing list, and the satellite reads it from its next pass. A ranch with its
              own map below gets that map&apos;s pastures; the farm map&apos;s go to the nearer ranch. Redrawing one updates its boundary; shapes with other names
              are left out, and nothing is ever deleted. Each map must be shared &ldquo;anyone with the link&rdquo;.
            </p>
          </HelpNote>
        </div>
        {isManager && (
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', sync.isPending && 'animate-spin')} /> Update now
          </button>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {(ranches ?? []).map((r) => (
          <RanchMapLink key={r.id} ranch={r} isManager={isManager} />
        ))}
      </div>
      {sync.isSuccess && <p className="mt-2 text-xs text-green-700">{sync.data}</p>}
      {sync.isError && <p className="mt-2 text-xs text-red-700">{(sync.error as Error).message}</p>}
    </section>
  )
}

function RanchMapLink({ ranch, isManager }: { ranch: Ranch; isManager: boolean }) {
  const set = useSetRanch()
  const [value, setValue] = useState(ranch.mymaps_url ?? '')
  const changed = value.trim() !== (ranch.mymaps_url ?? '')
  const valid = value.trim() === '' || /[?&]mid=/.test(value)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && valid) set.mutate({ id: ranch.id, patch: { mymaps_url: value.trim() || null } })
      }}
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <span className="w-24 shrink-0 font-medium text-gray-700">{ranch.name}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!isManager}
        placeholder="farm map (paste this ranch's own My Map link)"
        className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-50"
      />
      {isManager && (
        <button type="submit" disabled={!changed || !valid || set.isPending} className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white disabled:opacity-40">
          Save
        </button>
      )}
      {!valid && <span className="text-red-700">That isn&apos;t a My Maps link (it should contain &ldquo;mid=&rdquo;).</span>}
      {set.isSuccess && !changed && <span className="text-green-700">Saved — press Update now.</span>}
      {set.isError && <span className="text-red-700">{(set.error as Error).message}</span>}
    </form>
  )
}
