import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useCrops } from '@/lib/queries'
import { isBookkeepingCrop } from '@/lib/crop-label'
import { depthText, populationText, usePlanterProfiles, type PlanterProfile } from '@/lib/planter-profiles'
import { hasPlanterOverrides } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import { TABLE_HEAD } from '@/lib/table-style'
import { CardList, RowCard } from '@/components/RowCards'

const joined = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || '—'

/** One crop's settings as text, shared by the table's cells and the phone card. */
function settingsText(p: PlanterProfile) {
  return {
    depth: joined([p.depth_setting && `Stop ${p.depth_setting}`, depthText(p)]),
    seeds: populationText(p) ?? (p.seeds_per_m2 ? `${p.seeds_per_m2}/m²` : '—'),
    disc: joined([p.plate_holes != null && `${p.plate_holes} holes`, p.disc_number]),
    singulator: p.singulator ?? '—',
    speed: p.planting_speed_mph ? `${p.planting_speed_mph} mph` : '—',
  }
}

/**
 * Every active crop's planter settings in one table: the depth stop, the disc
 * and the population, which are what get checked at the planter. It is the
 * same record the crop page's "Planter settings" fold edits and the calculator
 * fills itself from, so editing stays on the crop page and each row links
 * there. Crops with nothing recorded are named underneath, so a gap shows
 * before seeding rather than at the planter (Sam, 24 Oct 2026).
 */
export function CropPlanterList() {
  const { data: crops, isLoading } = useCrops()
  const { data: profiles } = usePlanterProfiles()
  const { data: varieties } = useCropVarietySettings()

  const { rows, missing } = useMemo(() => {
    const byCrop = new Map((profiles ?? []).map((p) => [p.crop_id, p]))
    const active = (crops ?? []).filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name))
    const rows: { id: string; name: string; p: PlanterProfile; varieties: number }[] = []
    for (const c of active) {
      const p = byCrop.get(c.id)
      if (!p) continue
      rows.push({
        id: c.id,
        name: c.name,
        p,
        // Varieties sown differently from the crop's own settings: the calculator
        // switches to them when a field's plan names the variety.
        varieties: (varieties ?? []).filter((v) => v.crop_id === c.id && hasPlanterOverrides(v)).length,
      })
    }
    // Summer Fallow, Not farmed by us and the placeholder crops are never sown,
    // so a planter setting for them is not a gap.
    return { rows, missing: active.filter((c) => !byCrop.has(c.id) && !isBookkeepingCrop(c.name)) }
  }, [crops, profiles, varieties])

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No crop has planter settings yet. Add them on the crop&apos;s page.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {/* One crop a card on a phone (design review, Nov 2026). */}
          <CardList>
            {rows.map(({ id, name, p, varieties: n }) => {
              const t = settingsText(p)
              return (
                <RowCard
                  key={id}
                  heading={
                    <>
                      <Link to={`/crops/${id}`} className="text-brand-700 hover:underline">
                        {name}
                      </Link>
                      {n > 0 && (
                        <span className="block text-xs font-normal text-gray-500">
                          {n} {n === 1 ? 'variety' : 'varieties'} set differently
                        </span>
                      )}
                    </>
                  }
                  facts={[
                    { label: 'Depth', node: t.depth },
                    { label: 'Seeds/ac', node: t.seeds },
                    { label: 'Disc', node: t.disc },
                    { label: 'Singulators', node: t.singulator },
                    { label: 'Speed', node: t.speed },
                    { label: 'Notes', node: p.notes ?? '' },
                  ]}
                />
              )
            })}
          </CardList>
          <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[620px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-3 py-2 font-medium">Crop</th>
                <th className="px-3 py-2 font-medium">Depth</th>
                <th className="px-3 py-2 font-medium">Seeds/ac</th>
                <th className="px-3 py-2 font-medium">Disc</th>
                <th className="px-3 py-2 font-medium">Singulators</th>
                <th className="px-3 py-2 font-medium">Speed</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ id, name, p, varieties: n }) => {
                const t = settingsText(p)
                return (
                <tr key={id} className="align-top">
                  <td className="px-3 py-2">
                    <Link to={`/crops/${id}`} className="font-medium text-brand-700 hover:underline">
                      {name}
                    </Link>
                    {n > 0 && (
                      <span className="block text-xs text-gray-500">
                        {n} {n === 1 ? 'variety' : 'varieties'} set differently
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{t.depth}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{t.seeds}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{t.disc}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{t.singulator}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{t.speed}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.notes ?? ''}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-gray-500">
          Nothing recorded for{' '}
          {missing.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link to={`/crops/${c.id}`} className="text-brand-700 hover:underline">
                {c.name}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  )
}
