import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Minus, Pencil, Plus, X } from 'lucide-react'
import { useCrops } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { GRADE_ADVICE, bandSegments, chartPdfUrl, gradeLabel, chartSummary, hasBands, type Grade, type MoistureBands } from '@/lib/moisture'
import { cropColour } from '@/lib/crop-colour'
import { Modal } from '@/components/Modal'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'

/** Solid fills for the bar; the badges keep the softer GRADE_STYLE. */
const BAR: Record<Grade, string> = {
  too_dry: 'bg-sky-300',
  dry: 'bg-green-500',
  tough: 'bg-amber-400',
  wet: 'bg-red-600',
}
const DOT: Record<Grade, string> = { ...BAR }

const LEGEND: Grade[] = ['too_dry', 'dry', 'tough', 'wet']

type CropRow = NonNullable<ReturnType<typeof useCrops>['data']>[number]
type Key = keyof Pick<MoistureBands, 'dry_min' | 'dry_max' | 'tough_max'>

const bandsOf = (c: CropRow): MoistureBands => ({
  dry_min: c.moisture_dry_min,
  dry_max: c.moisture_dry_max,
  tough_max: c.moisture_tough_max,
})

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(1).replace(/\.0$/, '')}%`)

/**
 * Safe moisture to harvest at, a card per crop (Sam, 10 Oct 2026): the
 * level it is safe to bin at, large, a slim bar of the bands, and the other
 * cut-offs in words. Tapping Edit opens the levels with handles to drag along
 * the bar and − / + to nudge them; anyone signed in can change them
 * (set_crop_moisture_levels), and the crop's audit log records who did.
 *
 * Replaces a list of bars with every cut-off printed under it, which read
 * like a spreadsheet.
 */
export function MoistureRanges() {
  const { data: crops } = useCrops()
  const [editing, setEditing] = useState<CropRow | null>(null)
  const rows = (crops ?? []).filter((c) => hasBands(bandsOf(c)) && (c.active || c.moisture_chart_key)).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
        {LEGEND.map((g) => (
          <span key={g} className="flex items-center gap-1" title={GRADE_ADVICE[g]}>
            <span className={cn('h-2 w-2 rounded-full', DOT[g])} />
            <span className="capitalize">{gradeLabel(g)}</span>
          </span>
        ))}
        <span className="text-gray-400">· Started from the Canadian Grain Commission grade limits; yours to change.</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-8 text-center text-sm text-gray-500">
          No crop has moisture levels yet.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.cropMoisture()}>Set them on a crop</SetupLink>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <CropCard key={c.id} crop={c} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}

      {editing && <EditLevels crop={editing} onDone={() => setEditing(null)} />}
    </div>
  )
}

function CropCard({ crop, onEdit }: { crop: CropRow; onEdit: () => void }) {
  const b = bandsOf(crop)
  const chart = chartSummary(crop.moisture_chart_key)
  const safe = b.dry_max ?? b.tough_max
  const dryAbove = b.tough_max ?? b.dry_max
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm transition hover:border-brand-200 hover:shadow">
      <header className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cropColour(crop) }} />
        <Link to={`/crops/${crop.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 hover:text-brand-700">
          {crop.name}
        </Link>
        {chart && (
          <a
            href={chartPdfUrl(chart.key)}
            target="_blank"
            rel="noreferrer"
            title={`Model 919 chart ${chart.table_no} — ${chart.crop}, ${chart.sample_weight_g} g sample`}
            className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-brand-700"
          >
            <FileText className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-800"
        >
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </header>

      <p className="flex items-baseline gap-1.5">
        <span className="text-xs text-gray-500">Safe to bin up to</span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-gray-900">{pct(safe)}</span>
      </p>

      <SlimBar bands={b} />

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {b.dry_min != null && <Tag grade="too_dry">Too dry under {pct(b.dry_min)}</Tag>}
        {b.tough_max != null && b.dry_max != null && b.tough_max > b.dry_max && <Tag grade="tough">Air on to {pct(b.tough_max)}</Tag>}
        {dryAbove != null && <Tag grade="wet">Wet over {pct(dryAbove)}</Tag>}
      </div>
    </article>
  )
}

function Tag({ grade, children }: { grade: Grade; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-gray-700 ring-1 ring-gray-200">
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[grade])} />
      {children}
    </span>
  )
}

