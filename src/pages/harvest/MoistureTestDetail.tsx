import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { DeleteButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useBins } from '@/lib/bins'
import { useCrops, useFields, useUsers } from '@/lib/queries'
import { chartSummary, GRADE_STYLE, gradeLabel, type Grade, type MoistureBands } from '@/lib/moisture'
import { useDeleteMoistureTest, useUpdateMoistureTest, type MoistureTest, type SampleCondition } from '@/lib/moisture-queries'
import { localDate, moistureTestPatch } from '@/lib/record-edits'
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
 */
export function MoistureTestDetail({ test, onClose }: { test: MoistureTest; onClose: () => void }) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const canEdit = useCanEditMoistureTest()(test)
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const { data: bins } = useBins()
  const { data: users } = useUsers()
  const update = useUpdateMoistureTest()
  const remove = useDeleteMoistureTest()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const name = <T extends { id: string; name: string }>(list: T[] | undefined, id: string | null) => (list ?? []).find((x) => x.id === id)?.name ?? null
  const chart = chartSummary(test.chart_key)

  const bandsFor = (cropId: string | null): MoistureBands | null => {
    const c = (crops ?? []).find((x) => x.id === cropId)
    if (!c) return null
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
        { key: 'bin_id', label: 'Bin', kind: 'select', options: [{ value: '', label: 'Not decided' }, ...(bins ?? []).map((b) => ({ value: b.id, label: b.name }))] },
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
    const body = isManager
      ? moistureTestPatch(test, patch, bandsFor)
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
              ['Bin', name(bins, test.bin_id)],
              ['Dial reading', test.meter_reading != null ? String(test.meter_reading) : null],
              ['Grain temperature', test.temperature_c != null ? `${test.temperature_c} °C` : null],
              ['Chart', chart ? `${chart.crop} · table ${chart.table_no}` : test.chart_key],
              ['Sample weight', test.sample_weight_g != null ? `${test.sample_weight_g} g` : null],
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
          {isManager && (
            <p className="mt-2 text-[11px] text-gray-500">
              The grade follows the moisture and the crop. A moisture changed here is marked typed in.
            </p>
          )}
        </RecordEditModal>
      )}
    </>
  )
}
