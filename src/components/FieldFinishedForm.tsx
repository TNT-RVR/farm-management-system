import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { Fold } from '@/components/Fold'
import { useAuth } from '@/lib/auth'
import { useEquipment } from '@/lib/equipment'
import { useAllCropZones } from '@/lib/cropZones'
import { useCropPlans, useCrops, useFields, useUsers } from '@/lib/queries'
import { useSaveFieldWork } from '@/lib/field-work-data'
import { FIELD_FINISHED, fromLocalInput, toLocalInput, workCropYear, type FieldWorkRecord } from '@/lib/field-work'
import { isCombine } from '@/lib/combine-monitor'
import { combineCropOf } from '@/lib/combine-field'
import { CROP_BASELINES, type SettingKey } from '@/lib/combine'
import { cropLabel, monitorText, pickSettings, type PickedSetting } from '@/lib/combine-start'
import { useAllCombineSettings, useSettingsUsed } from '@/lib/combine-start-data'
import { operatorText, settingsValues } from '@/lib/combine-finish'
import { useFinishSettings, useSaveFinishSettings } from '@/lib/combine-finish-data'
import { useLossChecks } from '@/lib/combine-queries'
import { useMoistureTests } from '@/lib/moisture-queries'
import { settingsLine, valuesOf } from '@/lib/combine-setting-text'
import { farmDay } from '@/lib/harvest-date'
import { SettingsList } from '@/pages/combine/SettingInputs'

const inputCls = 'w-full rounded-md border border-gray-300 px-2 py-2 text-sm'
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

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

/**
 * Field finished (Sam, 17 Oct 2026): the field, or one crop area of a split
 * field, is done. Records when (finish required, start if known), which
 * combines, who, and what the combines actually ran — prefilled from the
 * last settings used on this crop, else the saved ones, else the manual
 * (Start a field's "which settings and why"), to be corrected to what was
 * really on the display. The field's moisture and loss tests this crop year
 * are underneath, to read the settings against.
 *
 * Saved as a field work record (lib/combine-finish.ts says why): the finish
 * day becomes the field's harvest date everywhere (lib/harvest-date.ts).
 * Anyone active records one; the person who did, or a manager, edits it.
 */