/**
 * The bands as one slim rounded bar, each band as wide as its range, with the
 * % written under every change of colour (Sam, 10 Oct 2026). Labels that
 * would touch drop to a second line rather than overlap.
 */
function SlimBar({ bands }: { bands: MoistureBands }) {
  const { segments, min, max, edges } = bandSegments(bands)
  if (!segments.length) return null
  const span = max - min || 1
  const at = (v: number) => ((v - min) / span) * 100
  // Two labels closer than this share a line badly: the second goes below.
  const GAP = 11
  const labels = edges.reduce<{ e: number; x: number; low: boolean }[]>((out, e) => {
    const x = at(e)
    const lastTop = out.filter((l) => !l.low).at(-1)?.x ?? -Infinity
    const lastLow = out.filter((l) => l.low).at(-1)?.x ?? -Infinity
    out.push({ e, x, low: x - lastTop < GAP && x - lastLow >= GAP })
    return out
  }, [])
  const twoLines = labels.some((l) => l.low)
  return (
    <div className={cn('relative', twoLines ? 'pb-8' : 'pb-4')}>
      <div className="flex h-2 gap-px overflow-hidden rounded-full bg-gray-100">
        {segments.map((s) => (
          <div
            key={s.grade}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', BAR[s.grade])}
            style={{ width: `${((s.to - s.from) / span) * 100}%` }}
            title={`${gradeLabel(s.grade)}: ${GRADE_ADVICE[s.grade]}`}
          />
        ))}
      </div>
      {labels.map((l) => (
        <span
          key={l.e}
          className={cn('absolute -translate-x-1/2 text-[10px] font-medium tabular-nums text-gray-600', l.low ? 'top-6' : 'top-2.5')}
          style={{ left: `${l.x}%` }}
        >
          <span className="mx-auto mb-px block h-1 w-px bg-gray-300" />
          {pct(l.e)}
        </span>
      ))}
    </div>
  )
}

/** Each level in plain words: what happens at or under it. */
const LEVELS: { key: Key; grade: Grade; label: string; hint: string }[] = [
  { key: 'dry_min', grade: 'too_dry', label: 'Too dry below', hint: 'Under this it cracks and loses weight' },
  { key: 'dry_max', grade: 'dry', label: 'Safe to bin up to', hint: 'Straight grade, binned as it is' },
  { key: 'tough_max', grade: 'tough', label: 'Bin with air on up to', hint: 'Tough: keeps only with the fan on; over this it is wet' },
]
const round1 = (v: number) => Math.round(v * 10) / 10

