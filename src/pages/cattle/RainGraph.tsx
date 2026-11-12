import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LegendPayload,
} from 'recharts'
import { precipZoneEdges, precipZones } from '@/lib/forage-yield'
import { useWheelZoom } from '@/lib/useWheelZoom'

/**
 * The precipitation bands, palest at the bottom.
 *
 * A sequential ramp of one hue, light to dark, because the thing it encodes is
 * magnitude — more rain. Kept deliberately faint: the bands are there to tell
 * you which row of the estimator the year is in at a glance, and anything
 * stronger competes with the line that carries the actual number. The lowest
 * band is plain white, so "below the table" reads as absence rather than as
 * another shade of blue.
 */
const ZONE_FILL = ['#ffffff', '#f3f9ff', '#e9f4fe', '#ddeefd', '#d2e8fc', '#c7e2fb']

/**
 * The two cumulative lines: solid for this year, dashed for the 10-year
 * average. Defined once because the legend draws its own swatches, and a
 * swatch that disagrees with the line is worse than no legend at all.
 */
const THIS_YEAR = { color: '#0369a1', width: 2 }
const AVERAGE = { color: '#64748b', width: 1.5, dash: '5 4' }

/**
 * Recharts gives every <Line> the same straight icon and ignores
 * strokeDasharray, so this year's rain and the 10-year average arrived in the
 * legend as two identical marks in two colours that read alike at 11 px. These
 * swatches carry the dash pattern instead -- solid is this year, dashed is the
 * average -- which is what tells the two lines apart on the chart itself.
 */
