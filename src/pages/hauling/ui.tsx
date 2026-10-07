import { useState, type ReactNode } from 'react'
import { useBasics, useOperatingSettings, useResetOperatingSetting, useSaveOperatingSetting } from '@/lib/hauling-data'
import { cn } from '@/lib/utils'


export const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900'

export function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

export type NumberField<K extends string> = { key: K; label: string; unit?: string; hint?: string; step?: number }

/**
 * A group of numbers stored under one setting key, each shown beside its
 * default. A number nobody has set reads "default", in grey, so a guess can
 * never pass for the farm's own figure.
 */
export function SettingsGroup<K extends string>({
  settingKey,
  fields,
  values,
  defaults,
  isManager,
  title,
}: {
  settingKey: string
  fields: NumberField<K>[]
  values: Record<K, number>
  defaults: Record<K, number>
  isManager: boolean
  title?: string
}) {
  const s = useOperatingSettings()
  const save = useSaveOperatingSetting()
  const reset = useResetOperatingSetting()
  const saved = (s.get(settingKey) ?? {}) as Record<string, unknown>
  const [draft, setDraft] = useState<Record<string, string>>({})
  const dirty = Object.keys(draft).length > 0
  return (
    <div>
      {title && <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>}
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const isSet = saved[f.key] != null
          return (
            <label key={f.key} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="min-w-0 flex-1">
                {f.label}
                {f.hint && <span className="block text-[10px] text-gray-400">{f.hint}</span>}
              </span>
              {isManager ? (
                <input
                  inputMode="decimal"
                  value={draft[f.key] ?? String(values[f.key])}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className={cn(input, 'w-20 text-right text-xs', !isSet && draft[f.key] == null && 'text-gray-400')}
                />
              ) : (
                <span className={cn('tabular-nums', !isSet && 'text-gray-400')}>{values[f.key]}</span>
              )}
              <span className="w-12 text-[10px] text-gray-400">{f.unit}</span>
              <span className={cn('w-12 text-[10px]', isSet ? 'font-medium text-brand-700' : 'text-gray-400')} title={`Default ${defaults[f.key]}`}>
                {isSet ? 'ours' : 'default'}
              </span>
            </label>
          )
        })}
      </div>
      {isManager && (
        <div className="mt-2 flex flex-wrap gap-2">
          {dirty && (
            <button
              type="button"
              disabled={save.isPending}
              onClick={async () => {
                const next: Record<string, number> = {}
                for (const [k, v] of Object.entries(saved)) if (typeof v === 'number') next[k] = v
                for (const [k, v] of Object.entries(draft)) {
                  const n = Number(v)
                  if (v.trim() !== '' && Number.isFinite(n) && n >= 0) next[k] = n
                }
                await save.mutateAsync({ key: settingKey, value: next })
                setDraft({})
              }}
              className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
          {dirty && (
            <button type="button" onClick={() => setDraft({})} className="text-xs text-gray-500 underline">
              cancel
            </button>
          )}
          {!dirty && Object.keys(saved).length > 0 && (
            <button type="button" onClick={() => reset.mutate(settingKey)} className="text-xs text-gray-500 underline">
              back to the defaults
            </button>
          )}
          {save.isError && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
        </div>
      )}
    </div>
  )
}

/** Diesel and wage: the two prices under every number on the page. */
export function PricesBar({ isManager }: { isManager: boolean }) {
  const b = useBasics()
  const save = useSaveOperatingSetting()
  const reset = useResetOperatingSetting()
  const [d, setD] = useState<string | null>(null)
  const [w, setW] = useState<string | null>(null)
  const one = (
    label: string,
    value: number,
    unit: string,
    source: string,
    isSet: boolean,
    draft: string | null,
    setDraft: (v: string | null) => void,
    key: string,
  ) => (
    <div className="min-w-0 flex-1 basis-64">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">{label}</span>
        {isManager ? (
          <input inputMode="decimal" value={draft ?? value.toFixed(2)} onChange={(e) => setDraft(e.target.value)} className={cn(input, 'w-20 text-right', !isSet && draft == null && 'text-gray-400')} />
        ) : (
          <span className="font-semibold tabular-nums">${value.toFixed(2)}</span>
        )}
        <span className="text-xs text-gray-500">{unit}</span>
        {draft != null && (
          <button
            type="button"
            onClick={async () => {
              const n = Number(draft)
              if (Number.isFinite(n) && n > 0) await save.mutateAsync({ key, value: n })
              setDraft(null)
            }}
            className="rounded-md bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white"
          >
            Save
          </button>
        )}
        {isSet && draft == null && isManager && (
          <button type="button" onClick={() => reset.mutate(key)} className="text-[11px] text-gray-500 underline">
            use the default
          </button>
        )}
      </div>
      <p className={cn('text-[11px]', isSet ? 'text-brand-700' : 'text-gray-400')}>{source}</p>
    </div>
  )
  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white px-3 py-2">
      {one('Diesel', b.dieselPerL, '/L', b.dieselSource, b.dieselSet, d, setD, 'diesel_per_l')}
      {one('Labour', b.wage, '/h', b.wageSource, b.wageSet, w, setW, 'labour_per_hour')}
    </div>
  )
}
