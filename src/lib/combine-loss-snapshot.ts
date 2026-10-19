import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SETTINGS, type CombineCropKey, type SettingKey } from './combine'
import { pickSettings, type PickedSetting } from './combine-start'
import { useActivePeople, useAllCombineSettings, useSettingsUsed } from './combine-start-data'
import { lossChecksAsUsed, moistureForCheck, type LossHistoryRow, type MoistureAt } from './combine-what-worked'
import { valuesOf } from './combine-setting-text'
import { dryDownQuery } from './dry-down-data'
import { useMoistureTests } from './moisture-queries'
import { useEquipment } from './equipment'
import { isCombine } from './combine-monitor'
import { useFields } from './queries'

/**
 * What a loss check records about the combine and the conditions (Sam, 17
 * Oct 2026): the combine, who was driving, every setting in effect, the
 * grain moisture, and (fetched on save, combine-queries.ts) the weather.
 * Settings are prefilled from the newest of: the last loss check on this
 * combine and crop, the last Start a field / Field finished save, the saved
 * per-crop settings, the manual — today's when there is one, since it is
 * newest — and the operator corrects them before saving.
 */

export type LossSnapshot = {
  equipment_id: string | null
  operator: string | null
  header_type: string | null
  settings_from: string | null
  moisture_pct: number | null
  moisture_from: string | null
} & Partial<Record<SettingKey, number | null>>

const OTHER = '__other__'
export const OTHER_OPERATOR = OTHER

/** Where the prefilled values came from, in a line: "Last used on North 40, 12 Oct 2026; Manual starting point". */
export function settingsFromText(picked: PickedSetting[], edited: boolean): string | null {
  const whys = [...new Set(picked.map((p) => p.why))]
  const t = [edited ? 'Corrected at the check' : null, ...whys].filter(Boolean).join('; ')
  return t ? (t.length > 200 ? `${t.slice(0, 199)}…` : t) : null
}

export function useLossSnapshot(opts: { fieldId: string; cropKey: CombineCropKey; cropYear: number; checks: readonly LossHistoryRow[] }) {
  const qc = useQueryClient()
  const { data: fields } = useFields()
  const { data: equipment } = useEquipment(false)
  const people = useActivePeople()
  const used = useSettingsUsed()
  const saved = useAllCombineSettings()
  const { data: tests } = useMoistureTests(opts.cropYear)
  const dd = useQuery({ ...dryDownQuery(opts.fieldId, opts.cropYear, qc), enabled: Boolean(opts.fieldId) })

  const combines = (equipment ?? []).filter((e) => isCombine(e)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true }))
  const [combineId, setCombineId] = useState('')
  const [operatorPick, setOperatorPick] = useState('')
  const [operatorTyped, setOperatorTyped] = useState('')
  // What was typed over the prefill, kept only while the field, combine and crop stay the same.
  const key = `${opts.fieldId}:${combineId}:${opts.cropKey}`
  const [typed, setTyped] = useState<{ key: string; draft: Partial<Record<SettingKey, string>>; moisture: string }>({ key: '', draft: {}, moisture: '' })
  const draft = typed.key === key ? typed.draft : {}
  const moistureTyped = typed.key === key ? typed.moisture : ''
  const setDraft = (d: Partial<Record<SettingKey, string>>) => setTyped({ key, draft: d, moisture: moistureTyped })
  const setMoistureTyped = (m: string) => setTyped({ key, draft, moisture: m })

  const fieldName = (id: string | null) => (id ? (fields?.find((f) => f.id === id)?.name ?? null) : null)
  const combineName = (id: string | null) => (id ? (combines.find((m) => m.id === id)?.name ?? 'Combine') : null)
  const picked: PickedSetting[] = pickSettings({
    cropKey: opts.cropKey,
    cropYear: opts.cropYear,
    used: [...(used.data ?? []), ...lossChecksAsUsed(opts.checks)],
    saved: saved.data ?? [],
    equipmentId: combineId || null,
    fieldName,
    combineName,
  })
  const values = valuesOf(picked, draft)
  const edited = SETTINGS.some((s) => draft[s.key] !== undefined)

  const operator = operatorPick === OTHER ? operatorTyped.trim() : ((people.data ?? []).find((p) => p.id === operatorPick)?.name ?? '')
  // The header from the last Start a field on this field and crop, if any.
  const start = (used.data ?? []).find((u) => u.field_id === opts.fieldId && u.crop_key === opts.cropKey && u.header_type)
  const fieldTests = (tests ?? []).filter((t) => t.field_id === opts.fieldId)
  const auto: MoistureAt | null = opts.fieldId ? moistureForCheck(new Date().toISOString(), fieldTests, dd.data?.forecast?.hourly ?? []) : null
  const typedPct = moistureTyped.trim() === '' ? null : Number(moistureTyped)
  const moisture: MoistureAt | null = typedPct != null && Number.isFinite(typedPct) ? { pct: typedPct, from: 'typed at the check' } : auto

  const snapshot: LossSnapshot = {
    equipment_id: combineId || null,
    operator: operator ? operator.slice(0, 80) : null,
    header_type: start?.header_type ?? null,
    settings_from: settingsFromText(picked, edited),
    moisture_pct: moisture?.pct ?? null,
    moisture_from: moisture?.from ?? null,
    ...values,
  }

  return {
    combines,
    combineId,
    setCombineId,
    people: people.data ?? [],
    operatorPick,
    setOperatorPick,
    operatorTyped,
    setOperatorTyped,
    picked,
    draft,
    setDraft,
    auto,
    moistureTyped,
    setMoistureTyped,
    moisture,
    snapshot,
  }
}

export type LossSnapshotState = ReturnType<typeof useLossSnapshot>
