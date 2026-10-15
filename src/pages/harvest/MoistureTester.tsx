import type React from 'react'
import { useState } from 'react'
import {
  MoistureTestNote,
  SampleConditionToggle,
  TesterToggle,
} from '@/pages/harvest/SampleCondition'
import { CheckCircle2, FileText, MapPin, Save, Thermometer, Trash2 } from 'lucide-react'
import { useHere } from '@/lib/useHere'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { GRADE_STYLE, chartPdfUrl, gradeLabel, type Grade } from '@/lib/moisture'
import { useDeleteMoistureTest, useMoistureTests } from '@/lib/moisture-queries'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { Modal } from '@/components/Modal'
import { MoistureTestDetail } from './MoistureTestDetail'
import { rowClick } from '@/components/RecordEditor'
import { useMoistureEntry } from './useMoistureEntry'

/**
 * Convert a meter reading, and write it down against the field it came off.
 *
 * The two halves are one screen on purpose. A reading that has to be converted
 * on one screen and recorded on another is a reading that gets converted and
 * then not recorded, and the record is the half that matters in November.
 *
 * One form with every box at once; the phone walk-through was dropped (Sam,
 * 9 Oct 2026).
 *
 * The form opens in a pop-up from "Take a reading" at the top of the Moisture
 * view (Sam, 7 Oct 2026); the page itself is the readiness list and the
 * year's tests. Saving closes it and lands back on the list (9 Oct); more
 * dial readings go in later from the test's Edit. What is half typed, and
 * whether the form was open, outlast a reload.
 */
type ListSort = 'newest' | 'oldest' | 'field' | 'wettest' | 'driest'

