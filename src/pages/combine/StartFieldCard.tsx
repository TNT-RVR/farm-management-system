import { useState, type ReactNode } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { Select } from '@/components/Select'
import { EditButton, RecordEditModal } from '@/components/RecordEditor'
import { SETTINGS, type CombineCropKey, type SettingKey } from '@/lib/combine'
import { settingText as asText, settingValue as toValue } from '@/lib/combine-setting-text'
import { MONITOR_NAME_MAX } from '@/lib/monitor-limits'
import { SettingRow } from './SettingInputs'
import { FieldFinishedForm } from '@/components/FieldFinishedForm'
import { combineCropOf } from '@/lib/combine-field'
import { useCombineStates, useMonitorFields, type MonitorField } from '@/lib/combine-monitor-data'
import {
  ACS_KEYS,
  HEADER_TYPES,
  START_STEPS,
  cropLabel,
  monitorText,
  operationInstanceFor,
  pickSettings,
  suggestHeader,
  type PickedSetting,
  type StepKey,
} from '@/lib/combine-start'
import {
  useActivePeople,
  useAllCombineSettings,
  useSaveSettingsUsed,
  useSaveStartDefaults,
  useSettingsUsed,
  useStartDefaults,
  useSwathRecords,
} from '@/lib/combine-start-data'
import { useCropPlans, useCrops } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

/**
 * Combine → Starting settings → Start a field: everything to set on the
 * display when a combine moves onto a field, in cab order, each a tick box.
 * The ticks start over when the field changes. Built for a phone in the cab.
 */

const OTHER = '__other__'
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The field's crop on the combines: the first of its crops the combine settings know. */
function cropKeyOf(f: MonitorField | undefined): { key: CombineCropKey | null; name: string | null } {
  for (const c of f?.crops ?? []) {
    const k = combineCropOf(c)
    if (k) return { key: k, name: c }
  }
  return { key: null, name: f?.crops[0] ?? null }
}

