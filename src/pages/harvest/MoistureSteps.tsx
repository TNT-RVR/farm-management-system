import { useState } from 'react'
import { SampleConditionToggle } from '@/pages/harvest/SampleCondition'
import { ArrowLeft, ArrowRight, Check, FileText, RotateCcw, Save } from 'lucide-react'
import { Select } from '@/components/Select'
import { GRADE_STYLE, chartPdfUrl, gradeLabel } from '@/lib/moisture'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { stepBrief } from './MoistureGuide'
import type { MoistureEntry } from './useMoistureEntry'

/**
 * The phone walk-through: one thing at a time, in the order it is done.
 *
 * The desk form shows every box at once, which is right at a desk and wrong
 * standing at the bench with a meter in one hand. The steps here follow the
 * CGC procedure rather than the shape of the database row — weigh, then read
 * the temperature, then three dial readings — so the screen is a checklist of
 * what to do next, not a form to fill in afterwards from memory.
 *
 * The sample weight gets a step of its own. It looks like padding and it is
 * not: the meter reads the resistance of a FIXED MASS, so a 250 g chart read on
 * a 225 g sample is not slightly out, it is a reading of nothing — and it is
 * the step somebody who has done this a hundred times skips.
 */

const STEPS = ['what', 'weigh', 'temp', 'dial', 'result'] as const
type Step = (typeof STEPS)[number]

const TITLES: Record<Step, string> = {
  what: 'What are you testing?',
  weigh: 'Weigh the sample',
  temp: 'Grain temperature',
  dial: 'Dial readings',
  result: 'Moisture',
}

