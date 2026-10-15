import { Flower2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { useTab } from '@/lib/useTab'
import { HistoryTab } from '@/pages/canola/HistoryTab'
import { IsolationTab } from '@/pages/canola/IsolationTab'

const TABS = ['isolation', 'history'] as const
type Tab = (typeof TABS)[number]

/**
 * Canola reports (Sam, 8 Oct 2026): what the seed canola companies ask for.
 * Isolation — the mile around a seed canola field, quarter by quarter, with
 * what is planted on each now and the four years before. Field history — the
 * crops on the fields picked, for the company to judge them for canola.
 */
export function CanolaReportsPage() {
  const [tab, setTab] = useTab<Tab>('canola', TABS, 'isolation')
  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
      <PageHeader title="Canola reports" icon={<Flower2 className="h-5 w-5 text-brand-700" />} subtitle="Isolation and field history for the seed canola companies" />
      <PillTabs
        tabs={[
          { key: 'isolation', label: 'Isolation' },
          { key: 'history', label: 'Field history' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'isolation' ? <IsolationTab /> : <HistoryTab />}
    </div>
  )
}
