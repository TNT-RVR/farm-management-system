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
import { isPartnerTab } from '@/lib/partner'

const TABS = ['map', 'topography', 'profit', 'compare'] as const
type Tab = (typeof TABS)[number]

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
  // A partner gets the tabs his company's preset and ticks allow (lib/partner.ts).
  const tabs = usePartnerView() ? TABS.filter((t) => isPartnerTab('/map', t)) : TABS
  const [tab, setTab] = useTab<Tab>('map', tabs)
  return (
    <div className="flex h-full flex-col">
      {/* One line, scrolling sideways on a phone rather than wrapping: the
          wrap put Compare and the date on a second row and took ~35px off the
          map (design review, Nov 2026). */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
        {/* Only the tabs scroll; the date stays pinned on the right. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.length > 1 && tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium',
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
        </div>
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
  // A pill that reads "Today" or the day, in the same shape as the tabs, with
  // the real date box laid invisibly over it (design review, Nov 2026: the bare
  // box showed yyyy-mm-dd in the tab row). Tapping it opens the phone's own
  // picker; a computer gets the same picker from showPicker().
  const shown = on
    ? new Date(`${on}T12:00:00`).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        ...(on.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
      })
    : 'Today'
  return (
    <div
      className={cn(
        'ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
        on ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 text-gray-600',
      )}
      title="See the satellite photo, NDVI, FieldNET and AIMM layers as they were on a past day"
    >
      <label className="relative flex cursor-pointer items-center gap-1 whitespace-nowrap">
        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
        {shown}
        <input
          type="date"
          value={on ?? today}
          max={yesterday}
          aria-label="Show the map as it was on"
          onChange={(e) => set(asOfDay(e.target.value, today))}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.()
            } catch {
              // Older browsers: the box itself still opens on a tap.
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {on && (
        <button type="button" onClick={() => set(null)} aria-label="Back to today" title="Back to today" className="rounded p-0.5 hover:bg-amber-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
