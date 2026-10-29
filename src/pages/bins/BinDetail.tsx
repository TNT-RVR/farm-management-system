import { useMemo, useState } from 'react'
import { useBinYards } from '@/lib/bin-yards'
import { MoistureTestNote } from '@/pages/harvest/SampleCondition'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, FileText, Flag, PenLine, Scale, Thermometer } from 'lucide-react'
import { shipmentLabel } from '@/lib/bin-shipping'
import { MoveMenu } from '@/pages/bins/MoveMenu'
import { Modal } from '@/components/Modal'
import { Fold } from '@/components/Fold'
import { supabase } from '@/lib/supabase'
import { useCrops, useFields } from '@/lib/queries'
import { useBinAllocations, useBinFieldsIn, useBinOnHand, useBins, useEstimatedByBin, type BinRow } from '@/lib/bins'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useDismissBinAirAlert } from '@/lib/moisture-queries'
import { useBinContents, contentLabel, isCarryOver } from '@/lib/bin-contents'
import { isOpenLoad, loadInBin, testWeightFor, useBinLoads, useDeliverySites, weighTime } from '@/lib/bin-loads'
import { useBinProducts } from '@/lib/bins'
import { rowClick } from '@/components/RecordEditor'
import { GRAIN_MOVEMENT_TYPES, type GrainMovementRow } from '@/lib/inventory'
import { cropColour } from '@/lib/crop-colour'
import { applyVarietyToCrop, varietySettingFor } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import { cn } from '@/lib/utils'
import { BinDrawing } from './BinDrawing'
import { BinRunSwitches } from './BinRunSwitches'
import { SettingsButton } from '@/components/SettingsButton'
import { BinMonitoring } from './BinMonitoring'
import { BinEditForm, BinExportPanel } from './BinTools'
import { DeleteLoadButton, EditLoadDialog, FieldYieldNote } from './WeighIn'
import { currentFill } from '@/lib/bin-fill'
import { binEdits } from '@/lib/bin-edits'
import type { AuditRow } from '@/lib/reports/audit'
import { farmTz } from '@/lib/farm-context'
import { MovementDetail } from './MovementDetail'
import { MoistureTestDetail } from '@/pages/harvest/MoistureTestDetail'
import { TABLE_HEAD } from '@/lib/table-style'

const bu = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} bu`
const kg = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} kg`
/** Metric tonnes to two places: what the seed companies write on their forms. */
const tonnes = (v: number | string | null | undefined) =>
  v == null ? '—' : `${(Number(v) / 1000).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`
const KG_PER_LB = 0.45359237
/** "Oct 20, 11:34 a.m.", on the farm's clock. */
const changedWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: farmTz() })

/** Everything recorded against one bin, newest first where it is a history. */
function useBinHistory(binId: string) {
  return useQuery({
    queryKey: ['bin_detail', binId],
    queryFn: async () => {
      const [moves, tests, alerts, readings, edits, people] = await Promise.all([
        supabase.from('grain_movements').select('*').eq('bin_id', binId).order('moved_at').order('created_at'),
        supabase.from('moisture_tests').select('*').eq('bin_id', binId).order('tested_at', { ascending: false }).limit(20),
        supabase.from('bin_air_alerts').select('*').eq('bin_id', binId).is('dismissed_at', null).order('raised_at', { ascending: false }),
        supabase.from('bin_readings').select('*').eq('bin_id', binId).order('reading_at', { ascending: false }).limit(10),
        // Edits to its loads and movements: the audit log's changes and
        // deletions of rows that were, or are now, in this bin.
        supabase
          .from('audit_log')
          .select('changed_at, table_name, record_id, action, actor_id, old_values, new_values')
          .in('table_name', ['bin_loads', 'grain_movements'])
          .in('action', ['update', 'delete'])
          .or(
            `old_values->>bin_id.eq.${binId},new_values->>bin_id.eq.${binId},old_values->>overflow_bin_id.eq.${binId},new_values->>overflow_bin_id.eq.${binId}`,
          )
          .order('changed_at', { ascending: false })
          .limit(80),
        supabase.from('users').select('id, full_name'),
      ])
      for (const r of [moves, tests, alerts, readings]) if (r.error) throw r.error
      return {
        moves: (moves.data ?? []) as GrainMovementRow[],
        tests: tests.data ?? [],
        alerts: alerts.data ?? [],
        readings: readings.data ?? [],
        // The edits are a nicety: the bin still opens if they cannot be read.
        edits: (edits.error ? [] : (edits.data ?? [])) as unknown as AuditRow[],
        people: people.data ?? [],
      }
    },
    staleTime: 30_000,
  })
}

