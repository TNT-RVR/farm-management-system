import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import {
  CLASS_LABEL,
  FEEDING_METHODS,
  FEEDING_METHOD_LABEL,
  defaultWaste,
  strawToCutSurplus,
  type Conditions,
  type FeedClass,
  type FeedValue,
  type FeedingMethod,
  type GroupRation,
} from '@/lib/cattle-nutrition'
import { groupInput, rationLines, useRationMutations, useUpdateGroup, type GroupRationRow, type GroupSeason, type HerdCountRow } from '@/lib/winter-feeding'
import { cn } from '@/lib/utils'
import { weightFor } from '@/lib/animal-units'
import { FeedInfo } from './FeedInfo'
import { FromHerdChip, Num, WarningList, n0, n1, tonnes, yardAmount } from './bits'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { CardList, RowCard } from '@/components/RowCards'

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
  season = null,
  turnout = null,
  cond = null,
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
  /** This group over the season plan: condition put on, feed a measured ration would save. */
  season?: GroupSeason | null
  /** The season's last day, for "by Mar 15". */
  turnout?: Date | null
  /** Today's conditions, for the straw that would take a free-choice surplus off. */
  cond?: Conditions | null
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
  const feeding: FeedingMethod = group.feeding_method === 'measured' ? 'measured' : 'free_choice'
  const by = turnout ? turnout.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : 'turnout'
  // Free choice: what the surplus does to them, and ways to save feed when it is big.
  const planned = Math.max(0, Number(group.target_bcs) - Number(group.bcs))
  const bigSurplus =
    feeding === 'free_choice' && season != null && season.days > 0 && (season.energyPct > 110 || (season.bcsChange ?? 0) - planned > 0.25)
  const straw = useMemo(() => {
    if (!bigSurplus || !cond || !result || result.surplusTdnLb <= 0) return null
    const inRation = ration.find((r) => values.get(r.feed_type_id)?.category === 'straw')
    const feed = inRation ? values.get(inRation.feed_type_id) : [...values.values()].find((v) => v.category === 'straw' && !notUsed.has(v.id))
    if (!feed) return null
    const lines = rationLines(group.id, ration, values)
    const cut = strawToCutSurplus(groupInput(group), cond, lines, feed, inRation ? Number(inRation.waste_pct) : defaultWaste('straw'))
    if (!cut) return null
    const now = result.lines.find((l) => l.feed.id === feed.id)?.groupOfferedLb ?? 0
    const then = cut.ration.lines.find((l) => l.feed.id === feed.id)?.groupOfferedLb ?? 0
    return { feed, cut, moreLb: Math.max(0, then - now) }
  }, [bigSurplus, cond, result, ration, values, notUsed, group])
  const wasteNow = result && result.lines.length ? result.lines.reduce((s, l) => s + l.wastePct * l.groupOfferedLb, 0) / Math.max(1, result.lines.reduce((s, l) => s + l.groupOfferedLb, 0)) : 0
  const amber = result?.warnings.some((w) => w.level === 'amber')

  // Each ration line's cells built once: the phone card and the table row show the same nodes.
  const rationRows = ration.map((r) => {
    const v = values.get(r.feed_type_id)
    const out = result?.lines.find((l) => l.feed.id === r.feed_type_id)
    return {
      id: r.id,
      name: (
        <>
          {v?.name ?? '?'}
          {notUsed.has(r.feed_type_id) && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800">not usually fed here</span>}
          {v && (
            <span className={cn('ml-1 rounded px-1 text-[10px]', v.source === 'test' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-500')}>
              {v.source === 'test' ? 'tested' : 'book'} {n0(v.tdnPct)}% energy
            </span>
          )}
        </>
      ),
      share: <Num value={Number(r.dm_share_pct)} step="1" min={0} max={100} suffix="%" disabled={!isManager} onCommit={(x) => x != null && rm.set.mutate({ id: r.id, patch: { dm_share_pct: x } })} />,
      waste: (
        <span className="inline-flex items-center gap-1">
          <Select
            value=""
            size="sm"
            disabled={!isManager}
            ariaLabel="Feeding method"
            // w-24 cut "Method…" to "Metho…": the trigger needs 104 px for it
            // (62 px of text plus padding, gap and chevron). The Waste cell is
            // 196 px in the table and 214 px on a card, so 112 px costs nothing.
            className="w-28"
            onChange={(key) => {
              const m = FEEDING_METHODS.find((x) => x.key === key)
              if (m) rm.set.mutate({ id: r.id, patch: { waste_pct: m.waste } })
            }}
            options={[{ value: '', label: 'Method…' }, ...FEEDING_METHODS.map((m) => ({ value: m.key, label: `${m.label} (${m.waste}%)` }))]}
          />
          <Num value={Number(r.waste_pct)} step="1" min={0} max={80} suffix="%" disabled={!isManager} onCommit={(x) => x != null && rm.set.mutate({ id: r.id, patch: { waste_pct: x } })} className="w-12" />
        </span>
      ),
      perHead: out ? n1(out.offeredLb) : '—',
      group: out ? yardAmount(out.groupOfferedLb, out.feed.unit, out.feed.lbPerBale) : '—',
      remove: isManager ? (
        <button type="button" onClick={() => rm.remove.mutate(r.id)} className="text-gray-300 hover:text-red-600" aria-label={`Take ${v?.name} out of the ration`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null,
    }
  })

  return (
    <div className={cn('rounded-lg border bg-white', !included ? 'border-gray-200 opacity-60' : red ? 'border-red-300' : amber ? 'border-amber-300' : 'border-gray-200')}>
      {/* Header: the answer first */}
      <div className="flex flex-wrap items-start gap-3 p-3">
        <input type="checkbox" checked={included} disabled={!isManager} onChange={onToggle} className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-700" aria-label={`Feed ${group.class_name} this winter`} />
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 basis-48 text-left">
          <p className="flex items-center gap-1 text-sm font-semibold text-gray-900">
            {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            {group.class_name}
            <span className="font-normal text-gray-500">· {group.background_head ?? group.head_count} head · {weightFor(group).missing ? <span className="text-amber-700" title="No weight entered — fed at the class's typical weight">~{n0(weightFor(group).lb)} lb (typical)</span> : <>{n0(Number(group.avg_weight_lb))} lb</>} · {result?.need.stage ?? CLASS_LABEL[group.feed_class]}</span>
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
              <span className="text-gray-400"> · {feeding === 'free_choice' ? 'free choice' : 'measured'}</span>
            </p>
          )}
        </button>
        {included && result && result.lines.length > 0 && (
          <div className="w-full text-right text-xs sm:w-auto">
            <p className={cn('text-lg font-bold tabular-nums', result.energyMetPct < 90 ? 'text-red-700' : 'text-gray-900')}>{n1(result.dmLb)} <span className="text-xs font-normal text-gray-500" title="Dry matter: the feed with its water taken out">lb dry matter/hd</span></p>
            <p className="text-gray-500">
              energy {n0(result.energyMetPct)}% · protein {n0(result.proteinMetPct)}%
            </p>
          </div>
        )}
      </div>

      {included && feeding === 'free_choice' && season && season.days > 0 && (season.bcsChange != null || season.extraGainLb != null) && (
        <div className="-mt-1 px-3 pb-2 text-xs text-gray-700">
          <p className="flex flex-wrap items-center gap-1">
            {season.bcsChange != null ? (
              <>
                Condition{' '}
                <b className={cn(season.bcsChange < -0.1 ? 'text-red-700' : season.bcsChange > 0.25 ? 'text-amber-800' : 'text-gray-900')}>
                  {Math.abs(season.bcsChange) < 0.05
                    ? `holds by ${by}`
                    : `${season.bcsChange > 0 ? '+' : '−'}${Math.abs(season.bcsChange).toFixed(1)} by ${by}`}
                </b>
                <span className="text-gray-500">
                  ({Number(group.bcs).toFixed(2).replace(/0$/, '')} → about {(Number(group.bcs) + season.bcsChange).toFixed(1)}; energy {n0(season.energyPct)}% of need)
                </span>
              </>
            ) : (
              <>
                Gain{' '}
                {/* Rounded first: −0.04 lb read "−0.0 lb/day over the target". */}
                {Math.abs(season.extraGainLb ?? 0) < 0.05 ? (
                  <b className="text-gray-900">on target</b>
                ) : (
                  <>
                    <b className="text-gray-900">{Math.abs(season.extraGainLb ?? 0).toFixed(1)} lb/day</b>{' '}
                    {(season.extraGainLb ?? 0) > 0 ? 'over' : 'under'} the target
                  </>
                )}{' '}
                <span className="text-gray-500">to {by} (energy {n0(season.energyPct)}% of need)</span>
              </>
            )}
            <FeedInfo k="condition" />
          </p>
          {bigSurplus && (
            <div className="mt-1 rounded-md bg-amber-50 px-2 py-1.5 text-amber-950">
              <p className="flex items-center gap-1 font-semibold">
                Ways to save feed <FeedInfo k="saveFeed" />
              </p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {season.offeredLb > season.measuredLb && (
                  <li>Limit time at the bale feeder — fed to need they would use about {tonnes(season.offeredLb - season.measuredLb)} t less to {by}.</li>
                )}
                {straw && (
                  <li>
                    Swap in straw — about <b>{yardAmount(straw.moreLb, straw.feed.unit, straw.feed.lbPerBale)}</b> more {straw.feed.name.toLowerCase()} a day ({n0(straw.cut.sharePct)}% of the ration){' '}
                    {straw.cut.cutsAll ? 'takes today’s surplus off.' : 'is the most the straw limits allow.'}
                  </li>
                )}
                {wasteNow > 8 && (
                  <li>Cone or basket feeders — waste is about {n0(wasteNow)}% now; at 5% that is about {tonnes(season.offeredLb * (1 - (1 - wasteNow / 100) / 0.95))} t less.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

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
            <div className="text-xs text-gray-500">
              <span className="flex items-center gap-1">
                Fed <FeedInfo k="feeding" />
              </span>
              <div className="mt-0.5 flex rounded-md border border-gray-200 p-0.5" role="group" aria-label="How this group is fed">
                {(['free_choice', 'measured'] as FeedingMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={!isManager}
                    onClick={() => m !== feeding && patch({ feeding_method: m })}
                    aria-pressed={feeding === m}
                    className={cn('rounded px-2 py-0.5 text-xs font-medium disabled:cursor-default', feeding === m ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50 disabled:hover:bg-transparent')}
                  >
                    {FEEDING_METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
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
                {result.need.parts.cold > 0 && <> + {n0(result.need.parts.cold * 100)}% cold on the {n1(result.need.maintTdnLb)} lb maintenance</>}
                {result.need.parts.mud > 0 && <> + {n0(result.need.parts.mud * 100)}% mud on maintenance</>}
                {result.need.parts.condition > 0 && <> + {n0(result.need.parts.condition * 100)}% to put condition on</>}
                {result.need.parts.fatCredit < 0 && <> − 5% (fat, mid pregnancy)</>}
                {result.need.calfDmLb > 0 && <>; the calf at side eats about {n0(result.need.calfDmLb)} lb dry matter of the same feed</>}.
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-gray-500">
                Ration {n1(result.mixTdnPct)}% energy (TDN), {n1(result.mixCpPct)}% protein (CP), of dry matter · {feeding === 'free_choice' ? 'eats to appetite' : 'can eat up to'} {n1(result.capLb)} lb dry matter <FeedInfo k={feeding === 'free_choice' ? 'feeding' : 'intake'} />
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
            <CardList className="rounded-lg border border-gray-200">
              {rationRows.map((r) => (
                <RowCard
                  key={r.id}
                  heading={r.name}
                  actions={r.remove}
                  facts={[
                    { label: 'Group share', node: r.share },
                    { label: 'Waste', node: r.waste },
                    { label: 'lb/hd as fed', node: r.perHead },
                    { label: 'Group / day', node: r.group },
                  ]}
                />
              ))}
            </CardList>
            <div className="hidden overflow-x-auto rounded-lg border border-gray-200 sm:block">
              <table className="w-full min-w-[620px] text-sm">
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className={TABLE_TH}>Feed</th>
                    <th className={cn(TABLE_TH, 'text-right')} title="Share of this group's daily dry matter — what it is fed today">
                      Group share (% of dry matter)
                    </th>
                    <th className={cn(TABLE_TH, 'text-right')}>
                      <span className="inline-flex items-center gap-1">Waste <FeedInfo k="waste" /></span>
                    </th>
                    <th className={cn(TABLE_TH, 'text-right')}>lb/hd as fed</th>
                    <th className={cn(TABLE_TH, 'text-right')}>Group / day</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rationRows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-1 text-gray-900">{r.name}</td>
                      <td className="px-3 py-1 text-right">{r.share}</td>
                      <td className="px-3 py-1 text-right">{r.waste}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-700">{r.perHead}</td>
                      <td className="px-3 py-1 text-right tabular-nums font-medium text-gray-900">{r.group}</td>
                      <td className="px-3 py-1 text-right">{r.remove}</td>
                    </tr>
                  ))}
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
