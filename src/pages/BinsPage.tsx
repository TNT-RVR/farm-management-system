import { useEffect, useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useTab } from '@/lib/useTab'
import { useSearchParams } from 'react-router-dom'
import { AddBushels } from '@/pages/bins/AddBushels'
import { BinLoadsDialog } from '@/pages/bins/BinLoads'
import { BinDetail } from '@/pages/bins/BinDetail'
import { WeighInDialog } from '@/pages/bins/WeighIn'
import { MoveGrain } from '@/pages/bins/MoveGrain'
import { BushelCalculator } from '@/pages/calculator/BushelCalculator'
import { Link } from 'react-router-dom'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { BinAirAlerts } from '@/components/BinAirAlerts'
import { PillTabs } from '@/components/PillTabs'
import { HelpNote } from '@/components/HelpNote'
import { BinMap } from '@/pages/bins/BinMap'
import { BinContentsPanel, RecordContentsDialog } from '@/pages/bins/BinContents'
import { useBinContents, useEmptyBin, isCarryOver, contentLabel } from '@/lib/bin-contents'
import { DateField } from '@/components/DateField'
import { companyLookup, companiesFor, cropLabel } from '@/lib/crop-label'
import { useCropVarieties } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import {
  boundariesForYear,
  useAllBoundaries,
  useCropPlans,
  useCrops,
  useFields,
} from '@/lib/queries'
import {
  estimateBins,
  plansWithZones,
  useAllocationMutations,
  useCropBinOverrides,
  useSetCropBinOverride,
  useSetCropBinPolicy,
  useBinAllocations,
  useBinMutations,
  useBins,
  type BinEstimateLine, useBinOnHand, type BinRow } from '@/lib/bins'
import { cn } from '@/lib/utils'
import { cropColour } from '@/lib/crop-colour'
import { useAllCropZones } from '@/lib/cropZones'
import { Modal } from '@/components/Modal'

/** The three ways a crop can be put away, in the order they get chosen. */
const BIN_POLICIES = [
  { value: 'mixable', label: 'Mixable' },
  {
    value: 'segregate_by_field',
    // Not "one bin per field": a field can take two or three bins. The rule is
    // that a bin never holds more than one field.
    label: 'Keep fields separate',
  },
  { value: 'segregate_by_variety', label: 'Keep varieties separate' },
]

/**
 * The bins creek yard, told apart by their yard rather than their name.
 *
 * `site` is what the bin record actually carries — "Creek Yard" — where the
 * name is a label somebody typed and could be renamed tomorrow.
 */
function isCreekYard(b: { site: string | null; name: string }): boolean {
  const where = (b.site ?? b.name).toLowerCase()
  return where.includes('creek yard')
}

export type StorageTab = 'estimator' | 'bins' | 'map'

/**
 * The bins. Rendered as three of the Harvest view's tabs, which pass the tab
 * in; the Harvest view draws the heading, the tab strip and the air alerts.
 */
