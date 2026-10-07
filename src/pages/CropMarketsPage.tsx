import { PillTabs } from '@/components/PillTabs'
import { MarketsTab } from '@/pages/plan/MarketsTab'
import { BasisTab } from '@/pages/marketing/BasisTab'
import { TargetsTab } from '@/pages/marketing/TargetsTab'
import { useCropYear } from '@/lib/crop-year'
import { useTab } from '@/lib/useTab'

const TABS = [
  { key: 'prices', label: 'Prices' },
  { key: 'basis', label: 'Basis' },
  { key: 'targets', label: 'Targets' },
] as const
type Tab = (typeof TABS)[number]['key']

/**
 * Crop and cattle prices, on their own.
 *
 * Another tab that had nothing to do with the ones beside it: a price chart is
 * not part of planning this year's budget, it is what you check before selling.
 *
 * Basis and targets joined it later, for the same reason. Both are about what a
 * price is worth rather than about the crop that produced it, and both were
 * briefly a separate Marketing view before landing where they belong.
 *
 * The tab is in the address so the Prices tab's basis line can link to Basis.
 */
export function CropMarketsPage() {
  const [tab, setTab] = useTab<Tab>('markets', TABS.map((t) => t.key), 'prices')
  const { cropYear } = useCropYear()

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-3 text-lg font-semibold text-gray-900">Markets</h1>
      <PillTabs tabs={TABS} value={tab} onChange={setTab} className="mb-3" />
      {tab === 'prices' && <MarketsTab />}
      {tab === 'basis' && <BasisTab />}
      {tab === 'targets' && <TargetsTab year={cropYear} />}
    </div>
  )
}
