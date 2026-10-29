import { useMemo, useState } from 'react'
import { cropColour } from '@/lib/crop-colour'
import { useBinProducts } from '@/lib/bins'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useTab } from '@/lib/useTab'
import { useSearchParams } from 'react-router-dom'
import { AddToBin } from '@/pages/bins/AddToBin'
import { BinLoadsDialog } from '@/pages/bins/BinLoads'
import { BinDetail } from '@/pages/bins/BinDetail'
import { WeighInDialog } from '@/pages/bins/WeighIn'
import { MoveGrain } from '@/pages/bins/MoveGrain'
import { ShipOut } from '@/pages/bins/ShipOut'
import { MoveMenu } from '@/pages/bins/MoveMenu'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { BinAirAlerts } from '@/components/BinAirAlerts'
import { PillTabs } from '@/components/PillTabs'
import { HelpNote } from '@/components/HelpNote'
import { BinMap } from '@/pages/bins/BinMap'
import { BinRunSwitches } from '@/pages/bins/BinRunSwitches'
import { RecordContentsDialog } from '@/pages/bins/BinContents'
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
  useAllocationMutations,
  useBinAllocations,
  type BinEstimateLine, useBinFieldsIn, useBinOnHand, useEstimatedByBin, type BinRow } from '@/lib/bins'