export function StartFieldCard({ cropYear, canEdit, onCrop }: { cropYear: number; canEdit: boolean; onCrop?: (k: CombineCropKey) => void }) {
  // The operator in the cab saves what they ran; defaults stay with managers.
  const { profile } = useAuth()
  const canSave = Boolean(profile?.active)
  const fieldsQ = useMonitorFields(cropYear)
  const states = useCombineStates(cropYear)
  const plans = useCropPlans(cropYear)
  const crops = useCrops()
  const swaths = useSwathRecords(cropYear)
  const used = useSettingsUsed()
  const saved = useAllCombineSettings()
  const defaults = useStartDefaults()
  const people = useActivePeople()

  const [all, setAll] = useState(false)
  const [fieldId, setFieldId] = useState('')
  const [combineId, setCombineId] = useState('')
  const [ticks, setTicks] = useState<{ field: string; done: StepKey[] }>({ field: '', done: [] })
  const [operatorPick, setOperatorPick] = useState('')
  const [operatorText, setOperatorText] = useState('')
  const [headerPick, setHeaderPick] = useState<{ field: string; header: string } | null>(null)
  const [actual, setActual] = useState<{ field: string; values: Partial<Record<SettingKey, string>>; notes: string }>({ field: '', values: {}, notes: '' })
  const [editingDefaults, setEditingDefaults] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  // The display's optional Tag (a seed contract number, say), per field.
  const [tag, setTag] = useState<{ field: string; text: string }>({ field: '', text: '' })
  const [finishing, setFinishing] = useState(false)
  const saveUsed = useSaveSettingsUsed()
  const saveDefaults = useSaveStartDefaults()

  const list = fieldsQ.data
  const fields = (list?.fields ?? []).filter((f) => all || f.harvesting)
  const field = list?.fields.find((f) => f.id === fieldId)
  const combines = (states.data ?? []).map((s) => s.machine)
  const crop = cropKeyOf(field)
  const done = ticks.field === fieldId ? ticks.done : []
  const toggle = (k: StepKey) => setTicks({ field: fieldId, done: done.includes(k) ? done.filter((d) => d !== k) : [...done, k] })

  // Swathed: the crop plan's harvest method, or a swathing record for the field's own crop (not a renter's).
  const myPlans = (plans.data ?? []).filter((p) => p.field_id === fieldId)
  const plan = myPlans.find((p) => (crops.data ?? []).find((c) => c.id === p.crop_id)?.name === crop.name) ?? myPlans[0] ?? null
  const swathRec = (swaths.data ?? []).find((r) => r.field_id === fieldId && (!r.crop_id || !plan?.crop_id || r.crop_id === plan.crop_id))
  const suggested = suggestHeader(crop.key, {
    plan: plan?.harvest_method === 'swathed' || plan?.harvest_method === 'straight' ? plan.harvest_method : null,
    swathedOn: swathRec?.day || null,
  })
  const header = headerPick?.field === fieldId ? headerPick.header : suggested.header
  const instance = operationInstanceFor(defaults.data ?? {}, crop.key, header)

  const fieldName = (id: string | null) => (id ? (list?.fields.find((f) => f.id === id)?.name ?? null) : null)
  const combineName = (id: string | null) => (id ? (combines.find((m) => m.id === id)?.name ?? null) : null)
  const picked: PickedSetting[] = crop.key
    ? pickSettings({ cropKey: crop.key, cropYear, used: used.data ?? [], saved: saved.data ?? [], equipmentId: combineId || null, fieldName, combineName })
    : []
  const pickedBy = new Map(picked.map((p) => [p.key, p]))
  const actualOf = (k: SettingKey) => (actual.field === fieldId && actual.values[k] !== undefined ? actual.values[k]! : asText(k, pickedBy.get(k)?.value))

  const operator = operatorPick === OTHER ? operatorText : (people.data ?? []).find((p) => p.id === operatorPick)?.name ?? ''
  const variety = field?.varieties[0] ?? null
  const tagText = tag.field === fieldId ? tag.text : ''

  const pickField = (id: string) => {
    setFieldId(id)
    setSavedNote(null)
    const k = cropKeyOf(list?.fields.find((f) => f.id === id)).key
    if (k) onCrop?.(k)
  }

  const saveActual = () => {
    if (!crop.key || !field) return
    setSavedNote(null)
    const values: Partial<Record<SettingKey, number | null>> = {}
    for (const s of SETTINGS) values[s.key] = toValue(s.key, actualOf(s.key))
    saveUsed.mutate(
      {
        crop_key: crop.key,
        crop_year: cropYear,
        field_id: field.id,
        equipment_id: combineId || null,
        ...values,
        header_type: header,
        operation_instance: instance.value,
        operator: operator.trim() || null,
        variety: variety ? monitorText(variety) : null,
        tag: monitorText(tagText) || null,
        notes: actual.field === fieldId ? actual.notes.trim() || null : null,
      },
      { onSuccess: () => setSavedNote(`Saved. The next ${cropLabel(crop.key!).toLowerCase()} field starts from these.`) },
    )
  }

  const step = (k: StepKey, body: ReactNode, hidden = false) => {
    if (hidden) return null
    const s = START_STEPS.find((x) => x.key === k)!
    const n = START_STEPS.findIndex((x) => x.key === k) + 1
    const on = done.includes(k)
    return (
      <li key={k} className={cn('rounded-md border px-3 py-2', on ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white')}>
        <button type="button" onClick={() => toggle(k)} className="flex w-full items-start gap-2 text-left" aria-pressed={on}>
          {on ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-300" />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">
              {n}. {s.title}
            </span>
            <span className="block text-xs text-gray-500">{s.how}</span>
          </span>
        </button>
        <div className="mt-1.5 pl-7 text-sm">{body}</div>
      </li>
    )
  }

  const value = (v: ReactNode) => <span className="font-mono text-base font-semibold uppercase tracking-wide text-gray-900">{v}</span>

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Start a field</h2>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All fields
        </label>
      </div>
      {fieldsQ.error && <p className="mt-2 text-sm text-red-700">{messageOf(fieldsQ.error)}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Select
          value={fieldId}
          ariaLabel="Field"
          placeholder={fieldsQ.isLoading ? 'Loading…' : all ? 'Pick a field' : `Pick a field on the combines in ${cropYear}`}
          onChange={pickField}
          options={fields.map((f) => ({ value: f.id, label: `${f.name}${f.crops.length ? ` · ${f.crops.join(' / ')}` : ''}` }))}
        />
        {combines.length > 1 && (
          <Select
            value={combineId}
            ariaLabel="Combine"
            onChange={setCombineId}
            options={[{ value: '', label: 'Either combine' }, ...combines.map((m) => ({ value: m.id, label: m.name ?? 'Combine' }))]}
          />
        )}
      </div>
      {!fieldsQ.isLoading && !fields.length && <p className="mt-2 text-xs text-gray-500">No field is on a combine crop in {cropYear}. Tick All fields.</p>}

      {field && (
        <>
          <ol className="mt-3 space-y-2">
            {step(
              'place',
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-xs text-gray-500">Grower</span>
                {value(field.monitor.grower || '—')}
                <span className="text-xs text-gray-500">Farm</span>
                {value(field.monitor.farm || '—')}
                <span className="text-xs text-gray-500">Field</span>
                {value(field.monitor.name)}
              </div>,
            )}
            {step('task', null)}
            {step(
              'operator',
              <div className="space-y-1.5">
                <Select
                  value={operatorPick}
                  ariaLabel="Operator"
                  size="sm"
                  placeholder="Pick the operator"
                  onChange={setOperatorPick}
                  options={[...(people.data ?? []).map((p) => ({ value: p.id, label: p.name })), { value: OTHER, label: 'Someone else…' }]}
                />
                {operatorPick === OTHER && (
                  <input
                    value={operatorText}
                    onChange={(e) => setOperatorText(e.target.value)}
                    placeholder="Name"
                    aria-label="Operator name"
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                )}
                {operator.trim() && <div>{value(monitorText(operator))}</div>}
              </div>,
            )}
            {step(
              'header',
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  {HEADER_TYPES.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHeaderPick({ field: fieldId, header: h })}
                      className={cn('rounded-full border px-3 py-1 text-sm', header === h ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-gray-200 text-gray-600')}
                    >
                      {h}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  Suggested {suggested.header}: {suggested.why}
                </p>
              </div>,
            )}
            {step(
              'instance',
              <div className="flex flex-wrap items-center gap-2">
                {value(instance.value)}
                <span className="text-xs text-gray-500">{instance.why}</span>
                {canEdit && <EditButton label="Defaults" onClick={() => setEditingDefaults(true)} />}
              </div>,
            )}
            {step(
              'variety',
              variety ? (
                <div>
                  Variety: {value(monitorText(variety))}
                </div>
              ) : (
                <span className="text-xs text-gray-500">No variety on the {cropYear} crop plan.</span>
              ),
            )}
            {step(
              'tag',
              <input
                value={tagText}
                maxLength={MONITOR_NAME_MAX}
                onChange={(e) => setTag({ field: fieldId, text: e.target.value })}
                placeholder="e.g. a seed contract number"
                aria-label="Tag"
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:w-64"
              />,
            )}
            {step(
              'settings',
              crop.key ? (
                <ul className="divide-y divide-gray-100">
                  {ACS_KEYS.map((k) => (
                    <SettingRow key={k} k={k} picked={pickedBy.get(k)!} value={actualOf(k)} onChange={(v) => setActual({ field: fieldId, values: { ...(actual.field === fieldId ? actual.values : {}), [k]: v }, notes: actual.field === fieldId ? actual.notes : '' })} />
                  ))}
                </ul>
              ) : (
                <span className="text-xs text-gray-500">No combine settings for {crop.name ?? 'this crop'}.</span>
              ),
            )}
            {step(
              'speed',
              <ul>
                <SettingRow
                  k="ground_speed_mph"
                  picked={pickedBy.get('ground_speed_mph')!}
                  value={actualOf('ground_speed_mph')}
                  onChange={(v) => setActual({ field: fieldId, values: { ...(actual.field === fieldId ? actual.values : {}), ground_speed_mph: v }, notes: actual.field === fieldId ? actual.notes : '' })}
                />
              </ul>,
              !crop.key,
            )}
            {step(
              'finish',
              <button
                type="button"
                onClick={() => setFinishing(true)}
                className="rounded-md border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
              >
                Field finished…
              </button>,
              !canSave,
            )}
          </ol>

          {crop.key && canSave && (
            <div className="mt-3 space-y-2">
              <input
                value={actual.field === fieldId ? actual.notes : ''}
                onChange={(e) => setActual({ field: fieldId, values: actual.field === fieldId ? actual.values : {}, notes: e.target.value })}
                placeholder="Notes (optional)"
                aria-label="Notes"
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={saveUsed.isPending}
                onClick={saveActual}
                className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50 sm:w-auto"
              >
                {saveUsed.isPending ? 'Saving…' : 'Save what I actually used'}
              </button>
              {savedNote && <p className="text-xs text-green-700">{savedNote}</p>}
              {saveUsed.error && <p className="text-xs text-red-700">{messageOf(saveUsed.error)}</p>}
            </div>
          )}
        </>
      )}

      <Fold title="Why these steps" storageKey="combine-start-why" className="mt-3">
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>A new task per field keeps each field’s harvest data apart.</li>
          <li>The display starts a new task by itself when one fills (about 8 hours), so a field can have several. Its total is all of its tasks added together.</li>
          <li>Resetting the area count makes the acres on the screen this field’s.</li>
        </ul>
      </Fold>

      {finishing && field && (
        <FieldFinishedForm
          fieldId={field.id}
          combineIds={combineId ? [combineId] : []}
          onClose={() => setFinishing(false)}
          onSaved={() => setTicks({ field: fieldId, done: done.includes('finish') ? done : [...done, 'finish'] })}
        />
      )}

      {editingDefaults && (
        <RecordEditModal
          title="Operation Instance defaults"
          fields={[
            ...(crop.key ? [{ key: 'crop', label: `For ${cropLabel(crop.key).toLowerCase()}`, kind: 'text' as const, placeholder: 'e.g. Grain Harv 1' }] : []),
            { key: 'header', label: `For the ${header} header`, kind: 'text', placeholder: 'e.g. Grain Harv 1', hint: 'Used when the crop has no default.' },
          ]}
          row={{ crop: crop.key ? (defaults.data?.operation_instance?.crop?.[crop.key] ?? null) : null, header: defaults.data?.operation_instance?.header?.[header] ?? null }}
          onClose={() => setEditingDefaults(false)}
          onSave={(p) =>
            saveDefaults.mutateAsync({
              current: defaults.data ?? {},
              cropKey: crop.key,
              crop: (p.crop as string | null) ?? null,
              header,
              headerValue: (p.header as string | null) ?? null,
            })
          }
        />
      )}
    </section>
  )
}
