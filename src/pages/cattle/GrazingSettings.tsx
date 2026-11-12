import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ExternalLink, Map, Calculator } from 'lucide-react'
import { BrandSettings } from '@/pages/cattle/BrandSettings'
import { CostSettings } from '@/pages/cattle/CostSettings'
import { PastureMapSync } from '@/pages/cattle/PastureMapSync'
import { MoveAlertSettings } from '@/pages/cattle/MoveAlertSettings'
import { CalfSaleSettings, FarmCalfSaleDefault } from '@/pages/cattle/CalfSaleSettings'
import { CattleSuppliers } from '@/pages/cattle/CattleSuppliers'
import { useRanches, type Ranch } from '@/lib/ranches'
import { ManageRanches } from '@/pages/cattle/ManageRanches'
import { HerdDefaults } from '@/pages/cattle/HerdDefaults'
import {
  CARRYING_CAPACITY_CALC_URL,
  FORAGE_YIELD_ESTIMATOR,
  FORAGE_YIELD_IRRIGATION,
  GRASS_QUALITIES,
  GRAZEABLE_AREAS_MAP_URL,
  PASTURE_RATING_GUIDE,
} from '@/lib/grazing'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { AssumptionNote } from '@/components/AssumptionNote'
import { CardList, RowCard } from '@/components/RowCards'
import { TABLE_HEAD } from '@/lib/table-style'
import { PillTabs } from '@/components/PillTabs'
import { useTab } from '@/lib/useTab'

const CATTLE_SETTINGS_TABS = [
  { key: 'ranches', label: 'Ranches' },
  { key: 'costs', label: 'Costs' },
  { key: 'calf-sale', label: 'Calf sale' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'brands', label: 'Brands' },
  { key: 'map', label: 'Pasture map' },
] as const
type SettingsTab = (typeof CATTLE_SETTINGS_TABS)[number]['key']
const TAB_KEYS = CATTLE_SETTINGS_TABS.map((t) => t.key)

/** Old section anchors (`#costs`, `#ranch`, `#map-sync`…) to the tab that holds them now. */
function oldSection(asked: string): SettingsTab | undefined {
  if (asked === 'ranch') return 'ranches'
  if (asked === 'suppliers') return 'costs'
  if (asked === 'map-sync' || asked === 'reference' || asked === 'more') return 'map'
  if (asked.startsWith('calf-sale')) return 'calf-sale'
  return (TAB_KEYS as readonly string[]).includes(asked) ? (asked as SettingsTab) : undefined
}

/** One column per ranch, side by side; each column sizes its own inner grid. */
function RanchColumns({ ranches, children }: { ranches: Ranch[]; children: (r: Ranch) => React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {ranches.map((r) => (
        <div key={r.id} className="@container min-w-0">
          {children(r)}
        </div>
      ))}
    </div>
  )
}

/**
 * Cattle settings in tabs, with the ranches side by side on each (Sam,
 * 3 Nov 2026). It was one long scroll under a ranch picker and a row of
 * anchor links, which matched nothing else in the app.
 */
