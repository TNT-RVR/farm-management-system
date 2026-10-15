import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { CLASS_LABEL, FEEDING_METHODS, defaultWaste, type FeedClass, type FeedValue, type GroupRation } from '@/lib/cattle-nutrition'
import { useRationMutations, useUpdateGroup, type GroupRationRow, type HerdCountRow } from '@/lib/winter-feeding'
import { cn } from '@/lib/utils'
import { FeedInfo } from './FeedInfo'
import { FromHerdChip, Num, WarningList, n0, n1, yardAmount } from './bits'

const GROWING: FeedClass[] = ['backgrounder', 'heifer_calf']

/**
 * One group: who they are (class, weight, condition), what they are fed (the
 * ration), and what that means today — pounds and bales for the whole group,
 * and whether it meets their need.
 */
export function GroupCard({
  group,
  ration,
  values,
  notUsed,
  result,
  isManager,
  included,
  onToggle,
  weaningDate = null,
}: {
  group: HerdCountRow
  ration: GroupRationRow[]
  values: Map<string, FeedValue>
  /** Feeds this ranch doesn't normally use: left out of "Add a feed". */
  notUsed: Set<string>
  result: GroupRation | null
  isManager: boolean
  included: boolean
  onToggle: () => void
  /** The ranch's weaning day, for the calves group. */
  weaningDate?: string | null
}) {
  const [open, setOpen] = useState(false)
  const upd = useUpdateGroup()
  const rm = useRationMutations()
  const patch = (p: Parameters<typeof upd.mutate>[0]['patch']) => upd.mutate({ id: group.id, patch: p })
  const growing = GROWING.includes(group.feed_class)
  const inRation = new Set(ration.map((r) => r.feed_type_id))
  const [showAll, setShowAll] = useState(false)
  const addable = [...values.values()].filter((v) => !inRation.has(v.id) && (showAll || !notUsed.has(v.id)))
  const shareTotal = ration.reduce((s, r) => s + Number(r.dm_share_pct), 0)
  const red = result?.warnings.some((w) => w.level === 'red')
  const amber = result?.warnings.some((w) => w.level === 'amber')

  return (
    <div className={cn('rounded-lg border bg-white', !included ? 'border-gray-200 opacity-60' : red ? 'border-red-300' : amber ? 'border-amber-300' : 'border-gray-200')}>
      {/* Header: the answer first */}
      <div className="flex flex-wrap items-start gap-3 p-3">
        <input type="checkbox" checked={included} disabled={!isManager} onChange={onToggle} className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-700" aria-label={`Feed ${group.class_name} this winter`} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-1 text-sm font-semibold text-gray-900">
            {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            {group.class_name}
            <span className="font-normal text-gray-500">· {group.background_head ?? group.head_count} head · {n0(Number(group.avg_weight_lb))} lb · {result?.need.stage ?? CLASS_LABEL[group.feed_class]}</span>
          </p>
          {group.background_head != null && (
            <p className="mt-0.5 text-[11px] text-gray-500">
              {group.head_count} at side now{weaningDate ? `, fed through the cows until weaning on ${new Date(weaningDate + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}; {group.background_head} kept to background are fed from then. Set both on the Herd tab.
            </p>
          )}
          {included && result && result.lines.length > 0 && (
            <p className="mt-1 text-xs text-gray-600">
              Today:{' '}
              {result.lines.map((l, i) => (
                <span key={l.feed.id}>
                  {i > 0 && ' · '}
                  <b>{yardAmount(l.groupOfferedLb, l.feed.unit, l.feed.lbPerBale)}</b> {l.feed.name.toLowerCase()}
                </span>
              ))}
              {result.addGrainLb > 0.05 && (
                <span className="text-amber-800">
                  {' '}
                  · <b>+{n0(result.addGrainLb * (group.background_head ?? group.head_count))} lb grain</b>
                </span>
              )}
            </p>
          )}
        </button>
        {included && result && result.lines.length > 0 && (
          <div className="text-right text-xs">
            <p className={cn('text-lg font-bold tabular-nums', result.energyMetPct < 90 ? 'text-red-700' : 'text-gray-900')}>{n1(result.dmLb)} <span className="text-xs font-normal text-gray-500">lb DM/hd</span></p>
            <p className="text-gray-500">
              energy {n0(result.energyMetPct)}% · protein {n0(result.proteinMetPct)}%
            </p>
          </div>
        )}
      </div>

      {included && result && result.warnings.length > 0 && (
        <div className="px-3 pb-3">
          <WarningList warnings={result.warnings} />
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-gray-100 p-3">
          {/* Who they are */}
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-sm text-gray-700">
            <label className="text-xs text-gray-500">
              Class
              <Select
                value={group.feed_class}
                size="sm"
                disabled={!isManager}
                ariaLabel="Class"
                className="mt-0.5 w-52"
                onChange={(v) => patch({ feed_class: v as FeedClass, target_gain_lb: GROWING.includes(v as FeedClass) ? (group.target_gain_lb ?? 1.5) : group.target_gain_lb })}
                options={(Object.keys(CLASS_LABEL) as FeedClass[]).map((k) => ({ value: k, label: CLASS_LABEL[k] }))}
              />
            </label>
            <label className="text-xs text-gray-500">
              <span className="flex items-center gap-1">Typical weight <FeedInfo k="weight" /></span>
              <Num value={Number(group.avg_weight_lb)} step="25" min={100} max={3000} suffix="lb" disabled={!isManager} onCommit={(v) => v != null && patch({ avg_weight_lb: v })} className="w-20" />
            </label>
            <label className="text-xs text-gray-500">
              <span className="flex items-center gap-1">Condition now <FeedInfo k="bcs" label="how to score" /></span>
              <Num value={Number(group.bcs)} step="0.25" min={1} max={5} suffix="/ 5" disabled={!isManager} onCommit={(v) => v != null && patch({ bcs: v })} />
            </label>
            <label className="text-xs text-gray-500">
              <span className="flex items-center gap-1">Target <FeedInfo k="targetBcs" /></span>
              <Num value={Number(group.target_bcs)} step="0.25" min={1} max={5} suffix="/ 5" disabled={!isManager} onCommit={(v) => v != null && patch({ target_bcs: v })} />
            </label>
            {growing && (
              <label className="text-xs text-gray-500">
                <span className="flex items-center gap-1">Target gain <FeedInfo k="gain" /></span>
                <Num value={group.target_gain_lb == null ? 1.5 : Number(group.target_gain_lb)} step="0.1" min={0} max={4} suffix="lb/day" disabled={!isManager} onCommit={(v) => v != null && patch({ target_gain_lb: v })} />
              </label>
            )}
            <FromHerdChip />
          </div>

          {/* Need */}
          {result && (
            <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <p className="flex items-center gap-1 font-semibold text-gray-900">
                Need today, per head <FeedInfo k="need" />
              </p>
              <p className="mt-0.5">
                {n1(result.need.tdnLb)} lb energy (TDN) · {n1(result.need.cpLb)} lb protein — base {n1(result.need.base.tdn)} lb TDN
                {result.need.parts.cold > 0 && <> + {n0(result.need.parts.cold * 100)}% cold</>}
                {result.need.parts.mud > 0 && <> + {n0(result.need.parts.mud * 100)}% mud</>}
                {result.need.parts.condition > 0 && <> + {n0(result.need.parts.condition * 100)}% to put condition on</>}
                {result.need.parts.fatCredit < 0 && <> − 5% (fat, mid pregnancy)</>}
                {result.need.calfDmLb > 0 && <>; the calf at side eats about {n0(result.need.calfDmLb)} lb DM of the same feed</>}.
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-gray-500">
                Ration {n1(result.mixTdnPct)}% energy (TDN), {n1(result.mixCpPct)}% protein (CP), of dry matter · can eat up to {n1(result.capLb)} lb DM <FeedInfo k="intake" />
              </p>
            </div>
          )}

          {/* Ration */}
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1 text-xs font-semibold text-gray-900">
                Ration <FeedInfo k="share" />
                {group.ration_note && <span className="font-normal text-gray-400">— {group.ration_note}</span>}
              </p>
              {Math.abs(shareTotal - 100) > 0.5 && ration.length > 0 && <span className="text-[11px] text-amber-700">shares add to {n0(shareTotal)}% — scaled to 100</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="py-1 font-medium">Feed</th>
                    <th className="py-1 text-right font-medium" title="Share of this group's daily dry matter — what it is fed today">
                      Group share (% DM)
                    </th>
                    <th className="py-1 text-right font-medium">
                      <span className="inline-flex items-center gap-1">Waste <FeedInfo k="waste" /></span>
                    </th>
                    <th className="py-1 text-right font-medium">lb/hd as fed</th>
                    <th className="py-1 text-right font-medium">Group / day</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ration.map((r) => {
                    const v = values.get(r.feed_type_id)
                    const out = result?.lines.find((l) => l.feed.id === r.feed_type_id)
                    return (
                      <tr key={r.id}>
                        <td className="py-1 text-gray-900">
                          {v?.name ?? '?'}
                          {notUsed.has(r.feed_type_id) && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">not usually fed here</span>}
                          {v && (
                            <span className={cn('ml-1 rounded px-1 text-[10px]', v.source === 'test' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-500')}>
                              {v.source === 'test' ? 'tested' : 'book'} {n0(v.tdnPct)}% TDN
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right">
                          <Num value={Number(r.dm_share_pct)} step="1" min={0} max={100} suffix="%" disabled={!isManager} onCommit={(x) => x != null && rm.set.mutate({ id: r.id, patch: { dm_share_pct: x } })} />
                        </td>
                        <td className="py-1 text-right">
                          <span className="inline-flex items-center gap-1">
                            <Select
                              value=""
                              size="sm"
                              disabled={!isManager}
                              ariaLabel="Feeding method"
                              className="w-24"
                              onChange={(key) => {
                                const m = FEEDING_METHODS.find((x) => x.key === key)
                                if (m) rm.set.mutate({ id: r.id, patch: { waste_pct: m.waste } })
                              }}
                              options={[{ value: '', label: 'Method…' }, ...FEEDING_METHODS.map((m) => ({ value: m.key, label: `${m.label} (${m.waste}%)` }))]}
                            />
                            <Num value={Number(r.waste_pct)} step="1" min={0} max={80} suffix="%" disabled={!isManager} onCommit={(x) => x != null && rm.set.mutate({ id: r.id, patch: { waste_pct: x } })} className="w-12" />
                          </span>
                        </td>
                        <td className="py-1 text-right tabular-nums text-gray-700">{out ? n1(out.offeredLb) : '—'}</td>
                        <td className="py-1 text-right tabular-nums font-medium text-gray-900">{out ? yardAmount(out.groupOfferedLb, out.feed.unit, out.feed.lbPerBale) : '—'}</td>
                        <td className="py-1 text-right">
                          {isManager && (
                            <button type="button" onClick={() => rm.remove.mutate(r.id)} className="text-gray-300 hover:text-red-600" aria-label={`Take ${v?.name} out of the ration`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {isManager && addable.length > 0 && (
              <Select
                value=""
                size="sm"
                ariaLabel="Add a feed"
                className="mt-1 w-56"
                onChange={(id) => {
                  const v = values.get(id)
                  if (v) rm.add.mutate({ herd_count_id: group.id, feed_type_id: id, dm_share_pct: 0, waste_pct: defaultWaste(v.category), sort_order: ration.length + 1 })
                }}
                options={[{ value: '', label: 'Add a feed…' }, ...addable.map((v) => ({ value: v.id, label: notUsed.has(v.id) ? `${v.name} (not usually fed here)` : v.name }))]}
              />
            )}
            {isManager && notUsed.size > 0 && (
              <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-gray-500">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-3 w-3" /> show feeds not used at this ranch
              </label>
            )}
            {result && (result.addGrainLb > 0.05 || result.addSupplementLb > 0.05) && (
              <p className="mt-1 text-xs text-amber-800">
                To meet today&apos;s need add
                {result.addGrainLb > 0.05 && <> {n1(result.addGrainLb)} lb grain a head ({n0(result.addGrainLb * (group.background_head ?? group.head_count))} lb for the group)</>}
                {result.addGrainLb > 0.05 && result.addSupplementLb > 0.05 && ' and'}
                {result.addSupplementLb > 0.05 && <> {n1(result.addSupplementLb)} lb of a 32% protein supplement a head</>}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
