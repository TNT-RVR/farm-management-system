import { useMemo, useState } from 'react'
import { ArrowRight, Check, Clock, Flag, Pencil, Plus, Scale, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { Select, type SelectOption } from '@/components/Select'
import { DateField } from '@/components/DateField'
import { useAuth } from '@/lib/auth'
import { useCrops, useCropPlans, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { byYardThenNumber, useBinAllocations, useBinOnHand, useBins } from '@/lib/bins'
import {
  KG_TO_LB,
  bushelsFromKg,
  fieldHarvestSoFar,
  isOpenLoad,
  lastTare,
  testWeightFor,
  useAddDeliverySite,
  useAddHaulUnit,
  useBinLoads,
  useDeleteBinLoad,
  useDeliverySites,
  useFarmPeople,
  useFieldYield,
  useHaulUnits,
  useSaveBinLoad,
  type BinLoad,
  type HaulKind,
} from '@/lib/bin-loads'
import { cn } from '@/lib/utils'
import { useContacts, useContracts, type ContractRow } from '@/lib/sales'

/** Every box that takes typing is white, so it reads as a box to fill. */
const box = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none'
const numBox = cn(box, 'text-right tabular-nums')
const label = 'text-xs text-gray-500'
const ADD = '__add'
/** Today on the farm's clock: after 6 pm in Alberta the UTC date is already tomorrow. */
const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const kg = (v: number | string | null | undefined) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} kg`)
const bu = (v: number | string | null | undefined) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} bu`)

type Form = {
  field_id: string
  crop_id: string
  bin_id: string
  loaded_on: string
  gross: string
  tare: string
  /** How the weight was given: full & empty, net off the truck, or a bin total. */
  kind: 'weighed' | 'net' | 'bin_total'
  netOnly: string
  loadCount: string
  lbOverride: string
  /** Optional moisture %, for dry-basis yields. */
  moisture: string
  /** Optional protein %, wheat and durum. */
  protein: string
  driver_id: string
  truck: string
  trailer: string
  note: string
  /** The last load off this field. */
  last: boolean
  /** Into a bin, or straight to a plant. */
  dest: 'bin' | 'plant'
  site_id: string
  /** Optional: the contract a plant load was delivered on. */
  contract_id: string
}

function formFrom(load: BinLoad | null | undefined, presetBinId: string | null | undefined, me: string | null): Form {
  return {
    field_id: load?.field_id ?? '',
    crop_id: load?.crop_id ?? '',
    bin_id: load?.bin_id ?? presetBinId ?? '',
    loaded_on: load?.loaded_on ?? today(),
    gross: load?.gross_kg != null ? String(Math.round(Number(load.gross_kg))) : '',
    tare: load?.tare_kg != null ? String(Math.round(Number(load.tare_kg))) : '',
    kind: load?.entry_kind ?? 'weighed',
    netOnly: load && load.entry_kind !== 'weighed' && load.net_kg != null ? String(Math.round(Number(load.net_kg))) : '',
    loadCount: load?.load_count != null ? String(load.load_count) : '',
    lbOverride: '',
    moisture: load?.moisture_pct != null ? String(load.moisture_pct) : '',
    protein: load?.protein_pct != null ? String(load.protein_pct) : '',
    driver_id: load?.driver_id ?? me ?? '',
    truck: load?.truck ?? '',
    trailer: load?.trailer ?? '',
    note: load?.note ?? '',
    last: load?.last_from_field ?? false,
    dest: load?.delivery_site_id ? 'plant' : 'bin',
    site_id: load?.delivery_site_id ?? '',
    contract_id: load?.contract_id ?? '',
  }
}

/**
 * One truckload off the yard scale, asked in the order it happens: which
 * field it came from, which fills in the crop and — when the field has a bin
 * assigned — the bin; then the truck full and the truck empty.
 *
 * Either weight can be saved on its own and the other added later: the full
 * weight on the way in, the empty on the way back. A half-weighed load waits
 * on the open list and only counts toward the bin when both are in.
 */