function RainLegend({ payload }: { payload?: readonly LegendPayload[] }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] text-gray-600">
      {(payload ?? []).map((p) => {
        const key = String(p.dataKey)
        const avg = key === 'avg'
        return (
          <li key={key} className="flex items-center gap-1.5">
            <svg width="20" height="8" aria-hidden="true">
              {key === 'daily' ? (
                <rect x="4" y="1" width="12" height="6" fill={p.color} />
              ) : (
                <line
                  x1="0"
                  y1="4"
                  x2="20"
                  y2="4"
                  stroke={p.color}
                  strokeWidth={avg ? AVERAGE.width : THIS_YEAR.width}
                  strokeDasharray={avg ? AVERAGE.dash : undefined}
                />
              )}
            </svg>
            {p.value}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Cumulative growing-season rainfall (running total mm) with daily bars, and
 * the 10-year average running total to the same day when it is known — so a
 * dry year reads as a gap between two lines, not a number to remember.
 *
 * Behind it, the Forage Yield Estimator's own precipitation rows as bands. They
 * say which row the season is landing in, which is the only thing rainfall
 * decides: the pounds per acre also depend on each pasture's grass quality, and
 * that lives on the pasture, not on this chart. See precipZones() for the
 * mislabelling this replaced.
 *
 * `projectedMm` is the season total the calculator is actually planning on —
 * the rain so far plus a normal rest of season. It is drawn because flat band
 * edges against a climbing line are honest only at the end of the season: in
 * April the line is near zero and sits under every band, which reads as
 * disaster every spring. The projection is the value the bands should be read
 * against from May onward.
 */
export function RainGraph({
  series,
  normal,
  projectedMm,
}: {
  series: { t: string; mm: number }[]
  normal?: { md: string; mm: number }[]
  projectedMm?: number | null
}) {
  const avgByMd = new Map((normal ?? []).map((n) => [n.md, n.mm]))
  const data = series.reduce<{ ms: number; cum: number; daily: number; avg: number | null }[]>((arr, p) => {
    const prev = arr.length ? arr[arr.length - 1].cum : 0
    arr.push({
      ms: new Date(p.t + 'T12:00:00Z').getTime(),
      cum: Math.round((prev + p.mm) * 10) / 10,
      daily: p.mm,
      avg: avgByMd.get(p.t.slice(5)) ?? null,
    })
    return arr
  }, [])
  const total = data.length ? data[data.length - 1].cum : 0
  // Room for the projection too, or the line marking it would sit off the top.
  const highest = Math.max(total, projectedMm ?? 0)
  const maxY = Math.max(350, Math.ceil(highest / 50) * 50 + 50)
  const zones = precipZones(maxY)
  /*
   * The daily bars are on their own scale, and once the plot area is shaded by
   * cumulative band a tall bar reads as a cumulative figure: an 18 mm day drawn
   * to full height looked like 300 mm of season. Giving the daily axis four
   * times the headroom it needs pins the bars into a strip along the bottom, so
   * they read as "it rained here, this much" against their own axis without
   * climbing through bands that mean something else.
   */
  const dailyMax = data.reduce((m, d) => Math.max(m, d.daily), 0)
  const dailyTop = Math.max(Math.ceil(dailyMax / 5) * 5 * 4, 20)
  const edges = precipZoneEdges().filter((mm) => mm < maxY)
  const dataMin = data.length ? data[0].ms : NaN
  const dataMax = data.length ? data[data.length - 1].ms : NaN
  const { attach, domain, reset, zoomed } = useWheelZoom(dataMin, dataMax)

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

  return (
    <div ref={attach} className="relative">
      {zoomed && (
        <button
          onClick={reset}
          className="absolute right-1 top-0 z-10 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
        >
          Reset zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        {/* Bands first, so every mark draws over them. */}
        {zones.map((z, i) => (
          <ReferenceArea
            key={z.label}
            yAxisId="cum"
            y1={z.lo}
            y2={z.hi ?? maxY}
            fill={ZONE_FILL[Math.min(i, ZONE_FILL.length - 1)]}
            fillOpacity={1}
            ifOverflow="hidden"
          />
        ))}
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis
          dataKey="ms"
          type="number"
          domain={domain ?? ['dataMin', 'dataMax']}
          allowDataOverflow
          scale="time"
          tickFormatter={fmtDate}
          tick={{ fontSize: 11 }}
          minTickGap={44}
        />
        <YAxis
          yAxisId="cum"
          domain={[0, maxY]}
          tick={{ fontSize: 11 }}
          label={{ value: 'cumulative mm', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
        />
        <YAxis
          yAxisId="daily"
          orientation="right"
          domain={[0, dailyTop]}
          tick={{ fontSize: 11 }}
          label={{ value: 'daily mm', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
        />
        <Tooltip
          labelFormatter={(ms) => new Date(Number(ms)).toLocaleDateString('en-CA')}
          formatter={(v, name) => [`${Number(v).toFixed(1)} mm`, name as string]}
        />
        <Legend verticalAlign="bottom" height={22} content={<RainLegend />} />
        {/*
         * Each row edge, labelled with its own mm, sitting on the line.
         *
         * The bands used to carry the label instead ("250–350 mm", printed just
         * inside the band's top edge), which put a range beside a single line
         * and left you guessing whether that line was the 250 or the 350 —
         * Sam, 11 Nov 2026. One number on the line it marks cannot be read
         * two ways, and the shading alone then says which side is wetter.
         */}
        {edges.map((mm) => (
          <ReferenceLine
            key={mm}
            yAxisId="cum"
            y={mm}
            stroke="#cbd5e1"
            strokeDasharray="2 3"
            label={{ value: `${mm} mm`, position: 'insideTopRight', fontSize: 9, fill: '#94a3b8' }}
          />
        ))}
        <Bar yAxisId="daily" dataKey="daily" name="Daily" fill="#bae6fd" />
        <Line yAxisId="cum" type="monotone" dataKey="cum" name="This year" stroke={THIS_YEAR.color} strokeWidth={THIS_YEAR.width} dot={false} />
        {avgByMd.size > 0 && (
          <Line yAxisId="cum" type="monotone" dataKey="avg" name="10-year average" stroke={AVERAGE.color} strokeDasharray={AVERAGE.dash} strokeWidth={AVERAGE.width} dot={false} connectNulls />
        )}
        {projectedMm != null && (
          <ReferenceLine
            yAxisId="cum"
            y={projectedMm}
            stroke="#b45309"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{
              value: `planning on ${Math.round(projectedMm)} mm`,
              position: 'insideTopLeft',
              fontSize: 10,
              fill: '#b45309',
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
    </div>
  )
}