/**
 * One bin, all of it: how full, what with, which field it was given this
 * year, whether it needs air, every load into it and every bushel that moved.
 *
 * Opened by clicking a bin's row. The row keeps its own controls for the
 * quick jobs; this is for "what is going on with #21".
 */
export function BinDetail({
  bin,
  cropYear,
  canEdit,
  onClose,
  onWeighIn,
  onAdd,
  onMove,
  onShip,
  onRecord,
  extra,
  pinControls,
}: {
  bin: BinRow
  cropYear: number
  canEdit: boolean
  onClose: () => void
  onWeighIn: () => void
  /** Something that did not come off a field: bought seed, fertilizer, carry-over. */
  onAdd: () => void
  onMove: () => void
  /** Ship all or some of it out: to a plant or elevator, or picked up at the yard. */
  onShip: () => void
  onRecord: () => void
  /** More buttons from where it was opened — the bin map's "Show on map". */
  extra?: React.ReactNode
  /** The bin map's Move pin / Clear pin, shown in the Edit bin panel. */
  pinControls?: React.ReactNode
}) {
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const { data: onHand } = useBinOnHand()
  const { data: contents } = useBinContents()
  const { data: varietySettings } = useCropVarietySettings()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: fieldsIn } = useBinFieldsIn()
  const { data: estimates } = useEstimatedByBin()
  const { data: binProducts } = useBinProducts()
  const { data: loads } = useBinLoads(bin.id)
  const { data: history, isLoading } = useBinHistory(bin.id)
  const { data: allBins } = useBins()
  const { data: plants } = useDeliverySites()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const dismiss = useDismissBinAirAlert()
  const [panel, setPanel] = useState<'export' | 'edit' | null>(null)
  // Rows opened from the tables below (Sam, 7 Oct 2026), by id so what is
  // shown is the saved version after an edit.
  const [moveId, setMoveId] = useState<string | null>(null)
  // A change opened to read it in full: its time and its place in the list.
  const [editAt, setEditAt] = useState<string | null>(null)
  const [loadId, setLoadId] = useState<string | null>(null)
  const [testId, setTestId] = useState<string | null>(null)
  // The bin as saved now, so an edit shows without reopening the pop-up.
  const current = (allBins ?? []).find((b) => b.id === bin.id) ?? bin
  // The farm's yards, in their order (Bins page → Bin yards).
  const { data: yardList } = useBinYards()
  const sites = (yardList ?? []).map((y) => y.name)

  const cropName = (id: string | null | undefined) => (crops ?? []).find((c) => c.id === id)?.name ?? '—'
  const fieldName = (id: string | null | undefined) => (fields ?? []).find((f) => f.id === id)?.name ?? '—'
  /**
   * Kilograms in bushels of a crop, at the crop's own bushel weight (canola
   * 50 lb, wheat 60). The seed companies ask for kg and tonnes, not bushels (Sam,
   * 19 Oct 2026). Null when the crop has no bushel weight set.
   */
  const kgOf = (cropId: string | null | undefined, bushels: number) => {
    // The same bushel weight the loads were weighed in at: the crop's own, else the standard one.
    const lb = testWeightFor((crops ?? []).find((c) => c.id === cropId))
    return lb ? bushels * lb * KG_PER_LB : null
  }

  const held = (onHand ?? []).filter((o) => o.bin_id === bin.id && o.onhand_bu > 0)
  const heldTotal = held.reduce((s, o) => s + o.onhand_bu, 0)
  const heldKgs = held.map((o) => kgOf(o.crop_id, o.onhand_bu))
  const heldKgByCrop = heldKgs.some((k) => k == null) ? null : heldKgs.reduce((s: number, k) => s + (k ?? 0), 0)
  const content = (contents ?? []).find((c) => c.bin_id === bin.id) ?? null
  const products = binProducts?.get(bin.id) ?? []
  const cap = Number(bin.capacity_bu) || 0
  const fullPct = cap > 0 ? Math.min(100, (heldTotal / cap) * 100) : 0
  const alloc = (allocations ?? []).find((a) => a.bin_id === bin.id) ?? null
  // Where the grain in it actually came from, to hold against the plan.
  // What is in it now, lot by lot: grain leaves oldest first (bin-fill.ts),
  // so a field moved out (Moreau from #21) is no longer what it holds.
  const fill = currentFill(history?.moves ?? [])
  const fillFields = [...new Set(fill.map((l) => l.fieldId).filter((f): f is string => !!f))]
  /*
   * Kilograms of what is in it. Grain that crossed the scale keeps the weight
   * the scale gave it: every lot still in the bin is weighed at the bushel
   * weight ITS load was weighed at, and only grain with no load behind it
   * (moved from another bin, an adjustment) is converted at the crop's bushel
   * weight. Converting the lot as well made the header disagree with the
   * loads under it the moment Crop settings' bushel weight changed — #1 read
   * 111,279 kg over 103,860 kg of weighed corn, because grain corn was moved
   * from 56 to 60 lb a bushel after this crop was in the bin (Sam, 27 Oct
   * 2026).
   */
  const loadById = new Map((loads ?? []).map((l) => [l.id, l]))
  const lotKg = (lot: (typeof fill)[number]): number | null => {
    const load = lot.loadId ? loadById.get(lot.loadId) : null
    const share = load ? loadInBin(load, bin.id) : null
    if (share && share.bushels > 0.01) return (share.kg / share.bushels) * lot.bushels
    return kgOf(load?.crop_id ?? held[0]?.crop_id, lot.bushels)
  }
  const lotKgs = fill.map(lotKg)
  const fillBu = fill.reduce((sum, l) => sum + l.bushels, 0)
  // One rate for the bin, so the kilograms always divide back into the
  // bushels on the line above them.
  const weighedRate =
    fillBu > 0.5 && !lotKgs.some((k) => k == null) ? lotKgs.reduce((sum: number, k) => sum + (k ?? 0), 0) / fillBu : null
  const heldKg = weighedRate != null ? heldTotal * weighedRate : heldKgByCrop
  const from = heldTotal > 0 ? (fillFields.length ? fillFields : (fieldsIn?.get(bin.id) ?? [])) : []
  const offPlan = Boolean(alloc?.field_id && from.length > 0 && !from.includes(alloc.field_id))
  // The crop in the bin decides the moisture conversion: what is in it, else
  // what was recorded by hand, else what it was assigned this year.
  const heldCrop = (crops ?? []).find((c) => c.id === (held[0]?.crop_id ?? content?.crop_id ?? alloc?.crop_id)) ?? null
  // The recorded variety's own dry level (Crop settings), when the contents are that crop.
  const monitorCrop = heldCrop
    ? applyVarietyToCrop(heldCrop, content?.crop_id === heldCrop.id ? varietySettingFor(varietySettings, heldCrop.id, content.variety) : null)
    : null
  const waiting = (loads ?? []).filter(isOpenLoad)

  const binColour = held[0] ? cropColour((crops ?? []).find((c) => c.id === held[0].crop_id)) : '#cbd5e1'
  // The yard description is the only record of which bins are hoppers.
  const isHopper = /hopper/i.test(bin.notes_md ?? '')

  // The ledger with a running balance, shown newest first.
  const ledger = useMemo(() => {
    const rows = (history?.moves ?? []).map((m) => {
      const t = GRAIN_MOVEMENT_TYPES.find((x) => x.value === m.movement_type)
      const signed = m.movement_type === 'adjustment' ? Number(m.bushels) : (t?.inflow ? 1 : -1) * Number(m.bushels)
      // A shipment says where it went.
      const shipped = shipmentLabel(m, (id) => (plants ?? []).find((p) => p.id === id)?.name ?? null)
      return { m, label: shipped ?? t?.label ?? m.movement_type, signed }
    })
    const balances = rows.reduce<number[]>((acc, r) => [...acc, (acc[acc.length - 1] ?? 0) + r.signed], [])
    return rows.map((r, i) => ({ ...r, balance: balances[i] })).reverse()
  }, [history, plants])

  // The loads in what is in the bin now: the lots still in it, grain leaving
  // oldest first (bin-fill.ts). Earlier fields' loads are under Every movement.
  const fillLoadIds = new Set(fill.map((l) => l.loadId).filter((id): id is string => !!id))
  const finished = heldTotal > 0 ? (loads ?? []).filter((l) => !isOpenLoad(l) && fillLoadIds.has(l.id)) : []
  // A field whose last load is in it: what it yielded an acre (Sam, 20 Oct 2026).
  const doneFields = [...new Map(finished.filter((l) => l.last_from_field && l.field_id).map((l) => [l.field_id as string, l.crop_year])).entries()]

  // What was changed in its records, by whom (Sam, 20 Oct 2026).
  const edits = binEdits(history?.edits ?? [], bin.id, {
    field: (id) => fieldName(id),
    crop: (id) => cropName(id),
    bin: (id) => (allBins ?? []).find((b) => b.id === id)?.name ?? 'another bin',
    site: (id) => (plants ?? []).find((x) => x.id === id)?.name ?? 'a plant',
    person: (id) => (history?.people ?? []).find((x) => x.id === id)?.full_name ?? 'the app',
    movementType: (v) => GRAIN_MOVEMENT_TYPES.find((t) => t.value === v)?.label ?? v,
    inflow: (v) => GRAIN_MOVEMENT_TYPES.find((t) => t.value === v)?.inflow ?? false,
  })

  // The seed company's reports for what is in the bin, for the field it came from.
  const reportField = from[0] ?? alloc?.field_id ?? null
  const reportYear = finished[0]?.crop_year ?? content?.crop_year ?? cropYear
  const reportQuery = `${reportField ? `field=${encodeURIComponent(reportField)}&` : ''}year=${reportYear}`
  const reports: { to: string; label: string }[] = []
  // Seed grown for any other company (24 Oct 2026): the generic forms. Seed
  // is a seed-category crop, or a variety written "Specialty - <company>".
  if (!reports.length && (heldCrop?.category === 'seed' || /specialty/i.test(content?.variety ?? '')))
    reports.push(
      { to: `/harvest-reports?tab=seed-report&${reportQuery}`, label: 'Seed production report' },
      { to: `/reports?open=bin-temperature-record&bin=${encodeURIComponent(bin.id)}&year=${reportYear}`, label: 'Bin temperature monitoring record' },
    )

  return (
    <Modal title={current.name} onClose={onClose} wide="xl">
      <div className="space-y-4 text-sm">
        {/* How full, with what */}
        <div className="flex flex-wrap items-center gap-4">
          <BinDrawing
            capacityBu={cap}
            fillBu={heldTotal}
            colour={binColour}
            label={heldTotal > 0 ? cropName(held[0]?.crop_id) : null}
            hopper={isHopper}
            className="h-36 w-24 shrink-0"
          />
          <div className="min-w-0 flex-1 basis-48">
            {/* The unit follows what is in it (Sam, 26 Oct 2026): bushels
                for a crop, tonnes for fertilizer. Never the two added up. */}
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {heldTotal > 0
                ? bu(heldTotal)
                : products.length
                  ? `${products.reduce((s, p) => s + p.tonnes, 0).toLocaleString('en-CA', { maximumFractionDigits: 2 })} t`
                  : content
                    ? contentLabel(content)
                    : 'Empty'}
            </p>
            {products.length > 0 && (
              <p className="text-sm text-gray-700">{products.map((p) => `${p.product} ${p.tonnes.toLocaleString('en-CA', { maximumFractionDigits: 2 })} t`).join(' · ')}</p>
            )}
            <p className="text-xs text-gray-500">
              of {bu(cap)} ·{' '}
              {cap > 0 && heldTotal > cap + 0.5 ? (
                // Said to have all gone in, over its max (Sam, 20 Oct 2026).
                <span className="font-semibold text-red-700">{`${Math.round((heldTotal / cap) * 100)}% full, ${bu(heldTotal - cap)} over its max`}</span>
              ) : cap > 0 && heldTotal > 0 ? (
                `${Math.round(fullPct)}% full, room for ${bu(Math.max(0, cap - heldTotal))}`
              ) : (
                'capacity'
              )}
              {bin.site ? ` · ${bin.site}` : ''}
              {bin.usual_contents === 'fertilizer' ? ' · fertilizer bin' : ''}
            </p>
            {heldTotal > 0 && heldKg != null && (
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-800">
                {kg(heldKg)} · {tonnes(heldKg)}
              </p>
            )}
            {heldTotal > 0 && heldKg == null && (
              <p className="mt-0.5 text-xs text-gray-500">Kilograms need this crop's bushel weight, set on the Crops page.</p>
            )}
            {held.length > 1 && (
              <p className="mt-0.5 text-xs text-gray-600">
                {held
                  .map((h) => {
                    const k = kgOf(h.crop_id, h.onhand_bu)
                    return `${cropName(h.crop_id)} ${bu(h.onhand_bu)}${k != null ? ` (${kg(k)})` : ''}`
                  })
                  .join(' · ')}
              </p>
            )}
            {heldTotal > 0 && held.length === 1 && <p className="mt-0.5 text-xs text-gray-700">{cropName(held[0].crop_id)} in it</p>}
            {/* The same switches as the bin list, on the same bin: both read
                one cache, so one follows the other (Sam, 27 Oct 2026). */}
            <BinRunSwitches bin={current} canEdit={canEdit} className="mt-1" />
            {from.length > 0 && <p className="mt-0.5 text-xs text-gray-700">From {from.map((id) => fieldName(id)).join(', ')}</p>}
            {heldTotal > 0 && (estimates?.get(bin.id) ?? 0) > 0 && (
              <p className="mt-0.5 text-xs font-medium text-amber-800">
                Includes about {bu(Math.min(heldTotal, estimates!.get(bin.id)!))} estimated, not weighed.
              </p>
            )}
            {offPlan && <p className="mt-0.5 text-xs font-medium text-amber-700">Not the field it was planned for.</p>}
            {heldTotal <= 0 && content && isCarryOver(content, cropYear) && (
              <p className="mt-0.5 text-xs text-amber-800">Carry-over from {content.crop_year}, recorded by hand.</p>
            )}
          </div>
          {canEdit && (
            <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
              <button type="button" onClick={onWeighIn} className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">
                <Scale className="h-3.5 w-3.5" /> Weigh in
              </button>
              <MoveMenu held={heldTotal > 0} onAdd={onAdd} onMove={onMove} onShip={onShip} />
              {heldTotal <= 0 && !content && (
                <button type="button" onClick={onRecord} className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 hover:bg-amber-100">
                  <PenLine className="h-3.5 w-3.5" /> Record
                </button>
              )}
            </div>
          )}
          {extra && <div className="flex w-full flex-wrap gap-1.5">{extra}</div>}
          {/* Beside Weigh in and Move rather than alone on a line of their
              own, which left most of a row empty (Sam, 27 Oct 2026). */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPanel(panel === 'export' ? null : 'export')}
              className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            {isManager && (
              <SettingsButton
                iconOnly
                label="Bin settings"
                open={panel === 'edit'}
                onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
              />
            )}
          </div>
        </div>

        {panel === 'export' && <BinExportPanel bin={current} onDone={() => setPanel(null)} />}
        {panel === 'edit' && isManager && (
          <div className="space-y-2">
            <BinEditForm bin={current} sites={sites} onDone={() => setPanel(null)} onDeleted={onClose} />
            {pinControls && <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">{pinControls}</div>}
          </div>
        )}

        {/* The seed company's reports for what is in it (Sam, 20 Oct 2026). */}
        {reports.length > 0 && (
          <Section title="Reports">
            <ul className="flex flex-wrap gap-1.5">
              {reports.map((r) => (
                <li key={r.to}>
                  <Link
                    to={r.to}
                    onClick={onClose}
                    className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <FileText className="h-3.5 w-3.5 text-gray-400" /> {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Needs air */}
        {(history?.alerts ?? []).length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {(history?.alerts ?? []).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Went in {a.grade ?? ''} at {Number(a.moisture_pct).toFixed(1)}% on{' '}
                {a.raised_at.slice(0, 10)} — needs air.
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Air put on' })}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] hover:bg-red-100"
                  >
                    Air is on it
                  </button>
                  <button
                    type="button"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate({ id: a.id, note: 'Dismissed without air' })}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] hover:bg-red-100"
                  >
                    Dismiss — no air needed
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* The plan for the year, boxed apart from what is in the bin above
            (Sam, 8 Oct 2026): a bin marked for a field read as holding it. */}
        {/* Only until grain goes in (Sam, 20 Oct 2026): from then, what is
            in the bin is all that matters. */}
        {heldTotal <= 0 && (
          <Section title={`Plan for ${cropYear}`}>
            {alloc?.field_id ? (
              <div className="rounded-md border border-dashed border-sky-300 bg-sky-50 px-3 py-2">
                <p className="flex flex-wrap items-center gap-1.5 italic text-gray-700">
                  <span className="not-italic text-xs font-semibold uppercase tracking-wide text-sky-800">Planned</span>
                  {alloc.crop_id && (
                    <span
                      className="h-2.5 w-2.5 rounded-full border-2 bg-white"
                      style={{ borderColor: cropColour((crops ?? []).find((c) => c.id === alloc.crop_id)) }}
                    />
                  )}
                  <Link to={`/fields/${alloc.field_id}/history`} onClick={onClose} className="font-medium text-brand-700 hover:underline">
                    {fieldName(alloc.field_id)}
                  </Link>
                  <span>· {cropName(alloc.crop_id)}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">Nothing from it is in the bin yet.</p>
              </div>
            ) : (
              <p className="text-gray-400">No plan for this bin this year.</p>
            )}
          </Section>
        )}

        {/* Sensor cable readings, and BASF's canola report. "Latest
            readings" was a section of its own above this, a second sensor
            heading over the one below; the last reading entered on the
            Integrations page (bin_readings) is one line now instead. */}
        {(history?.readings ?? []).length > 0 && (
          <p className="-mb-2 flex items-center gap-1.5 text-xs text-gray-600">
            <Thermometer className="h-3.5 w-3.5 text-gray-400" />
            {(() => {
              const r = history!.readings[0]
              return `Last sensor reading: ${r.temp_c != null ? `${Number(r.temp_c).toFixed(1)} °C` : ''}${r.moisture_pct != null ? ` · ${Number(r.moisture_pct).toFixed(1)}% moisture` : ''} · ${new Date(r.reading_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`
            })()}
          </p>
        )}
        <BinMonitoring
          binId={bin.id}
          binName={bin.name}
          cropYear={cropYear}
          crop={monitorCrop}
          heldBu={heldTotal}
          capacityBu={cap}
          lldDefault={(fields ?? []).find((f) => f.id === alloc?.field_id)?.legal_land_description ?? null}
          canEdit={canEdit}
        />

        {/* Moisture of what went in */}
        {(history?.tests ?? []).length > 0 && (
          <Section title="Moisture tests">
            <Table head={['When', 'Field', 'Moisture', 'Grade', 'Sample / note']}>
              {history!.tests.map((t) => (
                <tr key={t.id} onClick={rowClick(() => setTestId(t.id))} className="cursor-pointer hover:bg-gray-50">
                  <Td>{t.tested_at.slice(0, 10)}</Td>
                  <Td>{fieldName(t.field_id)}</Td>
                  <Td num>{t.moisture_pct != null ? `${Number(t.moisture_pct).toFixed(1)}%` : '—'}</Td>
                  <Td>{t.grade ?? '—'}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <MoistureTestNote test={t} />
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>
        )}

        {/*
          One list, not two (Sam, 27 Oct 2026): "Loads weighed in" and
          "Every movement" were the same grain written out twice. Every
          movement is here, newest first, and the rows that are loads carry
          what only a load knows — the weight off the scale, who drove it, the
          field's last load — and open the load when clicked.
        */}
        <Section title={`Movements (${ledger.length})`}>
          {waiting.length > 0 && (
            <p className="mb-1 text-xs text-amber-800">
              {waiting.length} load{waiting.length === 1 ? '' : 's'} waiting for a second weight.
            </p>
          )}
          {isLoading ? (
            <p className="text-gray-400">Loading…</p>
          ) : ledger.length === 0 ? (
            <p className="text-gray-400">Nothing has moved in or out of this bin yet.</p>
          ) : (
            <div className={cn(ledger.length > 12 && 'max-h-96 overflow-y-auto')}>
              <Table head={['Date', 'What', 'Field', 'Crop', 'Bushels', 'Kg', 'Driver', 'Balance', ...(canEdit ? [''] : [])]}>
                {ledger.map(({ m, label, signed, balance }) => {
                  const load = m.ticket_number?.startsWith('load:') ? loadById.get(m.ticket_number.slice(5)) : undefined
                  const share = load ? loadInBin(load, bin.id) : null
                  return (
                    <tr
                      key={m.id}
                      title={load ? 'Open the load to see or correct it' : (m.notes ?? undefined)}
                      onClick={rowClick(() => (load && canEdit ? setLoadId(load.id) : setMoveId(m.id)))}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <Td>
                        {m.moved_at}
                        {load?.full_at && (
                          <span className="block text-[10px] text-gray-500">
                            in {weighTime(load.full_at, false)}
                            {load.empty_at ? ` · out ${weighTime(load.empty_at, false)}` : ''}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {label}
                        {load?.last_from_field && (
                          <Flag className="ml-1 inline h-3 w-3 text-green-700" fill="currentColor" aria-label="Last load from the field" />
                        )}
                      </Td>
                      <Td>{m.field_id ? fieldName(m.field_id) : '—'}</Td>
                      <Td>{cropName(m.crop_id)}</Td>
                      <Td num className={signed >= 0 ? 'text-green-800' : 'text-red-700'}>
                        {signed >= 0 ? '+' : '−'}
                        {Math.round(Math.abs(signed)).toLocaleString('en-CA')}
                        {/* A load that filled this bin and went on into another (Sam, 20 Oct 2026). */}
                        {load?.overflow_bin_id && share && (
                          <span className="block text-[10px] font-normal text-gray-500">
                            {share.part === 'first'
                              ? `of ${bu(load.bushels)}; rest to ${(allBins ?? []).find((b) => b.id === load.overflow_bin_id)?.name ?? 'another bin'}`
                              : `of ${bu(load.bushels)}; after ${(allBins ?? []).find((b) => b.id === load.bin_id)?.name ?? 'another bin'} filled`}
                          </span>
                        )}
                      </Td>
                      <Td num>{share ? kg(share.kg) : '—'}</Td>
                      <Td>{load?.driver ?? '—'}</Td>
                      <Td num strong>
                        {Math.round(balance).toLocaleString('en-CA')}
                      </Td>
                      {canEdit && <td className="px-1 py-1 text-right">{load && <DeleteLoadButton load={load} />}</td>}
                    </tr>
                  )
                })}
              </Table>
            </div>
          )}

          {/* What is in it now came over the scale in these loads. By field,
              weighed: what a seed company asks for its own canola in this bin.
              With one field that list only says the line above it again. */}
          {finished.length > 0 && (
            <div className="mt-1.5 text-xs text-gray-700">
              <p className="text-right text-gray-500">
                In it now, over {finished.length} load{finished.length === 1 ? '' : 's'}:{' '}
                {bu(finished.reduce((sum, l) => sum + loadInBin(l, bin.id).bushels, 0))} ·{' '}
                {kg(finished.reduce((sum, l) => sum + loadInBin(l, bin.id).kg, 0))} ·{' '}
                {tonnes(finished.reduce((sum, l) => sum + loadInBin(l, bin.id).kg, 0))}
              </p>
              {[...new Set(finished.map((l) => l.field_id))].length > 1 && (
                <ul className="mt-0.5 space-y-0.5">
                  {[...new Set(finished.map((l) => l.field_id))].map((fid) => {
                    const mine = finished.filter((l) => l.field_id === fid)
                    const net = mine.reduce((sum, l) => sum + loadInBin(l, bin.id).kg, 0)
                    const bus = mine.reduce((sum, l) => sum + loadInBin(l, bin.id).bushels, 0)
                    return (
                      <li key={fid ?? 'none'} className="flex flex-wrap justify-between gap-x-3">
                        <span>
                          {fid ? fieldName(fid) : 'No field'} · {mine.length} load{mine.length === 1 ? '' : 's'}
                        </span>
                        <span className="tabular-nums">
                          {bu(bus)} · <b>{kg(net)}</b> · {tonnes(net)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {doneFields.map(([fid, year]) => (
            <div key={fid} className="mt-2">
              <FieldYieldNote fieldId={fid} cropYear={year} />
            </div>
          ))}

          {edits.length > 0 && (
            <Fold
              title="Changes to records"
              summary={`${edits.length} edit${edits.length === 1 ? '' : 's'}`}
              storageKey="bin-detail-edits"
              className="mt-2 text-sm"
            >
              {/* What was changed, on what grain — the crop and the bushels,
                  so a row says something on its own (Sam, 27 Oct 2026). Who
                  did it and the old and new figures are a click away rather
                  than three repeated lines wide. */}
              <div className={cn(edits.length > 8 && 'max-h-72 overflow-y-auto')}>
                <Table head={['Changed', 'Record', 'Crop', 'Bushels', 'What']}>
                  {edits.map((e, i) => (
                    <tr
                      key={`${e.at}:${i}`}
                      onClick={rowClick(() => setEditAt(`${e.at}:${i}`))}
                      title="Open the change"
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <Td>{changedWhen(e.at)}</Td>
                      <Td>
                        {e.what}
                        {e.on && <span className="block text-[10px] text-gray-400">{e.on}</span>}
                      </Td>
                      <Td>{e.crop ?? '—'}</Td>
                      <Td num className={e.direction === 'out' ? 'text-red-700' : 'text-green-800'}>
                        {e.bushels == null ? '—' : `${e.direction === 'out' ? '−' : '+'}${Math.round(e.bushels).toLocaleString('en-CA')}`}
                      </Td>
                      <Td>
                        <span className="block max-w-56 truncate text-gray-600">{e.fields.join(', ')}</span>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Fold>
          )}
        </Section>

        {bin.notes_md && (
          <Section title="Notes">
            <p className="whitespace-pre-wrap text-gray-700">{bin.notes_md}</p>
          </Section>
        )}
      </div>

      {(() => {
        const row = ledger.find((r) => r.m.id === moveId)
        return row ? (
          <MovementDetail
            m={row.m}
            label={row.label}
            signed={row.signed}
            balance={row.balance}
            isManager={isManager}
            onOpenLoad={(id) => {
              if (!(loads ?? []).some((l) => l.id === id)) return
              setMoveId(null)
              setLoadId(id)
            }}
            onClose={() => setMoveId(null)}
          />
        ) : null
      })()}
      {(() => {
        const l = (loads ?? []).find((x) => x.id === loadId)
        return l ? <EditLoadDialog load={l} onClose={() => setLoadId(null)} /> : null
      })()}
      {(() => {
        const t = (history?.tests ?? []).find((x) => x.id === testId)
        return t ? <MoistureTestDetail test={t} onClose={() => setTestId(null)} /> : null
      })()}
      {(() => {
        const e = edits.find((x, i) => `${x.at}:${i}` === editAt)
        if (!e) return null
        return (
          <Modal title={e.what} onClose={() => setEditAt(null)}>
            <div className="space-y-2 text-sm">
              <p className="text-xs text-gray-500">
                Changed {changedWhen(e.at)} by {e.who}
                {e.on ? ` · the record is dated ${e.on}` : ''}
              </p>
              {(e.crop || e.bushels != null) && (
                <p className="text-gray-700">
                  {[e.crop, e.bushels == null ? null : `${Math.round(e.bushels).toLocaleString('en-CA')} bu ${e.direction === 'out' ? 'out of' : 'into'} this bin`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <ul className="space-y-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-gray-800">
                {e.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          </Modal>
        )
      })()}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-gray-200">
      <table className="w-full text-xs">
        <thead className={cn(TABLE_HEAD, 'sticky top-0')}>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cn('px-2 py-1 font-medium', i >= 2 && (h === 'Net' || h === 'Bushels' || h === 'Balance' || h === 'Moisture') && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, num, strong, className }: { children: React.ReactNode; num?: boolean; strong?: boolean; className?: string }) {
  return (
    <td className={cn('px-2 py-1 text-gray-700', num && 'text-right tabular-nums', strong && 'font-semibold text-gray-900', className)}>{children}</td>
  )
}