export function MoistureSteps({ entry }: { entry: MoistureEntry }) {
  const [step, setStep] = useState<Step>('what')
  const i = STEPS.indexOf(step)

  const {
    fields,
    crops,
    bins,
    crop,
    summary,
    fieldId,
    cropId,
    binId,
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
    setBinId,
    setTemp,
    setDialAt,
    setManualPct,
    setNote,
    condition,
    setCondition,
    save,
  } = entry

  // What has to be answered before the next step means anything. Weighing has
  // no input — it is an instruction — so it is always passable.
  const canAdvance: Record<Step, boolean> = {
    what: Boolean(cropId),
    weigh: true,
    temp: temp.trim() !== '',
    dial: reading != null,
    result: false,
  }

  const next = () => setStep(STEPS[Math.min(i + 1, STEPS.length - 1)])
  const back = () => setStep(STEPS[Math.max(i - 1, 0)])

  const bigInput =
    'mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-center text-2xl tabular-nums text-gray-900'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      {/* Where you are, and a way back to any step already done — a stepper
          that can only be walked forwards makes a typo on step one into a
          restart. */}
      <ol className="flex items-center gap-1.5">
        {STEPS.map((s, n) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              disabled={n > i}
              onClick={() => setStep(s)}
              aria-label={TITLES[s]}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'block h-1.5 w-full rounded-full transition-colors',
                n < i && 'bg-brand-700',
                n === i && 'bg-brand-500',
                n > i && 'bg-gray-200',
              )}
            />
          </li>
        ))}
      </ol>
      <h2 className="mt-3 text-base font-semibold text-gray-900">
        {TITLES[step]}
        <span className="ml-2 text-xs font-normal text-gray-400">
          {i + 1} of {STEPS.length}
        </span>
      </h2>

      {step === 'what' && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-gray-500">
            Field
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
          <label className="block text-xs text-gray-500">
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
          <label className="block text-xs text-gray-500">
            Bin
            <Select
              value={binId}
              ariaLabel="Bin it is going in"
              className="mt-1"
              onChange={setBinId}
              options={[
                { value: '', label: 'Not decided yet' },
                ...(bins ?? []).filter((b) => b.active).map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </label>
          {cropId && !summary && (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              No Model 919 chart is set for {crop?.name}. You can still type the moisture in at the
              end.{' '}
              <SetupLink managerOnly to={SETUP_LINKS.cropMoisture(cropId)}>Set a chart</SetupLink>
            </p>
          )}
        </div>
      )}

      {step === 'weigh' && (
        <div className="mt-3">
          {summary ? (
            <>
              <p className="text-sm text-gray-600">Clean the dockage out, then weigh out</p>
              <p className="my-2 text-5xl font-bold tabular-nums text-brand-800">
                {summary.sample_weight_g} g
              </p>
              <p className="text-sm text-gray-700">
                of {summary.crop.toLowerCase()}, and calibrate the meter at{' '}
                <span className="font-semibold">{summary.calibrate_at}</span>.
              </p>
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {stepBrief('weigh')}
              </p>
              <a
                href={chartPdfUrl(summary.key)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
              >
                <FileText className="h-4 w-4" /> Chart {summary.table_no} PDF
              </a>
            </>
          ) : (
            <p className="text-sm text-gray-600">
              No chart for this crop, so no sample weight to check. Weigh to whatever your own chart
              says.
            </p>
          )}
        </div>
      )}

      {step === 'temp' && (
        <div className="mt-3">
          <label className="block text-xs text-gray-500">
            Grain temperature °C
            <input
              autoFocus
              inputMode="decimal"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              placeholder="18"
              className={bigInput}
            />
          </label>
          <p className="mt-2 text-xs text-gray-500">{stepBrief('temp')}</p>
        </div>
      )}

      {step === 'dial' && (
        <div className="mt-3">
          <p className="text-sm text-gray-600">{stepBrief('three')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {dial.map((v, n) => (
              <label key={n} className="text-center text-xs text-gray-500">
                {n + 1}
                <input
                  autoFocus={n === 0}
                  inputMode="decimal"
                  value={v}
                  onChange={(e) => setDialAt(n, e.target.value)}
                  placeholder="—"
                  className={bigInput}
                />
              </label>
            ))}
          </div>
          {reading != null && (
            <p className="mt-2 text-center text-sm text-gray-600">
              Average <span className="font-semibold tabular-nums">{reading}</span>
            </p>
          )}
        </div>
      )}

      {step === 'result' && (
        <div className="mt-3">
          {chartLoading && <p className="text-sm text-gray-400">Loading the chart…</p>}
          {result?.ok && (
            <div className="text-center">
              <p className="text-5xl font-bold tabular-nums text-gray-900">
                {result.moisture.toFixed(1)}%
              </p>
              {grade && (
                <p
                  className={cn(
                    'mt-2 inline-block rounded-md px-3 py-1 text-base font-semibold capitalize',
                    GRADE_STYLE[grade],
                  )}
                >
                  {gradeLabel(grade)}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                read at {result.temperature} °C
                {result.interpolated && ' · between two rows'}
              </p>
              {grade && <p className="mt-2 text-sm text-gray-700">{advice}</p>}
              {!grade && crop && (
                <p className="mt-2 text-xs text-gray-500">
                  No moisture bands set for {crop.name}, so this is not graded.{' '}
                  <SetupLink managerOnly to={SETUP_LINKS.cropMoisture(crop.id)}>Set the bands</SetupLink>
                </p>
              )}
            </div>
          )}

          {result && !result.ok && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{result.problem}</p>
          )}

          {!result?.ok && (
            <label className="mt-3 block text-xs text-gray-500">
              Or type the moisture in
              <input
                inputMode="decimal"
                value={manualPct}
                onChange={(e) => setManualPct(e.target.value)}
                placeholder="%"
                className={bigInput}
              />
            </label>
          )}
          {!result?.ok && pct != null && grade && (
            <p className="mt-2 text-center text-sm text-gray-700">
              <span className={cn('rounded px-1.5 py-0.5 font-semibold capitalize', GRADE_STYLE[grade])}>
                {gradeLabel(grade)}
              </span>{' '}
              {advice}
            </p>
          )}

          <SampleConditionToggle value={condition} onChange={setCondition} big />

          <label className="mt-3 block text-xs text-gray-500">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Which corner, off the truck…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
            />
          </label>

          <button
            onClick={save}
            disabled={pct == null || record.isPending}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            <Save className="h-5 w-5" />
            {record.isPending ? 'Saving…' : 'Record this test'}
          </button>
          {saved && (
            <div className="mt-2 text-center">
              <p className="flex items-center justify-center gap-1.5 text-sm text-green-700">
                <Check className="h-4 w-4" /> {saved}
              </p>
              {/* Samples come in runs off the same truck, so the way back to
                  another reading on the same bin is one tap and keeps the
                  field, crop and bin already chosen. */}
              <button
                onClick={() => setStep('temp')}
                className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 underline"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Another sample from the same bin
              </button>
            </div>
          )}
          {record.isError && (
            <p className="mt-2 text-sm text-red-600">{(record.error as Error).message}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {i > 0 && (
          <button
            onClick={back}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        {step !== 'result' && (
          <button
            onClick={next}
            disabled={!canAdvance[step]}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Next <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
