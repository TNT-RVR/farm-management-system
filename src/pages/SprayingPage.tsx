import { SprayCan } from 'lucide-react'
import { SprayCheck } from '@/components/SprayCheck'
import { PillTabs } from '@/components/PillTabs'
import { ReentryPanel } from '@/components/ReentryWarning'
import { FieldEntryAlert } from '@/components/FieldEntryAlert'
import { useTab } from '@/lib/useTab'

/**
 * Spraying: the in-season half of what used to be Chemicals. Checking a
 * product before the sprayer goes out and seeing what was sprayed lately are
 * jobs done in June; the label registry, the shed and prices are looked up
 * year round, so they stay on Chemicals (Sam, 24 Oct 2026). Old
 * /chemicals?tab=spraycheck and ?tab=reentry links are sent here.
 */
export function SprayingPage() {
  const [tab, setTab] = useTab('spraying', ['spraycheck', 'reentry'] as const, 'spraycheck')
  return (
    <div className="p-4 md:p-6">
      <div className="mb-3">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <SprayCan className="h-5 w-5 text-brand-700" /> Spraying
        </h1>
        <p className="text-xs text-gray-500">
          {tab === 'spraycheck'
            ? 'Pick a product and the fields: see which planned crops its label rules out.'
            : 'Fields sprayed lately, and when it is safe to go back in.'}
        </p>
      </div>

      <PillTabs
        tabs={[
          { key: 'spraycheck', label: 'Before spraying' },
          { key: 'reentry', label: 'Recently sprayed' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-3"
      />

      {tab === 'spraycheck' ? (
        <SprayCheck />
      ) : (
        <>
          <div className="mb-3">
            <FieldEntryAlert />
          </div>
          <ReentryPanel />
        </>
      )}
    </div>
  )
}
