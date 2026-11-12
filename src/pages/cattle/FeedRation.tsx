import { useMemo, useState } from 'react'
import { Sprout, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { useCropPlans, useCrops } from '@/lib/queries'
import { useFeedRation, useFeedRationMutations, type FeedPlan } from '@/lib/feed'
import { ranchNeed, tonnesPerUnit, type HerdRow } from '@/lib/feed-crops'
import { useRotationContext } from '@/lib/rotation-context'
import { cn } from '@/lib/utils'
import { n0 } from '@/lib/format'
import { TABLE_HEAD } from '@/lib/table-style'
import { CardList, RowCard } from '@/components/RowCards'

/**
 * The ranch's winter ration by home-grown feed, and whether the crop plan
 * grows enough of each. The shares set here are what the rotation plans the
 * feed crops' minimum acres from (Crop Plan → Rotation).
 */
export function FeedRation({
  isManager,
  ranchId,
  plan,
  herds,
  coldByMonth,
  weaningDate,
}: {
  isManager: boolean
  ranchId: string
  plan: FeedPlan
  herds: HerdRow[]
  /** The ranch's cold by month from its last five winters, as the season plan uses it. */
  coldByMonth?: Map<number, number>
  weaningDate?: string | null
}) {
  const { data: ration } = useFeedRation(ranchId)
  const { data: crops } = useCrops()
  const m = useFeedRationMutations(ranchId, plan.id)
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const ctx = useRotationContext(year)
  const { data: plans } = useCropPlans(year)

  const need = useMemo(
    () =>
      ranchNeed(
        { ranchId, plan, herds, ration: ration ?? [], coldByMonth, weaningDate },
        (crops ?? []).map((c) => ({ id: c.id, name: c.name, yield_unit: c.yield_unit, feed_dm_pct: c.feed_dm_pct, test_weight_lb_per_bu: c.test_weight_lb_per_bu })),
      ),
    [ranchId, plan, herds, ration, crops, coldByMonth, weaningDate],
  )
  const cropName = (id: string) => crops?.find((c) => c.id === id)?.name ?? '?'
  const inRation = new Set((ration ?? []).map((r) => r.crop_id))
  const addable = (crops ?? []).filter((c) => c.active && !inRation.has(c.id)).sort((a, b) => Number(b.feed_dm_pct != null) - Number(a.feed_dm_pct != null))

  // The whole operation's need from the chosen crop year, against what that year's plan grows.
  const feed = ctx.ready ? ctx.feedMinimums(year) : null
  const planned = new Map<string, number>()
  for (const p of plans ?? []) if (p.crop_id) planned.set(p.crop_id, (planned.get(p.crop_id) ?? 0) + Number(p.planned_acres ?? 0))

  // Each row's cells built once: the phone card and the table row show the same nodes.
  const rationRows = (ration ?? []).map((r) => {
    const crop = crops?.find((c) => c.id === r.crop_id)
    const n = need.byCrop.get(r.crop_id)
    return {
      id: r.id,
      name: crop?.name ?? '?',
      share: (
        <span className="whitespace-nowrap">
          <input
            key={`${r.id}-${r.dm_share_pct}`}
            type="number"
            min={0}
            max={100}
            step={5}
            disabled={!isManager}
            defaultValue={Number(r.dm_share_pct)}
            onBlur={(e) => {
              const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
              if (v !== Number(r.dm_share_pct)) m.setShare.mutate({ id: r.id, pct: v })
            }}
            className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums"
          />
          <span className="ml-1 text-xs text-gray-400">%</span>
        </span>
      ),
      dryMatter: (
        <span className="whitespace-nowrap">
          <input
            key={`${r.crop_id}-dm-${crop?.feed_dm_pct ?? ''}`}
            type="number"
            min={1}
            max={100}
            disabled={!isManager}
            defaultValue={crop?.feed_dm_pct ?? ''}
            placeholder="set"
            onBlur={(e) => {
              const v = e.target.value.trim() === '' ? null : Math.min(100, Math.max(1, Number(e.target.value)))
              if (v !== (crop?.feed_dm_pct == null ? null : Number(crop.feed_dm_pct))) m.setDryMatter.mutate({ cropId: r.crop_id, pct: v })
            }}
            className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums"
          />
          <span className="ml-1 text-xs text-gray-400">%</span>
        </span>
      ),
      dmT: n ? n0(n.dmTonnes) : '—',
      asFedT: n?.asFedTonnes != null ? n0(n.asFedTonnes) : '—',
      remove: isManager ? (
        <button type="button" onClick={() => m.remove.mutate(r.id)} className="text-gray-300 hover:text-red-600" aria-label={`Take ${crop?.name} out of the ration`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null,
    }
  })

  // The crop plan check, row by row.
  const planRows = [...(feed ?? [])].map(([cropId, fm]) => {
    const ac = planned.get(cropId) ?? 0
    const crop = crops?.find((c) => c.id === cropId)
    const perAc = fm.tonnesPerAcre ?? (crop ? tonnesPerUnit(crop.yield_unit, crop) : null)
    const grows = fm.tonnesPerAcre != null ? ac * fm.tonnesPerAcre : null
    const diff = grows != null ? grows - fm.tonnes : null
    return {
      cropId,
      name: cropName(cropId),
      perAcre: fm.tonnesPerAcre != null ? `${fm.tonnesPerAcre.toFixed(1)} t/ac expected` : null,
      ranch: `${n0(fm.byRanch.get(ranchId) ?? 0)} t`,
      all: `${n0(fm.tonnes)} t`,
      acres:
        fm.acres != null ? (
          `${n0(fm.acres)} ac`
        ) : (
          <span className="text-xs text-amber-700" title={perAc == null ? 'No unit to convert its yield' : undefined}>
            no yield on file
          </span>
        ),
      planned: `${n0(ac)} ac`,
      grows: grows != null ? `${n0(grows)} t` : '—',
      diffClass: diff == null ? 'text-gray-400' : diff < -0.5 ? 'text-red-700' : 'text-emerald-700',
      diff: diff == null ? '—' : diff < -0.5 ? `${n0(-diff)} t short` : `${n0(diff)} t spare`,
    }
  })

  // Folded by default: it plans next year's crop, not this winter's feeding.
  // An unconfirmed ration says so on the folded title.
  return (
    <Fold
      storageKey="cattle-feed-homegrown"
      title={
        <span className="flex items-center gap-1.5">
          <Sprout className="h-4 w-4 text-emerald-600" /> Ration from home-grown feed
        </span>
      }
      summary={plan.ration_confirmed ? 'sets the feed crops’ acres in Crop Plan → Rotation' : 'shares not confirmed yet'}
      bodyClassName="space-y-3"
    >
      <p className="text-xs text-gray-400">Sets the feed crops&apos; acres in Crop Plan → Rotation</p>

      {!plan.ration_confirmed && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="flex-1">
            These shares are a starting guess, not your ration. Set what each feed really makes up of the winter&apos;s dry matter, and the crop
            plan will grow enough of it.
          </span>
          {isManager && (
            <button type="button" onClick={() => m.confirm.mutate()} className="rounded border border-amber-300 bg-white px-2 py-0.5 font-medium hover:bg-amber-100">
              These are right
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <CardList>
          {rationRows.map((r) => (
            <RowCard
              key={r.id}
              heading={r.name}
              actions={r.remove}
              facts={[
                { label: 'Winter share', node: r.share },
                { label: 'Dry matter', node: r.dryMatter },
                { label: 'Dry matter (t)', node: r.dmT },
                { label: 'As fed (t)', node: r.asFedT },
              ]}
            />
          ))}
          <RowCard
            heading={<span className="font-normal text-gray-500">Bought, straw or grazed stalks</span>}
            facts={[
              { label: 'Winter share', node: `${n0(need.boughtPct)} %` },
              { label: 'Dry matter (t)', node: n0((need.dmTonnes * need.boughtPct) / 100) },
            ]}
          />
        </CardList>
        <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[600px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-2 font-medium">Feed</th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Share of the whole ranch's winter dry matter this feed supplies — plans the crop acres; does not change what any group is fed"
              >
                Winter share (% of dry matter)
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Dry matter % of the feed as fed">Dry matter</th>
              <th className="px-3 py-2 text-right font-medium" title="Dry matter: the feed with its water taken out">Dry matter (t)</th>
              <th className="px-3 py-2 text-right font-medium">As fed (t)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rationRows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="px-3 py-1.5 font-medium text-gray-900">{r.name}</td>
                <td className="px-3 py-1.5 text-right">{r.share}</td>
                <td className="px-3 py-1.5 text-right">{r.dryMatter}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.dmT}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.asFedT}</td>
                <td className="px-3 py-1.5 text-right">{r.remove}</td>
              </tr>
            ))}
            <tr className="border-b border-gray-100 text-gray-500">
              <td className="px-3 py-1.5">Bought, straw or grazed stalks</td>
              <td className={cn('px-3 py-1.5 text-right tabular-nums', need.boughtPct === 0 && 'text-gray-300')}>{n0(need.boughtPct)} %</td>
              <td />
              <td className="px-3 py-1.5 text-right tabular-nums">{n0((need.dmTonnes * need.boughtPct) / 100)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
          <span>
            {n0(need.dmTonnes)} t of dry matter over {need.days} days, waste included
            {need.boughtPct < 0.5 ? '' : ` — ${n0(100 - need.boughtPct)}% from the farm`}.
          </span>
          {isManager && addable.length > 0 && (
            <Select
              value=""
              size="sm"
              ariaLabel="Add a feed"
              className="w-44"
              onChange={(v) => v && m.add.mutate({ cropId: v, sortOrder: (ration?.length ?? 0) + 1 })}
              options={[{ value: '', label: 'Add a feed…' }, ...addable.map((c) => ({ value: c.id, label: c.name }))]}
            />
          )}
        </div>
      </div>

      {/* Against the crop plan */}
      <div className="rounded-lg border border-emerald-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 px-3 py-2">
          <p className="text-sm font-semibold text-gray-900">
            The {year}–{String(year + 1).slice(2)} winter against the {year} crop plan
          </p>
          <Select
            value={String(year)}
            size="sm"
            ariaLabel="Crop year"
            className="w-24"
            onChange={(v) => setYear(Number(v))}
            options={[0, 1, 2, 3].map((d) => ({ value: String(thisYear + d), label: String(thisYear + d) }))}
          />
        </div>
        {!feed ? (
          <p className="px-3 py-4 text-center text-xs text-gray-400">Loading the crop plan…</p>
        ) : feed.size === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-gray-400">No home-grown feed in any ranch&apos;s ration.</p>
        ) : (
          <>
          <CardList>
            {planRows.map((r) => (
              <RowCard
                key={r.cropId}
                heading={r.name}
                actions={<span className={cn('text-xs font-semibold tabular-nums', r.diffClass)}>{r.diff}</span>}
                facts={[
                  { label: 'Expected', node: r.perAcre },
                  { label: 'This ranch', node: r.ranch },
                  { label: 'All ranches', node: r.all },
                  { label: 'Acres needed', node: r.acres },
                  { label: 'Planned', node: r.planned },
                  { label: 'Grows', node: r.grows },
                ]}
              />
            ))}
          </CardList>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="px-3 py-1.5 font-medium">Feed</th>
                  <th className="px-3 py-1.5 text-right font-medium" title="This ranch's need, tonnes as fed">This ranch</th>
                  <th className="px-3 py-1.5 text-right font-medium" title="Every ranch's need, tonnes as fed">All ranches</th>
                  <th className="px-3 py-1.5 text-right font-medium">Acres needed</th>
                  <th className="px-3 py-1.5 text-right font-medium">Planned</th>
                  <th className="px-3 py-1.5 text-right font-medium">Grows (t)</th>
                  <th className="px-3 py-1.5 text-right font-medium">Short / spare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {planRows.map((r) => (
                  <tr key={r.cropId}>
                    <td className="px-3 py-1.5 font-medium text-gray-900">
                      {r.name}
                      {r.perAcre && <span className="block text-[10px] font-normal text-gray-400">{r.perAcre}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.ranch}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.all}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.acres}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.planned}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.grows}</td>
                    <td className={cn('px-3 py-1.5 text-right font-semibold tabular-nums', r.diffClass)}>{r.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <HelpNote
          className="border-t border-gray-100 px-3 py-1.5"
          summary={`The ${year} crop feeds the winter that starts in December ${year}.`}
          title="How the crop plan is checked"
        >
          <p>
            The {year} crop feeds the winter that starts in December {year}. Yields are the farm&apos;s own (the rotation&apos;s margin yield); head counts as they stand
            today. The rotation places at least the acres needed before anything else, as it does for a contract.
          </p>
        </HelpNote>
      </div>
    </Fold>
  )
}
