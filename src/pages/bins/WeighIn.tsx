import { useMemo, useRef, useState } from 'react'
import { viewableFile } from '@/lib/heic'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Flag,
  Pencil,
  Scale,
  Trash2,
  X,
  Image as ImageIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { Select, type SelectOption } from '@/components/Select'
import { DateField } from '@/components/DateField'
import { useAuth } from '@/lib/auth'
import { useCrops, useCropPlans, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { byYardThenNumber, useBinAllocations, useBinOnHand, useBins } from '@/lib/bins'
import { hiddenYardNames, inHiddenYard, useBinYards } from '@/lib/bin-yards'
import {
  KG_TO_LB,
  bushelsFromKg,
  fieldHarvestSoFar,
  isOpenLoad,
  lastMoistureFor,
  lastTare,
  loadInBin,
  overATruckload,
  fromTimeInput,
  toTimeInput,
  weighTime,
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
  uploadScalePhoto,
  useScalePhotoUrl,
  type BinLoad,
  type HaulKind,
} from '@/lib/bin-loads'
import { readScalePhoto, usableRead, type ScaleRead } from '@/lib/scale-photo-read'
import { cn } from '@/lib/utils'
import { TruckForecastLine } from '@/pages/harvest/TruckForecast'
import { useContacts, useContracts, type ContractRow } from '@/lib/sales'
import { useMoistureTests } from '@/lib/moisture-queries'
import { cropForVariety } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'

/**
 * The driver picker's "Someone else": a temporary driver (Sam, 24 Oct 2026:
 * Clayton Lehr, for a while) is typed on the load and remembered there, never
 * added to the farm's people.
 */
const OTHER_DRIVER = '__other'

/** Every box that takes typing is white, so it reads as a box to fill. */
const box =
  'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none'
const numBox = cn(box, 'text-right tabular-nums')
const label = 'text-xs text-gray-500'
const ADD = '__add'
/** Today on the farm's clock: after 6 pm in Alberta the UTC date is already tomorrow. */
const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "9 Oct": a test's timestamp on the local clock, or a load's plain date. */
const dayMonth = (on: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(on) ? `${on}T12:00` : on)
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

const kg = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} kg`
const bu = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-CA')} bu`

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
  /** Nobody weighed it: a best guess, marked as an estimate (9 Oct 2026). */
  estimated: boolean
  /** What the estimate is in. Stored as kg like every load. */
  estUnit: 'kg' | 't' | 'bu'
  loadCount: string
  /** Optional moisture %, for dry-basis yields. */
  moisture: string
  /** Optional protein %, wheat and durum. */
  protein: string
  driver_id: string
  /** A driver who is not one of the farm's people (a temporary driver), typed. */
  driverName: string
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
  /** Photos of the scale: one saved (a path) or one just taken (a file). */
  fullPhoto: Photo
  emptyPhoto: Photo
  /** More than the bin had room for (Sam, 20 Oct 2026): the bin the rest went into. */
  overflowBin: string
  /** ...or the answer that it all went into the one bin, over its max. */
  allIn: boolean
  /** Work the split out again from the bin's room now, not what it took then. */
  resplit: boolean
  /** "Yes, that really is the grain, not the loaded truck." */
  overTruckOk: boolean
  /** When it was weighed in and out, as the boxes show them (a load already weighed). */
  fullAt: string
  emptyAt: string
  /** Who stood at the scale for each weight: whoever is signed in, until somebody picks. */
  weighedInBy: string
  weighedOutBy: string
}

/** A scale photo on the form: none, one already saved, or one just taken. */
type Photo = { path: string | null; file: File | null }
const savedPhoto = (path: string | null | undefined): Photo => ({ path: path ?? null, file: null })

