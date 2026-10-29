import { lazy } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Flower2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { useTab } from '@/lib/useTab'
import { TabSuspense } from '@/components/TabSuspense'

// Isolation is a map; each tab is its own chunk.
const HistoryTab = lazy(() => import('@/pages/canola/HistoryTab').then((m) => ({ default: m.HistoryTab })))
const IsolationTab = lazy(() => import('@/pages/canola/IsolationTab').then((m) => ({ default: m.IsolationTab })))

const TABS = ['isolation', 'history'] as const
type Tab = (typeof TABS)[number]

/**
 * The seed company's forms were tabs here until 24 Oct 2026, when they moved
 * to Harvest reports (Sam): 'seed-forms' was the one tab of 19 Oct, split
 * into 'seed-report' and 'bin-temps' on 20 Oct. Reminders and saved links
 * still carry these, with their ?field= and ?year=.
 */
const FORM_TABS = new Set(['seed-report', 'bin-temps', 'seed-forms'])

/**
 * Canola reports (Sam, 8 Oct 2026): what the seed canola companies ask for
 * before the crop goes in. "Canola isolation" in the season menu.
 * Isolation — the mile around a seed canola field, quarter by quarter, with
 * what is planted on each now and the four years before. Field history — the
 * crops on the fields picked, for the company to judge them for canola.
 */
export function CanolaReportsPage() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (FORM_TABS.has(params.get('tab') ?? '')) return <Navigate to={`/harvest-reports?${params.toString()}`} replace />
  return <CanolaReportsView />
}

function CanolaReportsView() {
  const [tab, setTab] = useTab<Tab>('canola', TABS, 'isolation')
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
      <PageHeader title="Isolation" icon={<Flower2 className="h-5 w-5 text-brand-700" />} subtitle="The mile around each seed field, and its field history, for the seed companies" />
      <PillTabs
        tabs={[
          { key: 'isolation', label: 'Isolation' },
          { key: 'history', label: 'Field history' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabSuspense>{tab === 'isolation' ? <IsolationTab /> : <HistoryTab />}</TabSuspense>
    </div>
  )
}
