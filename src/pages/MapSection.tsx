import { CalendarDays, CircleDollarSign, Columns2, Map as MapIcon, Mountain, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { asOfDay } from '@/lib/map-as-of'
import { useTab } from '@/lib/useTab'
import { MapPage } from '@/pages/MapPage'
import { TopographyPage } from '@/pages/TopographyPage'
import { ProfitLossPage } from '@/pages/ProfitLossPage'
import { ComparePage } from '@/pages/map/ComparePage'
import { cn } from '@/lib/utils'
import { usePartnerView } from '@/lib/partner-view'

const TABS = ['map', 'topography', 'profit', 'compare'] as const
type Tab = (typeof TABS)[number]
// A crop-share partner gets the map of his fields; topography and the
// profit map are the whole farm's.
const PARTNER_TABS: readonly Tab[] = ['map']

/**
 * The Map section: the farm map, and the topography built from Deere's
 * elevation, as two tabs of one view (merged 25 Sep 2026). /topography still
 * lands on the second. The Profit/Loss Map is the third: same map, same grid
 * of 5 m cells, coloured by dollars instead of height.
 *
 * A slim switch rather than the usual pill strip: the map is edge to edge and
 * every pixel of height above it is a pixel of map lost. Compare (29 Oct 2026)
 * splits it into two to four panes: one field through several layers, or
 * several fields through one.
 */
export function MapSection() {
  const tabs = usePartnerView() ? PARTNER_TABS : TABS
  const [tab, setTab] = useTab<Tab>('map', tabs)
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
        {tabs.length > 1 && tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium',
              tab === t ? 'bg-brand-800 text-white' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {t === 'map' ? (
              <MapIcon className="h-3.5 w-3.5" />
            ) : t === 'topography' ? (
              <Mountain className="h-3.5 w-3.5" />
            ) : t === 'compare' ? (
              <Columns2 className="h-3.5 w-3.5" />
            ) : (
              <CircleDollarSign className="h-3.5 w-3.5" />
            )}
            {t === 'map' ? 'Map' : t === 'topography' ? 'Topography' : t === 'compare' ? 'Compare' : 'Profit / Loss'}
          </button>
        ))}
        {(tab === 'map' || tab === 'compare') && <MapDatePicker />}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'map' ? <MapPage /> : tab === 'topography' ? <TopographyPage /> : tab === 'compare' ? <ComparePage /> : <ProfitLossPage />}
      </div>
    </div>
  )
}

/**
 * The day the map shows (Sam, 29 Oct 2026): today, or a past day picked
 * here. Kept in the address (?on=YYYY-MM-DD) so a link opens on the same day.
 * The satellite photo, NDVI, AIMM and FieldNET layers follow it; see
 * lib/map-as-of.
 */
function MapDatePicker() {
  const [params, setParams] = useSearchParams()
  const today = new Date().toLocaleDateString('en-CA')
  const on = asOfDay(params.get('on'), today)
  const set = (v: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (v) next.set('on', v)
        else next.delete('on')
        return next
      },
      { replace: true },
    )
  const day = new Date(`${today}T12:00:00`)
  day.setDate(day.getDate() - 1)
  const yesterday = day.toLocaleDateString('en-CA')
  return (
    <div
      className={cn(
        'ml-auto flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
        on ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600',
      )}
      title="See the satellite photo, NDVI, FieldNET and AIMM layers as they were on a past day"
    >
      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
      <input
        type="date"
        value={on ?? today}
        max={yesterday}
        aria-label="Show the map as it was on"
        onChange={(e) => set(asOfDay(e.target.value, today))}
        className="w-[7.5rem] bg-transparent text-xs focus:outline-none"
      />
      {on && (
        <button type="button" onClick={() => set(null)} aria-label="Back to today" title="Back to today" className="rounded p-0.5 hover:bg-amber-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
