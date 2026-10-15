import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { HelpNote } from '@/components/HelpNote'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Select } from '@/components/Select'
import { ColumnHelp } from '@/components/ColumnHelp'
import { useFieldSoilReports, useSoilTestCoverage } from '@/lib/soilTests'
import { useFields } from '@/lib/queries'
import { SOIL_COLUMNS, SOIL_HELP, SOIL_MICRO_COLUMNS } from '@/lib/soil-help'
import {
  availableNutrients,
  buildHistory,
  DEPTH_MODES,
  seriesFor,
  yearSpan,
  type DepthMode,
} from '@/lib/nutrient-history'
import { cn } from '@/lib/utils'

const PALETTE = ['#0f172a', '#0284c7', '#c2410c', '#7c3aed', '#0f766e', '#b45309', '#be123c']

/** Every column that can be charted, in table order, excluding the labels. */
const CHARTABLE = [...SOIL_COLUMNS, ...SOIL_MICRO_COLUMNS].filter(
  (c) => !['sample', 'depth'].includes(c.key),
)
const LABEL = new Map(CHARTABLE.map((c) => [c.key, c.label + (c.unit ? ` (${c.unit})` : '')]))

/**
 * A nutrient's colour, fixed for good.
 *
 * Keyed to its position in the full column list, NOT to its position among the
 * currently selected ones — otherwise toggling any nutrient reshuffles every
 * colour after it, and potassium is blue one moment and orange the next while
 * you are trying to follow a single line across the years.
 */
const colourFor = (key: string) =>
  PALETTE[Math.max(0, CHARTABLE.findIndex((c) => c.key === key)) % PALETTE.length]

/**
 * Year and the crop grown that year, stacked under the axis.
 *
 * The crop is the reason a nutrient moved — potassium falling after silage, or
 * nitrate left behind by a poor year — so it belongs on the axis rather than in
 * a tooltip nobody opens while scanning a trend.
 */
function YearTick({
  x,
  y,
  payload,
  crops,
}: {
  // recharts types these as string | number; it passes numbers at runtime.
  x?: string | number
  y?: string | number
  payload?: { value?: string | number }
  crops: Map<number, string | null>
}) {
  const year = payload?.value == null ? null : Number(payload.value)
  const crop = year == null ? null : crops.get(year)
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="middle" dy={12} className="fill-gray-700" style={{ fontSize: 11, fontWeight: 600 }}>
        {year}
      </text>
      {crop && (
        <text textAnchor="middle" dy={26} className="fill-gray-500" style={{ fontSize: 10 }}>
          {crop}
        </text>
      )}
    </g>
  )
}

