import { useEffect, useMemo, useState } from 'react'
import { useCropYear } from '@/lib/crop-year'
import { useBins } from '@/lib/bins'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import {
  averageReading,
  chartSummary,
  adviceFor,
  gradeFor,
  hasBands,
  lookupMoisture,
  type Grade,
  type MoistureBands,
} from '@/lib/moisture'
import { useMoistureChart, useRecordMoistureTest, type SampleCondition } from '@/lib/moisture-queries'

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * One moisture test being entered, whichever screen is entering it.
 *
 * The desk form and the phone walk-through are two arrangements of exactly this
 * — which is the reason it is a hook rather than state in a component. The
 * conversion, the grade, what counts as ready to save and what gets written
 * must be the same on both, and the only way to be sure of that is for there to
 * be one copy.
 */
export function useMoistureEntry() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: bins } = useBins()
  const record = useRecordMoistureTest()

  const [fieldId, setFieldId] = useState('')
  const [cropId, setCropId] = useState('')
  const [binId, setBinId] = useState('')
  const [temp, setTemp] = useState('')
  const [dial, setDial] = useState(['', '', ''])
  const [manualPct, setManualPct] = useState('')
  const [note, setNote] = useState('')
  // Kept between saves like the field and bin: a run of samples is tested one way.
  const [condition, setCondition] = useState<SampleCondition | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(null), 6000)
    return () => clearTimeout(t)
  }, [saved])

  const crop = crops?.find((c) => c.id === cropId)
  const bands: MoistureBands = {
    dry_max: crop?.moisture_dry_max ?? null,
    tough_max: crop?.moisture_tough_max ?? null,
    damp_max: crop?.moisture_damp_max ?? null,
    moist_max: crop?.moisture_moist_max ?? null,
    dry_min: crop?.moisture_dry_min ?? null,
    tough_advice: crop?.moisture_tough_advice ?? null,
  }
  const summary = chartSummary(crop?.moisture_chart_key)
  const { data: chart, isLoading: chartLoading } = useMoistureChart(crop?.moisture_chart_key)

  const reading = averageReading(dial.map(num))
  const temperature = num(temp)

  const result = useMemo(() => {
    if (!chart || temperature == null || reading == null) return null
    return lookupMoisture(chart, temperature, reading)
  }, [chart, temperature, reading])

  const byHand = num(manualPct)
  const pct = result?.ok ? result.moisture : byHand
  const grade: Grade | null = pct != null && hasBands(bands) ? gradeFor(bands, pct) : null
  const advice = grade ? adviceFor(grade, bands) : null

  /** Picking the field settles the crop — the whole point of recording against
   *  a field is that the reading follows that field's crop into the harvest
   *  record, and letting the two disagree would quietly break that. */
  const pickField = (fid: string) => {
    setFieldId(fid)
    const planned = plans?.find((p) => p.field_id === fid)?.crop_id
    if (planned) setCropId(planned)
  }

  const setDialAt = (i: number, v: string) =>
    setDial((d) => d.map((x, j) => (j === i ? v : x)))

  const save = () => {
    if (pct == null) return
    record.mutate(
      {
        crop_year: cropYear,
        field_id: fieldId || null,
        crop_id: cropId || null,
        bin_id: binId || null,
        temperature_c: result?.ok ? temperature : null,
        meter_reading: result?.ok ? reading : null,
        chart_key: result?.ok ? (crop?.moisture_chart_key ?? null) : null,
        sample_weight_g: result?.ok ? (summary?.sample_weight_g ?? null) : null,
        moisture_pct: pct,
        grade,
        entered_by_hand: !result?.ok,
        note: note.trim() || null,
        sample_condition: condition,
      },
      {
        onSuccess: () => {
          // The readings clear and the field, crop and bin stay: samples come
          // in runs off the same truck, and retyping the field every time is
          // how people stop recording them.
          setDial(['', '', ''])
          setManualPct('')
          setNote('')
          setSaved(`Recorded ${pct.toFixed(1)}%${grade ? ` — ${grade}` : ''}.`)
        },
      },
    )
  }

  return {
    cropYear,
    fields,
    crops,
    bins,
    crop,
    bands,
    advice,
    summary,
    chart,
    chartLoading,
    fieldId,
    cropId,
    binId,
    temp,
    dial,
    manualPct,
    note,
    condition,
    reading,
    temperature,
    result,
    pct,
    grade,
    saved,
    record,
    pickField,
    setCropId,
    setBinId,
    setTemp,
    setDialAt,
    setManualPct,
    setNote,
    setCondition,
    save,
  }
}

export type MoistureEntry = ReturnType<typeof useMoistureEntry>
