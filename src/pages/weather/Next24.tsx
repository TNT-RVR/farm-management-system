import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CloudRain, Droplets, Thermometer, Wind } from 'lucide-react'
import { windDirLabel, wmo, type ForecastHour, type RanchWeather } from '@/lib/ranchWeather'
import { clockLabel, judgeHour } from '@/lib/field-work-weather'
import { WeatherIcon, wxKind } from '@/components/WeatherIcon'
import { cn } from '@/lib/utils'
import { SprayLegend, sprayCellClass } from './SprayLegend'
import { rhClass } from './rh'

const rhBar = (rh: number) => (rh < 30 ? 'bg-amber-400' : rh < 60 ? 'bg-sky-400' : rh < 85 ? 'bg-sky-600' : 'bg-blue-800')
const hourLabel = (t: string) => {
  const h = Number(t.slice(11, 13))
  return h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? 'noon' : `${h - 12} pm`
}
const r = (v: number | null | undefined) => (v == null ? '—' : Math.round(v))

/**
 * The next 24 hours at one site, hour by hour: temperature, humidity (big — it
 * decides Delta T for spraying and drying), wind, rain, and whether the hour is
 * fit to spray. Charts underneath for the shape of the day.
 */
export default function Next24({ data, showSpray = true }: { data: RanchWeather; showSpray?: boolean }) {
  // From the current hour on; the feed also carries yesterday's hours.
  const now = (data.current.time ?? data.hourly?.[0]?.time ?? '').slice(0, 13)
  const all = data.hourly ?? []
  const start = all.findIndex((h) => h.time.slice(0, 13) >= now)
  const hours = start < 0 ? [] : all.slice(start, start + 24).map((h, i) => ({ h, rest: all.slice(start + i + 1, start + i + 3) }))
  const sunFor = (t: string) => {
    const d = data.daily.find((x) => x.date === t.slice(0, 10))
    return { rise: d?.sunrise ?? null, set: d?.sunset ?? null }
  }
  const isNightHour = (t: string) => {
    const s = sunFor(t)
    return !!s.rise && !!s.set && (t < s.rise || t > s.set)
  }
  const rows = hours.map(({ h, rest }) => ({ h, spray: judgeHour(h, rest, sunFor(h.time)) }))
  if (!rows.length) return <p className="py-10 text-center text-sm text-gray-400">No hourly forecast right now.</p>

  const vals = (f: (h: ForecastHour) => number | null) => rows.map((x) => f(x.h)).filter((v): v is number => v != null)
  const temps = vals((h) => h.temp)
  const rhs = vals((h) => h.rh)
  const winds = vals((h) => h.wind)
  const gusts = vals((h) => h.gust)
  const rain = vals((h) => h.precip).reduce((s, v) => s + v, 0)
  const chart = rows.map(({ h }) => ({ t: h.time, label: hourLabel(h.time), temp: h.temp, dew: h.dew, rh: h.rh, wind: h.wind, gust: h.gust, pop: h.pop, precip: h.precip }))
  const tick = (t: string) => hourLabel(t)
  const tip = (t: unknown) => clockLabel(String(t))

  return (
    <div className="space-y-4">
      {/* The next 24 hours in four numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <Thermometer className="h-3.5 w-3.5" /> Temperature
          </p>
          <p className="text-2xl font-black tabular-nums text-gray-900">
            {r(Math.max(...temps))}° <span className="text-base font-semibold text-gray-500">/ {r(Math.min(...temps))}°</span>
          </p>
        </div>
        <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3">
          <p className="flex items-center gap-1 text-xs font-semibold text-sky-800">
            <Droplets className="h-3.5 w-3.5" /> Humidity
          </p>
          <p className={cn('text-2xl font-black tabular-nums', rhClass(rows[0].h.rh))}>
            {r(rows[0].h.rh)}% <span className="text-base font-semibold text-sky-700">now</span>
          </p>
          <p className="text-xs text-sky-800">
            {r(Math.min(...rhs))}–{r(Math.max(...rhs))}% over the day
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <Wind className="h-3.5 w-3.5" /> Wind
          </p>
          <p className="text-2xl font-black tabular-nums text-gray-900">
            {r(Math.max(...winds))} <span className="text-base font-semibold text-gray-500">km/h max</span>
          </p>
          {gusts.length > 0 && <p className="text-xs text-gray-500">gusts to {r(Math.max(...gusts))}</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="flex items-center gap-1 text-xs text-gray-500">
            <CloudRain className="h-3.5 w-3.5" /> Rain
          </p>
          <p className="text-2xl font-black tabular-nums text-gray-900">
            {rain >= 0.1 ? `${rain.toFixed(1)} mm` : 'dry'}
          </p>
          <p className="text-xs text-gray-500">chance up to {r(Math.max(0, ...vals((h) => h.pop)))}%</p>
        </div>
      </div>

      {/* Hour by hour */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <div className="flex min-w-max">
          {rows.map(({ h, spray }, i) => (
            <div key={h.time} className={cn('w-[4.6rem] shrink-0 border-r border-gray-100 px-1.5 py-2 text-center last:border-r-0', i % 2 === 1 && 'bg-gray-50/60')}>
              <p className="text-[11px] font-semibold text-gray-700">{i === 0 ? 'Now' : hourLabel(h.time)}</p>
              <WeatherIcon kind={wxKind(h.code, isNightHour(h.time))} className="mx-auto h-8 w-8" title={wmo(h.code).label} />
              <p className="text-lg font-black tabular-nums text-gray-900">{r(h.temp)}°</p>
              {/* Humidity, big, with a fill bar */}
              <p className={cn('mt-0.5 text-base font-extrabold tabular-nums', rhClass(h.rh))}>{r(h.rh)}%</p>
              <div className="mx-auto mt-0.5 h-1.5 w-10 overflow-hidden rounded-full bg-gray-200">
                <div className={cn('h-full', rhBar(h.rh ?? 0))} style={{ width: `${Math.min(100, h.rh ?? 0)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-gray-600">
                {r(h.wind)} {windDirLabel(h.windDir)}
              </p>
              <p className={cn('text-[11px]', (h.pop ?? 0) >= 40 ? 'font-semibold text-sky-700' : 'text-gray-400')}>{r(h.pop)}% rain</p>
              {showSpray && <div className={cn('mx-auto mt-1 h-2 w-full rounded-sm', sprayCellClass(spray, spray.ok && !spray.bees))} title={spray.ok ? (spray.bees ? 'sprayable, bees flying' : 'sprayable, bees home') : spray.reasons.join(', ')} />}
            </div>
          ))}
        </div>
      </div>
      {showSpray && <SprayLegend compact />}

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Humidity" note="Under 30% the air is dry (Delta T climbs, spray drift and evaporation); over 85% very humid.">
          <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <ReferenceArea y1={0} y2={30} fill="#fde68a" fillOpacity={0.35} />
            <ReferenceArea y1={85} y2={100} fill="#bfdbfe" fillOpacity={0.45} />
            <XAxis dataKey="t" tickFormatter={tick} interval={3} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={tip} formatter={(v) => [`${Math.round(Number(v))}%`, 'Humidity']} />
            <Area dataKey="rh" type="monotone" stroke="#0369a1" strokeWidth={2.5} fill="#38bdf8" fillOpacity={0.25} />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Temperature and dew point">
          <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="t" tickFormatter={tick} interval={3} tick={{ fontSize: 11 }} />
            <YAxis unit="°" tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={tip} formatter={(v, n) => [`${Math.round(Number(v))}°`, n === 'temp' ? 'Temperature' : 'Dew point']} />
            <Line dataKey="temp" type="monotone" stroke="#dc2626" strokeWidth={2} dot={false} />
            <Line dataKey="dew" type="monotone" stroke="#0891b2" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Wind and gusts" note="The spray limits: 3–20 km/h, gusts under 30.">
          <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <ReferenceArea y1={3} y2={20} fill="#bbf7d0" fillOpacity={0.35} />
            <XAxis dataKey="t" tickFormatter={tick} interval={3} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={tip} formatter={(v, n) => [`${Math.round(Number(v))} km/h`, n === 'wind' ? 'Wind' : 'Gust']} />
            <Line dataKey="wind" type="monotone" stroke="#334155" strokeWidth={2} dot={false} />
            <Line dataKey="gust" type="monotone" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Rain">
          <ComposedChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="t" tickFormatter={tick} interval={3} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="p" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="mm" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={tip} formatter={(v, n) => (n === 'pop' ? [`${Math.round(Number(v))}%`, 'Chance'] : [`${Number(v).toFixed(1)} mm`, 'Amount'])} />
            <Bar yAxisId="mm" dataKey="precip" fill="#0284c7" />
            <Line yAxisId="p" dataKey="pop" type="monotone" stroke="#7dd3fc" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartCard>
      </div>
    </div>
  )
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      {note && <p className="text-[11px] text-gray-500">{note}</p>}
      <div className="mt-1 h-48">
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  )
}
