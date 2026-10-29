import type { Tester } from '@/lib/tester-offsets'
import { useEffect, useMemo, useState } from 'react'
import { useCropYear } from '@/lib/crop-year'
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
import { applyVarietyToCrop, varietyOverrides, varietySettingFor } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * A test half entered, kept on the device (Sam, 9 Oct 2026): a phone put
 * down at the bench reloads the page when it is picked up again, and the
 * readings typed so far must still be there. Only for half an hour, the same
 * as the start time below: a form begun in the morning and finished in the
 * evening is not the morning's sample.
 */
const DRAFT_KEY = 'moisture-test-draft-v1'
const FRESH_MS = 30 * 60_000
type Draft = {
  at: number
  open: boolean
  startedAt: number | null
  testedAt: string
  timeEdited: boolean
  fieldId: string
  cropId: string
  temp: string
  dial: string[]
  manualPct: string
  note: string
  condition: SampleCondition | null
}

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null
    if (!d || Date.now() - d.at > FRESH_MS) return null
    return { ...d, dial: Array.isArray(d.dial) && d.dial.length ? d.dial : ['', '', ''] }
  } catch {
    return null
  }
}

function writeDraft(d: Omit<Draft, 'at'>) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: Date.now() }))
  } catch {
    /* private window: nothing kept, nothing broken */
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** A time as a datetime-local input's value: local, not UTC. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fresh = (startedAt: number | null) => startedAt != null && Date.now() - startedAt <= FRESH_MS

/** Whether the reading form was open when the page went away. */
export function moistureFormWasOpen() {
  return readDraft()?.open ?? false
}

/**
 * One moisture test being entered: the conversion, the grade, what counts as
 * ready to save and what gets written.
 */
export function useMoistureEntry({ open = false }: { open?: boolean } = {}) {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: varietySettings } = useCropVarietySettings()
  const record = useRecordMoistureTest()

  const [draft] = useState(readDraft)
  const [fieldId, setFieldId] = useState(draft?.fieldId ?? '')
  const [cropId, setCropId] = useState(draft?.cropId ?? '')
  const [temp, setTemp] = useState(draft?.temp ?? '')
  const [dial, setDial] = useState(draft?.dial ?? ['', '', ''])
  const [manualPct, setManualPct] = useState(draft?.manualPct ?? '')
  const [note, setNote] = useState(draft?.note ?? '')
  // Kept between saves like the field: a run of samples is tested one way.
  const [condition, setCondition] = useState<SampleCondition | null>(draft?.condition ?? null)
  // Which meter read it. Bench unless someone picks another, every test.
  const [tester, setTester] = useState<Tester>('bench')
  const [saved, setSaved] = useState<string | null>(null)

  // When the sample was taken (Sam, 9 Oct 2026): the time the form was
  // started, which can be changed. Started over half an hour ago and left
  // alone, it is not the start any more, so the test takes the time it is saved.
  const [startedAt, setStartedAt] = useState<number | null>(() =>
    draft && fresh(draft.startedAt) ? draft.startedAt : open ? Date.now() : null,
  )
  const [testedAt, setTestedAt] = useState(draft?.timeEdited ? draft.testedAt : '')
  const [timeEdited, setTimeEdited] = useState(draft?.timeEdited ?? false)
  // Opening the form starts the clock, unless a recent start is still running.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStartedAt((s) => (fresh(s) ? s : Date.now()))
  }
  const timeValue = timeEdited ? testedAt : startedAt != null ? toLocalInput(startedAt) : ''
  const setTime = (v: string) => {
    setTestedAt(v)
    setTimeEdited(true)
  }

  useEffect(() => {
    writeDraft({ open, startedAt, testedAt, timeEdited, fieldId, cropId, temp, dial, manualPct, note, condition })
  }, [open, startedAt, testedAt, timeEdited, fieldId, cropId, temp, dial, manualPct, note, condition])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(null), 6000)
    return () => clearTimeout(t)
  }, [saved])

  const crop = crops?.find((c) => c.id === cropId)
  // The field's planned variety, when it is this crop: a variety's own bands
  // (Crop settings) win over the crop's where it sets them.
  const variety = (fieldId && plans?.find((p) => p.field_id === fieldId && p.crop_id === cropId)?.variety) || null
  const ownBands = varietySettingFor(varietySettings, cropId, variety)
  const bandsFrom = crop ? applyVarietyToCrop(crop, ownBands) : undefined
  /** The variety whose own bands grade this sample, when it has any. */
  const bandsVariety = varietyOverrides(ownBands).some((k) => k.startsWith('moisture_')) ? ownBands!.variety : null
  const bands: MoistureBands = {
    dry_max: bandsFrom?.moisture_dry_max ?? null,
    tough_max: bandsFrom?.moisture_tough_max ?? null,
    dry_min: bandsFrom?.moisture_dry_min ?? null,
    tough_advice: crop?.moisture_tough_advice ?? null,
  }
  const summary = chartSummary(crop?.moisture_chart_key)
  const { data: chart, isLoading: chartLoading } = useMoistureChart(crop?.moisture_chart_key)

  const reading = averageReading(dial.map(num))
  const temperature = num(temp)

  const result = useMemo(() => {
    if (tester !== 'bench' || !chart || temperature == null || reading == null) return null
    return lookupMoisture(chart, temperature, reading)
  }, [tester, chart, temperature, reading])

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

  const save = (onSaved?: () => void) => {
    if (pct == null) return
    const typed = timeEdited && testedAt ? new Date(testedAt) : null
    const testedAtIso =
      typed && !Number.isNaN(typed.getTime())
        ? typed.toISOString()
        : startedAt != null && fresh(startedAt)
          ? new Date(startedAt).toISOString()
          : new Date().toISOString()
    record.mutate(
      {
        crop_year: cropYear,
        tested_at: testedAtIso,
        field_id: fieldId || null,
        crop_id: cropId || null,
        temperature_c: result?.ok ? temperature : null,
        meter_reading: result?.ok ? reading : null,
        // Each reading, so one can be added on Edit later.
        meter_readings: result?.ok ? dial.map(num).filter((n): n is number => n != null) : null,
        chart_key: result?.ok ? (crop?.moisture_chart_key ?? null) : null,
        sample_weight_g: result?.ok ? (summary?.sample_weight_g ?? null) : null,
        moisture_pct: pct,
        grade,
        entered_by_hand: !result?.ok,
        note: note.trim() || null,
        sample_condition: condition,
        tester,
      },
      {
        onSuccess: () => {
          // The readings clear and the field and crop stay: samples come
          // in runs off the same truck, and retyping the field every time is
          // how people stop recording them.
          setDial(['', '', ''])
          setManualPct('')
          setNote('')
          setTester('bench')
          setStartedAt(null)
          setTestedAt('')
          setTimeEdited(false)
          setSaved(`Recorded ${pct.toFixed(1)}%${grade ? ` — ${grade}` : ''}. Open it in the list to add more dial readings later.`)
          onSaved?.()
        },
      },
    )
  }

  return {
    cropYear,
    fields,
    crops,
    crop,
    variety,
    bandsVariety,
    bands,
    advice,
    summary,
    chart,
    chartLoading,
    fieldId,
    cropId,
    temp,
    dial,
    manualPct,
    note,
    condition,
    tester,
    setTester,
    timeValue,
    timeEdited,
    startedLongAgo: !timeEdited && startedAt != null && !fresh(startedAt),
    setTime,
    reading,
    temperature,
    result,
    pct,
    grade,
    saved,
    record,
    pickField,
    setCropId,
    setTemp,
    setDialAt,
    setManualPct,
    setNote,
    setCondition,
    save,
  }
}

export type MoistureEntry = ReturnType<typeof useMoistureEntry>