export function MoistureTester({
  aside,
  formOpen = false,
  onCloseForm,
}: { aside?: React.ReactNode; formOpen?: boolean; onCloseForm?: () => void } = {}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const entry = useMoistureEntry({ open: formOpen })
  const here = useHere()
  const { data: tests } = useMoistureTests(entry.cropYear)
  const remove = useDeleteMoistureTest()
  // A test opened from the list (Sam, 7 Oct 2026), by id so an edit shows.
  const [openId, setOpenId] = useState<string | null>(null)
  const [listField, setListField] = useState('')
  const [listCrop, setListCrop] = useState('')
  const [listSort, setListSort] = useState<ListSort>('newest')
  const opened = (tests ?? []).find((t) => t.id === openId) ?? null

  const {
    fields,
    crops,
    crop,
    bandsVariety,
    summary,
    fieldId,
    cropId,
    temp,
    dial,
    manualPct,
    note,
    reading,
    result,
    pct,
    grade,
    advice,
    saved,
    record,
    chartLoading,
    pickField,
    setCropId,
    setTemp,
    setDialAt,
    setManualPct,
    setNote,
    condition,
    tester,
    setTester,
    setCondition,
    timeValue,
    startedLongAgo,
    setTime,
    save,
  } = entry

  const form = (
    <div className="space-y-4">
      {aside && <div className="flex items-center justify-end gap-3">{aside}</div>}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Thermometer className="h-4 w-4 text-brand-700" /> Take a reading
        </h2>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            <span className="flex items-center justify-between">
              Field
              {/* The field the truck is parked in, one tap. Offered rather
                    than applied, because the sample may have come off the
                    field next door. */}
              {here.fieldId && here.fieldId !== fieldId && (
                <button
                  type="button"
                  onClick={() => pickField(here.fieldId!)}
                  className="inline-flex items-center gap-0.5 text-[11px] text-brand-700 hover:underline"
                  title={
                    here.inside
                      ? 'You are in this field'
                      : `${Math.round(here.distanceM)} m from it`
                  }
                >
                  <MapPin className="h-3 w-3" /> {here.fieldName}
                </button>
              )}
            </span>
            <Select
              value={fieldId}
              ariaLabel="Field this sample came off"
              className="mt-1"
              onChange={pickField}
              options={[
                { value: '', label: 'Not tied to a field' },
                ...(fields ?? []).map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
          </label>
          <label className="text-xs text-gray-500">
            Crop
            <Select
              value={cropId}
              ariaLabel="Crop being tested"
              className="mt-1"
              onChange={setCropId}
              options={[
                { value: '', label: 'Choose a crop…' },
                ...(crops ?? [])
                  .filter((c) => c.active || c.id === cropId)
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>
        </div>

        {/* The chart, its sample weight and its calibration point — in front
              of whoever is at the scale, because the meter reads the resistance
              of a FIXED MASS and a 250 g chart on a 225 g sample is not
              slightly out, it is a reading of nothing. */}
        {crop && summary && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-800">{summary.crop}</span>
            <span>
              Table {summary.table_no} · {summary.revised}
            </span>
            <span className="font-semibold text-brand-800">Weigh {summary.sample_weight_g} g</span>
            <span>Calibrate at {summary.calibrate_at}</span>
            <a
              href={chartPdfUrl(summary.key)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
            >
              <FileText className="h-3.5 w-3.5" /> Chart PDF
            </a>
          </div>
        )}
        {crop && !summary && (
          <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
            No Model 919 chart is set for {crop.name}. Enter the moisture straight in below, or set
            a chart on the crop page.{' '}
            <SetupLink managerOnly to={SETUP_LINKS.cropMoisture(crop.id)}>
              Set a chart
            </SetupLink>
          </p>
        )}

        <label className="mt-3 block text-xs text-gray-500 sm:max-w-64">
          Taken at
          <input
            type="datetime-local"
            value={timeValue}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
          {startedLongAgo && (
            <span className="mt-0.5 block text-[11px] text-amber-700">
              Started over 30 min ago, so it saves as the time you record it. Change it if the
              sample was earlier.
            </span>
          )}
        </label>

        <TesterToggle value={tester} onChange={setTester} />

        {tester === 'bench' && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="text-xs text-gray-500">
                Grain temperature °C
                <input
                  inputMode="decimal"
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  placeholder="e.g. 18"
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                />
              </label>
              {/* Three, because the CGC procedure is three readings averaged —
                one dump of a cell is noisier than the half division the dial is
                read to. One or two still work; the average is of what is filled
                in. */}
              {dial.map((v, i) => (
                <label key={i} className="text-xs text-gray-500">
                  Dial reading {i + 1}
                  <input
                    inputMode="decimal"
                    value={v}
                    onChange={(e) => setDialAt(i, e.target.value)}
                    placeholder={i === 0 ? 'e.g. 40.5' : 'optional, or add on Edit'}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
                  />
                </label>
              ))}
            </div>

            {reading != null && dial.filter((d) => d.trim()).length > 1 && (
              <p className="mt-1.5 text-xs text-gray-500">Average reading {reading}.</p>
            )}

            <div className="mt-3">
              {chartLoading && <p className="text-sm text-gray-400">Loading the chart…</p>}
              {result && !result.ok && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {result.problem}
                </p>
              )}
              {result?.ok && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl font-semibold tabular-nums text-gray-900">
                    {result.moisture.toFixed(1)}%
                  </span>
                  {grade && (
                    <span
                      className={cn(
                        'rounded-md px-2 py-1 text-sm font-semibold capitalize',
                        GRADE_STYLE[grade],
                      )}
                    >
                      {gradeLabel(grade)}
                    </span>
                  )}
                  {grade && bandsVariety && (
                    <span className="text-xs text-gray-500">{bandsVariety} bands</span>
                  )}
                  <span className="text-xs text-gray-500">
                    read at {result.temperature} °C
                    {result.interpolated && ' · between two rows on the chart'}
                  </span>
                </div>
              )}
              {result?.ok && grade && <p className="mt-1 text-sm text-gray-700">{advice}</p>}
              {result?.ok && !grade && crop && (
                <p className="mt-1 text-xs text-gray-500">
                  No moisture bands are set for {crop.name}, so this is not graded. Set them on the
                  crop page.{' '}
                  <SetupLink managerOnly to={SETUP_LINKS.cropMoisture(crop.id)}>
                    Set the bands
                  </SetupLink>
                </p>
              )}
            </div>
          </>
        )}

        {/* The way out when the chart cannot answer: another meter, an
              elevator ticket, or a crop with no 919 table. Recorded as entered
              by hand so it is never mistaken for one of ours. */}
        {!result?.ok && (
          <label className="mt-3 block text-xs text-gray-500 sm:max-w-56">
            {tester === 'bench'
              ? 'Or type the moisture in'
              : `Moisture on the ${tester === 'handheld' ? 'hand held' : 'bean plant'} tester`}
            <input
              inputMode="decimal"
              value={manualPct}
              onChange={(e) => setManualPct(e.target.value)}
              placeholder="%"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
        )}
        {!result?.ok && pct != null && grade && (
          <p className="mt-1.5 text-sm text-gray-700">
            <span
              className={cn('rounded px-1.5 py-0.5 font-semibold capitalize', GRADE_STYLE[grade])}
            >
              {gradeLabel(grade)}
            </span>{' '}
            {advice}
          </p>
        )}

        <SampleConditionToggle value={condition} onChange={setCondition} />

        <label className="mt-3 block text-xs text-gray-500">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Which corner, off the truck or the bin, anything odd…"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => save(() => onCloseForm?.())}
            disabled={pct == null || record.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {record.isPending ? 'Saving…' : 'Record this test'}
          </button>
          {record.isError && (
            <span className="text-sm text-red-600">{(record.error as Error).message}</span>
          )}
        </div>
      </div>
    </div>
  )

  const nameOf = (list: { id: string; name: string }[] | undefined, id: string | null) =>
    (id && list?.find((x) => x.id === id)?.name) || ''
  const used = (key: 'field_id' | 'crop_id', list: { id: string; name: string }[] | undefined) =>
    [...new Set((tests ?? []).map((t) => t[key]).filter((id): id is string => !!id))]
      .map((id) => [id, nameOf(list, id)] as const)
      .sort((a, b) => a[1].localeCompare(b[1]))
  const listFields = used('field_id', fields)
  const listCrops = used('crop_id', crops)
  const shown = (tests ?? [])
    .filter(
      (t) => (!listField || t.field_id === listField) && (!listCrop || t.crop_id === listCrop),
    )
    .sort((a, b) => {
      const newer = b.tested_at.localeCompare(a.tested_at)
      if (listSort === 'oldest') return -newer
      if (listSort === 'field')
        return nameOf(fields, a.field_id).localeCompare(nameOf(fields, b.field_id)) || newer
      if (listSort === 'wettest') return Number(b.moisture_pct) - Number(a.moisture_pct) || newer
      if (listSort === 'driest') return Number(a.moisture_pct) - Number(b.moisture_pct) || newer
      return newer
    })

  return (
    <div className="space-y-4">
      {formOpen && (
        <Modal title="Take a reading" onClose={() => onCloseForm?.()} wide>
          {form}
        </Modal>
      )}

      {saved && (
        <p className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {saved}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-gray-500">
            Tests this year
          </h2>
          {/* Narrow the list to a field or crop, and order it (Oct 2026: one long list). */}
          <select
            aria-label="Field"
            value={listField}
            onChange={(e) => setListField(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
          >
            <option value="">All fields</option>
            {listFields.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="Crop"
            value={listCrop}
            onChange={(e) => setListCrop(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
          >
            <option value="">All crops</option>
            {listCrops.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort"
            value={listSort}
            onChange={(e) => setListSort(e.target.value as ListSort)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="field">By field</option>
            <option value="wettest">Wettest first</option>
            <option value="driest">Driest first</option>
          </select>
        </div>
        {!tests?.length ? (
          <p className="px-3 py-8 text-center text-sm text-gray-400">Nothing recorded yet.</p>
        ) : !shown.length ? (
          <p className="px-3 py-8 text-center text-sm text-gray-400">No tests match.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map((t) => {
              const field = fields?.find((f) => f.id === t.field_id)?.name
              const cropName = crops?.find((c) => c.id === t.crop_id)?.name
              return (
                <li
                  key={t.id}
                  onClick={rowClick(() => setOpenId(t.id))}
                  className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="w-20 shrink-0 text-xs text-gray-500">
                    {new Date(t.tested_at).toLocaleDateString('en-CA', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="font-medium tabular-nums text-gray-900">
                    {Number(t.moisture_pct).toFixed(1)}%
                  </span>
                  {t.grade && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
                        GRADE_STYLE[t.grade as Grade],
                      )}
                    >
                      {gradeLabel(t.grade as Grade)}
                    </span>
                  )}
                  <span className="text-gray-600">
                    {[field, cropName].filter(Boolean).join(' · ') || 'no field'}
                  </span>
                  {t.meter_reading != null && (
                    <span className="text-xs text-gray-400">
                      dial {t.meter_reading} @ {t.temperature_c}°C
                    </span>
                  )}
                  {t.entered_by_hand && (
                    <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">
                      typed in
                    </span>
                  )}
                  <MoistureTestNote test={t} />
                  {isManager && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this moisture test?')) remove.mutate(t.id)
                      }}
                      className="ml-auto rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"
                      aria-label="Delete this test"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {opened && <MoistureTestDetail test={opened} onClose={() => setOpenId(null)} />}
    </div>
  )
}
