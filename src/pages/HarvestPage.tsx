import { useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Calculator, Thermometer } from 'lucide-react'
import { useTab } from '@/lib/useTab'
import { GrainBin } from '@/components/icons/GrainBin'
import { PillTabs } from '@/components/PillTabs'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'
import { BinAirAlerts } from '@/components/BinAirAlerts'
import { PhiPanel } from '@/components/PhiPanel'
import { MoistureGuide } from '@/pages/harvest/MoistureGuide'
import { MoistureRanges } from '@/pages/harvest/MoistureRanges'
import { MoistureTester } from '@/pages/harvest/MoistureTester'
import { HarvestReadiness } from '@/pages/harvest/HarvestReadiness'
import { BinsPage } from '@/pages/BinsPage'
import { useCropYear } from '@/lib/crop-year'

const TABS = [
  { key: 'bins', label: 'Bins' },
  { key: 'estimator', label: 'Bin estimator' },
  { key: 'map', label: 'Bin map' },
  { key: 'moisture', label: 'Moisture' },
] as const
type Tab = (typeof TABS)[number]['key']
const STORAGE_TABS = new Set<Tab>(['bins', 'estimator', 'map'])

/**
 * Harvest: what came off, where it went, and how wet it was.
 *
 * One view since 25 Sep 2026. Storage (the bins, what is in them, the
 * estimator and the bin map) was its own section beside this one, and at
 * harvest the two are the same job: a load is weighed into a bin, and the
 * moisture of what went in is what says whether that bin needs air.
 *
 * The bin-needs-air alerts sit above every tab rather than inside one,
 * because they are the thing that must not be missed and the tab somebody is
 * on is not up to them.
 *
 * Moisture was three tabs — the tester, the safe ranges and how to test —
 * and is one now: the tester, the procedure behind ⓘ, the ranges folded
 * underneath. The Calculator tab was the bushel converter, which lives on the
 * Calculator view; an old ?tab=calculator link goes there.
 */
export function HarvestPage() {
  const { search } = useLocation()
  if (new URLSearchParams(search).get('tab') === 'calculator') {
    return <Navigate to="/calculator?tab=bushels" replace />
  }
  return <HarvestView />
}

function HarvestView() {
  const { cropYear } = useCropYear()
  // What the address asked for on arrival, before the tab hook rewrites it:
  // an old "Safe ranges" or "How to test" link opens that part of Moisture.
  const [params] = useSearchParams()
  const [arrivedFor] = useState(() => params.get('tab'))
  // Kept in the address and remembered, so a tile, a link, the back button
  // and a refresh all land on the tab they meant. 'movements' was a Storage
  // tab once; saved links to it land on the bins. 'crops' and 'guide' were
  // Moisture's ranges and procedure.
  const [tab, choose] = useTab<Tab>('harvest', TABS.map((t) => t.key), 'bins', (asked) =>
    asked === 'movements' ? 'bins' : asked === 'crops' || asked === 'guide' ? 'moisture' : undefined,
  )

  return (
    <div className={STORAGE_TABS.has(tab) ? 'pt-4 md:pt-6' : 'p-4 md:p-6'}>
      <div className={STORAGE_TABS.has(tab) ? 'px-4 md:px-6' : ''}>
        <h1 className="mb-3 flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <GrainBin className="h-5 w-5 text-brand-700" /> Harvest {cropYear}
        </h1>

        {/* On a phone the bin map gets the screen: the alerts and the spray
            check are one tab away and would push the map below the fold. */}
        <div className={tab === 'map' ? 'hidden md:block' : undefined}>
          <BinAirAlerts />
          <PhiPanel cropYear={cropYear} />
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-3">
          <PillTabs tabs={TABS} value={tab} onChange={choose} />
          {/* Bushels and weight, the sum done at the scale. */}
          <Link
            to="/calculator?tab=bushels"
            className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700"
          >
            <Calculator className="h-3.5 w-3.5" /> Bushel calculator
          </Link>
        </div>
      </div>

      {/* The bins keep their own page padding, so they sit where they always did. */}
      {tab === 'bins' && <BinsPage tab="bins" />}
      {tab === 'estimator' && <BinsPage tab="estimator" />}
      {tab === 'map' && <BinsPage tab="map" />}
      {tab === 'moisture' && <MoistureView arrivedFor={arrivedFor} cropYear={cropYear} />}
    </div>
  )
}

/**
 * The tester, how to use it, and what is safe to bin.
 *
 * The procedure is behind ⓘ because whoever is at the meter has usually done
 * it before; an old "How to test" link opens it full width above the tester
 * instead, since that is what the link was for.
 */
function MoistureView({ arrivedFor, cropYear }: { arrivedFor: string | null; cropYear: number }) {
  const guideFirst = arrivedFor === 'guide'
  const rangesOpen = arrivedFor === 'crops'
  // The reading form is a pop-up from here (Sam, 7 Oct 2026).
  const [reading, setReading] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setReading(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <Thermometer className="h-4 w-4" /> Take a reading
        </button>
      </div>
      {guideFirst && (
        <Fold title="How to test — Dimo’s Model 919" defaultOpen>
          <MoistureGuide />
        </Fold>
      )}
      {/* When each field will be dry: first on the tab, so it is found without looking. */}
      <HarvestReadiness cropYear={cropYear} />
      <MoistureTester
        formOpen={reading}
        onCloseForm={() => setReading(false)}
        aside={
          !guideFirst && (
            <InfoPopover title="Taking a moisture reading — Dimo’s Model 919" label="How to test" width={480}>
              <MoistureGuide compact />
            </InfoPopover>
          )
        }
      />
      {/* Opened by an old "Safe ranges" link; otherwise remembered per device. */}
      <Fold
        key={rangesOpen ? 'asked' : 'kept'}
        title="Safe moisture to harvest at"
        summary="by crop"
        defaultOpen={rangesOpen}
        storageKey={rangesOpen ? undefined : 'harvest-moisture-ranges'}
      >
        <MoistureRanges />
      </Fold>
    </div>
  )
}

/**
 * /bins was Storage. Its tabs are Harvest's tabs now, under the same names,
 * so the address keeps everything it asked for (?tab=, and ?weigh=1 from the
 * home-screen tile) and only the path changes.
 */
export function BinsRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (!params.get('tab') || params.get('tab') === 'movements') params.set('tab', 'bins')
  return <Navigate to={`/harvest?${params.toString()}`} replace />
}
