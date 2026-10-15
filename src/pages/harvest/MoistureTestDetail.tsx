import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { DeleteButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropPlans, useCrops, useFields, useUsers } from '@/lib/queries'
import { cropForVariety, planVarieties } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import { averageReading, chartSummary, GRADE_STYLE, gradeFor, gradeLabel, hasBands, lookupMoisture, type Grade, type MoistureBands } from '@/lib/moisture'
import { useDeleteMoistureTest, useMoistureChart, useUpdateMoistureTest, type MoistureTest, type SampleCondition } from '@/lib/moisture-queries'
import { localDate, moistureTestPatch } from '@/lib/record-edits'
import { TESTERS, testerLabel } from '@/lib/tester-offsets'
import { cn } from '@/lib/utils'
import { SampleConditionBadge, useCanEditMoistureTest } from './SampleCondition'

const CONDITIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'screened', label: 'Screened' },
  { value: 'dirty', label: 'Dirty' },
]

/**
 * One moisture test, opened from a list (Sam, 7 Oct 2026).
 *
 * Everything recorded about it, and Edit. A manager can correct any of it —
 * the date, where it came from and went, and the moisture itself, with the
 * grade worked out again from the crop's bands (moistureTestPatch). Whoever
 * recorded it can fix its note and screened/dirty, as before. Delete is a
 * manager's, as the table's policy is.
 *
 * A manager can also add a reading off the meter later (Sam, 8 Oct 2026),
 * the way the form takes three: the readings are averaged and read off the
 * same 919 chart again, so the moisture and grade follow them. A test saved
 * before 8 Oct kept only the average of its readings, which stands in as the
 * first reading. The bin is not asked for: the bin a load goes in is set when
 * it is weighed.
 */
