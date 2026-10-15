import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Satellite } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * A background function answers 202 with no body — the work has not started
 * when the response is sent, so there is nothing to report yet.
 */
type StartResult = { started: true }

/**
 * Run the satellite ingest by hand.
 *
 * TEMPORARY. Phase 1 has to be proven against three real fields before anything
 * is built on top of it, and waiting for the 08:00 cron to find that out is a
 * day per attempt. Once the observation counts have been checked against what
 * the sky actually did, this card comes out and the schedule is the only path.
 */
export function SatelliteSyncCard() {
  const [result, setResult] = useState<StartResult | null>(null)
  const run = useMutation({
    mutationFn: async (reprocess: boolean) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      // Background function: 202 with no body. A run over every field touches
      // four providers and takes minutes, which is far past the ten seconds a
      // synchronous Netlify function is given — that is what the 504 was.
      const res = await fetch(
        `/api/sat-ingest-background?days=14${reprocess ? '&reprocess=1' : ''}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        },
      )
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Failed (${res.status})`)
      }
      return { started: true } as StartResult
    },
    onSuccess: setResult,
  })

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Satellite className="h-4 w-4 text-gray-400" /> Satellite sync
          <span className="rounded bg-amber-200 px-1.5 text-[10px] font-medium uppercase text-amber-900">
            temporary
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => run.mutate(true)}
            disabled={run.isPending}
            className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
            title="Recompute scenes already on file, using the current mask. Costs processing units."
          >
            Reprocess
          </button>
          <button
            onClick={() => run.mutate(false)}
            disabled={run.isPending}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {run.isPending ? 'Running…' : 'Run satellite sync'}
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-600">
        Pulls the last 14 days of Sentinel-2, Sentinel-1 and Landsat over every satellite-enabled
        field, skipping any scene already computed. The overnight run does the same thing; this is
        here so a change can be checked without waiting a day for it.
      </p>
      <p className="mt-1 text-xs text-gray-500">
        <span className="font-medium">Reprocess</span> recomputes scenes already on file. Use it
        after the cloud mask changes — the numbers on file were produced by the old one. It spends
        processing units the ordinary run would have saved.
      </p>

      {run.isError && (
        <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {(run.error as Error).message}
        </p>
      )}

      {result && (
        <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs text-gray-600">
          <p className="font-medium text-gray-900">Started.</p>
          <p className="mt-1">
            A full run over every field takes a few minutes and finishes on the server, so there is
            nothing to wait for here. The map picks up new readings once it does; a cloudy or smoky
            fortnight can legitimately produce very few.
          </p>
        </div>
      )}
    </div>
  )
}
