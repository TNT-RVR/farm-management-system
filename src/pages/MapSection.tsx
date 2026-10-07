import { CircleDollarSign, Map as MapIcon, Mountain } from 'lucide-react'
import { useTab } from '@/lib/useTab'
import { MapPage } from '@/pages/MapPage'
import { TopographyPage } from '@/pages/TopographyPage'
import { ProfitLossPage } from '@/pages/ProfitLossPage'
import { cn } from '@/lib/utils'

const TABS = ['map', 'topography', 'profit'] as const
type Tab = (typeof TABS)[number]

/**
 * The Map section: the farm map, and the topography built from Deere's
 * elevation, as two tabs of one view (merged 25 Sep 2026). /topography still
 * lands on the second. The Profit/Loss Map is the third: same map, same grid
 * of 5 m cells, coloured by dollars instead of height.
 *
 * A slim switch rather than the usual pill strip: the map is edge to edge and
 * every pixel of height above it is a pixel of map lost.
 */
export function MapSection() {
  const [tab, setTab] = useTab<Tab>('map', TABS, 'map')
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
        {TABS.map((t) => (
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
            ) : (
              <CircleDollarSign className="h-3.5 w-3.5" />
            )}
            {t === 'map' ? 'Map' : t === 'topography' ? 'Topography' : 'Profit / Loss'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'map' ? <MapPage /> : tab === 'topography' ? <TopographyPage /> : <ProfitLossPage />}
      </div>
    </div>
  )
}
