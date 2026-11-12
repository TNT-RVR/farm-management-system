import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Droplet, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePastures, useOnRanch } from '@/lib/pastures'
import { useCattleWater } from '@/lib/cattle-water'
import { mobsNow, useActivations } from '@/lib/eshepherd'
import { useHerdCounts } from '@/lib/cattle'
import { useRanches } from '@/lib/ranches'
import { localDateKey, useRanchWeather } from '@/lib/ranchWeather'
import { HOT_C, pastureWaterRows, type HerdClassRow } from '@/lib/cattle-water-demand'
import { HelpNote } from '@/components/HelpNote'
import { n0 } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Which pastures front the river, from the same column the 800 m reach reads. */
function useRiverAccess() {
  return useQuery({
    queryKey: ['pastures', 'river-access'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pastures').select('id, river_access')
      if (error) throw error
      return new Map((data ?? []).map((p) => [p.id as string, (p.river_access as string | null) ?? 'none']))
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * Water per pasture: what the herd on each one drinks a day, and the
 * drinkable water recorded for it.
 *
 * Sized on today's forecast high (Sam, 10 Nov 2026). It used to be three
 * buttons — cool / 20 °C / 30 °C+ — defaulting to the hot one, so in November
 * it quietly reported a July figure and nobody was going to press "Cool"
 * every morning. The forecast refetches every 15 minutes, so the number
 * follows the day on its own.
 *
 * `ranchId` '' is every ranch.
 */
export function WaterDemand({ ranchId = '' }: { ranchId?: string }) {
  const { data: pastures } = usePastures()
  const { data: pins } = useCattleWater()
  const { data: river } = useRiverAccess()
  const { data: activations } = useActivations()
  const { data: counts } = useHerdCounts('')
  const { data: ranches } = useRanches()
  const onRanch = useOnRanch(ranchId)
  const [showAll, setShowAll] = useState(false)

  // Whose weather: the ranch in the filter, or the first one when it is All.
  // Home Ranch and East Ranch are 24 km apart, so on All either is honest —
  // the card says which it read.
  const sorted = useMemo(() => [...(ranches ?? [])].sort((a, b) => a.sort_order - b.sort_order), [ranches])
  const wxRanch = (ranchId ? sorted.find((r) => r.id === ranchId) : sorted[0]) ?? null
  const { data: wx } = useRanchWeather(
    wxRanch?.latitude == null ? null : Number(wxRanch.latitude),
    wxRanch?.longitude == null ? null : Number(wxRanch.longitude),
    undefined,
    2,
  )
  const todayKey = localDateKey()
  const forecast = (wx?.daily ?? []).find((d) => d.date === todayKey) ?? wx?.daily?.[0] ?? null
  // No forecast: fall back to the hot day the card was sized for before, which
  // is the safe way to be wrong about how much water a dugout has to hold.
  const tempC = forecast?.hi ?? HOT_C

  const rows = useMemo(() => {
    if (!pastures || !pins || !counts || !ranches) return null
    const nameOf = new Map(ranches.map((r) => [r.id, r.name]))
    const herd: HerdClassRow[] = counts.map((c) => ({ ...c, ranch: nameOf.get(c.ranch_id ?? '') ?? '' }))
    const today = new Date().toLocaleDateString('en-CA')
    return pastureWaterRows({
      pastures: pastures
        // Paddocks on the ranch in the filter. useOnRanch drops the farm
        // outlines with it: a boundary is not a paddock.
        .filter((p) => onRanch(p.id))
        .map((p) => ({ id: p.id, name: p.name, ranch: p.ranch, river_access: river?.get(p.id) ?? 'none' })),
      mobs: mobsNow(activations ?? []),
      herd,
      pins,
      tempC,
      weaningDate: (name) => ranches.find((r) => r.name === name)?.weaning_date ?? null,
      today,
    })
  }, [pastures, pins, counts, ranches, river, activations, onRanch, tempC])

  if (!rows) return <p className="py-6 text-center text-sm text-gray-400">Loading water…</p>

  const occupied = rows.filter((r) => r.head > 0)
  const empty = rows.filter((r) => r.head === 0)
  const dryEmpty = empty.filter((r) => r.noWater).length
  const totalL = occupied.reduce((s, r) => s + r.litres, 0)
  const shown = showAll ? rows : occupied

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Droplet className="h-4 w-4 text-sky-600" /> Water the herd needs
          {occupied.length > 0 && <span className="font-normal text-gray-500">· {n0(totalL)} L a day</span>}
        </h2>
        <p className="text-xs text-gray-500">
          {forecast?.hi != null ? (
            <>
              Today {Math.round(forecast.hi)} °C
              {forecast.lo != null && <span className="text-gray-400"> / {Math.round(forecast.lo)} °C</span>}
              {wxRanch && <span className="text-gray-400"> at {wxRanch.name}</span>}
            </>
          ) : (
            <span className="text-amber-700">No forecast — sized for a {HOT_C} °C day</span>
          )}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="px-3 py-4 text-sm text-gray-500">No collared herd is on a drawn pasture right now.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((r) => (
            <li key={r.pasture.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{r.pasture.name}</p>
                <p className="text-xs text-gray-500">
                  {r.head > 0 ? r.groups.map((g) => `${n0(g.head)} ${g.label.toLowerCase()}`).join(' · ') : 'No herd on it now'}
                </p>
              </div>
              {r.head > 0 && (
                <p className="w-28 text-right font-semibold tabular-nums text-gray-900">
                  {n0(r.litres)} <span className="text-xs font-normal text-gray-500">L/day</span>
                </p>
              )}
              <div className="basis-full text-xs">
                {r.noWater ? (
                  <span className={cn('inline-flex items-center gap-1 font-medium', r.head > 0 ? 'text-red-700' : 'text-amber-700')}>
                    <AlertTriangle className="h-3.5 w-3.5" /> No drinkable water recorded
                  </span>
                ) : (
                  <span className="text-gray-600">
                    Water: {[...r.pins.map((p) => p.name), ...(r.river ? ['the river'] : [])].join(', ')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
        {empty.length > 0 ? (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-medium text-brand-700 hover:underline">
            {showAll ? 'Only pastures with cattle' : `All ${rows.length} pastures${dryEmpty ? ` · ${dryEmpty} with no drinkable water` : ''}`}
          </button>
        ) : (
          <span />
        )}
        <HelpNote title="How the water need is worked out">
          <p>
            About 1 US gallon per 100 lb of body weight a day in cool weather, rising in a straight line to 2 gallons at 30 °C and above. A
            cow nursing a calf drinks 30% more; calves at side drink by their own weight until the weaning date.
          </p>
          <p>
            The temperature is today&apos;s forecast high where the cattle are, refreshed every quarter of an hour — the high rather than
            the mean because the day&apos;s heat is what the drinking follows, and a trough has to keep up on the afternoon. The low is
            shown beside it for the shape of the day. If the forecast cannot be reached the card sizes for a {HOT_C} °C day and says so.
          </p>
          <p>
            The herd on each pasture is the collar mobs at the last eShepherd import, weighed from the Herd tab. Water is the drinkable pins
            in the pasture, pins set to serve it, and the river where the pasture fronts it.
          </p>
        </HelpNote>
      </div>
    </section>
  )
}