function formFrom(
  load: BinLoad | null | undefined,
  presetBinId: string | null | undefined,
  me: string | null,
): Form {
  return {
    field_id: load?.field_id ?? '',
    crop_id: load?.crop_id ?? '',
    bin_id: load?.bin_id ?? presetBinId ?? '',
    loaded_on: load?.loaded_on ?? today(),
    gross: load?.gross_kg != null ? String(Math.round(Number(load.gross_kg))) : '',
    tare: load?.tare_kg != null ? String(Math.round(Number(load.tare_kg))) : '',
    kind: load?.entry_kind ?? 'weighed',
    netOnly:
      load && load.entry_kind !== 'weighed' && load.net_kg != null
        ? String(Math.round(Number(load.net_kg)))
        : '',
    estimated: load?.estimated ?? false,
    estUnit: 'kg',
    loadCount: load?.load_count != null ? String(load.load_count) : '',
    moisture: load?.moisture_pct != null ? String(load.moisture_pct) : '',
    protein: load?.protein_pct != null ? String(load.protein_pct) : '',
    // A load with a typed name and no person opens on "Someone else".
    driver_id: load?.driver_id ?? (load?.driver ? OTHER_DRIVER : (me ?? '')),
    driverName: load && !load.driver_id ? (load.driver ?? '') : '',
    truck: load?.truck ?? '',
    trailer: load?.trailer ?? '',
    note: load?.note ?? '',
    last: load?.last_from_field ?? false,
    dest: load?.delivery_site_id ? 'plant' : 'bin',
    site_id: load?.delivery_site_id ?? '',
    contract_id: load?.contract_id ?? '',
    fullPhoto: savedPhoto(load?.full_photo),
    emptyPhoto: savedPhoto(load?.empty_photo),
    overflowBin: load?.overflow_bin_id ?? '',
    // A finished load saved into one bin was answered already.
    allIn: !!load && !isOpenLoad(load) && !load.overflow_bin_id,
    resplit: false,
    overTruckOk: false,
    fullAt: toTimeInput(load?.full_at),
    emptyAt: toTimeInput(load?.empty_at),
    // A new load is being weighed by whoever is holding the phone. A load
    // already saved keeps the name it has, blank and all: filling a blank one
    // in now would put today's reader at a scale they never stood at.
    weighedInBy: load ? (load.weighed_in_by ?? '') : (me ?? ''),
    weighedOutBy: load ? (load.weighed_out_by ?? '') : (me ?? ''),
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
  const { data: varietySettings } = useCropVarietySettings()
  const { data: zones } = useAllCropZones()
  const { data: bins } = useBins()
  const { data: allocations } = useBinAllocations(cropYear)
  const { data: onHand } = useBinOnHand()
  const { data: yards } = useBinYards()
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
  const { data: tests } = useMoistureTests(cropYear)

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
  // The truck and trailer the driver had on their last load (Sam, 20 Oct
  // 2026), until somebody picks: most drive the same rig all harvest.
  const [rigTouched, setRigTouched] = useState(!!load)
  const otherDriver = driverId === OTHER_DRIVER
  const lastRig =
    rigTouched || !driverId || otherDriver
      ? null
      : ((allLoads ?? []).find((l) => l.driver_id === driverId && (l.truck || l.trailer)) ?? null)
  // The trailer last pulled by a truck (Sam, 23 Oct 2026: "we just leave
  // the same trailer on the same truck"), until somebody picks a trailer.
  // Only a trailer still on the list (Clay's is not offered again).
  const trailerOnList = (n: string | null | undefined) =>
    !!n && (units?.trailers ?? []).some((u) => u.name === n)
  const lastTrailerFor = (t: string) =>
    (allLoads ?? []).find((l) => l.truck === t && trailerOnList(l.trailer))?.trailer ?? null
  const [trailerPicked, setTrailerPicked] = useState(!!load)
  // A truck taken off the list (Clay's) is not offered again from an old load.
  const lastActiveTruck =
    lastRig?.truck && (units?.trucks ?? []).some((u) => u.name === lastRig.truck)
      ? lastRig.truck
      : ''
  const truck = rigTouched ? form.truck : form.truck || lastActiveTruck
  const trailer =
    trailerPicked || form.trailer
      ? form.trailer
      : rigTouched
        ? (truck ? lastTrailerFor(truck) : null) || ''
        : (truck ? lastTrailerFor(truck) : null) ||
          (trailerOnList(lastRig?.trailer) ? lastRig!.trailer : '') ||
          ''
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  // A new load starts at the crop's last moisture reading, and follows the
  // crop until somebody types one (Sam, 13 Oct 2026). A saved load keeps its own.
  const [moistureTouched, setMoistureTouched] = useState(!!load)
  const reading = lastMoistureFor(form.crop_id, cropYear, tests ?? [], allLoads ?? [], editingId)
  const moisture = moistureTouched ? form.moisture : reading ? String(reading.pct) : ''
  // Three steps (Sam, 20 Oct 2026): where from and to, the weights, check
  // and save. A load already started opens on its weights.
  const [step, setStep] = useState<Step>(!load ? 1 : isOpenLoad(load) ? 2 : 3)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

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

  const cropName = (id: string | null | undefined) =>
    (crops ?? []).find((c) => c.id === id)?.name ?? ''
  const varietyOf = (fieldId: string, cropId: string) =>
    (plans ?? []).find((p) => p.field_id === fieldId && p.crop_id === cropId)?.variety ?? null

  /** Bins assigned to the field this year, for the crop when one is chosen. */
  const assignedTo = (fieldId: string, cropId: string) =>
    (allocations ?? [])
      .filter((a) => a.field_id === fieldId && (!cropId || !a.crop_id || a.crop_id === cropId))
      .map((a) => a.bin_id)

  const pickField = (fieldId: string) => {
    const grown = toWeigh(fieldId).length ? toWeigh(fieldId) : (cropsOnField.get(fieldId) ?? [])
    setForm((f) => {
      const crop =
        grown.length === 1
          ? grown[0]
          : grown.includes(f.crop_id)
            ? f.crop_id
            : grown.length
              ? ''
              : f.crop_id
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
      const bin =
        presetBinId || assigned.includes(f.bin_id) || !assigned.length
          ? f.bin_id
          : assigned.length === 1
            ? assigned[0]
            : ''
      return { ...f, crop_id: cropId, bin_id: bin }
    })
  }

  /* ------------------------------------------------------------ options */

  // Only what is still to weigh (Sam, 22 Oct 2026): a crop not weighed at
  // the scale (potatoes, green feed, hay; Crop settings) is not offered, nor is
  // a field-crop whose last load is in. A field with nothing left to weigh
  // drops off the list. The load's own field and crop always stay.
  const weighedCrop = (id: string) => (crops ?? []).find((c) => c.id === id)?.weighed !== false
  const finishedPairs = new Set(
    (allLoads ?? [])
      .filter((l) => l.last_from_field && l.crop_year === cropYear && l.field_id && !isOpenLoad(l))
      .map((l) => `${l.field_id}|${l.crop_id}`),
  )
  const toWeigh = (fieldId: string) =>
    (cropsOnField.get(fieldId) ?? []).filter(
      (c) =>
        (fieldId === load?.field_id && c === load?.crop_id) ||
        (weighedCrop(c) && !finishedPairs.has(`${fieldId}|${c}`)),
    )
  const fieldOptions: SelectOption[] = useMemo(() => {
    // The load's own field, and the one picked, stay on the list.
    const keep = (id: string) => id === load?.field_id || id === form.field_id
    const list = [...(fields ?? [])].filter((f) => f.active || cropsOnField.has(f.id) || keep(f.id))
    const growing = list
      .filter((f) => cropsOnField.has(f.id) && (toWeigh(f.id).length > 0 || keep(f.id)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const other = list
      .filter((f) => !cropsOnField.has(f.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const lbl = (f: { id: string; name: string }) => {
      const left = toWeigh(f.id)
      const cs = left.length ? left : (cropsOnField.get(f.id) ?? [])
      return cs.length
        ? `${f.name} — ${cs.map((c) => [varietyOf(f.id, c), cropName(c)].filter(Boolean).join(' ')).join(' / ')}`
        : f.name
    }
    return [
      ...growing.map((f) => ({ value: f.id, label: lbl(f) })),
      ...(other.length
        ? [{ value: '__other', label: '— Fields with no crop planned —', disabled: true }]
        : []),
      ...other.map((f) => ({ value: f.id, label: f.name })),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, cropsOnField, crops, plans, load?.field_id, form.field_id, allLoads, cropYear])

  // The field's crops still to weigh (all of them if none is left, so a field kept for a correction still names its crop).
  const grown = form.field_id
    ? toWeigh(form.field_id).length
      ? toWeigh(form.field_id)
      : (cropsOnField.get(form.field_id) ?? [])
    : []
  // The field's own crop is named with it, so no Crop box (Sam, 20 Oct
  // 2026). Asked only where the field does not settle it: two crops on it,
  // none planned, or an old load saved with no field or another crop.
  const askCrop = form.field_id
    ? grown.length !== 1 || (!!form.crop_id && !grown.includes(form.crop_id))
    : !!load && !load.field_id
  const cropOptions: SelectOption[] = [
    ...grown.map((c) => ({ value: c, label: `${cropName(c)} · on this field` })),
    ...(crops ?? [])
      .filter(
        (c) =>
          (c.active && c.weighed !== false && !grown.includes(c.id)) ||
          (c.id === form.crop_id && !grown.includes(c.id)),
      )
      .map((c) => ({ value: c.id, label: c.name })),
  ]

  const assigned = form.field_id ? assignedTo(form.field_id, form.crop_id) : []
  const binLabel = (b: { id: string; name: string; capacity_bu: number }) => {
    const held = (onHand ?? [])
      .filter((o) => o.bin_id === b.id)
      .reduce((s, o) => s + o.onhand_bu, 0)
    return `${b.name.replace(/^Main Yard\s*-\s*/i, 'Main Yard ')} · ${held > 0 ? `${Math.round(held).toLocaleString('en-CA')} of ` : 'empty, '}${Math.round(Number(b.capacity_bu)).toLocaleString('en-CA')} bu`
  }
  // Not offered (Sam, 22 Oct 2026): a bin in a hidden yard (Bins page → Bin
  // yards), or a full one. The bin picked, and a load's own, always stay.
  const hiddenYards = hiddenYardNames(yards)
  const isFull = (b: { id: string; capacity_bu: number }) => {
    const cap = Number(b.capacity_bu) || 0
    const held = (onHand ?? [])
      .filter((o) => o.bin_id === b.id)
      .reduce((s, o) => s + o.onhand_bu, 0)
    return cap > 0 && held >= cap - 0.5
  }
  const keepBin = (id: string) =>
    id === form.bin_id ||
    id === form.overflowBin ||
    id === load?.bin_id ||
    id === load?.overflow_bin_id ||
    id === presetBinId
  const activeBins = [...(bins ?? [])]
    .filter((b) => b.active && (keepBin(b.id) || (!inHiddenYard(b, hiddenYards) && !isFull(b))))
    .sort(byYardThenNumber)
  const binOptions: SelectOption[] = [
    ...(assigned.length
      ? [
          { value: '__assigned', label: '— Planned for this field —', disabled: true },
          ...activeBins
            .filter((b) => assigned.includes(b.id))
            .map((b) => ({ value: b.id, label: binLabel(b) })),
          { value: '__any', label: '— Any other bin —', disabled: true },
        ]
      : []),
    ...activeBins
      .filter((b) => !assigned.includes(b.id))
      .map((b) => ({ value: b.id, label: binLabel(b) })),
  ]

  const unitOptions = (kind: HaulKind): SelectOption[] => {
    const list = kind === 'truck' ? (units?.trucks ?? []) : (units?.trailers ?? [])
    const current = kind === 'truck' ? truck : trailer
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
    setRigTouched(true)
    if (kind === 'trailer') {
      setTrailerPicked(true)
      return setForm((f) => ({ ...f, truck, trailer: v }))
    }
    // A truck brings the trailer it last pulled, unless one was picked.
    setForm((f) => ({
      ...f,
      truck: v,
      trailer: trailerPicked ? trailer : (v ? lastTrailerFor(v) : null) || '',
    }))
  }

  const personName = (id: string) =>
    (people ?? []).find((p) => p.id === id)?.full_name ?? 'somebody'
  const peopleOptions: SelectOption[] = [
    { value: '', label: 'Not recorded' },
    ...(people ?? []).map((p) => ({ value: p.id, label: p.full_name })),
    { value: OTHER_DRIVER, label: 'Someone else (type a name)…' },
  ]
  // Names typed on earlier loads, offered as you type, so a temporary driver
  // is spelt the same each time without joining the list.
  const typedDrivers = [
    ...new Set(
      (allLoads ?? []).filter((l) => !l.driver_id && l.driver?.trim()).map((l) => l.driver!.trim()),
    ),
  ].sort()

  /* -------------------------------------------------------------- sums */

  // The crop as the load's variety grows it: its own test weight and dry level.
  const pickedCrop = (crops ?? []).find((c) => c.id === form.crop_id) ?? null
  const loadVariety = form.field_id
    ? (varietyOf(form.field_id, form.crop_id) ??
      (load && form.field_id === load.field_id && form.crop_id === load.crop_id
        ? load.variety
        : null))
    : load && form.crop_id === load.crop_id
      ? load.variety
      : null
  const crop = pickedCrop ? cropForVariety(pickedCrop, loadVariety, varietySettings) : null
  const standardLb = testWeightFor(crop)
  // The test weight is Crop settings' only, not typed on a load (Sam, 20
  // Oct 2026), so nobody changes it by accident at the scale. A load being
  // corrected keeps the one it was saved at while it is still the same crop,
  // so its bushels do not shift; a different crop brings its own.
  const lbPerBu =
    load?.lb_per_bu != null && form.crop_id === load.crop_id ? Number(load.lb_per_bu) : standardLb
  // A net or a bin total is one number: stored as gross = the net and an
  // empty weight of 0, so everything downstream treats it as a finished load.
  const single = form.kind !== 'weighed'
  // An estimate can be given in tonnes or bushels; it is kept in kg like every load.
  const typedOne = form.netOnly.trim() === '' ? null : Number(form.netOnly)
  const oneKg =
    typedOne == null
      ? null
      : !form.estimated || form.estUnit === 'kg'
        ? typedOne
        : form.estUnit === 't'
          ? typedOne * 1000
          : lbPerBu
            ? (typedOne * lbPerBu) / 2.20462262
            : null
  const gross = single ? oneKg : form.gross.trim() === '' ? null : Number(form.gross)
  const tare = single
    ? oneKg == null
      ? null
      : 0
    : form.tare.trim() === ''
      ? null
      : Number(form.tare)
  const both = gross != null && tare != null
  const wrongWay = both && !(gross > tare)
  const net = both && !wrongWay ? gross - tare : null
  const bushels = net != null && lbPerBu ? bushelsFromKg(net, lbPerBu) : null
  const previousTare = lastTare(allLoads ?? [], truck || null, trailer || null)

  // More than the bin had room for (Sam, 20 Oct 2026): ask whether the rest
  // went into another bin. Nobody types how much: the first bin is filled to
  // its room, the rest goes into the second. Or it all went in, over its max.
  const binRow = (id: string) => (bins ?? []).find((b) => b.id === id) ?? null
  const shortBin = (id: string) => binRow(id)?.name.replace(/^Main Yard\s*-\s*/i, '') ?? 'the bin'
  const heldIn = (id: string) =>
    (onHand ?? []).filter((o) => o.bin_id === id).reduce((s, o) => s + o.onhand_bu, 0)
  // This load's own grain, already counted in the bin when it is being corrected.
  const ownIn = (id: string) => (load && !isOpenLoad(load) ? loadInBin(load, id).bushels : 0)
  const roomIn = (id: string) => {
    const cap = Number(binRow(id)?.capacity_bu ?? 0)
    return cap > 0 ? Math.max(0, cap - (heldIn(id) - ownIn(id))) : null
  }
  const firstRoom = form.dest === 'bin' && form.bin_id ? roomIn(form.bin_id) : null
  // A split load being corrected in the same bin keeps what that bin took, so
  // fixing a typo never shovels grain between bins behind your back.
  const splitTook =
    load?.overflow_bin_id && load.first_bin_bu != null && load.bin_id === form.bin_id
      ? Number(load.first_bin_bu)
      : null
  const firstBu = splitTook != null && !form.resplit ? splitTook : firstRoom
  // ...but the room it was worked out from can turn out to have been wrong —
  // 27 Oct 2026, a load weighed in as its loaded-truck weight made a bin look
  // 708 bu fuller than it was. Then the split is offered again.
  const roomMoved =
    splitTook != null && !form.resplit && firstRoom != null && Math.abs(firstRoom - splitTook) > 0.5
  // One number given as the grain when it is the loaded truck: the empty
  // weight has to come off it first.
  const overTruck =
    single && !!truck && !(Number(form.loadCount) > 1) && !form.overTruckOk
      ? overATruckload(oneKg, allLoads ?? [])
      : null
  const overBy = bushels != null && firstBu != null ? bushels - firstBu : 0
  const tooMuch = form.dest === 'bin' && !!form.bin_id && overBy > 0.5
  const split = tooMuch && !form.allIn && !!form.overflowBin && form.overflowBin !== form.bin_id
  const needsAnswer = tooMuch && !form.allIn && !split
  const restRoom = split ? roomIn(form.overflowBin) : null
  const pickBin = (v: string) =>
    setForm((f) => ({
      ...f,
      bin_id: v,
      overflowBin: v === f.overflowBin ? '' : f.overflowBin,
      allIn: false,
    }))
  const fieldNameOf = (id: string) => (fields ?? []).find((f) => f.id === id)?.name ?? 'this field'
  const soFar = form.field_id
    ? fieldHarvestSoFar(
        (allLoads ?? []).filter((l) => l.id !== editingId),
        form.field_id,
        cropYear,
      )
    : { loads: 0, bushels: 0, last: null, latest: null }

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
          ((!form.crop_id || !c.crop_id || c.crop_id === form.crop_id) &&
            c.status !== 'cancelled' &&
            c.status !== 'delivered'),
      )
      .map((c) => ({ value: c.id, label: contractLabel(c) })),
  ]

  const wheat = /wheat|durum/i.test(crop?.name ?? '') && !/buckwheat/i.test(crop?.name ?? '')
  const rigLine = [
    otherDriver ? form.driverName.trim() : (people ?? []).find((p) => p.id === driverId)?.full_name,
    truck,
    trailer,
  ]
    .filter(Boolean)
    .join(' · ')

  const missing: string[] = []
  if (!form.crop_id) missing.push(askCrop ? 'the crop' : 'the field')
  if (form.crop_id && !lbPerBu) missing.push("the crop's test weight (Crop settings)")
  if (gross == null && tare == null) missing.push('a weight')
  if (both && form.dest === 'bin' && !form.bin_id) missing.push('the bin')
  if (needsAnswer) missing.push('where the rest went')
  if (overTruck) missing.push('whether that weight is the grain or the loaded truck')
  if (both && form.dest === 'plant' && !form.site_id) missing.push('the plant')
  const bad = (gross != null && !(gross > 0)) || (tare != null && !(tare >= 0))
  const canSave = !missing.length && !wrongWay && !bad && !!form.loaded_on

  // What each step needs before the next. Weigh in: the field and the full
  // weight (or the one number). Weigh out: where it went and the empty weight.
  const inNeeds: string[] = []
  if (!form.crop_id) inNeeds.push(askCrop ? 'the crop' : 'the field')
  if (gross == null) inNeeds.push(single ? 'the weight' : 'the full weight')
  const inDone = inNeeds.length === 0 && !(gross != null && !(gross > 0))
  const outNeeds: string[] = []
  if (form.dest === 'bin' && !form.bin_id) outNeeds.push('the bin')
  if (form.dest === 'plant' && !form.site_id) outNeeds.push('the plant')
  if (!single && tare == null) outNeeds.push('the empty weight')
  if (form.crop_id && !lbPerBu) outNeeds.push("the crop's test weight (Crop settings)")
  if (needsAnswer) outNeeds.push('where the rest went')
  if (overTruck) outNeeds.push('whether that weight is the grain or the loaded truck')
  const outDone = inDone && both && !wrongWay && !bad && outNeeds.length === 0
  // Weighed in, not out yet: saved now, the empty added on the way back.
  const halfWeighed = !single && gross != null && tare == null && !correcting
  const stepNeeds = step === 1 ? inNeeds : step === 2 ? outNeeds : canSave ? [] : missing

  const doSave = async () => {
    const driver = (people ?? []).find((p) => p.id === driverId)
    // The scale photos go up first; the load keeps their paths.
    setPhotoError(null)
    let fullPhoto: string | null
    let emptyPhoto: string | null
    try {
      setUploading(true)
      fullPhoto = form.fullPhoto.file
        ? await uploadScalePhoto(form.fullPhoto.file)
        : form.fullPhoto.path
      // A net or a bin total is one number: one photo, kept as the full one.
      emptyPhoto = single
        ? null
        : form.emptyPhoto.file
          ? await uploadScalePhoto(form.emptyPhoto.file)
          : form.emptyPhoto.path
    } catch (e) {
      setPhotoError(`The photo did not upload: ${(e as Error).message}`)
      return
    } finally {
      setUploading(false)
    }
    // Uploaded once: a second press of Save keeps the same files.
    setForm((f) => ({ ...f, fullPhoto: savedPhoto(fullPhoto), emptyPhoto: savedPhoto(emptyPhoto) }))
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
            (load && form.field_id === load.field_id && form.crop_id === load.crop_id
              ? load.variety
              : null))
          : null,
        crop_year: cropYear,
        field_id: form.field_id || null,
        loaded_on: form.loaded_on,
        gross_kg: gross,
        tare_kg: tare,
        entry_kind: form.kind,
        estimated: form.estimated && form.kind !== 'weighed',
        load_count:
          form.kind === 'bin_total' && Number(form.loadCount) > 0
            ? Math.round(Number(form.loadCount))
            : null,
        moisture_pct:
          moisture.trim() && Number(moisture) > 0 && Number(moisture) < 60
            ? Number(moisture)
            : null,
        protein_pct:
          form.protein.trim() && Number(form.protein) > 3 && Number(form.protein) < 30
            ? Number(form.protein)
            : null,
        lb_per_bu: lbPerBu as number,
        truck: truck || null,
        trailer: trailer || null,
        driver: otherDriver ? form.driverName.trim() || null : (driver?.full_name ?? null),
        driver_id: otherDriver ? null : (driver?.id ?? null),
        note: form.note.trim() || null,
        last_from_field: form.last && !!form.field_id,
        full_photo: fullPhoto,
        empty_photo: emptyPhoto,
        // Times only when somebody changed them; otherwise the database stamps them.
        ...(load && form.fullAt !== toTimeInput(load.full_at)
          ? { full_at: fromTimeInput(form.fullAt) }
          : {}),
        ...(load && form.emptyAt !== toTimeInput(load.empty_at)
          ? { empty_at: fromTimeInput(form.emptyAt) }
          : {}),
        weighed_in_by: form.weighedInBy || null,
        // A net or a bin total was never weighed out; the database clears it either way.
        weighed_out_by: single ? null : form.weighedOutBy || null,
        overflow_bin_id: split ? form.overflowBin : null,
        first_bin_bu: split && firstBu != null ? Math.round(firstBu * 100) / 100 : null,
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
          <Check className="h-4 w-4" /> {saved.estimated ? 'About ' : ''}
          {bu(saved.bushels)} {saved.delivery_site_id ? 'to' : 'into'} {binName}
          {saved.estimated && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              estimate
            </span>
          )}
          {saved.contract_id && (contracts ?? []).find((c) => c.id === saved.contract_id) && (
            <span className="font-normal">
              {' '}
              · on{' '}
              {
                contractLabel((contracts ?? []).find((c) => c.id === saved.contract_id)!).split(
                  ' · ',
                )[0]
              }
            </span>
          )}
        </p>
        <p className="text-xs text-green-900/80">
          {saved.entry_kind === 'weighed'
            ? `${kg(saved.gross_kg)} full − ${kg(saved.tare_kg)} empty = ${kg(saved.net_kg)}`
            : `${saved.estimated ? 'An estimated ' : ''}${kg(saved.net_kg)} ${saved.entry_kind === 'bin_total' ? `into the bin${saved.load_count ? ` over ${saved.load_count} loads` : ''}` : 'net off the truck'}`}{' '}
          at {Number(saved.lb_per_bu)} lb/bu.
          {saved.estimated ? ' Open the load and put in the real weight when it is known.' : ''}
        </p>
        {saved.overflow_bin_id && saved.bin_id && (
          <p className="text-xs text-green-900/80">
            Filled {shortBin(saved.bin_id)} with about {bu(loadInBin(saved, saved.bin_id).bushels)};
            the rest, about {bu(loadInBin(saved, saved.overflow_bin_id).bushels)}, into{' '}
            {shortBin(saved.overflow_bin_id)}.
          </p>
        )}
        {saved.last_from_field && saved.field_id && (
          <FieldYieldNote fieldId={saved.field_id} cropYear={saved.crop_year} />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              // Same field, truck and driver; a fresh pair of weights.
              setForm((f) => ({
                ...f,
                gross: '',
                tare: '',
                netOnly: '',
                estimated: false,
                loadCount: '',
                moisture: '',
                protein: '',
                note: '',
                last: false,
                loaded_on: today(),
                fullPhoto: savedPhoto(null),
                emptyPhoto: savedPhoto(null),
                overflowBin: '',
                allIn: false,
              }))
              setMoistureTouched(false)
              setEditingId(null)
              setSaved(null)
              setStep(1)
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
                setForm((f) => ({
                  ...f,
                  gross: saved.tare_kg != null ? String(Math.round(Number(saved.tare_kg))) : '',
                  tare: '',
                  bin_id: '',
                  note: '',
                  last: false,
                  fullPhoto: savedPhoto(saved.empty_photo),
                  emptyPhoto: savedPhoto(null),
                  overflowBin: '',
                  allIn: false,
                }))
                setEditingId(null)
                setSaved(null)
                setStep(2)
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
      <StepBar
        step={step}
        reachable={inDone ? (outDone ? 3 : 2) : 1}
        onStep={setStep}
        single={single}
      />
      <div className="grid grid-cols-2 gap-2.5">
        {/* 1. Weigh in (Sam, 23 Oct 2026): the field, who and what is
            hauling, and the full weight. Where it went is the weigh-out's. */}
        {step === 1 && (
          <>
            <label className={cn(label, 'col-span-2')}>
              From which field?
              <Select
                value={form.field_id}
                ariaLabel="Field"
                placeholder="Pick the field…"
                className="mt-1"
                onChange={pickField}
                options={fieldOptions}
              />
            </label>

            {askCrop && (
              <label className={cn(label, 'col-span-2')}>
                Crop
                <Select
                  value={form.crop_id}
                  ariaLabel="Crop"
                  placeholder="Pick the crop…"
                  className="mt-1"
                  onChange={pickCrop}
                  options={cropOptions}
                />
                {form.field_id && form.crop_id && varietyOf(form.field_id, form.crop_id) && (
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    {varietyOf(form.field_id, form.crop_id)}
                  </span>
                )}
              </label>
            )}

            {/* Who and what is hauling, always on the first step (Sam, 21 Oct 2026):
            the driver is whoever holds the phone, the truck and trailer their last load's. */}
            <label className={cn(label, 'col-span-2')}>
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
              {otherDriver && (
                <>
                  <input
                    value={form.driverName}
                    onChange={(e) => set('driverName', e.target.value)}
                    list="weigh-typed-drivers"
                    placeholder="Driver's name"
                    aria-label="Driver's name"
                    autoFocus={!load}
                    className={box}
                  />
                  <datalist id="weigh-typed-drivers">
                    {typedDrivers.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    Kept on this load only; not added to the list of people.
                  </span>
                </>
              )}
            </label>
            <label className={label}>
              Truck
              <Select
                value={truck}
                ariaLabel="Truck"
                className="mt-1"
                onChange={(v) => pickUnit('truck', v)}
                options={unitOptions('truck')}
              />
            </label>
            <label className={label}>
              Trailer
              <Select
                value={trailer}
                ariaLabel="Trailer"
                className="mt-1"
                onChange={(v) => pickUnit('trailer', v)}
                options={unitOptions('trailer')}
              />
            </label>

            {adding && (
              <div className="col-span-2 flex items-end gap-2 rounded-md border border-gray-200 bg-white p-2">
                <label className={cn(label, 'flex-1')}>
                  New {adding.kind} name
                  <input
                    autoFocus
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                    placeholder={adding.kind === 'truck' ? 'e.g. Kenworth #2' : 'e.g. Super B #6'}
                    className={box}
                  />
                </label>
                <button
                  type="button"
                  disabled={!adding.name.trim() || addUnit.isPending}
                  onClick={() =>
                    addUnit.mutate(
                      { kind: adding.kind, name: adding.name },
                      {
                        onSuccess: () => {
                          setRigTouched(true)
                          setForm((f) => ({
                            ...f,
                            truck,
                            trailer,
                            [adding.kind]: adding.name.trim(),
                          }))
                          setAdding(null)
                        },
                      },
                    )
                  }
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {addUnit.isPending ? 'Adding…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(null)}
                  className="pb-1.5 text-xs text-gray-500 underline"
                >
                  Cancel
                </button>
              </div>
            )}
            {addUnit.isError && (
              <p className="col-span-2 text-xs text-red-700">{(addUnit.error as Error).message}</p>
            )}
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
                    // A load already saved can still change how it was weighed
                    // (Sam, 27 Oct 2026: a net that was really a bin total, a
                    // pair of weights typed as one number). The weight it has
                    // carries over where the two kinds mean the same thing.
                    onClick={() =>
                      setForm((f) => {
                        const wasOne = f.kind !== 'weighed'
                        const isOne = k !== 'weighed'
                        return {
                          ...f,
                          kind: k,
                          // A finished pair becomes the one net it added up to...
                          netOnly:
                            isOne && !wasOne && !f.netOnly.trim() && net != null
                              ? String(Math.round(net))
                              : f.netOnly,
                          // ...and the one number does not pretend to be a pair:
                          // nobody weighed a truck at 0, so both boxes start empty.
                          gross: !isOne && wasOne ? '' : f.gross,
                          tare: !isOne && wasOne ? '' : f.tare,
                          estimated: k === 'bin_total' ? f.estimated : false,
                        }
                      })
                    }
                    className={cn(
                      'flex-1 px-2 py-1.5 leading-tight disabled:opacity-40',
                      form.kind === k
                        ? 'bg-brand-700 font-semibold text-white'
                        : 'text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {text}
                  </button>
                ))}
              </span>
              {/* Nobody weighed it (Sam, 9 Oct 2026): a best guess now, the real
              weight later. Offered under Bin total only, to keep the form
              simple (20 Oct 2026); an estimate already saved still shows it. */}
              {(form.kind === 'bin_total' || form.estimated) && (
                <label className="mt-1.5 flex items-center gap-2 text-xs font-normal text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.estimated}
                    onChange={(e) => set('estimated', e.target.checked)}
                  />
                  Not weighed: this is an estimate
                </label>
              )}
            </div>

            {form.kind === 'weighed' ? (
              <label className={cn(label, 'col-span-2')}>
                Truck full (kg)
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.gross}
                  onChange={(e) => set('gross', e.target.value)}
                  placeholder="e.g. 61390"
                  className={numBox}
                />
                <ScalePhoto
                  photo={form.fullPhoto}
                  onChange={(p) => set('fullPhoto', p)}
                  what="the full weight"
                  current={form.gross}
                  onWeight={(w) => set('gross', String(w))}
                />
                {load?.full_at && (
                  <WeighTimeBox
                    label="Weighed in"
                    value={form.fullAt}
                    onChange={(v) => set('fullAt', v)}
                  />
                )}
                <WeigherBox
                  label="Weighed in by"
                  value={form.weighedInBy}
                  people={people ?? []}
                  onChange={(v) => set('weighedInBy', v)}
                />
              </label>
            ) : (
              <>
                <label className={label}>
                  {form.estimated
                    ? `Estimated ${form.kind === 'net' ? 'load' : 'total into the bin'}`
                    : form.kind === 'net'
                      ? 'Net off the truck (kg)'
                      : 'Total into the bin (kg)'}
                  <span className="flex gap-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.netOnly}
                      onChange={(e) => set('netOnly', e.target.value)}
                      placeholder={
                        form.estimated
                          ? 'best guess'
                          : form.kind === 'net'
                            ? 'e.g. 40580'
                            : 'e.g. 91440'
                      }
                      className={cn(numBox, 'min-w-0 flex-1')}
                    />
                    {form.estimated && (
                      <select
                        value={form.estUnit}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, estUnit: e.target.value as Form['estUnit'] }))
                        }
                        aria-label="Estimate in"
                        className="mt-1 rounded-md border border-gray-300 bg-white px-1.5 text-sm"
                      >
                        <option value="kg">kg</option>
                        <option value="t">tonnes</option>
                        <option value="bu">bu</option>
                      </select>
                    )}
                  </span>
                  {!form.estimated && (
                    <ScalePhoto
                      photo={form.fullPhoto}
                      onChange={(p) => set('fullPhoto', p)}
                      what="the weight"
                      current={form.netOnly}
                      onWeight={(w) => set('netOnly', String(w))}
                    />
                  )}
                </label>
                {form.kind === 'bin_total' ? (
                  <label className={label}>
                    How many loads <span className="text-gray-400">(optional)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={form.loadCount}
                      onChange={(e) => set('loadCount', e.target.value)}
                      placeholder="e.g. 3"
                      className={numBox}
                    />
                  </label>
                ) : (
                  <span className={cn(label, 'self-end pb-2 text-[11px] text-gray-400')}>
                    Just the one number the driver sent.
                  </span>
                )}
              </>
            )}
          </>
        )}

        {/* 2. Weigh out: which bin (or plant) it went into, and the empty weight. */}
        {step === 2 && (
          <>
            <div className={cn(label, 'col-span-2')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Going to</span>
                <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-[11px]">
                  {(['bin', 'plant'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set('dest', d)}
                      className={cn(
                        'px-2 py-0.5',
                        form.dest === d
                          ? 'bg-brand-700 font-semibold text-white'
                          : 'text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {d === 'bin' ? 'A bin' : 'Straight to a plant'}
                    </button>
                  ))}
                </span>
              </div>
              {form.dest === 'bin' ? (
                <>
                  <Select
                    value={form.bin_id}
                    ariaLabel="Bin"
                    placeholder="Pick the bin…"
                    className="mt-1"
                    onChange={pickBin}
                    options={binOptions}
                  />
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    {!form.field_id
                      ? 'Pick the field first; its planned bin fills in.'
                      : assigned.length === 0
                        ? 'No bin planned for this field — pick any.'
                        : assigned.length === 1
                          ? form.bin_id === assigned[0]
                            ? 'The bin planned for this field. Any other can be picked.'
                            : 'Not the planned bin — that is fine if it went elsewhere.'
                          : `${assigned.length} bins planned for this field — pick which one.`}
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
                    options={[
                      ...(sites ?? []).map((x) => ({ value: x.id, label: x.name })),
                      { value: ADD, label: '+ Add a plant or elevator…' },
                    ]}
                  />
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    No bin: counted in the field's yield, not in any bin.
                  </span>
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

            {newSite != null && (
              <div className="col-span-2 flex items-end gap-2 rounded-md border border-gray-200 bg-white p-2">
                <label className={cn(label, 'flex-1')}>
                  New plant or elevator
                  <input
                    autoFocus
                    value={newSite}
                    onChange={(e) => setNewSite(e.target.value)}
                    placeholder="e.g. Cargill Lethbridge"
                    className={box}
                  />
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
                <button
                  type="button"
                  onClick={() => setNewSite(null)}
                  className="pb-1.5 text-xs text-gray-500 underline"
                >
                  Cancel
                </button>
              </div>
            )}
            {addSite.isError && (
              <p className="col-span-2 text-xs text-red-700">
                {/duplicate|unique/i.test((addSite.error as Error).message)
                  ? 'That one is already on the list.'
                  : (addSite.error as Error).message}
              </p>
            )}

            {form.kind === 'weighed' && (
              <>
                <label className={cn(label, 'col-span-2')}>
                  Truck empty (kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={form.tare}
                    onChange={(e) => set('tare', e.target.value)}
                    placeholder="e.g. 20810"
                    className={numBox}
                  />
                  {form.tare === '' && previousTare != null && (
                    <button
                      type="button"
                      onClick={() => set('tare', String(Math.round(previousTare)))}
                      className="mt-0.5 block text-left text-[11px] text-brand-700 underline decoration-dotted"
                    >
                      Last empty for this truck: {kg(previousTare)}
                    </button>
                  )}
                  <ScalePhoto
                    photo={form.emptyPhoto}
                    onChange={(p) => set('emptyPhoto', p)}
                    what="the empty weight"
                    current={form.tare}
                    onWeight={(w) => set('tare', String(w))}
                  />
                  {load?.empty_at && (
                    <WeighTimeBox
                      label="Weighed out"
                      value={form.emptyAt}
                      onChange={(v) => set('emptyAt', v)}
                    />
                  )}
                  <WeigherBox
                    label="Weighed out by"
                    value={form.weighedOutBy}
                    people={people ?? []}
                    onChange={(v) => set('weighedOutBy', v)}
                  />
                </label>
              </>
            )}

            {/* A weight that is the loaded truck, given as the grain (27 Oct 2026):
            the bin it goes into holds the truck's own weight until somebody
            notices, and a split worked out in the meantime goes in wrong. */}
            {overTruck && oneKg != null && (
              <div className="col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">
                  {kg(oneKg)} is more grain than a truck carries
                  {overTruck.biggest != null
                    ? `; the biggest load weighed here is ${kg(overTruck.biggest)}`
                    : ''}
                  .
                </p>
                <p className="mt-0.5">
                  If that is the loaded truck, the empty weight still has to come off it.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        kind: 'weighed',
                        gross: String(Math.round(oneKg)),
                        tare: '',
                        netOnly: '',
                        estimated: false,
                      }))
                      setStep(2)
                    }}
                    className="font-semibold underline decoration-dotted"
                  >
                    It is the loaded truck — weigh out
                  </button>
                  <button
                    type="button"
                    onClick={() => set('overTruckOk', true)}
                    className="underline decoration-dotted"
                  >
                    No, that is the grain
                  </button>
                </div>
              </div>
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
                {crop ? (
                  lbPerBu ? (
                    `${crop.name} at ${lbPerBu} lb/bu${net != null ? ` · ${Math.round(net * KG_TO_LB).toLocaleString('en-CA')} lb` : ''}`
                  ) : (
                    <>
                      No test weight for {crop.name} yet:{' '}
                      <Link to="/crops" className="text-brand-700 underline">
                        set it in Crop settings
                      </Link>
                      .
                    </>
                  )
                ) : askCrop ? (
                  'Pick the crop to get bushels.'
                ) : (
                  'Pick the field to get bushels.'
                )}
              </p>
            </div>

            {tooMuch && bushels != null && firstBu != null && (
              <div
                className={cn(
                  'col-span-2 rounded-md border px-3 py-2 text-xs',
                  needsAnswer
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-gray-200 bg-white text-gray-700',
                )}
              >
                <p className="font-semibold">
                  {shortBin(form.bin_id)}{' '}
                  {splitTook != null && !form.resplit ? 'took' : 'only had room for'} about{' '}
                  {bu(firstBu)}; this load is {bu(bushels)}.
                </p>
                {/* The room it was split on can turn out to have been wrong. */}
                {roomMoved && firstRoom != null && (
                  <p className="mt-0.5">
                    {shortBin(form.bin_id)} has room for about {bu(firstRoom)} now — this was worked
                    out when it showed room for {bu(splitTook)}.{' '}
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, resplit: true, overflowBin: '', allIn: false }))
                      }
                      className="font-semibold underline decoration-dotted"
                    >
                      Work it out again
                    </button>
                  </p>
                )}
                {needsAnswer ? (
                  <>
                    <p className="mt-0.5">
                      Did it fill {shortBin(form.bin_id)} and the rest go into another bin?
                    </p>
                    <Select
                      value=""
                      ariaLabel="Bin the rest went into"
                      placeholder="The rest went into…"
                      className="mt-1.5"
                      onChange={(v) => setForm((f) => ({ ...f, overflowBin: v, allIn: false }))}
                      options={binOptions.filter((o) => o.value !== form.bin_id)}
                    />
                    <button
                      type="button"
                      onClick={() => set('allIn', true)}
                      className="mt-1.5 text-left text-[11px] text-amber-900 underline decoration-dotted"
                    >
                      No, it all went into {shortBin(form.bin_id)} (it will show over its max)
                    </button>
                  </>
                ) : split ? (
                  <p className="mt-0.5">
                    Filled {shortBin(form.bin_id)} with about {bu(firstBu)}; the rest, about{' '}
                    {bu(overBy)}, into {shortBin(form.overflowBin)}.
                    {restRoom != null && overBy - restRoom > 0.5
                      ? ` That is more than ${shortBin(form.overflowBin)} has room for too (about ${bu(restRoom)}).`
                      : ''}{' '}
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, overflowBin: '', allIn: false }))}
                      className="underline decoration-dotted"
                    >
                      Change
                    </button>
                  </p>
                ) : (
                  <p className="mt-0.5">
                    All of it into {shortBin(form.bin_id)}: it will show {bu(overBy)} over its max.{' '}
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, overflowBin: '', allIn: false }))}
                      className="underline decoration-dotted"
                    >
                      Change
                    </button>
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            {/* What is about to be saved, big enough to read at a glance (Sam, 20 Oct 2026). */}
            <div className="col-span-2 space-y-1.5 rounded-md border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {bushels != null ? `${form.estimated ? 'About ' : ''}${bu(bushels)}` : '—'}
                <span className="ml-2 text-base font-normal text-gray-500">
                  {net != null ? `${kg(net)} net` : ''}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="block w-full text-left text-xs text-gray-700 hover:text-brand-800"
              >
                <span className="text-gray-400">From </span>
                {form.field_id ? fieldNameOf(form.field_id) : 'no field'}
                {crop ? ` · ${crop.name}` : ''}
                <span className="text-gray-400"> to </span>
                {form.dest === 'plant'
                  ? ((sites ?? []).find((x) => x.id === form.site_id)?.name ?? 'a plant')
                  : split
                    ? `${shortBin(form.bin_id)}, the rest into ${shortBin(form.overflowBin)}`
                    : shortBin(form.bin_id)}
                <span className="ml-1 text-brand-700 underline decoration-dotted">change</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="block w-full text-left text-xs text-gray-700 hover:text-brand-800"
              >
                {form.kind === 'weighed'
                  ? `${kg(gross)} full − ${kg(tare)} empty`
                  : `${form.kind === 'net' ? 'Net off the truck' : 'Bin total'}${form.estimated ? ', estimated' : ''}`}
                {(form.fullPhoto.path ||
                  form.fullPhoto.file ||
                  form.emptyPhoto.path ||
                  form.emptyPhoto.file) && (
                  <Camera className="ml-1 inline h-3 w-3 text-gray-400" aria-label="With a photo" />
                )}
                <span className="ml-1 text-brand-700 underline decoration-dotted">change</span>
              </button>
              {/* When, from the scale: a time already saved, else "now" on save. */}
              <p className="text-[11px] text-gray-500">
                {form.kind === 'weighed'
                  ? `Weighed in ${load?.full_at ? weighTime(fromTimeInput(form.fullAt)) : 'now'} · weighed out ${load?.empty_at ? weighTime(fromTimeInput(form.emptyAt)) : tare != null ? 'now' : 'later'}`
                  : `Weighed ${load?.full_at ? weighTime(fromTimeInput(form.fullAt)) : 'now'}`}
              </p>
              {rigLine && <p className="text-[11px] text-gray-500">{rigLine}</p>}
              {/* Who stood at the scale, which is not always who drove. */}
              {(form.weighedInBy || form.weighedOutBy) && (
                <p className="text-[11px] text-gray-500">
                  {[
                    form.weighedInBy ? `In by ${personName(form.weighedInBy)}` : null,
                    !single && form.weighedOutBy ? `out by ${personName(form.weighedOutBy)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>

            <label className={label}>
              Date
              <DateField
                value={form.loaded_on}
                onChange={(v) => set('loaded_on', v)}
                className="mt-1 rounded-md bg-white"
              />
            </label>
            <label className={label}>
              Moisture %
              <input
                type="number"
                inputMode="decimal"
                value={moisture}
                onChange={(e) => {
                  setMoistureTouched(true)
                  set('moisture', e.target.value)
                }}
                placeholder="from the tester"
                className={numBox}
              />
              {reading && (
                <span className="mt-0.5 block text-[11px] text-gray-400">
                  Last {reading.from === 'test' ? 'reading for' : 'load of'}{' '}
                  {cropName(form.crop_id)}: {reading.pct}% ({dayMonth(reading.on)})
                </span>
              )}
              {crop?.moisture_dry_max != null &&
                Number(moisture) > Number(crop.moisture_dry_max) &&
                Number(moisture) < 60 && (
                  <span className="mt-0.5 block text-[11px] text-amber-700">
                    Wet (dry is {Number(crop.moisture_dry_max)}%): the field yield counts it at{' '}
                    {Math.round(
                      ((100 - Number(moisture)) / (100 - Number(crop.moisture_dry_max))) * 1000,
                    ) / 10}
                    % of its weight.
                  </span>
                )}
            </label>

            {form.field_id && form.crop_id && (
              <TruckForecastLine
                cropYear={cropYear}
                fieldId={form.field_id}
                cropId={form.crop_id}
                thisLoadBu={bushels}
                editing={!!editingId}
              />
            )}
            {form.field_id && (
              <label
                className={cn(
                  'col-span-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
                  form.last
                    ? 'border-green-300 bg-green-50 text-green-900'
                    : 'border-gray-200 bg-white text-gray-700',
                )}
              >
                <input
                  type="checkbox"
                  checked={form.last}
                  onChange={(e) => set('last', e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-green-700"
                />
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
                        : 'Tick when the field is done, and its yield is recorded from the loads.'}
                  </span>
                </span>
              </label>
            )}

            {wheat && (
              <label className={label}>
                Protein %
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.protein}
                  onChange={(e) => set('protein', e.target.value)}
                  placeholder="off the ticket"
                  className={numBox}
                />
              </label>
            )}
            <label className={cn(label, !wheat && 'col-span-2')}>
              Note
              <input
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                className={box}
              />
            </label>
          </>
        )}
      </div>

      {/* One step at a time, with big buttons for a phone in the truck. */}
      <div className="flex flex-wrap items-center gap-2">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep((st) => (st - 1) as Step)}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        {/* Weighed in and not out yet: saved now, finished on the way back. */}
        {step <= 2 && halfWeighed && (
          <button
            type="button"
            disabled={!canSave || save.isPending || uploading}
            onClick={() => void doSave()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40 sm:flex-none"
          >
            <Clock className="h-4 w-4" />
            {uploading ? 'Uploading photo…' : save.isPending ? 'Saving…' : 'Save — weigh out later'}
          </button>
        )}
        {step === 1 && (
          <button
            type="button"
            disabled={!inDone}
            onClick={() => setStep(2)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 sm:flex-none"
          >
            {single ? 'Next: where it went' : 'Next: weigh out'} <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            disabled={!outDone}
            onClick={() => setStep(3)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 sm:flex-none"
          >
            Next: check <ArrowRight className="h-4 w-4" />
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            disabled={!canSave || save.isPending || uploading}
            onClick={() => void doSave()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 sm:flex-none"
          >
            <Check className="h-4 w-4" />
            {uploading ? 'Uploading photo…' : save.isPending ? 'Saving…' : 'Save load'}
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-1 text-xs text-gray-500 underline">
            Cancel
          </button>
        )}
      </div>
      {stepNeeds.length > 0 && (
        <p className="text-[11px] text-gray-500">Needs {stepNeeds.join(', ')}.</p>
      )}
      {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
      {photoError && <p className="text-xs text-red-700">{photoError}</p>}
    </div>
  )
}

type Step = 1 | 2 | 3
const STEPS = (single: boolean): [Step, string][] => [
  [1, 'Weigh in'],
  [2, single ? 'Where it went' : 'Weigh out'],
  [3, 'Check & save'],
]

/** Where the form is: done steps can be gone back to, the next one once it is ready. */
function StepBar({
  step,
  reachable,
  onStep,
  single,
}: {
  step: Step
  reachable: Step
  onStep: (s: Step) => void
  single: boolean
}) {
  return (
    <ol className="flex gap-1 text-[11px]">
      {STEPS(single).map(([n, text]) => (
        <li key={n} className="flex-1">
          <button
            type="button"
            disabled={n > reachable}
            onClick={() => onStep(n)}
            aria-current={n === step ? 'step' : undefined}
            className={cn(
              'w-full rounded-md border px-1.5 py-1 font-medium disabled:opacity-40',
              n === step
                ? 'border-brand-700 bg-brand-700 text-white'
                : n < step
                  ? 'border-brand-200 bg-brand-50 text-brand-800'
                  : 'border-gray-200 bg-white text-gray-500',
            )}
          >
            {n}. {text}
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * A photo of the scale's readout under a weight (Sam, 20 Oct 2026). One
 * big Photo button (21 Oct: small ones were "too small for fingers"), which
 * asks Camera or Gallery itself: newer Android answers a plain picture picker
 * with Google Photos alone, no camera (22 Oct), so the app asks. Camera opens
 * the back camera; Gallery the phone's photos. Tap the picture to see it large.
 */
/** When a weight was taken, to correct; the database stamps it when it is first entered. */
/**
 * Who stood at the scale for one of the weights (Sam, 27 Oct 2026). The
 * driver hauled the load; this is who wrote the number down, which is often
 * somebody else. It starts on whoever is signed in.
 */
function WeigherBox({
  label: text,
  value,
  people,
  onChange,
}: {
  label: string
  value: string
  people: { id: string; full_name: string }[]
  onChange: (v: string) => void
}) {
  return (
    <span className="mt-1.5 block">
      <span className="block text-[11px] text-gray-500">{text}</span>
      <Select
        value={value}
        ariaLabel={text}
        size="sm"
        className="mt-0.5"
        onChange={onChange}
        options={[
          { value: '', label: 'Not recorded' },
          ...people.map((p) => ({ value: p.id, label: p.full_name })),
        ]}
      />
    </span>
  )
}

function WeighTimeBox({
  label: text,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <span className="mt-1.5 block">
      <span className="block text-[11px] text-gray-500">{text}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
      />
    </span>
  )
}

function ScalePhoto({
  photo,
  onChange,
  what,
  current,
  onWeight,
}: {
  photo: Photo
  onChange: (p: Photo) => void
  what: string
  /** What is typed in the weight box this photo belongs to. */
  current?: string
  /** Fill that box with the kilograms read off the photo. */
  onWeight?: (kg: number) => void
}) {
  const { data: savedUrl } = useScalePhotoUrl(photo.file ? null : photo.path)
  const local = useMemo(() => (photo.file ? URL.createObjectURL(photo.file) : null), [photo.file])
  const url = local ?? savedUrl ?? null
  const has = !!photo.file || !!photo.path
  const [choosing, setChoosing] = useState(false)
  // Buttons, not labels: this sits inside the weight's own label.
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  // A HEIC photo (a Samsung or iPhone gallery) is made a JPEG on the phone
  // first: Chrome can neither show nor shrink one (Sam, 23 Oct 2026).
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  // What the scale said, read off the photo (Sam, 27 Oct 2026). The weight
  // goes into the box the moment it is read, so the driver can hold the phone
  // up against the display and see the two agree before saving.
  const [read, setRead] = useState<ScaleRead | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const typed = (current ?? '').trim()
  const readWeight = (file: File) => {
    if (!onWeight) return
    setRead(null)
    setReadError(null)
    setReading(true)
    readScalePhoto(file)
      .then((r) => {
        setRead(r)
        // Filled in only when both reads agreed, the number is one a farm
        // scale could show, and the box is empty; anything else is offered
        // under the photo, never typed over.
        if (!typed && r.kg != null && usableRead(r)) onWeight(r.kg)
      })
      .catch((e: Error) => setReadError(e.message))
      .finally(() => setReading(false))
  }
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    setChoosing(false)
    if (!f) return
    setConvertError(null)
    setConverting(true)
    viewableFile(f)
      .then((file) => {
        onChange({ path: null, file })
        readWeight(file)
      })
      .catch(() =>
        setConvertError('That photo could not be read. Try taking it with the camera instead.'),
      )
      .finally(() => setConverting(false))
  }
  const big =
    'flex h-12 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50'
  return (
    <span className="mt-1.5 flex w-full items-center gap-2">
      {converting ? (
        <span className="flex h-12 flex-1 items-center justify-center rounded-md border border-dashed border-gray-300 bg-white text-sm text-gray-500">
          Getting the photo ready…
        </span>
      ) : has ? (
        <>
          <a
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-gray-300 bg-gray-100"
            title={`Photo of ${what}`}
          >
            {url && (
              <img
                src={url}
                alt={`Scale photo of ${what}`}
                className="h-full w-full object-cover"
              />
            )}
          </a>
          <button
            type="button"
            onClick={() => setChoosing(true)}
            aria-label={`Change the photo of ${what}`}
            className={cn(big, 'min-w-12 px-3 text-gray-600')}
          >
            <Camera className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              onChange({ path: null, file: null })
              setRead(null)
              setReadError(null)
            }}
            aria-label={`Remove the photo of ${what}`}
            className={cn(big, 'w-12 text-gray-500 hover:text-red-600')}
          >
            <X className="h-5 w-5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          aria-label={`Photo of ${what}`}
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border-2 border-dashed border-gray-300 bg-white text-sm text-gray-600 hover:bg-gray-50"
        >
          <Camera className="h-6 w-6" /> Photo
        </button>
      )}
      {/* The choice as a pop-up of its own (Sam, 22 Oct 2026: the two buttons
          in the row were too small to read and to tap). */}
      {choosing &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center"
            onClick={() => setChoosing(false)}
          >
            <div
              className="w-full max-w-sm space-y-2 rounded-xl bg-white p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="pb-1 text-center text-base font-semibold text-gray-900">
                Photo of {what}
              </p>
              <button
                type="button"
                onClick={() => camera.current?.click()}
                className="flex h-16 w-full items-center justify-center gap-3 rounded-lg bg-brand-700 text-lg font-semibold text-white hover:bg-brand-800"
              >
                <Camera className="h-7 w-7" /> Take a photo
              </button>
              <button
                type="button"
                onClick={() => gallery.current?.click()}
                className="flex h-16 w-full items-center justify-center gap-3 rounded-lg border-2 border-brand-700 bg-white text-lg font-semibold text-brand-800 hover:bg-brand-50"
              >
                <ImageIcon className="h-7 w-7" /> Choose from gallery
              </button>
              <button
                type="button"
                onClick={() => setChoosing(false)}
                className="h-12 w-full rounded-lg text-base text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
      {convertError && <span className="basis-full text-[11px] text-red-700">{convertError}</span>}
      {reading && (
        <span className="basis-full text-[11px] text-gray-500">
          Reading the scale off the photo…
        </span>
      )}
      {readError && (
        <span className="basis-full text-[11px] text-amber-700">
          The photo could not be read: {readError} Type the weight in.
        </span>
      )}
      {read && !reading && <ScaleReadLine read={read} typed={typed} onUse={onWeight} />}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={picked}
      />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={picked} />
    </span>
  )
}

/**
 * What the photo of the scale said, under the photo: the number it read, and
 * a button to use it when it is not what is already typed. The weight the
 * person saves is always the one in the box — this never changes it behind
 * them, and the photo stays the record of what the scale showed.
 */
function ScaleReadLine({
  read,
  typed,
  onUse,
}: {
  read: ScaleRead
  typed: string
  onUse?: (kg: number) => void
}) {
  const doubt = read.confidence !== 'high' ? ' Check it against the scale.' : ''
  const note = read.note?.trim() ? ` ${read.note.trim().replace(/[.\s]+$/, '')}.` : ''
  const got = read.kg
  // Not agreed, or nothing readable: the photo is kept, the weight is typed.
  if (got == null || !usableRead(read)) {
    return (
      <span className="basis-full text-[11px] text-amber-700">
        The photo could not be read for certain, so nothing has been filled in.{note} Type the
        weight in.
      </span>
    )
  }
  const same = typed !== '' && Math.abs(Number(typed) - got) < 1
  if (typed === '' || same) {
    return (
      <span className="basis-full text-[11px] text-gray-500">
        From the photo: <b className="tabular-nums text-gray-700">{kg(got)}</b>
        {read.unit === 'lb'
          ? ' (the display was in pounds)'
          : read.unit === 't'
            ? ' (the display was in tonnes)'
            : ''}
        .{doubt}
        {note}
      </span>
    )
  }
  return (
    <span className="basis-full text-[11px] text-amber-800">
      The photo reads {kg(got)}, not {kg(Number(typed))}.{doubt}
      {note}{' '}
      {onUse && (
        <button
          type="button"
          onClick={() => onUse(got)}
          className="font-semibold text-brand-700 underline decoration-dotted"
        >
          Use the photo's weight
        </button>
      )}
    </span>
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
  const open = (loads ?? [])
    .filter((l) => isOpenLoad(l) && (!binId || l.bin_id === binId))
    .reverse()
  if (!open.length) return null
  const name = <T extends { id: string; name: string }>(list: T[] | undefined, id: string | null) =>
    (list ?? []).find((x) => x.id === id)?.name ?? null
  return (
    <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
      <p className="flex items-center gap-1.5 border-b border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-900">
        <Clock className="h-3.5 w-3.5" /> Waiting for a second weight ({open.length})
      </p>
      <ul className="divide-y divide-amber-100">
        {open.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="min-w-0">
              <span className="font-medium text-gray-900">
                {name(fields, l.field_id) ?? 'No field'}
              </span>
              <span className="text-gray-600">
                {' '}
                · {name(crops, l.crop_id) ?? ''} →{' '}
                {name(bins, l.bin_id)?.replace(/^Main Yard\s*-\s*/i, '') ??
                  name(sites, l.delivery_site_id) ??
                  'bin not picked'}
              </span>
              <span className="block text-[11px] text-gray-500">
                {l.gross_kg != null
                  ? `full ${kg(l.gross_kg)}, needs the empty`
                  : `empty ${kg(l.tare_kg)}, needs the full`}{' '}
                · {l.loaded_on}
                {l.driver ? ` · ${l.driver}` : ''}
                {l.truck ? ` · ${l.truck}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onFinish(l)}
                className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
              >
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
 * Loads already weighed in, newest first, to open and correct (Sam, 19 Oct
 * 2026: "allow me to edit past loads"). Any crop year; a search narrows by
 * field, bin, plant, driver or date.
 */
export function PastLoads({
  onOpen,
  openId,
}: {
  onOpen: (l: BinLoad) => void
  openId?: string | null
}) {
  const { data: loads } = useBinLoads()
  const { data: fields } = useFields()
  const { data: bins } = useBins()
  const { data: sites } = useDeliverySites()
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(15)
  // Folded until asked for (Sam, 23 Oct 2026): the form is what the
  // weigh-in is for; the history is a tap away.
  const [open, setOpen] = useState(false)
  const where = (l: BinLoad) =>
    l.delivery_site_id
      ? `→ ${(sites ?? []).find((x) => x.id === l.delivery_site_id)?.name ?? 'a plant'}`
      : ((bins ?? []).find((b) => b.id === l.bin_id)?.name ?? '—')
  const fieldName = (id: string | null) => (fields ?? []).find((f) => f.id === id)?.name ?? '—'
  const done = (loads ?? []).filter((l) => !isOpenLoad(l))
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? done.filter((l) =>
        [l.loaded_on, fieldName(l.field_id), where(l), l.driver ?? '', l.truck ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : done
  if (!done.length) return null
  return (
    <div className="rounded-lg border border-gray-200">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-3 py-2',
          open && 'border-b border-gray-200',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} /> Past
          loads ({done.length})
        </button>
        {open && (
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setShown(15)
            }}
            placeholder="Field, bin, driver, date…"
            aria-label="Search past loads"
            className="w-44 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
          />
        )}
      </div>
      {!open ? null : !hits.length ? (
        <p className="px-3 py-3 text-center text-xs text-gray-400">No loads match.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-xs">
          {hits.slice(0, shown).map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onOpen(l)}
                title="Open the load to correct it"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50',
                  openId === l.id && 'bg-brand-50',
                )}
              >
                <span className="w-20 shrink-0 tabular-nums text-gray-700">{l.loaded_on}</span>
                <span className="min-w-0 flex-1 truncate text-gray-800">
                  {fieldName(l.field_id)} <span className="text-gray-400">{where(l)}</span>
                  {l.last_from_field && (
                    <Flag
                      className="ml-1 inline h-3 w-3 text-green-700"
                      fill="currentColor"
                      aria-label="Last load"
                    />
                  )}
                  {l.estimated && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-800">
                      est.
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right tabular-nums font-semibold text-gray-900">
                  {bu(l.bushels)}
                </span>
                <Pencil className="h-3 w-3 shrink-0 text-gray-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && hits.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + 30)}
          className="w-full border-t border-gray-100 py-1.5 text-xs text-brand-700 hover:bg-gray-50"
        >
          Show more ({hits.length - shown} left)
        </button>
      )}
    </div>
  )
}

/**
 * The home-screen tile: the loads still waiting for a weight, a new one
 * started from the field, and the past loads to correct.
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
            // A past load saves under its own crop year, not the one on screen.
            cropYear={finishing?.crop_year ?? cropYear}
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
        {!finishing && <PastLoads onOpen={(l) => setFinishing(l)} />}
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
      <WeighInForm
        key={load.id}
        cropYear={load.crop_year}
        load={load}
        onDone={onClose}
        onCancel={onClose}
      />
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
        <Flag className="h-3.5 w-3.5" /> {name} is done:{' '}
        {Math.round(Number(y.actual_yield_total)).toLocaleString('en-CA')} {unit} pre-clean
        {y.yield_per_acre != null
          ? `, ${Number(y.yield_per_acre).toLocaleString('en-CA')} ${unit}/ac`
          : ''}
      </p>
      <p className="mt-0.5 text-[11px] text-green-900/80">
        {y.yield_override
          ? `A person's figure is kept; the scale says ${Math.round(Number(y.scale_total ?? 0)).toLocaleString('en-CA')} ${unit}.`
          : `Pre-clean, from ${y.scale_loads ?? 'its'} loads over ${y.acres != null ? `${Number(y.acres).toLocaleString('en-CA')} ac` : 'the seeded acres'}. The plan and marketing position use it, labelled pre-clean, until the yield after clean-out is entered.`}{' '}
        {y.scale_estimated_bu != null && Number(y.scale_estimated_bu) > 0 && (
          <strong className="text-amber-800">
            Includes about {Math.round(Number(y.scale_estimated_bu)).toLocaleString('en-CA')} bu
            estimated, not weighed.{' '}
          </strong>
        )}
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
export function DeleteLoadButton({
  load,
  onDeleted,
  withText = false,
}: {
  load: BinLoad
  onDeleted?: () => void
  withText?: boolean
}) {
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
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="text-[11px] text-gray-500 underline"
        >
          keep it
        </button>
        {del.isError && (
          <span className="text-[11px] text-red-700">{(del.error as Error).message}</span>
        )}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      aria-label="Delete this load"
      title={
        load.last_from_field
          ? "Delete this load — it is the field's last, so its harvest reopens"
          : 'Delete this load'
      }
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
