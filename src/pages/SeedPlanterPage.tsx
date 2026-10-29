import { Sprout } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { PlanterCalculator } from '@/pages/calculator/PlanterCalculator'
import { CropPlanterList } from '@/pages/planter/CropPlanterList'
import { useTab } from '@/lib/useTab'

/**
 * Seed & planter: the planter calculator, which was a Calculator tab, and
 * every crop's planter settings in one list, which were only on each crop's
 * page. Both are wanted at seeding, so they share a view rather than sitting
 * under unit conversions and a dozen crop pages (Sam, 24 Oct 2026). Old
 * /calculator?tab=planter links are sent here.
 */
export function SeedPlanterPage() {
  const [tab, setTab] = useTab('seed-planter', ['planter', 'crops'] as const)
  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-3 flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <Sprout className="h-5 w-5 text-brand-700" /> Seed &amp; planter
      </h1>

      <PillTabs
        tabs={[
          { key: 'planter', label: 'Planter settings' },
          { key: 'crops', label: 'Crop planter notes' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === 'planter' ? (
        // The same two-column grid the calculator page gave it.
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <PlanterCalculator />
        </div>
      ) : (
        <CropPlanterList />
      )}
    </div>
  )
}
