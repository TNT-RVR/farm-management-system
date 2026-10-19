import { SETTINGS, type SettingKey } from '@/lib/combine'
import type { PickedSetting } from '@/lib/combine-start'
import { IN_INCHES, SETTING_LABEL, settingText } from '@/lib/combine-setting-text'

/**
 * The combine settings as boxes to type what was actually run, each with the
 * value the app would start from and where it came from. Shared by Start a
 * field, Field finished and the loss check.
 */

/** One setting: what to set, where it came from, and a box for what was actually run. */
export function SettingRow({ k, picked, value, onChange }: { k: SettingKey; picked: PickedSetting | undefined; value: string; onChange: (v: string) => void }) {
  const s = SETTING_LABEL[k]
  return (
    <li className="flex items-center justify-between gap-2 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">
          {s.label} {picked && <span className="font-mono">{settingText(k, picked.value)}</span>} <span className="text-xs text-gray-400">{s.unit}</span>
        </span>
        {picked && <span className="block text-[11px] text-gray-500">{picked.why}</span>}
      </span>
      <input
        type={IN_INCHES.includes(k) ? 'text' : 'number'}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${s.label} used`}
        className="w-24 shrink-0 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
      />
    </li>
  )
}

/**
 * Every setting as a box, prefilled from `picked` until typed over. `draft`
 * holds only what was typed; `valuesOf` turns the whole list into numbers.
 */
export function SettingsList({
  picked,
  draft,
  onDraft,
  keys = SETTINGS.map((s) => s.key),
}: {
  picked: PickedSetting[]
  draft: Partial<Record<SettingKey, string>>
  onDraft: (d: Partial<Record<SettingKey, string>>) => void
  keys?: SettingKey[]
}) {
  const by = new Map(picked.map((p) => [p.key, p]))
  return (
    <ul className="divide-y divide-gray-100">
      {keys.map((k) => (
        <SettingRow key={k} k={k} picked={by.get(k)} value={draft[k] ?? settingText(k, by.get(k)?.value)} onChange={(v) => onDraft({ ...draft, [k]: v })} />
      ))}
    </ul>
  )
}