export function MoistureTestDetail({ test, onClose }: { test: MoistureTest; onClose: () => void }) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const canEdit = useCanEditMoistureTest()(test)
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(test.crop_year)
  const { data: varietySettings } = useCropVarietySettings()
  const { data: fields } = useFields()
  const { data: users } = useUsers()
  const update = useUpdateMoistureTest()
  const remove = useDeleteMoistureTest()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The readings, as the form takes them: each one saved, or the average a
  // test saved before 8 Oct kept, and room for three.
  const startReadings = (test.meter_readings?.length ? test.meter_readings : test.meter_reading != null ? [test.meter_reading] : []).map((n) => String(n))
  const [readings, setReadings] = useState<string[]>(() => [...startReadings, '', '', ''].slice(0, Math.max(3, startReadings.length)))
  const [temp, setTemp] = useState(test.temperature_c != null ? String(test.temperature_c) : '')
  const chartKey = test.chart_key ?? (crops ?? []).find((c) => c.id === test.crop_id)?.moisture_chart_key ?? null
  const { data: chartData } = useMoistureChart(isManager && editing ? chartKey : null)
  const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
  const avg = averageReading(readings.map(num))
  const tempC = num(temp)
  const converted = useMemo(() => (chartData && avg != null && tempC != null ? lookupMoisture(chartData, tempC, avg) : null), [chartData, avg, tempC])
  const readingsChanged =
    readings.map(num).filter((n) => n != null).join(',') !== startReadings.map(Number).join(',') || tempC !== (test.temperature_c != null ? Number(test.temperature_c) : null)
  const readGrade = (pct: number) => {
    const b = bandsFor(test.crop_id)
    return b && hasBands(b) ? gradeFor(b, pct) : null
  }

  const name = <T extends { id: string; name: string }>(list: T[] | undefined, id: string | null) => (list ?? []).find((x) => x.id === id)?.name ?? null
  const chart = chartSummary(test.chart_key)

  const bandsFor = (cropId: string | null): MoistureBands | null => {
    const found = (crops ?? []).find((x) => x.id === cropId)
    if (!found) return null
    // The bands of the variety the field's plan names, where it has its own.
    const c = cropForVariety(found, planVarieties(plans)(test.field_id, found.id), varietySettings)
    return {
      dry_max: c.moisture_dry_max ?? null,
      tough_max: c.moisture_tough_max ?? null,
      damp_max: c.moisture_damp_max ?? null,
      moist_max: c.moisture_moist_max ?? null,
      dry_min: c.moisture_dry_min ?? null,
    }
  }

  const fieldsToEdit: EditField[] = isManager
    ? [
        { key: 'tested_on', label: 'Date', kind: 'date', required: true },
        { key: 'moisture_pct', label: 'Moisture %', kind: 'number', step: '0.1', required: true },
        { key: 'field_id', label: 'Field', kind: 'select', options: [{ value: '', label: 'Not tied to a field' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))] },
        { key: 'crop_id', label: 'Crop', kind: 'select', options: [{ value: '', label: 'Not recorded' }, ...(crops ?? []).map((c) => ({ value: c.id, label: c.name }))] },
        { key: 'tester', label: 'Tester', kind: 'select', options: [{ value: '', label: 'Not recorded' }, ...TESTERS] },
        { key: 'sample_condition', label: 'Sample', kind: 'select', options: CONDITIONS },
        { key: 'note', label: 'Note', kind: 'textarea' },
      ]
    : [
        { key: 'sample_condition', label: 'Sample', kind: 'select', options: CONDITIONS },
        { key: 'note', label: 'Note', kind: 'textarea' },
      ]

  const save = async (patch: Record<string, unknown>) => {
    setError(null)
    const pct = patch.moisture_pct as number | null | undefined
    if (isManager && (pct == null || !(pct > 0) || !(pct < 60))) {
      setError('The moisture has to be a percentage between 0 and 60.')
      throw new Error('bad moisture')
    }
    // New or changed readings decide the moisture, read off the chart again.
    const fromReadings = isManager && readingsChanged && converted?.ok ? converted : null
    const body = isManager
      ? fromReadings
        ? {
            ...moistureTestPatch(test, { ...patch, moisture_pct: fromReadings.moisture }, bandsFor),
            entered_by_hand: false,
            meter_reading: avg,
            meter_readings: readings.map(num).filter((n): n is number => n != null),
            temperature_c: tempC,
            chart_key: chartKey,
            sample_weight_g: chartSummary(chartKey)?.sample_weight_g ?? test.sample_weight_g,
          }
        : moistureTestPatch(test, patch, bandsFor)
      : { note: patch.note ?? null, sample_condition: (patch.sample_condition as SampleCondition | null) ?? null }
    try {
      await update.mutateAsync({ id: test.id, ...body })
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
  }

  return (
    <>
      <Modal title={`Moisture test · ${new Date(test.tested_at).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`} onClose={onClose}>
        <div className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold tabular-nums text-gray-900">{Number(test.moisture_pct).toFixed(1)}%</span>
            {test.grade && (
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium capitalize', GRADE_STYLE[test.grade as Grade])}>{gradeLabel(test.grade as Grade)}</span>
            )}
            <SampleConditionBadge value={test.sample_condition} />
          </p>
          <DetailList
            rows={[
              ['Tested', new Date(test.tested_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })],
              ['Field', name(fields, test.field_id)],
              ['Crop', name(crops, test.crop_id)],
              ['Dial reading', test.meter_reading != null ? (test.meter_readings && test.meter_readings.length > 1 ? `${test.meter_reading} (average of ${test.meter_readings.join(', ')})` : String(test.meter_reading)) : null],
              ['Grain temperature', test.temperature_c != null ? `${test.temperature_c} °C` : null],
              ['Chart', chart ? `${chart.crop} · table ${chart.table_no}` : test.chart_key],
              ['Sample weight', test.sample_weight_g != null ? `${test.sample_weight_g} g` : null],
              ['Tester', testerLabel(test.tester)],
              ['How', test.entered_by_hand ? 'Typed in, not read off the 919 chart' : 'Worked out from the 919 chart'],
              ['Note', test.note],
              ['Recorded by', (users ?? []).find((u) => u.id === test.created_by)?.full_name ?? null],
              ['Crop year', String(test.crop_year)],
            ]}
          />
          {remove.isError && <p className="text-xs text-red-700">{(remove.error as Error).message}</p>}
          {(isManager || canEdit) && (
            <div className="flex flex-wrap justify-end gap-2">
              {isManager && (
                <DeleteButton
                  disabled={remove.isPending}
                  confirm="Delete this moisture test?"
                  onDelete={() => remove.mutate(test.id, { onSuccess: onClose })}
                />
              )}
              <EditButton onClick={() => setEditing(true)} label={isManager ? 'Edit' : 'Edit note'} />
            </div>
          )}
        </div>
      </Modal>

      {editing && (
        <RecordEditModal
          title={isManager ? 'Correct this test' : 'Note and sample'}
          fields={fieldsToEdit}
          row={{ ...test, tested_on: localDate(test.tested_at), moisture_pct: Number(test.moisture_pct) }}
          saving={update.isPending}
          error={error}
          onClose={() => {
            setEditing(false)
            setError(null)
          }}
          onSave={save}
        >
          {isManager && chartKey && (
            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2">
              <p className="text-xs font-medium text-gray-700">Readings off the meter</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-[11px] text-gray-500">
                  Grain temp °C
                  <input inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900" />
                </label>
                {readings.map((v, i) => (
                  <label key={i} className="text-[11px] text-gray-500">
                    Dial reading {i + 1}
                    <input
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setReadings((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder="optional"
                      className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                ))}
              </div>
              {readings.length < 8 && (
                <button type="button" onClick={() => setReadings((r) => [...r, ''])} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add another reading
                </button>
              )}
              {!test.meter_readings?.length && test.meter_reading != null && (
                <p className="mt-1 text-[11px] text-gray-500">This test was saved with only the average of its readings ({test.meter_reading}), so that stands as reading 1.</p>
              )}
              {readingsChanged && converted?.ok && (
                <p className="mt-1.5 text-sm text-gray-800">
                  Average {avg} at {tempC} °C reads <b>{converted.moisture.toFixed(1)}%</b>
                  {readGrade(converted.moisture) ? ` (${gradeLabel(readGrade(converted.moisture)!)})` : ''}. Saving uses this in place of the moisture above.
                </p>
              )}
              {readingsChanged && converted && !converted.ok && <p className="mt-1.5 text-xs text-red-700">{converted.problem}</p>}
            </div>
          )}
          {isManager && (
            <p className="mt-2 text-[11px] text-gray-500">
              The grade follows the moisture and the crop. A moisture typed in here, not read off the chart, is marked typed in.
            </p>
          )}
        </RecordEditModal>
      )}
    </>
  )
}
