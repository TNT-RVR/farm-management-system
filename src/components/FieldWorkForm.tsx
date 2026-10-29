import { useMemo, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { useAuth } from '@/lib/auth'
import { useEquipment } from '@/lib/equipment'
import { useAllCropZones } from '@/lib/cropZones'
import { useCropPlans, useCrops, useUsers } from '@/lib/queries'
import { useFieldCentroid, useFieldWorkPhotoUrls, useFieldWorkTypes, useSaveFieldWork } from '@/lib/field-work-data'
import { fmtHours, fromLocalInput, toLocalInput, weatherLine, workCropYear, workHours, workTypeList, type FieldWorkRecord, type WorkWeather } from '@/lib/field-work'
import { BALES_UNIT, BALE_TYPES, BALING, baleCount, baleFeeds, defaultBaleType, defaultRanch, isHayCrop, ordinal, suggestFeedType, type BaleType } from '@/lib/baling'
import { useFeedTypesFull } from '@/lib/winter-feeding'
import { useRanches } from '@/lib/ranches'
import { useFarmSettings } from '@/lib/farm-setup'
import { useFeedStoragePlaces } from '@/lib/feed-inventory'
import { usePartnerAccess } from '@/lib/partner-view'

const numOrNull = (s: string) => {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm'

function Label({ text, required, children, wide }: { text: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'col-span-2 block text-sm' : 'block text-sm'}>
      <span className="mb-0.5 block text-xs text-gray-500">
        {text}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Chips({ items, onRemove }: { items: { id: string; label: string }[]; onRemove: (id: string) => void }) {
  if (!items.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
          {i.label}
          <button type="button" onClick={() => onRemove(i.id)} aria-label={`Remove ${i.label}`} className="text-gray-400 hover:text-gray-700">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

/**
 * Record work Deere never saw. Only the kind of work is required; the rest is
 * whatever the person knows. The weather is fetched for the finish time when
 * it saves, so nothing about it is asked here.
 */
export function FieldWorkForm({
  fieldId,
  fieldAcres,
  record,
  onClose,
  onSaved,
}: {
  fieldId: string
  /** The field's mapped acres: the default for acres done. */
  fieldAcres: number | null
  /** An existing record to edit; omit to add one. */
  record?: FieldWorkRecord
  onClose: () => void
  onSaved?: (r: { queued: boolean }) => void
}) {
  const { profile } = useAuth()
  const { data: customTypes } = useFieldWorkTypes()
  const types = useMemo(() => workTypeList(customTypes ?? []), [customTypes])
  const { data: equipment } = useEquipment(false)
  const { data: users } = useUsers()
  const { data: zones } = useAllCropZones()
  const { data: crops } = useCrops()
  const save = useSaveFieldWork()

  const [workType, setWorkType] = useState(record?.work_type ?? '')
  const [other, setOther] = useState(record?.work_type_other ?? '')
  const [started, setStarted] = useState(toLocalInput(record?.started_at))
  // A new record finishes now unless told otherwise: most are entered as the job ends.
  const [finished, setFinished] = useState(record ? toLocalInput(record.finished_at) : toLocalInput(new Date().toISOString()))
  const [hours, setHours] = useState(record?.hours != null ? String(record.hours) : '')
  const [zoneId, setZoneId] = useState(record?.zone_id ?? '')
  const [acres, setAcres] = useState<string | null>(record ? (record.acres != null ? String(record.acres) : '') : null)
  const [machineIds, setMachineIds] = useState<string[]>(record?.machine_ids ?? [])
  const [several, setSeveral] = useState((record?.machines_at_once ?? 1) > 1)
  const [atOnce, setAtOnce] = useState(record?.machines_at_once != null && record.machines_at_once > 1 ? String(record.machines_at_once) : '2')
  const [operatorIds, setOperatorIds] = useState<string[]>(record?.operator_ids ?? (record ? [] : profile?.id ? [profile.id] : []))
  const [otherPeople, setOtherPeople] = useState(record?.other_people ?? '')
  const [amount, setAmount] = useState(record?.amount != null ? String(record.amount) : '')
  const [unit, setUnit] = useState(record?.amount_unit ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [removePaths, setRemovePaths] = useState<string[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  // Baling: what the bales go into the feed supply as. Null = not chosen by
  // the person, so it follows the crop / size / nearest ranch.
  const [toFeed, setToFeed] = useState(record ? record.feed_type_id != null || baleCount(record) == null : true)
  const [feedTypeId, setFeedTypeId] = useState<string | null>(record?.feed_type_id ?? null)
  const [baleType, setBaleType] = useState<BaleType | null>(record?.bale_type ?? null)
  const [cut, setCut] = useState(record?.hay_cut != null ? String(record.hay_cut) : '')
  const [ranchId, setRanchId] = useState<string | null>(record?.feed_ranch_id ?? null)
  const [storage, setStorage] = useState(record?.feed_storage ?? '')

  const startIso = fromLocalInput(started)
  const finishIso = fromLocalInput(finished)
  const year = workCropYear({ started_at: startIso, finished_at: finishIso })
  // A crop-share partner records only in the years the field is his (lib/partner-view.ts).
  const access = usePartnerAccess()
  const { data: plans } = useCropPlans(year)
  const fieldZones = (zones ?? []).filter((z) => z.field_id === fieldId && z.crop_year === year)
  const zone = fieldZones.find((z) => z.id === zoneId) ?? null
  const plan = plans?.find((p) => p.field_id === fieldId)
  const cropName = (id: string | null | undefined) => crops?.find((c) => c.id === id)?.name ?? null
  const cropId = zone ? zone.crop_id : (plan?.crop_id ?? null)
  const defaultAcres = zone?.acres != null ? Number(zone.acres) : fieldAcres
  // Untouched, the box follows the area chosen.
  const acresShown = acres ?? (defaultAcres != null ? String(Math.round(defaultAcres * 10) / 10) : '')

  const def = types.find((t) => t.key === workType)

  // ---- baling into the feed supply
  const baling = workType === BALING
  const { data: feedTypes } = useFeedTypesFull()
  const { data: ranches } = useRanches()
  const { mainRanchId } = useFarmSettings()
  const { data: centroid } = useFieldCentroid(baling ? fieldId : null)
  const { data: places } = useFeedStoragePlaces()
  const baleList = useMemo(
    () => baleFeeds((feedTypes ?? []).map((t) => ({ ...t, default_lb_per_bale: t.default_lb_per_bale == null ? null : Number(t.default_lb_per_bale) }))),
    [feedTypes],
  )
  const cutNum = numOrNull(cut)
  const crop = cropName(cropId)
  const guess = suggestFeedType(crop, cutNum, baleType, baleList)
  const feedShown = feedTypeId ?? guess.id ?? ''
  const feedPicked = baleList.find((t) => t.id === feedShown) ?? null
  const baleShown: BaleType = baleType ?? defaultBaleType(feedPicked)
  const ranchShown = ranchId ?? defaultRanch(ranches ?? [], centroid, mainRanchId) ?? ''
  const count = baling ? numOrNull(amount) : null
  const hay = isHayCrop(crop) || feedPicked?.category === 'hay'
  // Likeliest feeds first, then the rest, for the picker.
  const likelyFirst = guess.likely.map((id) => baleList.find((t) => t.id === id)).filter((t): t is (typeof baleList)[number] => !!t)
  const feedOptions = [...likelyFirst, ...baleList.filter((t) => !guess.likely.includes(t.id))]
  const feedMissing = baling && toFeed && count != null && count > 0 && !feedShown
  const order = startIso && finishIso && finishIso < startIso
  const missing = !workType
    ? 'the kind of work'
    : workType === 'other' && !other.trim()
      ? 'what the work was'
      : feedMissing
        ? 'what the bales are'
        : null
  const took = workHours({ started_at: startIso, finished_at: finishIso, hours: numOrNull(hours) })

  const { data: photoUrls } = useFieldWorkPhotoUrls((record?.photo_paths ?? []).filter((p) => !removePaths.includes(p)))
  const keptPaths = (record?.photo_paths ?? []).filter((p) => !removePaths.includes(p))

  const machineName = (id: string) => {
    const e = equipment?.find((m) => m.id === id)
    return e ? (e.name ?? ([e.make, e.model].filter(Boolean).join(' ') || 'machine')) : 'a machine'
  }
  const userName = (id: string) => users?.find((u) => u.id === id)?.full_name ?? 'someone'

  const submit = async () => {
    setFailed(null)
    if (missing || order || !profile) return
    if (!access.canWrite(fieldId, year)) {
      setFailed(`This work falls in the ${year} crop year, which is not one of your years on this field.`)
      return
    }
    const n = numOrNull(atOnce)
    try {
      const r = await save.mutateAsync({
        before: record,
        photos,
        removePaths,
        row: {
          id: record?.id ?? crypto.randomUUID(),
          field_id: fieldId,
          crop_year: year,
          zone_id: zone?.id ?? null,
          crop_id: cropId,
          work_type: workType,
          work_type_other: workType === 'other' ? other.trim() : null,
          counts_as: def?.countsAs ?? null,
          started_at: startIso,
          finished_at: finishIso,
          hours: numOrNull(hours),
          acres: numOrNull(acresShown),
          machine_ids: machineIds,
          machines_at_once: several && n != null && n >= 2 ? Math.round(n) : null,
          operator_ids: operatorIds,
          other_people: otherPeople.trim() || null,
          amount: numOrNull(amount),
          // Baling: the amount is the bale count.
          amount_unit: baling ? BALES_UNIT : unit.trim() || null,
          bale_type: baling ? baleShown : null,
          hay_cut: baling && hay && cutNum != null && cutNum >= 1 ? Math.round(cutNum) : null,
          feed_type_id: baling && toFeed && feedShown ? feedShown : null,
          feed_ranch_id: baling && toFeed && ranchShown ? ranchShown : null,
          feed_storage: baling && toFeed ? storage.trim() || null : null,
          notes: notes.trim() || null,
          created_by: record?.created_by ?? profile.id,
          entered_at: record?.entered_at ?? new Date().toISOString(),
        },
      })
      onSaved?.(r)
      onClose()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
  }

  const wx = record?.weather as unknown as WorkWeather | null

  return (
    <Modal title={record ? 'Edit work' : 'Record work'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Label text="Work" required wide>
          <Select
            value={workType}
            ariaLabel="Work"
            className="w-full"
            placeholder="Choose the work…"
            onChange={(v) => {
              setWorkType(v)
              const u = types.find((t) => t.key === v)?.unit
              if (u && !unit) setUnit(u)
            }}
            options={types.map((t) => ({ value: t.key, label: t.label }))}
          />
        </Label>
        {workType === 'other' && (
          <Label text="What was it" required wide>
            <input value={other} onChange={(e) => setOther(e.target.value)} className={inputCls} placeholder="e.g. Picking roots" />
          </Label>
        )}

        <Label text="Finished">
          <input type="datetime-local" value={finished} onChange={(e) => setFinished(e.target.value)} className={inputCls} />
        </Label>
        <Label text="Started">
          <input type="datetime-local" value={started} onChange={(e) => setStarted(e.target.value)} className={inputCls} />
        </Label>
        <Label text="Hours it took">
          <input type="number" step="0.25" min="0" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} placeholder={took.from === 'times' ? fmtHours(took.hours) ?? '' : ''} />
        </Label>
        <Label text="Acres done">
          <input type="number" step="any" min="0" inputMode="decimal" value={acresShown} onChange={(e) => setAcres(e.target.value)} className={inputCls} />
        </Label>
        {order && <p className="col-span-2 text-xs text-red-600">The finish is before the start.</p>}

        {fieldZones.length > 0 ? (
          <Label text="Crop area" wide>
            <Select
              value={zoneId}
              ariaLabel="Crop area"
              className="w-full"
              onChange={(v) => {
                setZoneId(v)
                setAcres(null)
              }}
              options={[
                { value: '', label: 'Whole field' },
                ...fieldZones.map((z) => ({
                  value: z.id,
                  label: `${cropName(z.crop_id) ?? 'Crop'}${z.acres != null ? ` · ${Math.round(Number(z.acres))} ac` : ''}`,
                })),
              ]}
            />
          </Label>
        ) : (
          cropId && <p className="col-span-2 text-xs text-gray-500">Crop: {cropName(cropId)}</p>
        )}

        <Label text="Machines" wide>
          <Select
            value=""
            ariaLabel="Add a machine"
            className="w-full"
            placeholder="Add a machine…"
            onChange={(v) => v && setMachineIds((m) => (m.includes(v) ? m : [...m, v]))}
            options={(equipment ?? [])
              .filter((e) => !machineIds.includes(e.id))
              .map((e) => ({ value: e.id, label: e.name ?? ([e.make, e.model].filter(Boolean).join(' ') || 'machine') }))}
          />
          <Chips items={machineIds.map((id) => ({ id, label: machineName(id) }))} onRemove={(id) => setMachineIds((m) => m.filter((x) => x !== id))} />
        </Label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={several} onChange={(e) => setSeveral(e.target.checked)} />
          More than one machine going at once
          {several && (
            <input
              type="number"
              min="2"
              step="1"
              inputMode="numeric"
              value={atOnce}
              onChange={(e) => setAtOnce(e.target.value)}
              aria-label="How many machines at once"
              className="ml-auto w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          )}
        </label>

        <Label text="Who did it" wide>
          <Select
            value=""
            ariaLabel="Add a person"
            className="w-full"
            placeholder="Add a person…"
            onChange={(v) => v && setOperatorIds((m) => (m.includes(v) ? m : [...m, v]))}
            options={(users ?? [])
              .filter((u) => !operatorIds.includes(u.id))
              .map((u) => ({ value: u.id, label: u.full_name || u.email }))}
          />
          <Chips items={operatorIds.map((id) => ({ id, label: userName(id) }))} onRemove={(id) => setOperatorIds((m) => m.filter((x) => x !== id))} />
        </Label>
        <Label text="Anyone else (not in the app)" wide>
          <input value={otherPeople} onChange={(e) => setOtherPeople(e.target.value)} className={inputCls} placeholder="e.g. custom baler" />
        </Label>

        {baling ? (
          <>
            <Label text="Bales">
              <input type="number" step="1" min="0" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </Label>
            <Label text="Bale size">
              <Select value={baleShown} ariaLabel="Bale size" className="w-full" onChange={(v) => setBaleType(v as BaleType)} options={BALE_TYPES} />
            </Label>
            {hay && (
              <Label text="Cut">
                <Select
                  value={cut}
                  ariaLabel="Cut"
                  className="w-full"
                  onChange={setCut}
                  options={[{ value: '', label: 'Not known' }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${ordinal(n)} cut` }))]}
                />
              </Label>
            )}
            <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={toFeed} onChange={(e) => setToFeed(e.target.checked)} />
              Add these bales to the feed supply
            </label>
            {toFeed && (
              <>
                <Label text="The bales are" required={count != null && count > 0} wide>
                  <Select
                    value={feedShown}
                    ariaLabel="Feed"
                    className="w-full"
                    placeholder="Choose the feed…"
                    onChange={(v) => setFeedTypeId(v || null)}
                    options={feedOptions.map((t) => ({ value: t.id, label: t.name }))}
                  />
                  {!feedTypeId && !guess.sure && guess.ask && <span className="mt-0.5 block text-xs text-amber-700">{guess.ask}</span>}
                </Label>
                {(ranches?.length ?? 0) > 1 && (
                  <Label text="Feed supply of">
                    <Select
                      value={ranchShown}
                      ariaLabel="Ranch"
                      className="w-full"
                      onChange={(v) => setRanchId(v || null)}
                      options={(ranches ?? []).map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </Label>
                )}
                <Label text="Stacked at" wide={(ranches?.length ?? 0) <= 1}>
                  <input value={storage} onChange={(e) => setStorage(e.target.value)} className={inputCls} list="feed-storage-places" placeholder="e.g. home yard" />
                  <datalist id="feed-storage-places">
                    {(places ?? []).map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Label>
              </>
            )}
          </>
        ) : (
          <>
            <Label text="Amount">
              <input type="number" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </Label>
            <Label text="Unit">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} placeholder={def?.unit ?? 'bales, bu, in deep…'} />
            </Label>
          </>
        )}

        <Label text="Notes" wide>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Label>

        <div className="col-span-2">
          <span className="mb-0.5 block text-xs text-gray-500">Photos</span>
          <div className="flex flex-wrap items-center gap-2">
            {keptPaths.map((p, i) => (
              <span key={p} className="relative">
                {photoUrls?.[i] ? <img src={photoUrls[i]} alt="" className="h-14 w-14 rounded object-cover" /> : <span className="block h-14 w-14 rounded bg-gray-100" />}
                <button type="button" onClick={() => setRemovePaths((r) => [...r, p])} aria-label="Remove photo" className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 text-gray-500 shadow">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {photos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {f.name}
                <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remove photo" className="text-gray-400">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
              <Camera className="h-3.5 w-3.5" /> Add
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  if (files.length) setPhotos((p) => [...p, ...files])
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>

        {record && (
          <p className="col-span-2 text-xs text-gray-500">
            Weather: {weatherLine(wx) ?? 'not yet'}
            {record.weather_source && <span className="text-gray-400"> · {record.weather_source}</span>}
          </p>
        )}
      </div>

      {failed && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{failed}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        {missing && <span className="text-[11px] text-gray-400">Needs {missing}</span>}
        <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={!!missing || !!order || save.isPending || !profile}
          onClick={() => void submit()}
          className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