export function WeighInForm({
  cropYear,
  presetBinId,
  load,
  onDone,
  onCancel,
}: {
  cropYear: number
  presetBinId?: string | null
  /** An open load to finish. */
  load?: BinLoad | null
  onDone: () => void
  onCancel?: () => void
}) {
  const { profile } = useAuth()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: zones } = useAllCropZones()
  const { data: bins } = useBins()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: onHand } = useBinOnHand()
  const { data: people } = useFarmPeople()
  const { data: units } = useHaulUnits()
  const { data: allLoads } = useBinLoads()
  const save = useSaveBinLoad()
  const addUnit = useAddHaulUnit()
  const { data: sites } = useDeliverySites()
  const addSite = useAddDeliverySite()
  const [newSite, setNewSite] = useState<string | null>(null)
  const { data: contracts } = useContracts(cropYear)
  const { data: contacts } = useContacts()

  const [form, setForm] = useState<Form>(() => formFrom(load, presetBinId, profile?.id ?? null))
  const [editingId, setEditingId] = useState<string | null>(load?.id ?? null)
  // A finished load opened to correct it (Sam, 7 Oct 2026), not one waiting
  // for its second weight: saving it is the end, with no "next load" after.
  const correcting = !!load && !isOpenLoad(load) && editingId === load.id
  const [adding, setAdding] = useState<{ kind: HaulKind; name: string } | null>(null)
  const [saved, setSaved] = useState<BinLoad | null>(null)
  // The driver defaults to whoever is holding the phone, once their profile
  // has loaded, until somebody picks otherwise.
  const [driverTouched, setDriverTouched] = useState(!!load)
  const driverId = form.driver_id || (driverTouched ? '' : (profile?.id ?? ''))
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  /* ------------------------------------------------ what the field says */

  const cropsOnField = useMemo(() => {
    const m = new Map<string, string[]>()
    const add = (fieldId: string, cropId: string | null) => {
      if (!cropId) return
      const list = m.get(fieldId) ?? []
      if (!list.includes(cropId)) list.push(cropId)
      m.set(fieldId, list)
    }
    for (const p of plans ?? []) add(p.field_id, p.crop_id)
    for (const z of zones ?? []) if (z.crop_year === cropYear) add(z.field_id, z.crop_id)
    return m
  }, [plans, zones, cropYear])

  const cropName = (id: string | null | undefined) => (crops ?? []).find((c) => c.id === id)?.name ?? ''
  const varietyOf = (fieldId: string, cropId: string) =>
    (plans ?? []).find((p) => p.field_id === fieldId && p.crop_id === cropId)?.variety ?? null

  /** Bins assigned to the field this year, for the crop when one is chosen. */
  const assignedTo = (fieldId: string, cropId: string) =>
    (allocations ?? [])
      .filter((a) => a.field_id === fieldId && (!cropId || !a.crop_id || a.crop_id === cropId))
      .map((a) => a.bin_id)

  const pickField = (fieldId: string) => {
    const grown = cropsOnField.get(fieldId) ?? []
    setForm((f) => {
      const crop = grown.length === 1 ? grown[0] : grown.includes(f.crop_id) ? f.crop_id : grown.length ? '' : f.crop_id
      const assigned = assignedTo(fieldId, crop)
      const bin = presetBinId
        ? f.bin_id
        : assigned.includes(f.bin_id)
          ? f.bin_id
          : assigned.length === 1
            ? assigned[0]
            : ''
      return { ...f, field_id: fieldId, crop_id: crop, bin_id: bin }
    })
  }

  const pickCrop = (cropId: string) => {
    setForm((f) => {
      const assigned = f.field_id ? assignedTo(f.field_id, cropId) : []
      const bin = presetBinId || assigned.includes(f.bin_id) || !assigned.length ? f.bin_id : assigned.length === 1 ? assigned[0] : ''
      return { ...f, crop_id: cropId, bin_id: bin }
    })
  }

  /* ------------------------------------------------------------ options */

  const fieldOptions: SelectOption[] = useMemo(() => {
    // The load's own field stays on the list when a load is corrected, archived or not.
    const list = [...(fields ?? [])].filter((f) => f.active || cropsOnField.has(f.id) || f.id === load?.field_id)
    const growing = list.filter((f) => cropsOnField.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const other = list.filter((f) => !cropsOnField.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const lbl = (f: { id: string; name: string }) => {
      const cs = cropsOnField.get(f.id) ?? []
      return cs.length ? `${f.name} — ${cs.map((c) => [varietyOf(f.id, c), cropName(c)].filter(Boolean).join(' ')).join(' / ')}` : f.name
    }
    return [
      ...growing.map((f) => ({ value: f.id, label: lbl(f) })),
      ...(other.length ? [{ value: '__other', label: '— Fields with no crop planned —', disabled: true }] : []),
      ...other.map((f) => ({ value: f.id, label: f.name })),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, cropsOnField, crops, plans, load?.field_id])

  const grown = form.field_id ? (cropsOnField.get(form.field_id) ?? []) : []
  const cropOptions: SelectOption[] = [
    ...grown.map((c) => ({ value: c, label: `${cropName(c)} · on this field` })),
    ...(crops ?? []).filter((c) => c.active && !grown.includes(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ]

  const assigned = form.field_id ? assignedTo(form.field_id, form.crop_id) : []
  const binLabel = (b: { id: string; name: string; capacity_bu: number }) => {
    const held = (onHand ?? []).filter((o) => o.bin_id === b.id).reduce((s, o) => s + o.onhand_bu, 0)
    return `${b.name.replace(/^Main Yard\s*-\s*/i, 'Main Yard ')} · ${held > 0 ? `${Math.round(held).toLocaleString('en-CA')} of ` : 'empty, '}${Math.round(Number(b.capacity_bu)).toLocaleString('en-CA')} bu`
  }
  const activeBins = [...(bins ?? [])].filter((b) => b.active).sort(byYardThenNumber)
  const binOptions: SelectOption[] = [
    ...(assigned.length
      ? [
          { value: '__assigned', label: '— Assigned to this field —', disabled: true },
          ...activeBins.filter((b) => assigned.includes(b.id)).map((b) => ({ value: b.id, label: binLabel(b) })),
          { value: '__any', label: '— Any other bin —', disabled: true },
        ]
      : []),
    ...activeBins.filter((b) => !assigned.includes(b.id)).map((b) => ({ value: b.id, label: binLabel(b) })),
  ]

  const unitOptions = (kind: HaulKind): SelectOption[] => {
    const list = kind === 'truck' ? (units?.trucks ?? []) : (units?.trailers ?? [])
    const current = kind === 'truck' ? form.truck : form.trailer
    const names = list.map((u) => u.name)
    return [
      { value: '', label: 'None' },
      ...names.map((n) => ({ value: n, label: n })),
      // A name typed on an old load that is not in the list any more.
      ...(current && !names.includes(current) ? [{ value: current, label: current }] : []),
      { value: ADD, label: kind === 'truck' ? '+ Add a truck…' : '+ Add a trailer…' },
    ]
  }
  const pickUnit = (kind: HaulKind, v: string) => {
    if (v === ADD) return setAdding({ kind, name: '' })
    set(kind === 'truck' ? 'truck' : 'trailer', v)
  }

  const peopleOptions: SelectOption[] = [
    { value: '', label: 'Not recorded' },
    ...(people ?? []).map((p) => ({ value: p.id, label: p.full_name })),
  ]

  /* -------------------------------------------------------------- sums */

  const crop = (crops ?? []).find((c) => c.id === form.crop_id) ?? null
  const standardLb = testWeightFor(crop)
  const typedLb = Number(form.lbOverride)
  // The load's own test weight while it is still the same crop; a different
  // crop brings its own.
  const lbPerBu =
    form.lbOverride.trim() !== '' && Number.isFinite(typedLb) && typedLb > 0
      ? typedLb
      : load?.lb_per_bu != null && form.crop_id === load.crop_id
        ? Number(load.lb_per_bu)
        : standardLb
  // A net or a bin total is one number: stored as gross = the net and an
  // empty weight of 0, so everything downstream treats it as a finished load.
  const single = form.kind !== 'weighed'
  const gross = single ? (form.netOnly.trim() === '' ? null : Number(form.netOnly)) : form.gross.trim() === '' ? null : Number(form.gross)
  const tare = single ? (form.netOnly.trim() === '' ? null : 0) : form.tare.trim() === '' ? null : Number(form.tare)
  const both = gross != null && tare != null
  const wrongWay = both && !(gross > tare)
  const net = both && !wrongWay ? gross - tare : null
  const bushels = net != null && lbPerBu ? bushelsFromKg(net, lbPerBu) : null
  const previousTare = lastTare(allLoads ?? [], form.truck || null, form.trailer || null)
  const fieldNameOf = (id: string) => (fields ?? []).find((f) => f.id === id)?.name ?? 'this field'
  const soFar = form.field_id ? fieldHarvestSoFar((allLoads ?? []).filter((l) => l.id !== editingId), form.field_id, cropYear) : { loads: 0, bushels: 0, last: null, latest: null }

  const contractLabel = (c: ContractRow) => {
    const buyer = (contacts ?? []).find((x) => x.id === c.buyer_contact_id)?.contact_name
    const unit = (crops ?? []).find((x) => x.id === c.crop_id)?.yield_unit ?? ''
    return [
      c.contract_number ? `#${c.contract_number}` : 'Contract',
      buyer,
      c.bushels != null ? `${Math.round(Number(c.bushels)).toLocaleString('en-CA')} ${unit}` : null,
      `${Math.round(Number(c.delivered_bu ?? 0)).toLocaleString('en-CA')} delivered`,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const contractOptions: SelectOption[] = [
    { value: '', label: 'No contract' },
    ...(contracts ?? [])
      .filter(
        (c) =>
          c.id === form.contract_id ||
          ((!form.crop_id || !c.crop_id || c.crop_id === form.crop_id) && c.status !== 'cancelled' && c.status !== 'delivered'),
      )
      .map((c) => ({ value: c.id, label: contractLabel(c) })),
  ]

  const missing: string[] = []
  if (!form.crop_id) missing.push('the crop')
  if (!lbPerBu) missing.push('a test weight')
  if (gross == null && tare == null) missing.push('a weight')
  if (both && form.dest === 'bin' && !form.bin_id) missing.push('the bin')
  if (both && form.dest === 'plant' && !form.site_id) missing.push('the plant')
  const bad = (gross != null && !(gross > 0)) || (tare != null && !(tare >= 0))
  const canSave = !missing.length && !wrongWay && !bad && !!form.loaded_on

  const doSave = () => {
    const driver = (people ?? []).find((p) => p.id === driverId)
    save.mutate(
      {
        id: editingId ?? undefined,
        bin_id: form.dest === 'bin' ? form.bin_id || null : null,
        delivery_site_id: form.dest === 'plant' ? form.site_id || null : null,
        contract_id: form.dest === 'plant' ? form.contract_id || null : null,
        crop_id: form.crop_id,
        // The plan's variety, else (same field and crop) what the load already said.
        variety: form.field_id
          ? (varietyOf(form.field_id, form.crop_id) ??
            (load && form.field_id === load.field_id && form.crop_id === load.crop_id ? load.variety : null))
          : null,
        crop_year: cropYear,
        field_id: form.field_id || null,
        loaded_on: form.loaded_on,
        gross_kg: gross,
        tare_kg: tare,
        entry_kind: form.kind,
        load_count: form.kind === 'bin_total' && Number(form.loadCount) > 0 ? Math.round(Number(form.loadCount)) : null,
        moisture_pct: form.moisture.trim() && Number(form.moisture) > 0 && Number(form.moisture) < 60 ? Number(form.moisture) : null,
        protein_pct: form.protein.trim() && Number(form.protein) > 3 && Number(form.protein) < 30 ? Number(form.protein) : null,
        lb_per_bu: lbPerBu as number,
        truck: form.truck || null,
        trailer: form.trailer || null,
        driver: driver?.full_name ?? null,
        driver_id: driver?.id ?? null,
        note: form.note.trim() || null,
        last_from_field: form.last && !!form.field_id,
      },
      {
        onSuccess: (row) => {
          if (isOpenLoad(row) || correcting) onDone()
          else setSaved(row)
        },
      },
    )
  }

  /* ----------------------------------------------- after a full load */

  if (saved) {
    const binName = saved.delivery_site_id
      ? ((sites ?? []).find((x) => x.id === saved.delivery_site_id)?.name ?? 'the plant')
      : ((bins ?? []).find((b) => b.id === saved.bin_id)?.name ?? 'the bin')
    return (
      <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-green-900">
          <Check className="h-4 w-4" /> {bu(saved.bushels)} {saved.delivery_site_id ? 'to' : 'into'} {binName}
          {saved.contract_id && (contracts ?? []).find((c) => c.id === saved.contract_id) && (
            <span className="font-normal"> · on {contractLabel((contracts ?? []).find((c) => c.id === saved.contract_id)!).split(' · ')[0]}</span>
          )}
        </p>
        <p className="text-xs text-green-900/80">
          {saved.entry_kind === 'weighed'
            ? `${kg(saved.gross_kg)} full − ${kg(saved.tare_kg)} empty = ${kg(saved.net_kg)}`
            : `${kg(saved.net_kg)} ${saved.entry_kind === 'bin_total' ? `into the bin${saved.load_count ? ` over ${saved.load_count} loads` : ''}` : 'net off the truck'}`}{' '}
          at {Number(saved.lb_per_bu)} lb/bu.
        </p>
        {saved.last_from_field && saved.field_id && <FieldYieldNote fieldId={saved.field_id} cropYear={saved.crop_year} />}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              // Same field, truck and driver; a fresh pair of weights.
              setForm((f) => ({ ...f, gross: '', tare: '', netOnly: '', loadCount: '', moisture: '', protein: '', note: '', last: false, loaded_on: today() }))
              setEditingId(null)
              setSaved(null)
            }}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Scale className="h-3.5 w-3.5" /> Next load, same field
          </button>
          {saved.entry_kind === 'weighed' && (
          <button
            type="button"
            onClick={() => {
              // Truck not empty: what it weighed after this bin is what it
              // weighed going into the next one.
              setForm((f) => ({ ...f, gross: saved.tare_kg != null ? String(Math.round(Number(saved.tare_kg))) : '', tare: '', bin_id: '', note: '', last: false }))
              setEditingId(null)
              setSaved(null)
            }}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <ArrowRight className="h-3.5 w-3.5" /> Rest of this truck into another bin
          </button>
          )}
          <button type="button" onClick={onDone} className="px-2 text-xs text-gray-600 underline">
            Done
          </button>
        </div>
      </div>
    )
  }

  /* --------------------------------------------------------------- form */

  return (
    <div className="space-y-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      {editingId && load && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {correcting ? (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <Pencil className="h-3.5 w-3.5" /> Correcting the load of {load.loaded_on}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <Clock className="h-3.5 w-3.5" /> Finishing a load started {load.loaded_on}
            </p>
          )}
          <DeleteLoadButton load={load} onDeleted={onDone} withText />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <label className={cn(label, 'col-span-2')}>
          From which field?
          <Select value={form.field_id} ariaLabel="Field" placeholder="Pick the field…" className="mt-1" onChange={pickField} options={fieldOptions} />
        </label>

        <label className={cn(label, 'col-span-2 sm:col-span-1')}>
          Crop
          <Select value={form.crop_id} ariaLabel="Crop" placeholder="Pick the crop…" className="mt-1" onChange={pickCrop} options={cropOptions} />
          {form.field_id && form.crop_id && varietyOf(form.field_id, form.crop_id) && (
            <span className="mt-0.5 block text-[11px] text-gray-400">{varietyOf(form.field_id, form.crop_id)}</span>
          )}
        </label>

        <div className={cn(label, 'col-span-2 sm:col-span-1')}>
          <div className="flex items-center justify-between gap-2">
            <span>Going to</span>
            <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-[11px]">
              {(['bin', 'plant'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('dest', d)}
                  className={cn('px-2 py-0.5', form.dest === d ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}
                >
                  {d === 'bin' ? 'A bin' : 'Straight to a plant'}
                </button>
              ))}
            </span>
          </div>
          {form.dest === 'bin' ? (
            <>
              <Select value={form.bin_id} ariaLabel="Bin" placeholder="Pick the bin…" className="mt-1" onChange={(v) => set('bin_id', v)} options={binOptions} />
              <span className="mt-0.5 block text-[11px] text-gray-400">
                {!form.field_id
                  ? 'Pick the field first; its assigned bin fills in.'
                  : assigned.length === 0
                    ? 'No bin assigned to this field — pick any.'
                    : assigned.length === 1
                      ? form.bin_id === assigned[0]
                        ? 'The bin assigned to this field. Any other can be picked.'
                        : 'Not the assigned bin — that is fine if it went elsewhere.'
                      : `${assigned.length} bins assigned to this field — pick which one.`}
              </span>
            </>
          ) : (
            <>
              <Select
                value={form.site_id}
                ariaLabel="Plant"
                placeholder="Pick the plant…"
                className="mt-1"
                onChange={(v) => (v === ADD ? setNewSite('') : set('site_id', v))}
                options={[...(sites ?? []).map((x) => ({ value: x.id, label: x.name })), { value: ADD, label: '+ Add a plant or elevator…' }]}
              />
              <span className="mt-0.5 block text-[11px] text-gray-400">No bin: counted in the field's yield, not in any bin.</span>
              <Select
                value={form.contract_id}
                ariaLabel="Contract"
                className="mt-1.5"
                onChange={(v) => set('contract_id', v)}
                options={contractOptions}
              />
              <span className="mt-0.5 block text-[11px] text-gray-400">
                {form.contract_id
                  ? "Counts toward the contract now; the plant's ticket takes over when it is recorded."
                  : contractOptions.length > 1
                    ? 'Optional: the contract it was delivered on.'
                    : `No open ${cropName(form.crop_id) || ''} contracts for ${cropYear}.`}
              </span>
            </>
          )}
        </div>

        <div className={cn(label, 'col-span-2')}>
          How was it weighed?
          <span className="mt-1 flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs">
            {(
              [
                ['weighed', 'Full & empty'],
                ['net', 'Net off the truck'],
                ['bin_total', 'Bin total'],
              ] as const
            ).map(([k, text]) => (
              <button
                key={k}
                type="button"
                disabled={!!editingId && k !== form.kind}
                onClick={() => set('kind', k)}
                className={cn('flex-1 px-2 py-1.5 disabled:opacity-40', form.kind === k ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600 hover:bg-gray-50')}
              >
                {text}
              </button>
            ))}
          </span>
        </div>

        {form.kind === 'weighed' ? (
          <>
            <label className={label}>
              Truck full (kg)
              <input type="number" inputMode="decimal" value={form.gross} onChange={(e) => set('gross', e.target.value)} placeholder="e.g. 61390" className={numBox} />
            </label>
            <label className={label}>
              Truck empty (kg)
              <input type="number" inputMode="decimal" value={form.tare} onChange={(e) => set('tare', e.target.value)} placeholder="e.g. 20810" className={numBox} />
              {form.tare === '' && previousTare != null && (
                <button type="button" onClick={() => set('tare', String(Math.round(previousTare)))} className="mt-0.5 block text-left text-[11px] text-brand-700 underline decoration-dotted">
                  Last empty for this truck: {kg(previousTare)}
                </button>
              )}
            </label>
          </>
        ) : (
          <>
            <label className={label}>
              {form.kind === 'net' ? 'Net off the truck (kg)' : 'Total into the bin (kg)'}
              <input type="number" inputMode="decimal" value={form.netOnly} onChange={(e) => set('netOnly', e.target.value)} placeholder={form.kind === 'net' ? 'e.g. 40580' : 'e.g. 91440'} className={numBox} />
            </label>
            {form.kind === 'bin_total' ? (
              <label className={label}>
                How many loads <span className="text-gray-400">(optional)</span>
                <input type="number" inputMode="numeric" value={form.loadCount} onChange={(e) => set('loadCount', e.target.value)} placeholder="e.g. 3" className={numBox} />
              </label>
            ) : (
              <span className={cn(label, 'self-end pb-2 text-[11px] text-gray-400')}>Just the one number the driver sent.</span>
            )}
          </>
        )}

        <div className="col-span-2 rounded-md border border-gray-200 bg-white px-3 py-2">
          <p className="text-xs text-gray-500">This load</p>
          <p className="text-lg font-bold tabular-nums text-gray-900">
            {bushels != null ? bu(bushels) : '—'}
            <span className="ml-2 text-sm font-normal text-gray-500">
              {net != null
                ? `${kg(net)} net`
                : wrongWay
                  ? 'full must be more than empty'
                  : gross != null
                    ? 'full weighed — the empty can be added later'
                    : tare != null
                      ? 'empty weighed — the full can be added later'
                      : 'no weights yet'}
            </span>
          </p>
          <p className="text-[11px] text-gray-500">
            {crop ? (lbPerBu ? `${crop.name} at ${lbPerBu} lb/bu${net != null ? ` · ${Math.round(net * KG_TO_LB).toLocaleString('en-CA')} lb` : ''}` : 'No test weight on file for this crop — type one below.') : 'Pick the field or crop to get bushels.'}
          </p>
        </div>

        {form.field_id && (
          <label
            className={cn(
              'col-span-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
              form.last ? 'border-green-300 bg-green-50 text-green-900' : 'border-gray-200 bg-white text-gray-700',
            )}
          >
            <input type="checkbox" checked={form.last} onChange={(e) => set('last', e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
            <span>
              <span className="font-semibold">Last load from {fieldNameOf(form.field_id)}</span>
              <span className="block text-[11px] opacity-80">
                {soFar.loads
                  ? `So far ${soFar.loads} load${soFar.loads === 1 ? '' : 's'}, ${bu(soFar.bushels)}${bushels != null && !editingId ? ` — ${bu(soFar.bushels + bushels)} with this one` : ''}. `
                  : 'The first load from this field. '}
                {form.last
                  ? both
                    ? "Saving records the field's yield from all its loads, everywhere yield shows. It can be changed on the field's History tab."
                    : 'The yield is recorded once this load has both weights.'
                  : soFar.last
                    ? `Already finished on ${soFar.last.loaded_on}; this load will be added to its yield.`
                    : "Tick when the field is done, and its yield is recorded from the loads."}
              </span>
            </span>
          </label>
        )}

        <label className={label}>
          Driver
          <Select
            value={driverId}
            ariaLabel="Driver"
            className="mt-1"
            onChange={(v) => {
              setDriverTouched(true)
              set('driver_id', v)
            }}
            options={peopleOptions}
          />
        </label>
        <label className={label}>
          Date
          <DateField value={form.loaded_on} onChange={(v) => set('loaded_on', v)} className="mt-1 rounded-md bg-white" />
        </label>

        <label className={label}>
          Truck <span className="text-gray-400">(optional)</span>
          <Select value={form.truck} ariaLabel="Truck" className="mt-1" onChange={(v) => pickUnit('truck', v)} options={unitOptions('truck')} />
        </label>
        <label className={label}>
          Trailer <span className="text-gray-400">(optional)</span>
          <Select value={form.trailer} ariaLabel="Trailer" className="mt-1" onChange={(v) => pickUnit('trailer', v)} options={unitOptions('trailer')} />
        </label>

        {adding && (
          <div className="col-span-2 flex items-end gap-2 rounded-md border border-gray-200 bg-white p-2">
            <label className={cn(label, 'flex-1')}>
              New {adding.kind} name
              <input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder={adding.kind === 'truck' ? 'e.g. Kenworth #2' : 'e.g. Super B #6'} className={box} />
            </label>
            <button
              type="button"
              disabled={!adding.name.trim() || addUnit.isPending}
              onClick={() =>
                addUnit.mutate(
                  { kind: adding.kind, name: adding.name },
                  {
                    onSuccess: () => {
                      set(adding.kind === 'truck' ? 'truck' : 'trailer', adding.name.trim())
                      setAdding(null)
                    },
                  },
                )
              }
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {addUnit.isPending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setAdding(null)} className="pb-1.5 text-xs text-gray-500 underline">
              Cancel
            </button>
          </div>
        )}
        {addUnit.isError && <p className="col-span-2 text-xs text-red-700">{(addUnit.error as Error).message}</p>}

        {newSite != null && (
          <div className="col-span-2 flex items-end gap-2 rounded-md border border-gray-200 bg-white p-2">
            <label className={cn(label, 'flex-1')}>
              New plant or elevator
              <input autoFocus value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="e.g. Cargill Lethbridge" className={box} />
            </label>
            <button
              type="button"
              disabled={!newSite.trim() || addSite.isPending}
              onClick={() =>
                addSite.mutate(newSite, {
                  onSuccess: (row) => {
                    set('site_id', row.id)
                    setNewSite(null)
                  },
                })
              }
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {addSite.isPending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setNewSite(null)} className="pb-1.5 text-xs text-gray-500 underline">
              Cancel
            </button>
          </div>
        )}
        {addSite.isError && (
          <p className="col-span-2 text-xs text-red-700">
            {/duplicate|unique/i.test((addSite.error as Error).message) ? 'That one is already on the list.' : (addSite.error as Error).message}
          </p>
        )}

        <label className={label}>
          Test weight (lb/bu){standardLb ? ` · standard ${standardLb}` : ''}
          <input type="number" inputMode="decimal" value={form.lbOverride} onChange={(e) => set('lbOverride', e.target.value)} placeholder={lbPerBu ? String(lbPerBu) : 'e.g. 50'} className={numBox} />
        </label>
        <label className={label}>
          Moisture (%){crop?.moisture_dry_max != null ? ` · dry at ${Number(crop.moisture_dry_max)}` : ''} — optional
          <input type="number" inputMode="decimal" value={form.moisture} onChange={(e) => set('moisture', e.target.value)} placeholder="from the tester" className={numBox} />
          {crop?.moisture_dry_max != null && Number(form.moisture) > Number(crop.moisture_dry_max) && Number(form.moisture) < 60 && (
            <span className="mt-0.5 block text-[11px] text-amber-700">
              Wet: the field yield counts this load at{' '}
              {Math.round(((100 - Number(form.moisture)) / (100 - Number(crop.moisture_dry_max))) * 1000) / 10}% of its weight.
            </span>
          )}
        </label>
        {/wheat|durum/i.test(crop?.name ?? '') && !/buckwheat/i.test(crop?.name ?? '') && (
          <label className={label}>
            Protein (%) — optional
            <input type="number" inputMode="decimal" value={form.protein} onChange={(e) => set('protein', e.target.value)} placeholder="off the elevator ticket" className={numBox} />
          </label>
        )}
        <label className={label}>
          Note
          <input value={form.note} onChange={(e) => set('note', e.target.value)} className={box} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canSave || save.isPending}
          onClick={doSave}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {both ? <Plus className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          {save.isPending ? 'Saving…' : both ? 'Save load' : gross != null ? 'Save — weigh empty later' : tare != null ? 'Save — weigh full later' : 'Save load'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-xs text-gray-500 underline">
            Cancel
          </button>
        )}
        {!canSave && missing.length > 0 && <span className="text-[11px] text-gray-400">Needs {missing.join(', ')}.</span>}
        {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
      </div>
    </div>
  )
}

/**
 * Loads with only one weight so far, oldest first — the ones somebody still
 * has to go back to the scale for.
 */
export function OpenLoads({ binId, onFinish }: { binId?: string; onFinish: (l: BinLoad) => void }) {
  const { data: loads } = useBinLoads()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: bins } = useBins()
  const { data: sites } = useDeliverySites()
  const open = (loads ?? []).filter((l) => isOpenLoad(l) && (!binId || l.bin_id === binId)).reverse()
  if (!open.length) return null
  const name = <T extends { id: string; name: string }>(list: T[] | undefined, id: string | null) => (list ?? []).find((x) => x.id === id)?.name ?? null
  return (
    <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
      <p className="flex items-center gap-1.5 border-b border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-900">
        <Clock className="h-3.5 w-3.5" /> Waiting for a second weight ({open.length})
      </p>
      <ul className="divide-y divide-amber-100">
        {open.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="min-w-0">
              <span className="font-medium text-gray-900">{name(fields, l.field_id) ?? 'No field'}</span>
              <span className="text-gray-600">
                {' '}
                · {name(crops, l.crop_id) ?? ''} → {name(bins, l.bin_id)?.replace(/^Main Yard\s*-\s*/i, '') ?? name(sites, l.delivery_site_id) ?? 'bin not picked'}
              </span>
              <span className="block text-[11px] text-gray-500">
                {l.gross_kg != null ? `full ${kg(l.gross_kg)}, needs the empty` : `empty ${kg(l.tare_kg)}, needs the full`} · {l.loaded_on}
                {l.driver ? ` · ${l.driver}` : ''}
                {l.truck ? ` · ${l.truck}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => onFinish(l)} className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700">
                Finish
              </button>
              <DeleteLoadButton load={l} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The home-screen tile: the loads still waiting for a weight, and a new one
 * started from the field.
 */
export function WeighInDialog({ cropYear, onClose }: { cropYear: number; onClose: () => void }) {
  const { data: loads } = useBinLoads()
  const [finishing, setFinishing] = useState<BinLoad | null>(null)
  const [fresh, setFresh] = useState(0)
  const [started, setStarted] = useState(false)
  const openCount = (loads ?? []).filter(isOpenLoad).length
  const showForm = started || finishing || openCount === 0
  return (
    <Modal title="Weigh in a load" onClose={onClose}>
      <div className="space-y-3">
        {!finishing && <OpenLoads onFinish={(l) => setFinishing(l)} />}
        {showForm ? (
          <WeighInForm
            key={finishing?.id ?? `new-${fresh}`}
            cropYear={cropYear}
            load={finishing}
            onDone={() => {
              setFinishing(null)
              setStarted(false)
              setFresh((n) => n + 1)
            }}
            onCancel={
              finishing || openCount > 0
                ? () => {
                    setFinishing(null)
                    setStarted(false)
                  }
                : undefined
            }
          />
        ) : (
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Scale className="h-3.5 w-3.5" /> Start a new load
          </button>
        )}
      </div>
    </Modal>
  )
}

/**
 * A load opened from a list to see and correct (Sam, 7 Oct 2026): every
 * field of it in the weigh-in form, saved over the same load, with Delete.
 *
 * The database does the rest from the load: its bin movement is rewritten by
 * the mirror trigger, the field's yield is worked out again when the weights,
 * field or last-load mark change, and a plant load's contract total follows.
 * The form saves under the load's own crop year, not the one on screen.
 */
export function EditLoadDialog({ load, onClose }: { load: BinLoad; onClose: () => void }) {
  return (
    <Modal title={`Load of ${load.loaded_on}`} onClose={onClose}>
      <WeighInForm key={load.id} cropYear={load.crop_year} load={load} onDone={onClose} onCancel={onClose} />
    </Modal>
  )
}

/**
 * What the field's yield came to, once the last load is in: read back from
 * crop history so it shows what was actually recorded, not a sum made here.
 */
export function FieldYieldNote({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const { data: y, isLoading } = useFieldYield(fieldId, cropYear)
  const { data: fields } = useFields()
  const name = (fields ?? []).find((f) => f.id === fieldId)?.name ?? 'The field'
  if (isLoading) return <p className="text-xs text-green-900/70">Recording the field's yield…</p>
  if (!y || y.actual_yield_total == null) return null
  const unit = y.yield_unit ?? 'bu'
  return (
    <div className="rounded-md border border-green-300 bg-white px-3 py-2 text-xs text-green-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <Flag className="h-3.5 w-3.5" /> {name} is done: {Math.round(Number(y.actual_yield_total)).toLocaleString('en-CA')} {unit} pre-clean
        {y.yield_per_acre != null ? `, ${Number(y.yield_per_acre).toLocaleString('en-CA')} ${unit}/ac` : ''}
      </p>
      <p className="mt-0.5 text-[11px] text-green-900/80">
        {y.yield_override
          ? `A person's figure is kept; the scale says ${Math.round(Number(y.scale_total ?? 0)).toLocaleString('en-CA')} ${unit}.`
          : `Pre-clean, from ${y.scale_loads ?? 'its'} loads over ${y.acres != null ? `${Number(y.acres).toLocaleString('en-CA')} ac` : 'the seeded acres'}. The plan and marketing position use it, labelled pre-clean, until the yield after clean-out is entered.`}{' '}
        <Link to={`/fields/${fieldId}/history`} className="underline">
          Change it
        </Link>
      </p>
    </div>
  )
}

/**
 * Delete a load, after asking once. A test load, a load typed twice, a
 * half-weighed one that never happened. Its bushels leave the bin and the
 * field's yield is worked out again; deleting a field's last load reopens
 * its harvest.
 */
export function DeleteLoadButton({ load, onDeleted, withText = false }: { load: BinLoad; onDeleted?: () => void; withText?: boolean }) {
  const del = useDeleteBinLoad()
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={del.isPending}
          onClick={() =>
            del.mutate(load.id, {
              onSuccess: () => {
                setAsking(false)
                onDeleted?.()
              },
            })
          }
          className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {del.isPending ? 'Deleting…' : 'Delete this load'}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="text-[11px] text-gray-500 underline">
          keep it
        </button>
        {del.isError && <span className="text-[11px] text-red-700">{(del.error as Error).message}</span>}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      aria-label="Delete this load"
      title={load.last_from_field ? "Delete this load — it is the field's last, so its harvest reopens" : 'Delete this load'}
      className={cn(
        'inline-flex items-center gap-1 rounded text-gray-400 hover:bg-red-50 hover:text-red-600',
        withText ? 'px-2 py-1 text-xs' : 'p-1',
      )}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {withText && 'Delete this load'}
    </button>
  )
}
