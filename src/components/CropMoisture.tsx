import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Droplet, FileText, RotateCcw } from 'lucide-react'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import {
  CHARTS,
  GRADE_ADVICE,
  GRADE_STYLE,
  bandRanges,
  gradeLabel,
  chartPdfUrl,
  chartSummary,
} from '@/lib/moisture'
import { cn } from '@/lib/utils'

type CropRow = Database['public']['Tables']['crops']['Row']

/**
 * The CGC's straight-grade limits, for putting a crop back after somebody has
 * changed it and wants to start again.
 *
 * Keyed by crop name, which is how the seeding migration did it. A crop whose
 * name is not here simply has no reset offered — a made-up default would be
 * worse than none, since these numbers decide whether a bin gets a fan on it.
 */
const CGC_DEFAULTS: Record<string, [number, number, number | null, number | null]> = {
  Wheat: [14.5, 17.0, null, null],
  'Durum Wheat': [14.5, 17.0, null, null],
  Barley: [14.8, 17.0, null, null],
  Oats: [13.5, 17.0, null, null],
  Triticale: [14.0, 17.0, null, null],
  Canola: [10.0, 12.5, null, null],
  'Seed Canola': [10.0, 12.5, null, null],
  Peas: [16.0, 18.0, null, null],
  Soybeans: [14.0, 16.0, 18.0, 20.0],
  Corn: [15.5, 17.5, 21.0, 25.0],
  'Grain Corn': [15.5, 17.5, 21.0, 25.0],
  'High-Moisture Corn': [15.5, 17.5, 21.0, 25.0],
  'Beans-Black': [18.0, 18.0, null, null],
  'Beans-Great Northern': [18.0, 18.0, null, null],
  'Beans-Pinto': [18.0, 18.0, null, null],
  'Beans-Yellow': [18.0, 18.0, null, null],
  'Dry Beans': [18.0, 18.0, null, null],
}

const FIELDS = [
  { key: 'dry', label: 'Dry up to', hint: 'Straight grade. Safe to bin.' },
  { key: 'tough', label: 'Tough up to', hint: 'Bin it with air on. Same as dry where the crop has no tough range — beans do not.' },
  { key: 'damp', label: 'Damp up to', hint: 'Leave blank where the CGC stops at damp, as it does for wheat.' },
  { key: 'moist', label: 'Moist up to', hint: 'Only corn, soybeans and the oilseed specials go this far.' },
] as const

const str = (n: number | null | undefined) => (n == null ? '' : String(n))
const numOrNull = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * What this crop can be put away at, and which Model 919 chart it reads on.
 *
 * The numbers arrived as the Canadian Grain Commission's straight-grade limits
 * and are editable here, because the CGC's question is what a buyer will grade
 * it as and the question being asked at the bin is whether it will keep — the
 * same number answers both most of the time, and it is the farm's call when it
 * does not.
 */
