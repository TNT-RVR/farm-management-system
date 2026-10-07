import { Droplet, TriangleAlert } from 'lucide-react'
import { useUnderutilisation } from '@/lib/grazing-forage'
import { usePastures } from '@/lib/pastures'
import { HelpNote } from '@/components/HelpNote'

/**
 * Ground the herd is not using, in acres (spec §9.4).
 *
 * "Cattle do not graze evenly. They avoid ground more than roughly 800 m from
 * water... That is a direct, actionable case for a portable water trough or a
 * temporary cross-fence, and it is measurable in acres."
 *
 * The acres are the point. "Some of that paddock is under-grazed" is an
 * observation; "310 acres beyond walking distance of water are carrying forage
 * the herd is not touching" is a decision about where to put a trough.
 *
 * The comparison is between two bands of the SAME paddock on the SAME day, so
 * both share the weather, the soil broadly, and — crucially — the same
 * atmosphere. A smoky day depresses both bands and the difference survives it,
 * which is why this holds up in a season where the absolute numbers have been
 * so much trouble.
 */
export function Underutilisation() {
  const { data: rows, isLoading } = useUnderutilisation()
  const { data: pastures } = usePastures()

  const withoutWater = (pastures ?? []).filter((p) => p.satellite_enabled).length - (rows ?? []).length
  const actionable = (rows ?? []).filter((r) => r.actionable)

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Droplet className="h-4 w-4 text-gray-400" /> Ground the herd is not using
      </h3>

      {isLoading && <p className="text-xs text-gray-500">Comparing distance-from-water bands…</p>}

      {!isLoading && (rows ?? []).length === 0 && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-xs text-gray-600">
          <HelpNote
            className="text-xs text-gray-600"
            summary="Mark water sources on the map to see ground the herd isn't using."
            title="Why it needs water marked"
          >
            <p>
              This needs a water source marked on each paddock — the whole finding is “ground more
              than 800 m from water”, and there is no such thing as 800 m from an unknown point.
              Mark the dugouts and troughs on the pasture map, then run a satellite sync.
            </p>
          </HelpNote>
        </div>
      )}

      {actionable.length > 0 && (
        <ul className="space-y-2">
          {actionable.map((r) => (
            <li key={r.pasture_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-baseline gap-2">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="font-medium text-gray-900">{r.name}</span>
                <span className="text-xs tabular-nums text-amber-800">
                  {r.far_water_acres != null
                    ? `${Math.round(r.far_water_acres).toLocaleString('en-CA')} ac`
                    : ''}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-700">{r.finding}</p>
              <p className="mt-1 text-[11px] tabular-nums text-gray-500">
                NDVI {r.near_water_ndvi} near water vs {r.far_water_ndvi} beyond it — a gap of{' '}
                {r.ndvi_gap}.
              </p>
            </li>
          ))}
        </ul>
      )}

      {(rows ?? []).length > 0 && actionable.length === 0 && (
        <p className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
          No paddock is showing a meaningful gap between the ground near water and the ground
          beyond it. That is the good outcome — it means the herd is spreading out.
        </p>
      )}

      {withoutWater > 0 && (rows ?? []).length > 0 && (
        <p className="text-[11px] text-gray-500">
          {withoutWater} paddock{withoutWater === 1 ? '' : 's'} still have no water source marked
          and are not included.
        </p>
      )}
    </div>
  )
}
