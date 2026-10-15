import { ExternalLink, Map, Calculator } from 'lucide-react'
import { BrandSettings } from '@/pages/cattle/BrandSettings'
import { CostSettings } from '@/pages/cattle/CostSettings'
import { PastureMapSync } from '@/pages/cattle/PastureMapSync'
import { MoveAlertSettings } from '@/pages/cattle/MoveAlertSettings'
import { CalfSaleSettings } from '@/pages/cattle/CalfSaleSettings'
import { CattleSuppliers } from '@/pages/cattle/CattleSuppliers'
import { useRanches } from '@/lib/ranches'
import { ManageRanches } from '@/pages/cattle/ManageRanches'
import {
  CARRYING_CAPACITY_CALC_URL,
  FORAGE_YIELD_ESTIMATOR,
  FORAGE_YIELD_IRRIGATION,
  GRASS_QUALITIES,
  GRAZEABLE_AREAS_MAP_URL,
  PASTURE_RATING_GUIDE,
} from '@/lib/grazing'

export function GrazingSettings({
  ranches,
  isManager,
}: {
  ranches: { id: string; name: string }[]
  isManager: boolean
}) {
  // The move-out alert thresholds need the whole ranch row, not just its name.
  const { data: fullRanches } = useRanches()
  return (
    <div className="space-y-6">
      {/* The first ranch is asked for on an empty Cattle page; this is where a
          farm adds its second, renames or deletes one (Sam, 7 Oct 2026), so
          it sits above the per-ranch settings it adds to. */}
      <ManageRanches isManager={isManager} />

      <CostSettings ranches={ranches} isManager={isManager} />

      {(fullRanches ?? []).map((r) => (
        <CalfSaleSettings key={`sale-${r.id}`} ranch={r} isManager={isManager} />
      ))}

      {(fullRanches ?? []).map((r) => (
        <MoveAlertSettings key={r.id} ranch={r} isManager={isManager} />
      ))}

      <CattleSuppliers ranches={ranches} isManager={isManager} />

      <BrandSettings isManager={isManager} />

      <PastureMapSync isManager={isManager} />

      {/* Links */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Reference links</h2>
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
              <p className="text-xs text-gray-500">
                Google My Maps — pasture boundaries &amp; grazeable areas
              </p>
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
              <p className="text-xs text-gray-500">
                BCRC — Method 1, the basis for these calculations
              </p>
            </div>
          </a>
        </div>
      </section>

      {/* Pasture Rating guide */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Pasture Rating guide</h2>
        <p className="mb-2 text-xs text-gray-500">
          How to judge a pasture's grass quality (the Quality column on the calculator).
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
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
      </section>

      {/* Forage Yield Estimator */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Forage Yield Estimator</h2>
        <p className="mb-2 text-xs text-gray-500">
          Expected forage (lbs/acre) by growing-season precipitation and grass quality. The
          calculator picks the row matching the precip you set, then the column matching each
          pasture's quality.
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
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
            lbs/acre. The Irrigation row is reference only — grazeable irrigated acres use the
            precip-based supply in the calculator.
          </p>
        </div>
      </section>
    </div>
  )
}