export function CropMoisture({ crop, readonly }: { crop: CropRow; readonly: boolean }) {
  const qc = useQueryClient()
  // Arriving from a "set a chart / set the bands" link (?section=moisture): this card, in view.
  const [params] = useSearchParams()
  const asked = params.get('section') === 'moisture'
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (asked) card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [asked])
  const [form, setForm] = useState({
    chart: crop.moisture_chart_key ?? '',
    dry: str(crop.moisture_dry_max),
    tough: str(crop.moisture_tough_max),
    damp: str(crop.moisture_damp_max),
    moist: str(crop.moisture_moist_max),
    dryMin: str(crop.moisture_dry_min),
    toughAdvice: crop.moisture_tough_advice ?? '',
    note: crop.moisture_note ?? '',
  })
  const [dirty, setDirty] = useState(false)

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('crops')
        .update({
          moisture_chart_key: form.chart || null,
          moisture_dry_max: numOrNull(form.dry),
          moisture_tough_max: numOrNull(form.tough),
          moisture_damp_max: numOrNull(form.damp),
          moisture_moist_max: numOrNull(form.moist),
          moisture_dry_min: numOrNull(form.dryMin),
          moisture_tough_advice: form.toughAdvice.trim() || null,
          moisture_note: form.note.trim() || null,
        })
        .eq('id', crop.id)
      if (error) throw error
    },
    onSuccess: () => {
      setDirty(false)
      void qc.invalidateQueries({ queryKey: ['crops'] })
    },
  })

  const bands = bandRanges({
    dry_min: numOrNull(form.dryMin),
    dry_max: numOrNull(form.dry),
    tough_max: numOrNull(form.tough),
    damp_max: numOrNull(form.damp),
    moist_max: numOrNull(form.moist),
  })
  const summary = chartSummary(form.chart)
  const cgc = CGC_DEFAULTS[crop.name]
  const changedFromCgc =
    cgc != null &&
    (numOrNull(form.dry) !== cgc[0] ||
      numOrNull(form.tough) !== cgc[1] ||
      numOrNull(form.damp) !== cgc[2] ||
      numOrNull(form.moist) !== cgc[3])

  const resetToCgc = () => {
    if (!cgc) return
    setForm((f) => ({
      ...f,
      dry: str(cgc[0]),
      tough: str(cgc[1]),
      damp: str(cgc[2]),
      moist: str(cgc[3]),
    }))
    setDirty(true)
  }

  return (
    <div ref={card} className="scroll-mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Droplet className="h-4 w-4 text-gray-400" /> Moisture
        </h3>
        <div className="flex items-center gap-2">
          {changedFromCgc && !readonly && (
            <button
              onClick={resetToCgc}
              title="Put the Canadian Grain Commission's straight-grade limits back"
              className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              <RotateCcw className="h-3 w-3" /> CGC limits
            </button>
          )}
          {dirty && !readonly && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        What {crop.name.toLowerCase()} can be binned at, and which Model 919 chart it reads on.
        Anything above dry raises a bin-needs-air alert once the field is off.
      </p>

      <label className="mt-3 block text-xs text-gray-500 sm:max-w-96">
        Conversion chart
        <Select
          disabled={readonly}
          value={form.chart}
          ariaLabel="Model 919 conversion chart"
          className="mt-1"
          onChange={(v) => set('chart', v)}
          options={[
            { value: '', label: 'No chart — moisture typed in by hand' },
            ...CHARTS.map((c) => ({ value: c.key, label: `${c.crop} (${c.sample_weight_g} g)` })),
          ]}
        />
      </label>
      {summary && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
          <span>
            Table {summary.table_no} · {summary.revised} · weigh {summary.sample_weight_g} g ·
            calibrate at {summary.calibrate_at}
          </span>
          <a
            href={chartPdfUrl(summary.key)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 underline hover:text-brand-700"
          >
            <FileText className="h-3.5 w-3.5" /> chart PDF
          </a>
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label
          className="text-xs text-gray-500"
          title="Leave blank unless the crop can be too dry to sell well — beans crack and get docked under 14 %."
        >
          Too dry below %
          <input
            inputMode="decimal"
            disabled={readonly}
            value={form.dryMin}
            onChange={(e) => set('dryMin', e.target.value)}
            placeholder="—"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900 disabled:bg-gray-50"
          />
        </label>
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-gray-500" title={f.hint}>
            {f.label} %
            <input
              inputMode="decimal"
              disabled={readonly}
              value={form[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder="—"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums text-gray-900 disabled:bg-gray-50"
            />
          </label>
        ))}
      </div>

      {/* The bands as they will actually read, so a typo shows up here rather
          than three weeks later as an alert that never fires. */}
      {bands.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {bands.map((b) => (
            <span
              key={b.grade}
              title={GRADE_ADVICE[b.grade]}
              className={cn('rounded px-2 py-0.5 text-xs tabular-nums', GRADE_STYLE[b.grade])}
            >
              <span className="font-semibold capitalize">{gradeLabel(b.grade)}</span> {b.range}%
            </span>
          ))}
        </div>
      )}

      <label className="mt-3 block text-xs text-gray-500">
        What to do with a tough sample of this crop
        <input
          disabled={readonly}
          value={form.toughAdvice}
          onChange={(e) => set('toughAdvice', e.target.value)}
          placeholder="Blank means the usual: bin it with air on. Beans: fine if it goes straight to the plant…"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
        />
      </label>

      <label className="mt-3 block text-xs text-gray-500">
        Note
        <input
          disabled={readonly}
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="Where these depart from the CGC, and why…"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50"
        />
      </label>

      {save.isError && (
        <p className="mt-2 text-xs text-red-600">{(save.error as Error).message}</p>
      )}
    </div>
  )
}
