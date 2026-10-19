import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { CROP_BASELINES, type CombineCropKey, type SettingKey } from '@/lib/combine'
import { useCropLossHistory } from '@/lib/combine-queries'
import { sortWhatWorked, whatWorked, type SortKey, type WhatWorkedRow } from '@/lib/combine-what-worked'
import { settingText } from '@/lib/combine-setting-text'
import { useEquipment } from '@/lib/equipment'
import { useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'

const SETTING_COLS: { key: SettingKey; label: string }[] = [
  { key: 'rotor_rpm', label: 'Rotor' },
  { key: 'concave_mm', label: 'Concave' },
  { key: 'fan_rpm', label: 'Fan' },
  { key: 'chaffer_mm', label: 'Upper' },
  { key: 'sieve_mm', label: 'Lower' },
  { key: 'ground_speed_mph', label: 'mph' },
]

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: '2-digit' })
const n0 = (v: number | null) => (v == null ? '—' : String(Math.round(v)))

/**
 * What worked: the crop's loss checks with the settings and the conditions
 * they were taken at, every year, sortable; the lowest loss is highlighted
 * and checks at or under the crop's target loss are green. Rows come from
 * lib/combine-what-worked.ts, which the conditions card also reads.
 */
export function WhatWorked({ crop }: { crop: CombineCropKey }) {
  const { data: history } = useCropLossHistory(crop)
  const { data: fields } = useFields()
  const { data: equipment } = useEquipment(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'loss', dir: 'asc' })
  const baseline = CROP_BASELINES.find((b) => b.key === crop)
  const rows = useMemo(() => whatWorked(history ?? [], crop, baseline?.targetLossPct ?? null), [history, crop, baseline])
  const shown = useMemo(() => sortWhatWorked(rows, sort.key, sort.dir), [rows, sort])
  const fieldName = (id: string | null) => (id ? (fields?.find((f) => f.id === id)?.name ?? '—') : '—')
  const combineName = (id: string | null | undefined) => (id ? (equipment?.find((e) => e.id === id)?.name ?? '—') : '—')

  const head = (key: SortKey, label: string, right = true) => (
    <th key={key} className={cn('px-2 py-1.5 font-medium', right && 'text-right')}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
        className="inline-flex items-center gap-0.5 uppercase hover:text-gray-800"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort.key === key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  )

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">What worked · {baseline?.label ?? crop}</h2>
      {!rows.length ? (
        <p className="px-3 py-3 text-xs text-gray-500">No {baseline?.label.toLowerCase() ?? ''} loss check with its settings yet. Each check saved on the Loss check tab keeps them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[10px] tracking-wide text-gray-500">
                {head('date', 'Date', false)}
                <th className="px-2 py-1.5 font-medium uppercase">Field · combine</th>
                {SETTING_COLS.map((c) => head(c.key, c.label))}
                {head('moisture', 'Moist')}
                {head('temp', '°C')}
                {head('rh', 'RH')}
                {head('wind', 'Wind')}
                {head('loss', 'Loss')}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.row.id} r={r} field={fieldName(r.row.field_id)} combine={combineName(r.row.equipment_id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fold title="Reading this" storageKey="combine-what-worked-why" className="px-3 pb-2">
        <p className="text-xs text-gray-600">
          The lowest loss is highlighted; green losses are at or under the {baseline?.targetLossPct ?? '?'}% target. Compare like with like: the same moisture and humidity. Concave and sieves in
          inches, wind in km/h. The Conditions card shows the lowest-loss settings in conditions like today’s.
        </p>
      </Fold>
    </section>
  )
}

function Row({ r, field, combine }: { r: WhatWorkedRow; field: string; combine: string }) {
  return (
    <tr className={cn('border-b border-gray-50 last:border-0', r.best && 'bg-green-50 font-semibold')}>
      <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
        {day(r.row.checked_at)}
        {r.best && <span className="ml-1 rounded bg-green-600 px-1 text-[9px] font-semibold uppercase text-white">lowest</span>}
      </td>
      <td className="max-w-[10rem] truncate px-2 py-1.5 text-gray-700" title={`${field} · ${combine}`}>
        {field}
        <span className="text-gray-400"> · {combine}</span>
      </td>
      {SETTING_COLS.map((c) => (
        <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-right text-gray-900">
          {r.settings[c.key] != null ? settingText(c.key, r.settings[c.key]) : '—'}
        </td>
      ))}
      <td className="px-2 py-1.5 text-right">{r.conditions.moisturePct != null ? r.conditions.moisturePct.toFixed(1) : '—'}</td>
      <td className="px-2 py-1.5 text-right">{n0(r.conditions.tempC)}</td>
      <td className="px-2 py-1.5 text-right">{n0(r.conditions.rh)}</td>
      <td className="px-2 py-1.5 text-right">{n0(r.conditions.windKmh)}</td>
      <td className={cn('whitespace-nowrap px-2 py-1.5 text-right', r.underTarget ? 'text-green-700' : 'text-gray-900')}>
        {r.lossPct != null ? `${r.lossPct.toFixed(1)}%` : `${r.lossBu.toFixed(2)} bu`}
      </td>
    </tr>
  )
}