export function NutrientHistory({
  fieldId,
  setFieldId,
}: {
  fieldId: string
  setFieldId: (v: string) => void
}) {
  const { data: fields } = useFields()
  const { data: coverage } = useSoilTestCoverage()
  const options = useMemo(() => {
    const tested = new Set((coverage ?? []).map((c) => c.field_id))
    return (fields ?? [])
      .filter((f) => f.active || tested.has(f.id))
      .map((f) => ({ value: f.id, label: f.active ? f.name : `${f.name} (archived)` }))
  }, [fields, coverage])
  const selected = fieldId || options[0]?.value || ''
  const { data: reports, isLoading } = useFieldSoilReports(selected || undefined)

  const [mode, setMode] = useState<DepthMode>('top')
  // Null means "not chosen yet", and the default is DERIVED below rather than
  // written into state by an effect. Syncing state to props on every field
  // change costs a second render pass and, when two effects do it, a cascade.
  const [pickedRaw, setPicked] = useState<string[] | null>(null)
  const [rangeRaw, setRange] = useState<{ from: number; to: number } | null>(null)

  const span = useMemo(() => (reports ? yearSpan(reports) : null), [reports])
  const offered = useMemo(
    () => (reports ? availableNutrients(reports, CHARTABLE.map((c) => c.key)) : []),
    [reports],
  )

  // Defaults: the whole history, and a few nutrients worth opening on. Derived
  // per field because coverage differs — a field with no micronutrient panel
  // should not open on an empty chart.
  const defaults = useMemo(() => {
    const preferred = ['p_bicarb_ppm', 'k_ppm', 'om_pct'].filter((k) => offered.includes(k))
    return preferred.length ? preferred : offered.slice(0, 2)
  }, [offered])

  // A selection the user made survives; otherwise the default stands. Cleared
  // back to null when the field changes so the next field gets its own default
  // rather than inheriting one that may not exist in its panel.
  const picked = useMemo(
    () => (pickedRaw ?? defaults).filter((k) => offered.includes(k)),
    [pickedRaw, defaults, offered],
  )
  // Memoised because it feeds a dependency array; a fresh object each render
  // would rebuild the chart data on every keystroke elsewhere on the page.
  const range = useMemo(
    () =>
      rangeRaw && span
        ? { from: Math.max(rangeRaw.from, span.from), to: Math.min(rangeRaw.to, span.to) }
        : span,
    [rangeRaw, span],
  )

  const rows = useMemo(
    () => (reports ? buildHistory(reports, picked, mode, range ?? undefined) : []),
    [reports, picked, mode, range],
  )
  const crops = useMemo(
    () => new Map(rows.map((r) => [r.year, (r.crop as string | null) ?? null])),
    [rows],
  )

  // Nutrients differ by orders of magnitude — potassium near 150 ppm against a
  // pH near 8. Anything small enough to be a flat line beside the biggest series
  // goes on its own right-hand axis, otherwise selecting K and pH together would
  // draw pH as a straight line along the floor.
  const axisOf = useMemo(() => {
    const peak = new Map<string, number>()
    for (const key of picked) {
      const vals = rows.flatMap((r) =>
        seriesFor(key, mode)
          .map((s) => r[s.id])
          .filter((v): v is number => typeof v === 'number'),
      )
      peak.set(key, vals.length ? Math.max(...vals) : 0)
    }
    const top = Math.max(1, ...peak.values())
    return new Map([...peak].map(([key, v]) => [key, v < top * 0.1 ? 'right' : 'left'] as const))
  }, [picked, rows, mode])
  const usesRight = [...axisOf.values()].includes('right')

  const toggle = (key: string) =>
    setPicked((p) => {
      const base = p ?? defaults
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
    })

  const years = span ? Array.from({ length: span.to - span.from + 1 }, (_, i) => span.from + i) : []

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={selected}
          onChange={setFieldId}
          ariaLabel="Field"
          className="w-full sm:w-56"
          options={options}
        />

        <div className="flex items-center gap-1 rounded-md border border-gray-200 p-0.5">
          {DEPTH_MODES.map((d) => (
            <button
              key={d.id}
              onClick={() => setMode(d.id)}
              title={d.hint}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                mode === d.id ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {span && (
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <span>Years</span>
            <Select
              value={String(range?.from ?? span.from)}
              onChange={(v) => setRange((r) => ({ from: Number(v), to: Math.max(Number(v), r?.to ?? span.to) }))}
              ariaLabel="From year"
              size="sm"
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
            <span>to</span>
            <Select
              value={String(range?.to ?? span.to)}
              onChange={(v) => setRange((r) => ({ from: Math.min(Number(v), r?.from ?? span.from), to: Number(v) }))}
              ariaLabel="To year"
              size="sm"
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
            {range && (range.from !== span.from || range.to !== span.to) && (
              <button
                onClick={() => setRange(span)}
                className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                All years
              </button>
            )}
          </div>
        )}
      </div>

      {/* Nutrient picker. Only what this field actually has — offering a dead
          option is worse than not offering it, because the empty chart that
          follows looks like a bug rather than a gap in the lab panel. */}
      <div className="mb-3 rounded-lg border border-gray-200 bg-white p-2">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Nutrients ({picked.length} shown)
        </p>
        <div className="flex flex-wrap gap-1">
          {CHARTABLE.filter((c) => offered.includes(c.key)).map((c) => {
            const on = picked.includes(c.key)
            const colour = colourFor(c.key)
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                style={on ? { borderColor: colour, color: colour } : undefined}
                aria-pressed={on}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  on ? 'bg-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
                )}
              >
                {on && (
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: colour }}
                  />
                )}
                {c.label}
                {c.unit ? <span className="ml-0.5 font-normal opacity-60">{c.unit}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      ) : !reports?.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
          No soil tests on file for this field.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.soilTests(selected)}>Upload one</SetupLink>
        </p>
      ) : !picked.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
          Pick a nutrient above to chart it.
        </p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis
                dataKey="year"
                height={44}
                interval={0}
                tick={(props) => <YearTick {...props} crops={crops} />}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              {usesRight && (
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              )}
              <Tooltip
                labelFormatter={(y) => `${y}${crops.get(Number(y)) ? ` · ${crops.get(Number(y))}` : ''}`}
                formatter={(v, name) => [typeof v === 'number' ? Math.round(v * 100) / 100 : '—', name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {picked.flatMap((key) =>
                seriesFor(key, mode).map((sr) => (
                  <Line
                    key={sr.id}
                    yAxisId={axisOf.get(key) === 'right' ? 'right' : 'left'}
                    type="monotone"
                    dataKey={sr.id}
                    name={`${LABEL.get(key) ?? key}${sr.suffix}`}
                    stroke={colourFor(key)}
                    // In both-depths mode the subsoil is the same colour dashed,
                    // so the pair reads as one nutrient at two depths rather
                    // than as two unrelated series.
                    strokeDasharray={sr.id.endsWith('__sub') ? '5 4' : undefined}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                )),
              )}
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-2">
            {picked.map((key) => (
              <span key={key} className="flex items-center text-[11px] text-gray-500">
                {LABEL.get(key)}
                {axisOf.get(key) === 'right' && <span className="ml-1 text-gray-400">(right axis)</span>}
                {SOIL_HELP[key] && <ColumnHelp help={SOIL_HELP[key]} />}
              </span>
            ))}
          </div>

          <HelpNote className="mt-1.5" summary="Each point is the field's average for that year; a gap means the test wasn't run." title="How to read this chart">
            Each point is the average across the field&rsquo;s sample sites for that year, so years
            stay comparable when the number of cores changes. A gap in a line means the lab did not
            run that test that year — 2024 has no micronutrient panel — rather than a reading of
            zero. Nutrients far smaller than the largest selected are drawn against the right-hand
            axis so they do not flatten to the floor.
          </HelpNote>
        </div>
      )}
    </div>
  )
}
