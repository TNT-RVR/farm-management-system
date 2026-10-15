import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Fan, X } from 'lucide-react'
import { useBinAirAlerts, useDismissBinAirAlert } from '@/lib/moisture-queries'
import { useBins } from '@/lib/bins'
import { useCrops, useFields } from '@/lib/queries'

/**
 * Bins that went up tough and have not had air put on them.
 *
 * Shown on Harvest and on Storage, because those are the two screens somebody
 * is on when they could actually do something about it, and it stays up until
 * a person says it is handled rather than ageing off on its own — a warning
 * that expires by itself is a warning that stops meaning anything.
 */
export function BinAirAlerts({ compact = false }: { compact?: boolean }) {
  const { data: alerts } = useBinAirAlerts()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: bins } = useBins()
  const dismiss = useDismissBinAirAlert()
  const [confirming, setConfirming] = useState<string | null>(null)

  if (!alerts?.length) return null

  const nameOf = (id: string | null, list: { id: string; name: string }[] | undefined) =>
    id ? list?.find((x) => x.id === id)?.name : undefined

  return (
    <div className="mb-4 space-y-2">
      {alerts.map((a) => {
        const field = nameOf(a.field_id, fields)
        const crop = nameOf(a.crop_id, crops)
        const bin = nameOf(a.bin_id, bins)
        return (
          <div
            key={a.id}
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <div className="flex flex-wrap items-start gap-2">
              <Fan className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {bin ? `${bin} needs air` : 'A bin needs air'}
                  {field && <span className="font-normal"> — {field}</span>}
                  {crop && <span className="font-normal"> {crop.toLowerCase()}</span>}
                </p>
                <p className="mt-0.5 text-amber-800">
                  Tested {Number(a.moisture_pct).toFixed(1)}% — {a.grade}. Harvest is recorded, so
                  it is in the bin now.
                  {/* The bin is often not known when the sample is run, and
                      saying so beats an alert that looks half-filled-in. */}
                  {!bin && ' Which bin it went in was not recorded.'}
                </p>
                {!compact && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    Raised {new Date(a.raised_at).toLocaleDateString('en-CA', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' · '}
                    <Link to="/harvest" className="underline">
                      moisture tests
                    </Link>
                  </p>
                )}
              </div>
              {confirming === a.id ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Air put on' })}
                    disabled={dismiss.isPending}
                    className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                  >
                    Air is on it
                  </button>
                  {/* Not every tough sample needs air: it may have been blended,
                      dried, sold, or read wetter than the bin really is. */}
                  <button
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Dismissed without air' })}
                    disabled={dismiss.isPending}
                    className="rounded-md border border-amber-500 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    No air needed
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
                    aria-label="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(a.id)}
                  className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