export function GrazingSettings({
  ranches,
  isManager,
}: {
  ranches: { id: string; name: string }[]
  isManager: boolean
}) {
  // The calf-sale and alert cards need the whole ranch row, not just its name.
  const { data: fullRanches } = useRanches()
  const all = fullRanches ?? []
  const [tab, setTab] = useTab<SettingsTab>('cattle-settings', TAB_KEYS, oldSection)
  // Links saved before the tabs named a section by its anchor.
  const { hash, search } = useLocation()
  useEffect(() => {
    if (!hash || new URLSearchParams(search).has('tab')) return
    const moved = oldSection(decodeURIComponent(hash.slice(1)))
    if (moved) setTab(moved)
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="border-b border-gray-200 bg-white px-4 py-3 md:px-6 print:hidden">
        <PillTabs tabs={CATTLE_SETTINGS_TABS} value={tab} onChange={setTab} />
      </div>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        {tab === 'ranches' && (
          <>
            {/* Moved off the pasture map (Sam, 10 Nov 2026): it is a list of
                settings to go and fill in, and every line links to the box
                that fills it, so it belongs where the settings are. Open,
                because here it is the point of the page rather than a
                footnote under a map. */}
            <AssumptionNote ranchId="" open />
            {/* The first ranch is asked for on an empty Cattle page; this is where
                a farm adds its second, renames or deletes one (Sam, 7 Oct 2026). */}
            <ManageRanches isManager={isManager} />
            <HerdDefaults />
          </>
        )}

        {tab === 'costs' && (
          <>
            <RanchColumns ranches={all}>{(r) => <CostSettings ranches={ranches} ranchId={r.id} isManager={isManager} />}</RanchColumns>
            <CattleSuppliers ranches={ranches} isManager={isManager} />
          </>
        )}

        {tab === 'calf-sale' && (
          <>
            <FarmCalfSaleDefault />
            <RanchColumns ranches={all}>{(r) => <CalfSaleSettings ranch={r} isManager={isManager} />}</RanchColumns>
          </>
        )}

        {tab === 'alerts' && <RanchColumns ranches={all}>{(r) => <MoveAlertSettings ranch={r} isManager={isManager} />}</RanchColumns>}

        {tab === 'brands' && <BrandSettings isManager={isManager} />}

        {tab === 'map' && (
          <>
            <PastureMapSync isManager={isManager} />
            <Fold title="Reference: pasture rating and forage yield" storageKey="cattle-settings-reference">
              <ReferenceTables />
            </Fold>
          </>
        )}
      </div>
    </div>
  )
}

/** The grazing calculator's lookup tables and where they came from. */
function ReferenceTables() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={GRAZEABLE_AREAS_MAP_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/40"
        >
          <Map className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-medium text-gray-900">
              Grazeable Areas map <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
            </p>
            <p className="text-xs text-gray-500">Google My Maps — pasture boundaries &amp; grazeable areas</p>
          </div>
        </a>
        <a
          href={CARRYING_CAPACITY_CALC_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:border-brand-300 hover:bg-brand-50/40"
        >
          <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-sm font-medium text-gray-900">
              Carrying Capacity Calculator <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
            </p>
            <p className="text-xs text-gray-500">BCRC — Method 1, the basis for these calculations</p>
          </div>
        </a>
      </div>

      {/* Pasture Rating guide */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Pasture Rating guide</h3>
        <p className="mb-2 text-xs text-gray-500">
          How to judge a pasture&apos;s grass quality (the Quality column on the calculator).
        </p>
        <CardList className="rounded-lg border border-gray-200 bg-white">
          {PASTURE_RATING_GUIDE.map((row) => (
            <RowCard
              key={row.category}
              heading={row.category}
              facts={GRASS_QUALITIES.map((q) => ({ label: q, node: row.values[q] }))}
            />
          ))}
        </CardList>
        <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-3 py-2 font-medium">Category</th>
                {GRASS_QUALITIES.map((q) => (
                  <th key={q} className="px-3 py-2 font-medium">
                    {q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PASTURE_RATING_GUIDE.map((row) => (
                <tr key={row.category} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-gray-700">{row.category}</td>
                  {GRASS_QUALITIES.map((q) => (
                    <td key={q} className="px-3 py-2 text-gray-600">
                      {row.values[q]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Forage Yield Estimator */}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Forage Yield Estimator</h3>
        <HelpNote className="mb-2 text-xs" summary="Expected forage (lbs/acre) by precipitation and grass quality.">
          Expected forage (lbs/acre) by growing-season precipitation and grass quality. The calculator picks
          the row matching the precip you set, then the column matching each pasture&apos;s quality.
        </HelpNote>
        <CardList className="rounded-lg border border-gray-200 bg-white">
          {FORAGE_YIELD_ESTIMATOR.map((band) => (
            <RowCard
              key={band.label}
              heading={band.label}
              facts={GRASS_QUALITIES.map((q) => ({ label: q, node: `${band.yields[q].toLocaleString('en-CA')} lb/ac` }))}
            />
          ))}
          <RowCard
            heading="Irrigation (reference only)"
            facts={GRASS_QUALITIES.map((q) => ({
              label: q,
              node: `${FORAGE_YIELD_IRRIGATION[q].toLocaleString('en-CA')} lb/ac`,
            }))}
          />
        </CardList>
        <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white sm:block">
          <table className="w-full min-w-[560px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-3 py-2 font-medium">Precipitation</th>
                {GRASS_QUALITIES.map((q) => (
                  <th key={q} className="px-3 py-2 text-right font-medium">
                    {q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FORAGE_YIELD_ESTIMATOR.map((band) => (
                <tr key={band.label} className="border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-700">{band.label}</td>
                  {GRASS_QUALITIES.map((q) => (
                    <td key={q} className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {band.yields[q].toLocaleString('en-CA')}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-700">Irrigation</td>
                {GRASS_QUALITIES.map((q) => (
                  <td key={q} className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {FORAGE_YIELD_IRRIGATION[q].toLocaleString('en-CA')}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
            lbs/acre. The Irrigation row is reference only — grazeable irrigated acres use the precip-based
            supply in the calculator.
          </p>
        </div>
      </div>
    </div>
  )
}
