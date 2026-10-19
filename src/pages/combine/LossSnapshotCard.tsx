import { Fold } from '@/components/Fold'
import { Select } from '@/components/Select'
import { cn } from '@/lib/utils'
import { OTHER_OPERATOR, type LossSnapshotState } from '@/lib/combine-loss-snapshot'
import { settingsLine } from '@/lib/combine-setting-text'
import { SettingsList } from './SettingInputs'

/**
 * Loss check step 5: the combine, who is driving and the settings now, kept
 * with the check as a snapshot. Prefilled; the operator corrects what has
 * changed since. The moisture is the nearest test or the dry-down model, and
 * can be typed over. The weather is fetched when it saves.
 */
export function LossSnapshotCard({ s }: { s: LossSnapshotState }) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-700">5. The combine right now</p>
      {s.combines.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Combine">
          {s.combines.map((m) => {
            const on = s.combineId === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => s.setCombineId(on ? '' : m.id)}
                className={cn('rounded-full border px-3 py-1.5 text-sm', on ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-gray-200 text-gray-600')}
              >
                {m.name ?? 'Combine'}
              </button>
            )
          })}
        </div>
      )}
      <Select
        value={s.operatorPick}
        ariaLabel="Operator"
        size="sm"
        placeholder="Who is driving"
        onChange={s.setOperatorPick}
        options={[...s.people.map((p) => ({ value: p.id, label: p.name })), { value: OTHER_OPERATOR, label: 'Someone else…' }]}
      />
      {s.operatorPick === OTHER_OPERATOR && (
        <input
          value={s.operatorTyped}
          onChange={(e) => s.setOperatorTyped(e.target.value)}
          placeholder="Name"
          aria-label="Operator name"
          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      )}
      <label className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          Grain moisture
          <span className="block text-[11px] text-gray-400">{s.auto ? `${s.auto.pct.toFixed(1)}% from the ${s.auto.from}` : 'No test near this time and no dry-down estimate.'}</span>
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          value={s.moistureTyped}
          placeholder={s.auto ? s.auto.pct.toFixed(1) : '%'}
          onChange={(e) => s.setMoistureTyped(e.target.value)}
          aria-label="Grain moisture now"
          className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums text-gray-900"
        />
      </label>
      <Fold title="Settings now" summary={settingsLine(s.snapshot) || 'none'} storageKey="combine-loss-settings">
        <SettingsList picked={s.picked} draft={s.draft} onDraft={s.setDraft} />
      </Fold>
    </div>
  )
}