import { useBinEstimate } from '@/lib/bin-estimate'
import { cn } from '@/lib/utils'
import { useAllCropZones } from '@/lib/cropZones'
import { Modal } from '@/components/Modal'

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
  const { data: contents } = useBinContents()
  // The bin whose contents are being written down from its own row.
  const [recordFor, setRecordFor] = useState<BinRow | null>(null)
  // Closing out what was in a bin, from its row: which content row, and the day.
  const emptyBin = useEmptyBin()
  const [emptying, setEmptying] = useState<{ id: string; on: string } | null>(null)
  const { data: varieties } = useCropVarieties()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: zones } = useAllCropZones()
  const allocMut = useAllocationMutations(cropYear)
  const [showFields, setShowFields] = useState<BinEstimateLine | null>(null)
  const { data: onHand } = useBinOnHand()
  const { data: fieldsIn } = useBinFieldsIn()

  /**
   * The estimate, the bins it counts and the room they have left. Bins in a
   * hidden yard (Creek Yard here) are already out of it: counting bins
   * nobody fills as available storage is the difference between "covered" and
   * "short two bins", and the wrong answer is the reassuring one. A yard is
   * shown or hidden in Bin settings (the ⚙ on Harvest).
   */
  const { lines, bins, room, shortBins } = useBinEstimate(cropYear)
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
  const [shippingFrom, setShippingFrom] = useState<BinRow | null>(null)
  // The bin opened in full, from a click on its row.
  const [detailFor, setDetailFor] = useState<BinRow | null>(null)
  const { data: estimates } = useEstimatedByBin()
  const { data: binProducts } = useBinProducts()
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
              { key: 'bins', label: 'Bins & plan' },
              { key: 'map', label: 'Map' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      )}

      {/* On a phone the Map tab gives the screen to the map; the totals are on the other tabs. */}
      {/* Active bins and total capacity are in Bin settings (the ⚙ on Harvest; Sam, 22 Oct 2026). */}
      {/* Unallocated and bins short: the estimator's figures, on its tab only (Sam, 23 Oct 2026). */}
      {tab === 'estimator' && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">Room left</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
              {Math.round(room.roomBu).toLocaleString()} bu
            </p>
            <p className="text-[11px] leading-tight text-gray-500">
              {room.emptyBins} bin{room.emptyBins === 1 ? '' : 's'} empty
              {room.inUseRoomBu > 0.5 && (
                <>
                  {', and '}
                  {Math.round(room.inUseRoomBu).toLocaleString()} bu spare over the grain in {room.partBins} more
                </>
              )}
            </p>
          </div>
          <div
            className={cn(
              'rounded-lg border p-3',
              shortBins > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white',
            )}
          >
            <p className="text-xs text-gray-500">Bins short</p>
            <p className={cn('mt-0.5 text-lg font-bold tabular-nums', shortBins > 0 ? 'text-red-700' : 'text-gray-900')}>
              {shortBins}
            </p>
            <p className="text-[11px] leading-tight text-gray-500">
              {shortBins > 0 ? 'for the crop still in the field' : 'everything still out has somewhere to go'}
            </p>
          </div>
        </div>
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
          actions={{ weighIn: setLoadsFor, add: setAddingTo, move: setMovingFrom, ship: setShippingFrom, record: setRecordFor }}
        />
      ) : tab === 'estimator' ? (
        <div className="space-y-2">
          {/* One line, with the whole of it behind ⓘ: the page used to carry
              an intro and a footer both saying where the settings were. */}
          <HelpNote
            summary={
              <>
                Which crops need a bin, how they are kept apart and how much of each to store are in{' '}
                <b>Bin settings</b> (the ⚙ above); the yields behind the figures are on the{' '}
                <Link to="/plan?tab=plan" className="text-brand-700 hover:underline">
                  crop plan
                </Link>
                .
              </>
            }
            title="What is set where"
          >
            <p>
              This page is the readout: for each crop, what it is expected to make, how much of it is
              already in a bin, and whether the bins set aside for it hold the rest.
            </p>
            <p>
              Whether a crop is binned at all, its bin policy (mixable / keep fields apart / keep
              varieties apart) and the bushels of it to store this year are all set in Bin settings,
              from the ⚙ at the top of this page. Test weight is on the Crops page.
            </p>
            <p>
              Room counts the empty part of a bin that already has grain in it, so a yard that is
              half full reads as half full rather than as the few bins nobody has claimed.
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
                {showNotBinned ? 'Hide them' : 'Show them'}
              </button>
            </p>
          )}
          {/* A card a crop, not a row in an eight-column table (Sam, 27 Oct
              2026: "make it fit well on a mobile phone"). What the page is for
              is the one sentence at the top of each card: enough room, or how
              much short. The tick, the policy and the bushels to store were
              settings sitting in the middle of the readout and are in Bin
              settings now. */}
          <ul className="space-y-2">
            {shownLines.map((l) => {
              const short = (l.shortfallBins ?? 0) > 0 || (l.shortfallBu ?? 0) > 0
              const allIn = l.needsBins && l.toComeBu != null && l.toComeBu <= 0.5 && l.binnedBu > 0.5
              const colour = cropColour(l.crop)
              const pct =
                l.productionBu != null && l.productionBu > 0
                  ? Math.min(100, (l.binnedBu / l.productionBu) * 100)
                  : l.binnedBu > 0
                    ? 100
                    : 0
              return (
                <li
                  key={l.crop.id}
                  className={cn(
                    'rounded-lg border p-3',
                    short ? 'border-red-300 bg-white' : 'border-gray-200 bg-white',
                    !l.needsBins && 'border-gray-200 bg-gray-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('min-w-0 font-semibold', l.needsBins ? 'text-gray-900' : 'text-gray-500')}>
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
                    </p>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        !l.needsBins
                          ? 'bg-gray-200 text-gray-600'
                          : short
                            ? 'bg-red-100 text-red-800'
                            : allIn
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-green-100 text-green-800',
                      )}
                    >
                      {!l.needsBins ? (
                        'Not binned'
                      ) : short ? (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {(l.shortfallBins ?? 0) > 0
                            ? `Short ${l.shortfallBins} bin${l.shortfallBins === 1 ? '' : 's'}`
                            : `Short ${Math.round(l.shortfallBu ?? 0).toLocaleString()} bu`}
                        </span>
                      ) : allIn ? (
                        'All in'
                      ) : (
                        'Covered'
                      )}
                    </span>
                  </div>

                  {/* How much of it is away already, in the crop's colour. */}
                  {l.needsBins && (l.productionBu ?? 0) > 0 && (
                    <div
                      className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"
                      title={`${Math.round(l.binnedBu).toLocaleString()} bu of ${Math.round(l.productionBu ?? 0).toLocaleString()} bu in the bins`}
                    >
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
                    </div>
                  )}

                  <p className={cn('mt-1.5 text-xs', short ? 'font-medium text-red-700' : 'text-gray-600')}>{l.summary}</p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                    {l.fieldCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowFields(l)}
                        className="rounded font-medium text-brand-700 underline-offset-2 hover:underline"
                        title="Which fields?"
                      >
                        {l.fieldCount} field{l.fieldCount === 1 ? '' : 's'}
                      </button>
                    )}
                    {/* Through to the plan, filtered to this crop, which is
                        where the per-field yields that make this number are set. */}
                    {l.estimatedBu != null && (
                      <Link
                        to={`/plan?tab=plan&crop=${l.crop.id}`}
                        className="underline-offset-2 hover:text-gray-800 hover:underline"
                        title="Open the crop plan to edit yields"
                      >
                        {Math.round(l.estimatedBu).toLocaleString()} bu expected
                        {l.estimatedLowBu != null && l.estimatedHighBu != null && (
                          <> ({Math.round(l.estimatedLowBu).toLocaleString()}–{Math.round(l.estimatedHighBu).toLocaleString()})</>
                        )}
                      </Link>
                    )}
                    {l.storedBu != null && <span>{Math.round(l.storedBu).toLocaleString()} bu of it binned by the plan</span>}
                    {l.needsBins && (
                      <span>
                        {l.allocatedBins} bin{l.allocatedBins === 1 ? '' : 's'} ·{' '}
                        {Math.round(l.allocatedCapacityBu).toLocaleString()} bu allocated
                      </span>
                    )}
                    {l.cutBu > 0 && (
                      <span
                        className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900"
                        title={l.cuts.map((c) => `${fieldName(c.fieldId) || 'A field'}: ${c.label}`).join('\n')}
                      >
                        −{Math.round(l.cutBu).toLocaleString()} bu cut
                      </span>
                    )}
                    {l.needsBins && l.policy !== 'mixable' && <span>{l.policy.replaceAll('_', ' ')}</span>}
                    {l.note && <span className="text-amber-800">{l.note}</span>}
                  </div>
                </li>
              )
            })}
            {lines.length === 0 && (
              <li className="rounded-lg border border-gray-200 bg-white px-3 py-8 text-center text-gray-400">
                No crop plans for {cropYear}, or no bins yet. Add bins and a plan to estimate.{' '}
                <SetupLink managerOnly to={SETUP_LINKS.cropPlan()}>Plan the crops</SetupLink>
              </li>
            )}
          </ul>
        </div>
      ) : (
        // Bins and the bin map as one view (Sam, 23 Oct 2026): the map on
        // the left and the list on the right; on a phone the map on top.
        <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:sticky lg:top-2 lg:self-start">
          <BinMap
            compact
            canEdit={isManager && !isPast}
            cropYear={cropYear}
            actions={{ weighIn: setLoadsFor, add: setAddingTo, move: setMovingFrom, ship: setShippingFrom, record: setRecordFor }}
          />
        </div>
        <div className="rounded-lg border border-gray-200 bg-white">
          {/* A card a bin (Sam, 23 Oct 2026): what is in it and how much,
              at a glance — a bar filled in the crop's colour, the bushels and
              where from. An empty bin shows its plan instead, marked as a plan,
              until grain goes in. A tap opens the bin for everything else. */}
          <ul className="max-h-[calc(100dvh-12rem)] divide-y divide-gray-100 overflow-y-auto">
            {(bins ?? []).map((bin) => {
              const a = allocByBin.get(bin.id)
              const held = (onHand ?? []).filter((o) => o.bin_id === bin.id).reduce((sum, o) => sum + o.onhand_bu, 0)
              const heldCrop = (onHand ?? []).find((o) => o.bin_id === bin.id && o.onhand_bu > 0)?.crop_id ?? null
              const from = fieldsIn?.get(bin.id) ?? []
              const est = estimates?.get(bin.id) ?? 0
              const c = contentByBin.get(bin.id)
              // Fertilizer is counted in tonnes, a crop in bushels (Sam, 26 Oct 2026).
              const products = binProducts?.get(bin.id) ?? []
              const cap = Math.round(bin.capacity_bu)
              const pct = cap > 0 ? (held / cap) * 100 : 0
              const over = cap > 0 && held > cap + 0.5
              const colour = cropColour((crops ?? []).find((x) => x.id === heldCrop))
              return (
                <li
                  key={bin.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input, select, [role=listbox], [role=option], [role=dialog]')) return
                    setDetailFor(bin)
                  }}
                  className="cursor-pointer px-3 py-2.5 hover:bg-gray-50 active:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="min-w-0 truncate font-semibold text-gray-900">{bin.name}</span>
                      {/* Grey until it is running: blue for the fan, red for the heat. */}
                      <BinRunSwitches bin={bin} canEdit={!isPast} />
                    </span>
                    {isManager && !isPast && (
                      <MoveMenu
                        held={held > 0}
                        className="shrink-0 py-1"
                        onAdd={() => setAddingTo(bin)}
                        onMove={() => setMovingFrom(bin)}
                        onShip={() => setShippingFrom(bin)}
                      />
                    )}
                  </div>

                  {held <= 0 && products.length > 0 ? (
                    <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                      <span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">In the bin </span>
                        {products.map((pr) => (
                          <span key={pr.product} className="mr-2">
                            <b className="tabular-nums text-gray-900">{pr.tonnes.toLocaleString('en-CA', { maximumFractionDigits: 2 })} t</b>{' '}
                            <span className="text-gray-900">{pr.product}</span>
                          </span>
                        ))}
                      </span>
                    </p>
                  ) : held > 0 ? (
                    <>
                      {/* How full, in the crop's colour; red over the top. */}
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: over ? '#dc2626' : colour }} />
                      </div>
                      <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                        <span>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">In the bin </span>
                          <b className="tabular-nums text-gray-900">
                            {est > 0 ? '~' : ''}
                            {Math.round(held).toLocaleString()} bu
                          </b>{' '}
                          <span className="text-gray-900">{cropName(heldCrop)}</span>
                          {from.length > 0 && <span className="text-gray-500"> · from {from.map((id) => fieldName(id) || 'a field').join(', ')}</span>}
                        </span>
                        <span className={cn('text-xs tabular-nums', over ? 'font-semibold text-red-700' : 'text-gray-500')}>
                          {over ? `${Math.round(held - cap).toLocaleString()} bu over ` : `${Math.round(pct)}% of `}
                          {cap.toLocaleString()} bu
                        </span>
                      </p>
                    </>
                  ) : c ? (
                    <p className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">In the bin </span>
                        <span className={cn(isCarryOver(c, cropYear) ? 'font-medium text-amber-800' : 'text-gray-900')}>{contentLabel(c)}</span>
                      </span>
                      {isManager && !isPast &&
                        (emptying?.id === c.id ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-gray-500">emptied on</span>
                            <DateField value={emptying.on} onChange={(v) => setEmptying({ id: c.id, on: v })} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-900" />
                            <button
                              type="button"
                              onClick={() => emptyBin.mutate({ id: c.id, on: emptying.on || undefined }, { onSuccess: () => setEmptying(null) })}
                              disabled={emptyBin.isPending}
                              className="rounded-md bg-brand-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              It is empty
                            </button>
                            <button type="button" onClick={() => setEmptying(null)} className="text-xs text-gray-500 underline">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEmptying({ id: c.id, on: new Date().toISOString().slice(0, 10) })}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            Emptied
                          </button>
                        ))}
                    </p>
                  ) : (
                    // Empty: the plan, plainly a plan (dashed, blue, says so).
                    <div className="mt-1.5 rounded-md border border-dashed border-sky-300 bg-sky-50/60 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">Plan · nothing in it yet</span>
                        <span className="ml-auto text-xs tabular-nums text-gray-500">empty · {cap.toLocaleString()} bu</span>
                      </div>
                      {isManager && !isPast ? (
                        <div className="mt-1 flex items-center gap-2">
                          <Select
                            value={a?.field_id ?? ''}
                            size="sm"
                            ariaLabel={`Plan for ${bin.name}`}
                            className="min-w-0 flex-1"
                            onChange={(fieldId) => {
                              if (!fieldId) {
                                allocMut.remove.mutate({ binId: bin.id })
                                return
                              }
                              const on = cropsOnField(fieldId)
                              allocMut.upsert.mutate({ crop_year: cropYear, bin_id: bin.id, crop_id: on.length === 1 ? on[0] : null, field_id: fieldId })
                            }}
                            options={[{ value: '', label: 'No plan' }, ...fieldsWithCrops.map((f) => ({ value: f.id, label: f.name }))]}
                          />
                          {a?.field_id && a.crop_id && <span className="shrink-0 text-xs italic text-sky-900">{cropOnField(a.crop_id, a.field_id)}</span>}
                        </div>
                      ) : (
                        <p className="mt-0.5 text-sm italic text-sky-900">
                          {a?.field_id ? `${fieldName(a.field_id)}${a.crop_id ? ` · ${cropOnField(a.crop_id, a.field_id)}` : ''}` : 'No plan'}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
            {(bins ?? []).length === 0 && <li className="px-3 py-8 text-center text-gray-400">No bins yet. Add them in Bin settings (the ⚙ above).</li>}
          </ul>
        </div>
        </div>
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
                {showFields.cuts
                  .filter((c) => c.fieldId === id)
                  .map((c, i) => (
                    <span key={`${c.label}-${i}`} className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                      {c.label}
                    </span>
                  ))}
                <span className="ml-auto shrink-0 text-xs tabular-nums text-gray-500">
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

      {shippingFrom && <ShipOut from={shippingFrom} cropYear={cropYear} onClose={() => setShippingFrom(null)} />}

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
          onShip={() => {
            setDetailFor(null)
            setShippingFrom(detailFor)
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
        <AddToBin
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