export function FieldFinishedForm({
  fieldId: fixedField,
  combineIds: initialCombines,
  record,
  onClose,
  onSaved,
}: {
  /** The field, when the form is opened from one; omit to pick it. */
  fieldId?: string
  combineIds?: string[]
  /** An existing finish to edit. */
  record?: FieldWorkRecord
  onClose: () => void
  onSaved?: (r: { queued: boolean }) => void
}) {
  const { profile } = useAuth()
  const { data: fields } = useFields()
  const { data: equipment } = useEquipment(false)
  const { data: users } = useUsers()
  const { data: zones } = useAllCropZones()
  const { data: crops } = useCrops()
  const used = useSettingsUsed()
  const saved = useAllCombineSettings()
  const mine = useFinishSettings(record?.id)
  const saveWork = useSaveFieldWork()
  const saveSettings = useSaveFinishSettings()

  const [fieldId, setFieldId] = useState(record?.field_id ?? fixedField ?? '')
  const [zoneId, setZoneId] = useState(record?.zone_id ?? '')
  const [finished, setFinished] = useState(toLocalInput(record?.finished_at ?? new Date().toISOString()))
  const [started, setStarted] = useState(toLocalInput(record?.started_at))
  const [combineIds, setCombineIds] = useState<string[]>(record?.machine_ids ?? initialCombines ?? [])
  const [operatorIds, setOperatorIds] = useState<string[]>(record?.operator_ids ?? (profile?.id ? [profile.id] : []))
  const [otherPeople, setOtherPeople] = useState(record?.other_people ?? '')
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({})
  const [failed, setFailed] = useState<string | null>(null)

  const finishIso = fromLocalInput(finished)
  const startIso = fromLocalInput(started)
  const year = workCropYear({ started_at: startIso, finished_at: finishIso })
  const { data: plans } = useCropPlans(year)
  const { data: moisture } = useMoistureTests(year)
  const { data: lossChecks } = useLossChecks(year)

  const combines = useMemo(() => (equipment ?? []).filter((e) => isCombine(e)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true })), [equipment])
  const fieldZones = (zones ?? []).filter((z) => z.field_id === fieldId && z.crop_year === year)
  const zone = fieldZones.find((z) => z.id === zoneId) ?? null
  const plan = plans?.find((p) => p.field_id === fieldId)
  const cropName = (id: string | null | undefined) => crops?.find((c) => c.id === id)?.name ?? null
  const cropId = zone ? zone.crop_id : (plan?.crop_id ?? null)
  const cropKey = combineCropOf(cropName(cropId))
  const fieldName = (id: string | null) => (id ? (fields?.find((f) => f.id === id)?.name ?? null) : null)
  const combineName = (id: string | null) => (id ? (combines.find((m) => m.id === id)?.name ?? 'Combine') : null)
  const userName = (id: string) => users?.find((u) => u.id === id)?.full_name || users?.find((u) => u.id === id)?.email || 'someone'

  // What to start the boxes at: this finish's own saved settings when editing,
  // else the last used on this crop (this combine's first), the saved, the book.
  const own = (mine.data ?? [])[0]
  const base: PickedSetting[] = cropKey
    ? pickSettings({ cropKey, cropYear: year, used: (used.data ?? []).filter((u) => !record || u.work_record_id !== record.id), saved: saved.data ?? [], equipmentId: combineIds[0] ?? null, fieldName, combineName })
    : []
  const picked: PickedSetting[] = own
    ? base.map((p) => {
        const v = own[p.key]
        return v != null && v !== '' ? { ...p, value: Number(v), source: 'used' as const, why: 'Saved with this finish' } : p
      })
    : base

  const tests = (moisture ?? []).filter((t) => t.field_id === fieldId && t.moisture_pct != null).sort((a, b) => b.tested_at.localeCompare(a.tested_at))
  const losses = (lossChecks ?? []).filter((c) => c.field_id === fieldId)
  const order = startIso && finishIso && finishIso < startIso
  const missing = !fieldId ? 'the field' : !finishIso ? 'the finish time' : null

  const submit = async () => {
    setFailed(null)
    if (missing || order || !profile) return
    const id = record?.id ?? crypto.randomUUID()
    const people = [...operatorIds.map(userName), ...(otherPeople.trim() ? [otherPeople.trim()] : [])]
    try {
      const r = await saveWork.mutateAsync({
        before: record,
        photos: [],
        row: {
          id,
          field_id: fieldId,
          crop_year: year,
          zone_id: zone?.id ?? null,
          crop_id: cropId,
          work_type: FIELD_FINISHED,
          work_type_other: null,
          counts_as: 'harvest',
          field_finished: true,
          started_at: startIso,
          finished_at: finishIso,
          hours: record?.hours ?? null,
          acres: record?.acres ?? null,
          machine_ids: combineIds,
          machines_at_once: combineIds.length > 1 ? combineIds.length : null,
          operator_ids: operatorIds,
          other_people: otherPeople.trim() || null,
          notes: notes.trim() || null,
          created_by: record?.created_by ?? profile.id,
          entered_at: record?.entered_at ?? new Date().toISOString(),
        },
      })
      const values = cropKey ? settingsValues(valuesOf(picked, draft)) : null
      if (!r.queued && cropKey && values) {
        // The header and Operation Instance from Start a field on this field, when it was saved.
        const start = (used.data ?? []).find((u) => u.field_id === fieldId && u.crop_key === cropKey && !u.work_record_id)
        const plannedVariety = zone ? null : (plan?.variety ?? null)
        await saveSettings.mutateAsync({
          workRecordId: id,
          existing: (mine.data ?? []).map((m) => ({ id: m.id, equipment_id: m.equipment_id })),
          combineIds,
          values,
          base: {
            crop_key: cropKey,
            crop_year: year,
            field_id: fieldId,
            used_on: farmDay(finishIso!),
            header_type: start?.header_type ?? null,
            operation_instance: start?.operation_instance ?? null,
            operator: operatorText(people),
            variety: plannedVariety ? monitorText(plannedVariety) : (start?.variety ?? null),
            tag: start?.tag ?? null,
            notes: notes.trim() || null,
          },
        })
      }
      onSaved?.(r)
      onClose()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = saveWork.isPending || saveSettings.isPending
  const target = cropKey ? CROP_BASELINES.find((b) => b.key === cropKey)?.targetLossPct : null

  return (
    <Modal title={record ? 'Edit field finished' : 'Field finished'} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        {!fixedField && !record && (
          <Label text="Field" required wide>
            <Select
              value={fieldId}
              ariaLabel="Field"
              className="w-full"
              placeholder="Choose the field…"
              onChange={(v) => {
                setFieldId(v)
                setZoneId('')
                setDraft({})
              }}
              options={(fields ?? []).map((f) => ({ value: f.id, label: f.name }))}
            />
          </Label>
        )}
        {fieldZones.length > 0 && (
          <Label text="Crop area" wide>
            <Select
              value={zoneId}
              ariaLabel="Crop area"
              className="w-full"
              onChange={(v) => {
                setZoneId(v)
                setDraft({})
              }}
              options={[
                { value: '', label: 'Whole field' },
                ...fieldZones.map((z) => ({ value: z.id, label: `${cropName(z.crop_id) ?? 'Crop'}${z.acres != null ? ` · ${Math.round(Number(z.acres))} ac` : ''}` })),
              ]}
            />
          </Label>
        )}
        {fieldId && fieldZones.length === 0 && cropId && <p className="col-span-2 text-xs text-gray-500">Crop: {cropName(cropId)}</p>}

        <Label text="Finished" required>
          <input type="datetime-local" value={finished} onChange={(e) => setFinished(e.target.value)} className={inputCls} />
        </Label>
        <Label text="Started (if known)">
          <input type="datetime-local" value={started} onChange={(e) => setStarted(e.target.value)} className={inputCls} />
        </Label>
        {order && <p className="col-span-2 text-xs text-red-600">The finish is before the start.</p>}

        <div className="col-span-2">
          <span className="mb-0.5 block text-xs text-gray-500">Combines</span>
          {combines.length ? (
            <div className="flex flex-wrap gap-1.5">
              {combines.map((m) => {
                const on = combineIds.includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCombineIds((c) => (on ? c.filter((x) => x !== m.id) : [...c, m.id]))}
                    className={on ? 'rounded-full border border-brand-600 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-800' : 'rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600'}
                  >
                    {m.name ?? 'Combine'}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">No combine in the equipment list.</p>
          )}
        </div>

        <Label text="Operators" wide>
          <Select
            value=""
            ariaLabel="Add an operator"
            className="w-full"
            placeholder="Add a person…"
            onChange={(v) => v && setOperatorIds((m) => (m.includes(v) ? m : [...m, v]))}
            options={(users ?? []).filter((u) => !operatorIds.includes(u.id)).map((u) => ({ value: u.id, label: u.full_name || u.email }))}
          />
          {operatorIds.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {operatorIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {userName(id)}
                  <button type="button" onClick={() => setOperatorIds((m) => m.filter((x) => x !== id))} aria-label={`Remove ${userName(id)}`} className="text-gray-400 hover:text-gray-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Label>
        <Label text="Anyone else (not in the app)" wide>
          <input value={otherPeople} onChange={(e) => setOtherPeople(e.target.value)} className={inputCls} placeholder="e.g. a custom operator" />
        </Label>
        <Label text="Notes" wide>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Label>
      </div>

      {fieldId && (
        <div className="mt-4 space-y-3">
          <section>
            <h3 className="text-sm font-semibold text-gray-900">What the combine{combineIds.length > 1 ? 's' : ''} ran</h3>
            {cropKey ? (
              <>
                <p className="text-[11px] text-gray-500">
                  {cropLabel(cropKey)}: change any box to what was really on the display. The next {cropLabel(cropKey).toLowerCase()} field starts from these.
                </p>
                <SettingsList picked={picked} draft={draft} onDraft={setDraft} />
              </>
            ) : (
              <p className="text-xs text-gray-500">{cropName(cropId) ?? 'No crop planned'}: no combine settings for this crop.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900">Moisture tests {year}</h3>
            {tests.length ? (
              <ul className="mt-1 divide-y divide-gray-100 text-sm">
                {tests.slice(0, 12).map((t) => (
                  <li key={t.id} className="flex justify-between gap-2 py-1">
                    <span className="text-gray-600">{when(t.tested_at)}</span>
                    <span className="font-semibold tabular-nums text-gray-900">{Number(t.moisture_pct).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500">None on this field in {year}.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900">Loss checks {year}</h3>
            {losses.length ? (
              <ul className="mt-1 divide-y divide-gray-100 text-sm">
                {losses.map((c) => {
                  const line = settingsLine(c)
                  const pct = c.loss_pct != null ? Number(c.loss_pct) : null
                  return (
                    <li key={c.id} className="py-1">
                      <span className="flex justify-between gap-2">
                        <span className="text-gray-600">{when(c.checked_at)}</span>
                        <span className={pct != null && target != null && pct <= target ? 'font-semibold tabular-nums text-green-700' : 'font-semibold tabular-nums text-gray-900'}>
                          {Number(c.loss_bu_per_acre).toFixed(2)} bu/ac{pct != null ? ` · ${pct.toFixed(1)}%` : ''}
                        </span>
                      </span>
                      {line && <span className="block text-[11px] text-gray-500">{line}</span>}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-gray-500">None on this field in {year}.</p>
            )}
          </section>

          <Fold title="What this record does" storageKey="field-finished-why">
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-700">
              <li>The finish day becomes the field’s harvest date: field progress, the harvest estimate, the season reports and the irrigation balance all read it first.</li>
              <li>On a split field, a crop area’s finish is that area’s; the whole field is done with a whole-field finish.</li>
              <li>The settings are saved once per combine picked. With no signal the finish is kept on the phone and the settings are not: open it again with signal to add them.</li>
            </ul>
          </Fold>
        </div>
      )}

      {failed && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{failed}</p>}
      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-2 bg-white py-2">
        {missing && <span className="text-[11px] text-gray-400">Needs {missing}</span>}
        <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={!!missing || !!order || busy || !profile}
          onClick={() => void submit()}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
