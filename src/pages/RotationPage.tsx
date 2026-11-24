import { lazy } from 'react'
import { PillTabs } from '@/components/PillTabs'
import { TabSuspense } from '@/components/TabSuspense'
import { useTab } from '@/lib/useTab'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { RotationPlanner } from '@/pages/plan/RotationPlanner'
import { usePartnerView } from '@/lib/partner-view'
import { isPartnerTab } from '@/lib/partner'
import { Page } from '@/components/Page'

// The rules are read once a winter and the recommendations are run a handful
// of times; neither needs to be in the plan's chunk.
const RotationRulesTab = lazy(() => import('@/pages/plan/RotationRules').then((m) => ({ default: m.RotationRulesTab })))

const TABS = ['plan', 'advice', 'rules'] as const
type Tab = (typeof TABS)[number]

/**
 * The crop rotation plan.
 *
 * It was a tab beside Plan and Budget, which put "what follows what over four
 * years" next to "what does this year cost" — two questions asked months apart
 * by different people. It has had its own address since.
 *
 * Three tabs since 28 Oct 2026 (Sam). The rules and the recommendations were
 * drawers that opened above the grid and pushed it down the page: the grid is
 * what people come for, and the other two are read a few times a winter. No
 * year in the heading — the plan covers four of them and starts at the first
 * one still to be planted, which the plan itself says.
 */
export function RotationPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const partner = usePartnerView()
  const [tab, setTab] = useTab<Tab>('rotation', partner ? TABS.filter((t) => isPartnerTab('/rotation', t)) : TABS)
  return (
    <Page
      title="Crop rotation plan"
      className="space-y-3"
      info="Which crops could go on each field for the next four years."
      tabs={
        <PillTabs
          tabs={[
            { key: 'plan', label: 'Plan' },
            ...(partner ? [] : [{ key: 'advice' as const, label: 'Recommendations' }]),
            { key: 'rules', label: 'Rules' },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      <TabSuspense>
        {tab === 'rules' ? <RotationRulesTab isManager={isManager} /> : <RotationPlanner isManager={isManager} view={tab} />}
      </TabSuspense>
    </Page>
  )
}