export function BinsPage({ tab: shownTab }: { tab?: StorageTab } = {}) {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const isManager = hasManagerAccess(profile?.role)
  const isPast = cropYear < new Date().getFullYear()
  // ?tab= opens straight on one, so a tile can land on the yard list rather
  // than on the estimator with an instruction to click again. Read once; after
  // that the tabs are ordinary state.
  //
  // 'movements' is still accepted and lands on the yard list: the tab it named
  // is gone, and a saved link or a home-screen tile pointing at it should not
  // dead-end.
  const [ownTab, setTab] = useTab('bins', ['estimator', 'bins', 'map'] as const, 'estimator', (asked) =>
    asked === 'movements' ? 'bins' : undefined,
  )
  const embedded = shownTab != null
  const tab = shownTab ?? ownTab

  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: allBoundaries } = useAllBoundaries()
  const { data: fields } = useFields()
  const { data: allBins } = useBins()
  const { data: contents } = useBinContents()
  // The bin whose contents are being written down from its own row.
  const [recordFor, setRecordFor] = useState<BinRow | null>(null)
  // Closing out what was in a bin, from its row: which content row, and the day.
  const emptyBin = useEmptyBin()
  const [emptying, setEmptying] = useState<{ id: string; on: string } | null>(null)
  const { data: varieties } = useCropVarieties()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: zones } = useAllCropZones()
  const binMut = useBinMutations()
  const allocMut = useAllocationMutations(cropYear)
  const { data: overrides } = useCropBinOverrides(cropYear)
  const setOverride = useSetCropBinOverride(cropYear)
  const setPolicy = useSetCropBinPolicy()
  const [showFields, setShowFields] = useState<BinEstimateLine | null>(null)

  /**
   * The bins creek yard are out of sight and, in practice, out of use.
   *
   * Hidden by default across the whole page — the yard list, the totals and the
   * storage the estimator sizes against — because counting four bins nobody
   * fills as available storage is the difference between "covered" and "short
   * two bins", and the wrong answer is the reassuring one.
   *
   * The choice sticks, so somebody who turns them on to put something down
   * there does not have to keep turning them on.
   */
  const [showCreekYard, setShowCreekYard] = useState(
    () => localStorage.getItem('bins_showCreekYard') === '1',
  )
  useEffect(
    () => void localStorage.setItem('bins_showCreekYard', showCreekYard ? '1' : '0'),
    [showCreekYard],
  )

  const creekYardCount = useMemo(
    () => (allBins ?? []).filter((b) => b.active && isCreekYard(b)).length,
    [allBins],
  )
  const bins = useMemo(
    () => (allBins ?? []).filter((b) => showCreekYard || !isCreekYard(b)),
    [allBins, showCreekYard],
  )

  /** Bins with something already in them — last year's durum in #2, say. */
  const occupiedBinIds = useMemo(
    () => new Set((contents ?? []).map((c) => c.bin_id)),
    [contents],
  )
  const carryOver = useMemo(
    () => (contents ?? []).filter((c) => isCarryOver(c, cropYear)),
    [contents, cropYear],
  )
  const contentByBin = useMemo(
    () => new Map((contents ?? []).map((c) => [c.bin_id, c])),
    [contents],
  )
  const company = useMemo(() => companyLookup(varieties ?? undefined), [varieties])

  const acresByField = useMemo(() => {
    const b = allBoundaries ? boundariesForYear(allBoundaries, cropYear) : []
    const m = new Map<string, number>()
    b.forEach((x) => m.set(x.field_id, x.acres))
    return m
  }, [allBoundaries, cropYear])

  const lines = useMemo(() => {
    if (!crops || !plans || !bins || !allocations) return []
    return estimateBins(
      crops,
      // A field split on the map counts as its crop areas, not its one plan.
      plansWithZones(plans, zones ?? [], cropYear),
      bins,
      allocations,
      (fid) => acresByField.get(fid) ?? null,
      overrides,
      occupiedBinIds,
    )
  }, [crops, plans, zones, cropYear, bins, allocations, acresByField, overrides, occupiedBinIds])

  // Baled hay and potatoes that leave on a truck are not a storage question, so
  // they are off the list by default — they were pushing the crops that DO need
  // a bin down the page. Kept one click away, because "not binned" is a setting
  // somebody may want to change and a row that has vanished cannot be changed.
  const [showNotBinned, setShowNotBinned] = useState(false)
  const notBinned = useMemo(() => lines.filter((l) => !l.needsBins), [lines])
  const shownLines = useMemo(
    () => (showNotBinned ? lines : lines.filter((l) => l.needsBins)),
    [lines, showNotBinned],
  )

  const totals = useMemo(() => {
    const active = (bins ?? []).filter((b) => b.active)
    const cap = active.reduce((s, b) => s + b.capacity_bu, 0)
    const allocatedBinIds = new Set((allocations ?? []).map((a) => a.bin_id))
    // A bin holding last year's durum is neither allocated nor available. It
    // was being counted as free storage, which is the reassuring answer and the
    // wrong one.
    const unallocated = active.filter(
      (b) => !allocatedBinIds.has(b.id) && !occupiedBinIds.has(b.id),
    )
    return {
      binCount: active.length,
      capacity: cap,
      unallocatedCount: unallocated.length,
      unallocatedCap: unallocated.reduce((s, b) => s + b.capacity_bu, 0),
      // Counted in the total, flagged separately: it is real capacity, but it
      // is capacity you empty first.
      fertCap: unallocated
        .filter((b) => b.usual_contents === 'fertilizer')
        .reduce((s, b) => s + b.capacity_bu, 0),
      shortBins: lines.reduce((s, l) => s + (l.shortfallBins ?? 0), 0),
      heldOver: active.filter((b) => occupiedBinIds.has(b.id)).length,
    }
  }, [bins, allocations, lines, occupiedBinIds])

  const [newBin, setNewBin] = useState({ name: '', capacity: '', site: '' })
  const [addingTo, setAddingTo] = useState<{ id: string; name: string } | null>(null)
  // The bin whose scale loads are being looked at or weighed in.
  const [loadsFor, setLoadsFor] = useState<{ id: string; name: string } | null>(null)
  // The home-screen tile lands here with ?weigh=1: the weigh-in form, field
  // first, with any loads still waiting for their second weight.
  const [params, setParams] = useSearchParams()
  const askingWhichBin = params.get('weigh') === '1' && !loadsFor
  const clearWeigh = () => {
    const next = new URLSearchParams(params)
    next.delete('weigh')
    setParams(next, { replace: true })
  }
  const [movingFrom, setMovingFrom] = useState<BinRow | null>(null)
  // The bin opened in full, from a click on its row.
  const [detailFor, setDetailFor] = useState<BinRow | null>(null)
  const { data: onHand } = useBinOnHand()
  const cropName = (id: string | null) => crops?.find((c) => c.id === id)?.name ?? ''

  /**
   * The crop as it should read on a bin: "BASF Canola", not "Canola".
   *
   * The company comes from the variety on that FIELD's plan, so two canola
   * fields on different contracts read differently — which is the whole point,
   * because they must not share a bin.
   */
  const cropOnField = (cropId: string | null, fieldId: string | null) => {
    const name = cropName(cropId)
    if (!name || !cropId || !fieldId) return name
    const variety = (plans ?? []).find((p) => p.field_id === fieldId && p.crop_id === cropId)?.variety
    return cropLabel(name, company(cropId, variety))
  }
  const fieldName = (id: string | null) => fields?.find((f) => f.id === id)?.name ?? ''
  const allocByBin = new Map((allocations ?? []).map((a) => [a.bin_id, a]))
  const cropById = useMemo(() => new Map((crops ?? []).map((c) => [c.id, c])), [crops])

  /**
   * The crops on a field this year — the whole-field plan, plus any split.
   *
   * A field is normally one crop, which is why the bin table can read it off
   * rather than ask. A field split between two crops on the map is the only
   * case where the bin has to be told which half it holds.
   */
  const cropsOnField = useMemo(() => {
    const byField = new Map<string, string[]>()
    const add = (fieldId: string, cropId: string | null) => {
      if (!cropId) return
      const list = byField.get(fieldId) ?? []
      if (!list.includes(cropId)) list.push(cropId)
      byField.set(fieldId, list)
    }
    for (const p of plans ?? []) add(p.field_id, p.crop_id)
    for (const z of zones ?? []) if (z.crop_year === cropYear) add(z.field_id, z.crop_id)
    return (fieldId: string) => byField.get(fieldId) ?? []
  }, [plans, zones, cropYear])

  // Only fields with something growing on them: a bin allocated to a field with
  // no crop planned tells nobody anything.
  const fieldsWithCrops = useMemo(
    () => (fields ?? []).filter((f) => cropsOnField(f.id).length > 0),
    [fields, cropsOnField],
  )

  return (
    <div className={embedded ? 'px-4 pb-4 pt-3 md:px-6 md:pb-6' : 'p-4 md:p-6'}>
      {!embedded && <h1 className="mb-3 text-lg font-semibold text-gray-900">Bins {cropYear}</h1>}

      {!embedded && <BinAirAlerts compact />}
      {/* Left-aligned under the heading, the way every other view puts its
          sub-tabs — a strip that starts on the right reads as a control panel
          rather than as navigation. */}
      {!embedded && (
        <div className="mb-4">
          <PillTabs
            tabs={[
              { key: 'estimator', label: 'Estimator' },
              { key: 'bins', label: 'Bins & allocations' },
              { key: 'map', label: 'Map' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      )}

      {/* On a phone the Map tab gives the screen to the map; the totals are on the other tabs. */}
      <div className={cn('mb-4 grid-cols-2 gap-3 sm:grid-cols-4', tab === 'map' ? 'hidden md:grid' : 'grid')}>
        {[
          ['Active bins', String(totals.binCount)],
          ['Total capacity', `${Math.round(totals.capacity).toLocaleString()} bu`],
          [
            'Unallocated',
            `${totals.unallocatedCount} · ${Math.round(totals.unallocatedCap).toLocaleString()} bu` +
              (totals.fertCap > 0
                ? ` (${Math.round(totals.fertCap).toLocaleString()} in fert bins)`
                : ''),
          ],
          ['Bins short', String(totals.shortBins)],
        ].map(([label, val], i) => (
          <div
            key={label}
            className={cn(
              'rounded-lg border p-3',
              i === 3 && totals.shortBins > 0
                ? 'border-red-300 bg-red-50'
                : 'border-gray-200 bg-white',
            )}
          >
            <p className="text-xs text-gray-500">{label}</p>
            <p
              className={cn(
                'mt-0.5 text-lg font-bold',
                i === 3 && totals.shortBins > 0 ? 'text-red-700' : 'text-gray-900',
              )}
            >
              {val}
            </p>
          </div>
        ))}
      </div>

      {/* Off by default: four bins nobody fills, counted as available storage,
          is the difference between "covered" and "short two bins". */}
      {creekYardCount > 0 && (
        <label className={cn('mb-3 items-center gap-2 text-xs text-gray-600', tab === 'map' ? 'hidden md:flex' : 'flex')}>
          <input
            type="checkbox"
            checked={showCreekYard}
            onChange={(e) => setShowCreekYard(e.target.checked)}
          />
          Include the {creekYardCount} bins creek yard
          {!showCreekYard && (
            <span className="text-gray-400">— hidden, and left out of the totals</span>
          )}
        </label>
      )}

      {/* The Bins tab lists carry-over in "What is in the bins" right below,
          with its own button to mark it emptied; saying it twice there was
          noise. The banner stays on the estimator and map, which lack that card. */}
      {carryOver.length > 0 && tab !== 'bins' && (
        <p className={cn('mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900', tab === 'map' && 'hidden md:block')}>
          {carryOver.length === 1 ? 'One bin is' : `${carryOver.length} bins are`} still holding
          grain from a previous year — {carryOver.map((c) => `${c.bin_name} (${contentLabel(c)})`).join(', ')}.
          {' '}Not counted as storage for {cropYear}.
        </p>
      )}

      {tab === 'map' ? (
        <BinMap
          canEdit={isManager && !isPast}
          cropYear={cropYear}
          actions={{ weighIn: setLoadsFor, add: setAddingTo, move: setMovingFrom, record: setRecordFor }}
        />
      ) : tab === 'estimator' ? (
        <div className="space-y-2">
          {/* The intro and the table's footer were two notes saying "the
              crop's own settings are on the Crops page"; one line now, with
              both in full behind ⓘ. */}
          <HelpNote
            summary={
              <>
                Whether a crop is binned, its bin policy and test weight are set under{' '}
                <Link to="/crops" className="text-brand-700 hover:underline">
                  Crop Settings
                </Link>
                ; the tick and bushels here change {cropYear} only.
              </>
            }
            title="What is set where"
          >
            <p>
              Whether a crop is binned at all is set once per crop under Crop Settings. The tick and
              the bushel figure here change {cropYear} only — leave the bushels blank to store the
              whole crop.
            </p>
            <p>
              Set a crop’s bin policy (mixable / segregate by field / by variety) and test weight on
              the Crops page. Seed crops that need one bin per field use “segregate by field”.
            </p>
          </HelpNote>
          {notBinned.length > 0 && (
            <p className="mb-2 text-xs text-gray-500">
              {notBinned.length} crop{notBinned.length === 1 ? '' : 's'} not stored in bins —{' '}
              {notBinned.map((l) => l.crop.name).join(', ')}.{' '}
              <button
                type="button"
                onClick={() => setShowNotBinned((v) => !v)}
                className="underline hover:text-gray-800"
              >
                {showNotBinned ? 'Hide them' : 'Show them to change it'}
              </button>
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-medium">Crop</th>
                  <th className="px-3 py-2 font-medium">Binned</th>
                  <th className="px-3 py-2 font-medium">Policy</th>
                  <th className="px-3 py-2 text-right font-medium">Fields</th>
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title="What the crop is expected to make. Opens the plan, where the per-field yields are set."
                  >
                    Est. production
                  </th>
                  <th
                    className="px-3 py-2 text-right font-medium"
                    title="Bushels that need a bin this year. Blank uses the whole estimated crop."
                  >
                    To bin (bu)
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Allocated</th>
                  <th className="px-3 py-2 font-medium">Assessment</th>
                </tr>
              </thead>
              <tbody>
                {shownLines.map((l) => {
                  const short = (l.shortfallBins ?? 0) > 0 || (l.shortfallBu ?? 0) > 0
                  return (
                    <tr
                      key={l.crop.id}
                      className={cn(
                        'border-b border-gray-100 last:border-0',
                        // Faded, not hidden. A crop excluded from the estimate has
                        // to stay visible or nobody can tell whether it was left
                        // out deliberately or forgotten.
                        !l.needsBins && 'bg-gray-50 text-gray-400',
                      )}
                    >
                      <td className="px-3 py-2 font-medium">
                        {/* "BASF Canola", not "Canola". The two contracts are
                            different grain that must not share a bin, and a
                            storage plan calling both of them Canola is how they
                            end up augered together. Where a crop runs under two
                            companies both are named, because that is two things
                            to keep apart rather than one. */}
                        {(() => {
                          const cos = companiesFor(plans ?? [], l.crop.id, company)
                          return cos.length === 0
                            ? l.crop.name
                            : cos.map((c) => cropLabel(l.crop.name, c)).join(' · ')
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        {/* This YEAR, not the crop. The crop's own default lives
                          in Crop Settings; here somebody is planning a season,
                          and a tick that quietly rewrote every other year would
                          be the wrong thing to hand them. */}
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={l.needsBins}
                            disabled={!isManager || setOverride.isPending}
                            onChange={(e) =>
                              setOverride.mutate({
                                crop_id: l.crop.id,
                                // Back to the crop's own setting when the tick
                                // agrees with it, rather than storing a redundant
                                // override that would then ignore a later change
                                // to the default.
                                needs_bins:
                                  e.target.checked === (l.crop.needs_bins !== false)
                                    ? null
                                    : e.target.checked,
                                stored_bu: overrides?.get(l.crop.id)?.stored_bu ?? null,
                              })
                            }
                          />
                          {l.needsBins ? 'yes' : 'no'}
                        </label>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {!l.needsBins ? (
                          '—'
                        ) : isManager ? (
                          <Select
                            value={l.policy}
                            options={BIN_POLICIES}
                            ariaLabel={`Bin policy for ${l.crop.name}`}
                            size="sm"
                            className="w-40"
                            onChange={(v) =>
                              setPolicy.mutate({
                                id: l.crop.id,
                                bin_policy: v as BinEstimateLine['policy'],
                              })
                            }
                          />
                        ) : (
                          l.policy.replaceAll('_', ' ')
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.fieldCount > 0 ? (
                          <button
                            onClick={() => setShowFields(l)}
                            className="rounded px-1 font-medium text-brand-700 underline-offset-2 hover:underline"
                            title="Which fields?"
                          >
                            {l.fieldCount}
                          </button>
                        ) : (
                          l.fieldCount
                        )}
                      </td>
                      {/* Through to the plan, filtered to this crop, which is
                          where the per-field yields that make this number are
                          actually set. */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.estimatedBu != null ? (
                          <Link
                            to={`/plan?tab=plan&crop=${l.crop.id}`}
                            className="text-brand-700 underline-offset-2 hover:underline"
                            title="Open the crop plan to edit yields"
                          >
                            {Math.round(l.estimatedBu).toLocaleString()} bu
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {!l.needsBins ? (
                          '—'
                        ) : isManager ? (
                          <input
                            type="number"
                            defaultValue={l.storedBu ?? ''}
                            placeholder={
                              l.productionBu != null ? String(Math.round(l.productionBu)) : ''
                            }
                            title="Bushels that need a bin. Blank means all of it."
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const bu = raw === '' ? null : Number(raw)
                              if (bu != null && !Number.isFinite(bu)) return
                              setOverride.mutate({
                                crop_id: l.crop.id,
                                needs_bins: overrides?.get(l.crop.id)?.needs_bins ?? null,
                                stored_bu: bu,
                              })
                            }}
                            className={cn(
                              'w-28 rounded-md border px-2 py-1 text-right text-sm tabular-nums',
                              l.overridden
                                ? 'border-brand-300 bg-white font-medium'
                                : 'border-gray-200 bg-white',
                            )}
                          />
                        ) : l.productionBu != null ? (
                          `${Math.round(l.productionBu).toLocaleString()} bu`
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.allocatedBins} · {Math.round(l.allocatedCapacityBu).toLocaleString()} bu
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-xs',
                          short ? 'font-medium text-red-700' : 'text-gray-600',
                        )}
                      >
                        <span className="flex items-center gap-1">
                          {short && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                          {l.summary}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                      No crop plans for {cropYear}, or no bins yet. Add bins and a plan to estimate.{' '}
                      <SetupLink managerOnly to={SETUP_LINKS.cropPlan()}>Plan the crops</SetupLink>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
        {/* Above the table, not under twenty-eight rows of it: what is still
            in a bin from last year is the first thing to know before any of
            this year's allocations are made. */}
        <div className="mb-4">
          <BinContentsPanel
            bins={bins}
            crops={crops ?? []}
            contents={contents ?? []}
            cropYear={cropYear}
            canEdit={isManager}
          />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white">
          {isManager && !isPast && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!newBin.name) return
                binMut.create.mutate(
                  {
                    name: newBin.name,
                    capacity_bu: Number(newBin.capacity || 0),
                    site: newBin.site || null,
                  },
                  { onSuccess: () => setNewBin({ name: '', capacity: '', site: '' }) },
                )
              }}
              className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3"
            >
              <input
                placeholder="Bin name"
                value={newBin.name}
                onChange={(e) => setNewBin((b) => ({ ...b, name: e.target.value }))}
                className="min-w-32 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="number"
                placeholder="Capacity (bu)"
                value={newBin.capacity}
                onChange={(e) => setNewBin((b) => ({ ...b, capacity: e.target.value }))}
                className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                placeholder="Site"
                value={newBin.site}
                onChange={(e) => setNewBin((b) => ({ ...b, site: e.target.value }))}
                className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
              >
                <Plus className="h-3.5 w-3.5" /> Add bin
              </button>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-medium">Bin</th>
                  <th className="px-3 py-2 text-right font-medium">Capacity</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">{cropYear} crop</th>
                  <th className="px-3 py-2 text-right font-medium">In the bin</th>
                  {isManager && !isPast && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {(bins ?? []).map((bin) => {
                  const a = allocByBin.get(bin.id)
                  return (
                    <tr
                      key={bin.id}
                      // A click on the row itself opens the bin; its dropdowns
                      // and buttons keep doing their own jobs.
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, input, select, [role=listbox], [role=option], [role=dialog]')) return
                        setDetailFor(bin)
                      }}
                      className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => setDetailFor(bin)}
                          className="text-left text-gray-900 underline decoration-gray-300 decoration-dotted underline-offset-2 hover:text-brand-800"
                        >
                          {bin.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Math.round(bin.capacity_bu).toLocaleString()} bu
                      </td>
                      <td className="px-3 py-2 text-gray-500">{bin.site ?? '—'}</td>
                      {/* The field is what somebody knows when they fill a
                          bin — "that is Kellers" — and the crop follows from it,
                          because the crop plan already says what is on Kellers.
                          Asking for both invited the pair to disagree. */}
                      <td className="px-3 py-2">
                        {isManager && !isPast ? (
                          <Select
                            value={a?.field_id ?? ''}
                            size="sm"
                            ariaLabel="Field"
                            className="max-w-44"
                            onChange={(fieldId) => {
                              if (!fieldId) {
                                allocMut.remove.mutate({ binId: bin.id })
                                return
                              }
                              const on = cropsOnField(fieldId)
                              allocMut.upsert.mutate({
                                crop_year: cropYear,
                                bin_id: bin.id,
                                // One crop on the field is not a choice, so do
                                // not make it one. Several and it stays unset
                                // until somebody picks, rather than guessing.
                                crop_id: on.length === 1 ? on[0] : null,
                                field_id: fieldId,
                              })
                            }}
                            options={[
                              { value: '', label: '—' },
                              ...fieldsWithCrops.map((f) => ({ value: f.id, label: f.name })),
                            ]}
                          />
                        ) : (
                          fieldName(a?.field_id ?? null) || '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const on = a?.field_id ? cropsOnField(a.field_id) : []
                          // A field growing one crop shows it as text: it is
                          // read off the crop plan, not decided here.
                          if (!a?.field_id) return <span className="text-gray-400">—</span>
                          if (on.length <= 1)
                            return (
                              <span className="inline-flex items-center gap-1.5">
                                {a.crop_id && (
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ background: cropColour(cropById.get(a.crop_id)) }}
                                  />
                                )}
                                {cropOnField(a.crop_id, a.field_id) || (
                                  <span className="text-gray-400">nothing planned</span>
                                )}
                              </span>
                            )
                          // Split field: choose, but only from what is on it.
                          return isManager && !isPast ? (
                            <Select
                              value={a.crop_id ?? ''}
                              size="sm"
                              ariaLabel="Which crop from this field"
                              className="max-w-40"
                              onChange={(cropId) =>
                                allocMut.upsert.mutate({
                                  crop_year: cropYear,
                                  bin_id: bin.id,
                                  crop_id: cropId || null,
                                  field_id: a.field_id,
                                })
                              }
                              options={[
                                { value: '', label: 'which crop?' },
                                ...on.map((id) => ({ value: id, label: cropOnField(id, a.field_id) })),
                              ]}
                            />
                          ) : (
                            <>{cropOnField(a.crop_id, a.field_id) || '—'}</>
                          )
                        })()}
                      </td>
                      {/* What is actually in it, and a way to put more in. The
                          figure is a view over grain_movements, so there is
                          nothing to set here — only history to add to. */}
                      <td className="px-3 py-2 text-right">
                        <span className="tabular-nums">
                          {(() => {
                            const held = (onHand ?? [])
                              .filter((o) => o.bin_id === bin.id)
                              .reduce((sum, o) => sum + o.onhand_bu, 0)
                            if (held > 0) return `${Math.round(held).toLocaleString()} bu`
                            // What somebody recorded is better than what the
                            // ledger can prove: nobody augers a bin in through
                            // a movements screen, and a bin known to be holding
                            // last year's durum must not read "empty".
                            const c = contentByBin.get(bin.id)
                            if (c) {
                              return emptying?.id === c.id ? (
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs text-gray-500">emptied on</span>
                                  <DateField
                                    value={emptying.on}
                                    onChange={(v) => setEmptying({ id: c.id, on: v })}
                                    className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-900"
                                  />
                                  <button
                                    onClick={() =>
                                      emptyBin.mutate(
                                        { id: c.id, on: emptying.on || undefined },
                                        { onSuccess: () => setEmptying(null) },
                                      )
                                    }
                                    disabled={emptyBin.isPending}
                                    className="rounded-md bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
                                  >
                                    It is empty
                                  </button>
                                  <button
                                    onClick={() => setEmptying(null)}
                                    className="text-xs text-gray-500 underline"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      isCarryOver(c, cropYear) && 'font-medium text-amber-800',
                                    )}
                                    title={c.note ?? undefined}
                                  >
                                    {contentLabel(c)}
                                  </span>
                                  {isManager && !isPast && (
                                    <button
                                      onClick={() =>
                                        setEmptying({ id: c.id, on: new Date().toISOString().slice(0, 10) })
                                      }
                                      title="It has been hauled out — say when, and the bin is free from that day"
                                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                                    >
                                      Emptied
                                    </button>
                                  )}
                                </span>
                              )
                            }
                            return <span className="text-gray-300">empty</span>
                          })()}
                        </span>
                        {isManager && !isPast && (
                          <>
                            {!contentByBin.get(bin.id) &&
                              !(onHand ?? []).some((o) => o.bin_id === bin.id && o.onhand_bu > 0) && (
                                <button
                                  onClick={() => setRecordFor(bin)}
                                  title="Write down what is already in this bin — last year's grain, say"
                                  className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                                >
                                  Record
                                </button>
                              )}
                            <button
                              onClick={() => setLoadsFor(bin)}
                              title="Weigh a truck in off the scale — full and empty in kg — and see every load into this bin"
                              className="ml-2 rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-100"
                            >
                              Weigh in
                            </button>
                            <button
                              onClick={() => setAddingTo(bin)}
                              className="ml-2 rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            >
                              Add
                            </button>
                            {(onHand ?? []).some(
                              (o) => o.bin_id === bin.id && o.onhand_bu > 0,
                            ) && (
                              <button
                                onClick={() => setMovingFrom(bin)}
                                className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                              >
                                Move
                              </button>
                            )}
                          </>
                        )}
                      </td>
                      {isManager && !isPast && (
                        <td className="px-1 text-center">
                          <button
                            onClick={() => {
                              if (confirm(`Delete bin “${bin.name}”?`)) binMut.remove.mutate(bin.id)
                            }}
                            className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Delete ${bin.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {(bins ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                      No bins yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {showFields && (
        <Modal
          title={`${showFields.crop.name} — ${showFields.fieldCount} fields`}
          onClose={() => setShowFields(null)}
        >
          <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto text-sm">
            {showFields.fieldIds.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 py-1.5">
                <Link
                  to={`/fields/${id}`}
                  onClick={() => setShowFields(null)}
                  className="min-w-0 truncate font-medium text-brand-700 hover:underline"
                >
                  {fieldName(id) || 'Unnamed field'}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {acresByField.has(id)
                    ? `${Math.round(acresByField.get(id)!).toLocaleString()} ac`
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">
            {Math.round(
              showFields.fieldIds.reduce((sum, id) => sum + (acresByField.get(id) ?? 0), 0),
            ).toLocaleString()}{' '}
            acres in {cropYear}.{' '}
            <Link
              to={`/plan?tab=plan&crop=${showFields.crop.id}`}
              onClick={() => setShowFields(null)}
              className="text-brand-700 hover:underline"
            >
              Edit yields in the plan
            </Link>
          </p>
        </Modal>
      )}
      {tab === 'bins' && (
        <div className="mt-4 max-w-2xl">
          <BushelCalculator />
        </div>
      )}

      {recordFor && (
        <RecordContentsDialog
          bin={recordFor}
          crops={crops ?? []}
          cropYear={cropYear}
          onClose={() => setRecordFor(null)}
        />
      )}

      {movingFrom && (
        <MoveGrain
          bins={bins ?? []}
          cropYear={cropYear}
          from={movingFrom}
          onClose={() => setMovingFrom(null)}
        />
      )}

      {askingWhichBin && <WeighInDialog cropYear={cropYear} onClose={clearWeigh} />}

      {detailFor && (
        <BinDetail
          bin={detailFor}
          cropYear={cropYear}
          canEdit={isManager && !isPast}
          onClose={() => setDetailFor(null)}
          onWeighIn={() => {
            setDetailFor(null)
            setLoadsFor(detailFor)
          }}
          onAdd={() => {
            setDetailFor(null)
            setAddingTo(detailFor)
          }}
          onMove={() => {
            setDetailFor(null)
            setMovingFrom(detailFor)
          }}
          onRecord={() => {
            setDetailFor(null)
            setRecordFor(detailFor)
          }}
        />
      )}

      {loadsFor && (
        <BinLoadsDialog
          binId={loadsFor.id}
          binName={loadsFor.name}
          cropYear={cropYear}
          defaultCropId={allocByBin.get(loadsFor.id)?.crop_id ?? null}
          canEdit={isManager}
          onClose={() => setLoadsFor(null)}
        />
      )}

      {addingTo && (
        <AddBushels
          binId={addingTo.id}
          binName={addingTo.name}
          cropYear={cropYear}
          defaultCropId={allocByBin.get(addingTo.id)?.crop_id ?? null}
          onClose={() => setAddingTo(null)}
        />
      )}
    </div>
  )
}
