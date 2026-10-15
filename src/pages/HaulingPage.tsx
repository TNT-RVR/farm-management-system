import { Truck } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useTab } from '@/lib/useTab'
import { DistancesTab } from './hauling/DistancesTab'
import { TruckingTab } from './hauling/TruckingTab'
import { FuelTab } from './hauling/FuelTab'
import { SpreadingTab } from './hauling/SpreadingTab'
import { SilageTab } from './hauling/SilageTab'
import { PricesBar } from './hauling/ui'

const TABS = ['distances', 'trucking', 'fuel', 'spreading', 'silage'] as const
type Tab = (typeof TABS)[number]
const LABEL: Record<Tab, string> = { distances: 'Distances', trucking: 'Trucking', fuel: 'Fuel', spreading: 'Spreading cost', silage: 'Silage haul' }

/**
 * Travel & trucking: how far everything is by road, what the machines burn
 * working each field and getting there, what trucking the crop costs, and
 * what spreading our own fertilizer would cost an acre, and how far silage
 * can be trucked before it stops paying.
 *
 * Diesel and the wage sit at the top because every tab is built on them.
 */
export function HaulingPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const [tab, setTab] = useTab<Tab>('hauling', TABS, 'distances')
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="border-b border-gray-200 bg-white px-4 md:px-6">
        <div className="flex items-center gap-2 py-3">
          <Truck className="h-5 w-5 text-brand-700" />
          <h1 className="text-lg font-semibold text-gray-900">Travel & trucking</h1>
        </div>
        <PillTabs tabs={TABS.map((t) => ({ key: t, label: LABEL[t] }))} value={tab} onChange={setTab} className="border-b-0 pb-0" />
      </div>
      <div className="space-y-4 p-4 md:p-6">
        <PricesBar isManager={isManager} />
        {tab === 'distances' ? (
          <DistancesTab isManager={isManager} />
        ) : tab === 'trucking' ? (
          <TruckingTab year={cropYear} isManager={isManager} />
        ) : tab === 'fuel' ? (
          <FuelTab year={cropYear} isManager={isManager} />
        ) : tab === 'spreading' ? (
          <SpreadingTab isManager={isManager} />
        ) : (
          <SilageTab year={cropYear} isManager={isManager} />
        )}
      </div>
    </div>
  )
}