/** A crop's levels: drag along the bar or nudge with − / +; blank leaves a band out. */
function EditLevels({ crop, onDone }: { crop: CropRow; onDone: () => void }) {
  const qc = useQueryClient()
  const start = bandsOf(crop)
  const [vals, setVals] = useState<Record<Key, number | null>>({
    dry_min: start.dry_min ?? null,
    dry_max: start.dry_max ?? null,
    tough_max: start.tough_max ?? null,
  })
  // The bar's scale is fixed while editing, so a handle does not run away from the finger.
  const [scale] = useState(() => {
    const { min, max } = bandSegments(start, 4)
    return { min, max: Math.max(max, min + 6) }
  })
  const draft: MoistureBands = vals
  const set = LEVELS.filter((l) => vals[l.key] != null)
  const ordered = set.every((l, i) => i === 0 || (vals[l.key] as number) >= (vals[set[i - 1].key] as number))
  const valid = ordered && set.length > 0 && set.every((l) => (vals[l.key] as number) >= 0 && (vals[l.key] as number) < 60)

  /** Keep a level between its set neighbours. */
  const clampFor = (key: Key, v: number) => {
    const i = LEVELS.findIndex((l) => l.key === key)
    const below = LEVELS.slice(0, i).reverse().find((l) => vals[l.key] != null)
    const above = LEVELS.slice(i + 1).find((l) => vals[l.key] != null)
    const lo = below ? (vals[below.key] as number) : 0
    const hi = above ? (vals[above.key] as number) : 59.9
    return round1(Math.min(hi, Math.max(lo, v)))
  }
  const setVal = (key: Key, v: number | null) => setVals((x) => ({ ...x, [key]: v == null ? null : clampFor(key, v) }))

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_crop_moisture_levels', {
        p_crop: crop.id,
        p_dry_min: vals.dry_min,
        p_dry_max: vals.dry_max,
        p_tough_max: vals.tough_max,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      onDone()
    },
  })

  return (
    <Modal title={`Moisture levels · ${crop.name}`} onClose={onDone}>
      <div className="space-y-4">
        <DragBar bands={draft} scale={scale} onMove={(k, v) => setVal(k, v)} />

        <ul className="space-y-1.5">
          {LEVELS.map((l) => {
            const v = vals[l.key]
            return (
              <li key={l.key} className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-2.5 py-1.5">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DOT[l.grade], v == null && 'opacity-30')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', v == null ? 'text-gray-400' : 'font-medium text-gray-800')}>{l.label}</span>
                  <span className="block text-[11px] text-gray-500">{l.hint}</span>
                </span>
                {v == null ? (
                  <button
                    type="button"
                    onClick={() => {
                      const below = LEVELS.slice(0, LEVELS.indexOf(l)).reverse().find((x) => vals[x.key] != null)
                      setVal(l.key, below ? (vals[below.key] as number) + 1 : 10)
                    }}
                    className="rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-600 hover:border-brand-300 hover:text-brand-800"
                  >
                    Add
                  </button>
                ) : (
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label={`Lower ${l.label}`} onClick={() => setVal(l.key, v - 0.5)} className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.1"
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => setVals((x) => ({ ...x, [l.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                      onBlur={(e) => e.target.value !== '' && setVal(l.key, Number(e.target.value))}
                      aria-label={l.label}
                      className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-center text-sm tabular-nums"
                    />
                    <button type="button" aria-label={`Raise ${l.label}`} onClick={() => setVal(l.key, v + 0.5)} className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={`Leave out ${l.label}`} title="Leave this band out" onClick={() => setVals((x) => ({ ...x, [l.key]: null }))} className="rounded p-1 text-gray-300 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {!ordered && <p className="text-xs text-red-700">Each level has to be at or above the one before it.</p>}
        {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onDone} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The bands on a fixed scale, with a handle on each cut-off to drag. */
function DragBar({ bands, scale, onMove }: { bands: MoistureBands; scale: { min: number; max: number }; onMove: (key: Key, v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Key | null>(null)
  const span = scale.max - scale.min
  const at = (v: number) => ((Math.min(scale.max, Math.max(scale.min, v)) - scale.min) / span) * 100
  const { segments } = bandSegments(bands)
  const valueAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return null
    return scale.min + ((clientX - r.left) / r.width) * span
  }
  const handles = LEVELS.filter((l) => bands[l.key] != null)
  return (
    <div className="px-2 pb-1 pt-6">
      <div ref={ref} className="relative h-7 select-none">
        <div className="absolute inset-0 flex overflow-hidden rounded-lg bg-gray-100">
          {segments.map((s) => {
            const from = Math.max(scale.min, s.from)
            const to = Math.min(scale.max, s.to)
            return to > from ? (
              <div key={s.grade} className={cn('h-full', BAR[s.grade])} style={{ marginLeft: s === segments[0] ? `${at(from)}%` : undefined, width: `${((to - from) / span) * 100}%` }} />
            ) : null
          })}
        </div>
        {handles.map((l) => {
          const v = bands[l.key] as number
          return (
            <button
              key={l.key}
              type="button"
              aria-label={`${l.label} ${v}%`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                setDragging(l.key)
              }}
              onPointerMove={(e) => {
                if (dragging !== l.key) return
                const nv = valueAt(e.clientX)
                if (nv != null) onMove(l.key, nv)
              }}
              onPointerUp={() => setDragging(null)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') onMove(l.key, v - 0.1)
                if (e.key === 'ArrowRight') onMove(l.key, v + 0.1)
              }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none"
              style={{ left: `${at(v)}%` }}
            >
              <span className={cn('absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[11px] font-semibold tabular-nums', dragging === l.key ? 'bg-gray-900 text-white' : 'text-gray-700')}>
                {pct(v)}
              </span>
              <span className={cn('block h-9 w-4 cursor-ew-resize rounded-full border-2 border-white shadow ring-1 ring-gray-300', DOT[l.grade], dragging === l.key && 'scale-110 ring-gray-500')} />
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-gray-400">Drag a handle, or use − and + below.</p>
    </div>
  )
}
