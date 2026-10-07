import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import type { ReactElement } from 'react'
import type { SoilProfileRow, WaterBalanceRow } from '@/lib/irrigation'
import type { BalanceSeries } from '@/lib/balance-series'
import { conv, depthValue, type UnitSystem } from '@/lib/units'
import type { ZoomDomain } from '@/lib/useWheelZoom'
import { barFor, fmtDay, fmtT, moistureChartRows, moistureSummary, simpleChartRows, tOf, type GraphType } from '@/lib/aimm-chart'

/**
 * The AIMM graphs, drawn by the Graph page on screen and by the AIMM field
 * report off-screen for its PDF. `still` is the off-screen case: a fixed
 * size (there is no page to stretch to) and no animation (a snapshot taken
 * mid-animation catches the bars half grown).
 */

export const CHART_HEIGHT = 420
export type Still = { width: number }

/** Stretched to its box on screen; a fixed size off-screen, where there is no box to measure. */
function Frame({ still, children }: { still?: Still; children: ReactElement }) {
  return still ? children : <ResponsiveContainer width="100%" height={CHART_HEIGHT}>{children}</ResponsiveContainer>
}

export function MoistureGraph({
  series,
  profile,
  u,
  domain,
  range,
  readings,
  still,
}: {
  series: BalanceSeries[]
  profile: SoilProfileRow | null
  u: UnitSystem
  domain: ZoomDomain
  range: [number, number]
  /** Measured soil moisture by date (mm), drawn as dots where the line was reset. */
  readings: Map<string, number>
  still?: Still
}) {
  const multi = series.length > 1
  const rows = series[0]?.rows ?? []
  const s = moistureSummary(rows, profile)
  const data = moistureChartRows(series, readings, u)
  const todayDate = rows.filter((r) => !r.is_forecast).at(-1)?.date ?? null

  const unit = conv.depthUnit(u)
  const fc = s.fc == null ? null : depthValue(s.fc, u)
  const thr = s.thr == null ? null : depthValue(s.thr, u)
  const bar = barFor(domain, range[0], range[1])
  const animate = still ? false : undefined

  return (
    <div>
      <Frame still={still}>
        <ComposedChart data={data} width={still?.width} height={still ? CHART_HEIGHT : undefined} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain ?? ['dataMin', 'dataMax']}
            allowDataOverflow
            tickFormatter={fmtT}
            tick={{ fontSize: 11 }}
            minTickGap={28}
          />
          <YAxis
            yAxisId="mm"
            tick={{ fontSize: 11 }}
            label={{ value: `Available Soil Moisture (${unit})`, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
          />
          {!still && (
            <Tooltip
              formatter={(value, name) => {
                const v = Number(value)
                return [Number.isFinite(v) ? `${v.toFixed(u === 'metric' ? 1 : 2)} ${unit}` : '—', name as string]
              }}
              labelFormatter={(l) => fmtT(Number(l))}
            />
          )}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {fc != null && (
            <ReferenceLine yAxisId="mm" y={fc} stroke="#94a3b8" strokeDasharray="5 4"
              label={{ value: `Field Capacity ${fc.toFixed(u === 'metric' ? 0 : 1)} ${unit}`, fontSize: 10, fill: '#64748b', position: 'insideTopRight' }} />
          )}
          {thr != null && (
            <ReferenceLine yAxisId="mm" y={thr} stroke="#2563eb" strokeDasharray="5 4"
              label={{ value: `Irrigation Threshold ${thr.toFixed(u === 'metric' ? 0 : 1)} ${unit}`, fontSize: 10, fill: '#2563eb', position: 'insideBottomRight' }} />
          )}
          {todayDate && (
            <ReferenceLine yAxisId="mm" x={tOf(todayDate)} stroke="#cbd5e1"
              label={{ value: 'today', fontSize: 10, fill: '#94a3b8', position: 'insideTopLeft' }} />
          )}
          <Bar yAxisId="mm" dataKey="rain" name={`Rainfall (${unit})`} fill="#3b82f6" barSize={bar} isAnimationActive={animate} />
          <Bar yAxisId="mm" dataKey="rainF" name={`Forecast / modelled rain (${unit})`} fill="#93c5fd" barSize={bar} isAnimationActive={animate} />
          {!multi && (
            <Bar yAxisId="mm" dataKey="irrig" name={`Effective Irrigation (${unit})`} fill="#22c55e" barSize={bar} isAnimationActive={animate} />
          )}
          {readings.size > 0 && (
            <Scatter yAxisId="mm" dataKey="meas" name="Measured soil moisture" fill="#047857" shape="diamond" isAnimationActive={false} />
          )}
          {series.map((sr) => (
            <Line
              key={`a_${sr.key}`}
              yAxisId="mm"
              type="monotone"
              dataKey={`a_${sr.key}`}
              name={multi ? sr.label : 'Available Soil Moisture'}
              stroke={sr.color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {series.map((sr) => (
            <Line
              key={`f_${sr.key}`}
              yAxisId="mm"
              type="monotone"
              dataKey={`f_${sr.key}`}
              name={multi ? `${sr.label} (forecast)` : 'Forecast'}
              stroke={sr.color}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </Frame>
      {!still && (
        <div className="mt-1 flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>
            {s.crossDate ? (
              <>Predicted to reach the irrigation threshold on <b>{fmtDay(s.crossDate)}</b></>
            ) : (
              'No irrigation required in the forecast window'
            )}
          </span>
          <span>
            Predicted water use (forecast) = <b>{conv.depth(s.predWaterUse, u)} {unit}</b>
            {s.predMoisture != null && s.lastDate && (
              <> · Predicted soil moisture on {fmtDay(s.lastDate)} = <b>{conv.depth(s.predMoisture, u)} {unit}</b></>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

export function SimpleGraph({ rows, type, u, domain, range, still }: { rows: WaterBalanceRow[]; type: GraphType; u: UnitSystem; domain: ZoomDomain; range: [number, number]; still?: Still }) {
  const unit = conv.depthUnit(u)
  const data = simpleChartRows(rows, u)
  const bar = barFor(domain, range[0], range[1])
  const animate = still ? false : undefined
  return (
    <Frame still={still}>
      <ComposedChart data={data} width={still?.width} height={still ? CHART_HEIGHT : undefined} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={domain ?? ['dataMin', 'dataMax']}
          allowDataOverflow
          tickFormatter={fmtT}
          tick={{ fontSize: 11 }}
          minTickGap={28}
        />
        <YAxis tick={{ fontSize: 11 }} label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
        {!still && <Tooltip formatter={(value, name) => [`${Number(value).toFixed(2)} ${unit}`, name as string]} labelFormatter={(l) => fmtT(Number(l))} />}
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {type === 'dailyet' && <Line type="monotone" dataKey="et" name={`Daily ET (${unit})`} stroke="#b45309" strokeWidth={2} dot={false} isAnimationActive={false} />}
        {type === 'accumet' && <Line type="monotone" dataKey="accet" name={`Accumulated ET (${unit})`} stroke="#b45309" strokeWidth={2} dot={false} isAnimationActive={false} />}
        {type === 'precip' && <Bar dataKey="rain" name={`Rainfall (${unit})`} fill="#3b82f6" barSize={bar} isAnimationActive={animate} />}
        {type === 'precip' && <Bar dataKey="rainF" name={`Forecast / modelled rain (${unit})`} fill="#93c5fd" barSize={bar} isAnimationActive={animate} />}
        {type === 'precip' && <Bar dataKey="irrig" name={`Effective Irrigation (${unit})`} fill="#22c55e" barSize={bar} isAnimationActive={animate} />}
      </ComposedChart>
    </Frame>
  )
}

/** The graph a GraphType names, as the Graph page shows it. */
export function AimmChart({ graph, series, seasonRows, profile, u, domain, range, readings, still }: {
  graph: GraphType
  series: BalanceSeries[]
  seasonRows: WaterBalanceRow[]
  profile: SoilProfileRow | null
  u: UnitSystem
  domain: ZoomDomain
  range: [number, number]
  readings: Map<string, number>
  still?: Still
}) {
  return graph === 'moist100' ? (
    <MoistureGraph series={series} profile={profile} u={u} domain={domain} range={range} readings={readings} still={still} />
  ) : (
    <SimpleGraph rows={series[0]?.rows ?? seasonRows} type={graph} u={u} domain={domain} range={range} still={still} />
  )
}
