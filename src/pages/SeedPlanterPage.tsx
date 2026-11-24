import { PillTabs } from '@/components/PillTabs'
import { ProductPrices } from '@/components/ProductPrices'
import { PlanterCalculator } from '@/pages/calculator/PlanterCalculator'
import { CropPlanterList } from '@/pages/planter/CropPlanterList'
import { useTab } from '@/lib/useTab'
import { Page } from '@/components/Page'

/**
 * Seed & planter: the planter calculator, which was a Calculator tab, and
 * every crop's planter settings in one list, which were only on each crop's
 * page. Both are wanted at seeding, so they share a view rather than sitting
 * under unit conversions and a dozen crop pages (Sam, 24 Oct 2026). Old
 * /calculator?tab=planter links are sent here.
 *
 * Seed prices joined them on 11 Nov 2026. They are the same price book the
 * Chemicals and Fertilizer pages show, filtered to seed, and they belong here
 * rather than on a page of their own: the planter's own seed counts are what
 * they price, and a price typed here is what puts seed on the Profit/Loss.
 */
export function SeedPlanterPage() {
  const [tab, setTab] = useTab('seed-planter', ['planter', 'crops', 'prices'] as const)
  return (
    <Page
      title="Seed & planter"
      tabs={
      <PillTabs
        tabs={[
          { key: 'planter', label: 'Planter settings' },
          { key: 'crops', label: 'Crop planter notes' },
          { key: 'prices', label: 'Seed prices' },
        ]}
        value={tab}
        onChange={setTab}
      />
      }
    >
      {tab === 'planter' ? (
        // The same two-column grid the calculator page gave it.
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <PlanterCalculator />
        </div>
      ) : tab === 'crops' ? (
        <CropPlanterList />
      ) : (
        <ProductPrices category="seed" />
      )}
    </Page>
  )
}
