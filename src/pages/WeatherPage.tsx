import { Suspense, useMemo, useState } from 'react'
import { BookOpen, CloudRain, Droplets, Moon, Settings2, Sprout, SprayCan, Sunrise, Sunset, Wind } from 'lucide-react'
import {
  describeToday,
  forecastDate,
  fromToday,
  localDateKey,
  useRanchWeather,
  weatherFreshness,
  windDirLabel,
  wmo,
  type ForecastDay,
  type RanchWeather,
} from '@/lib/ranchWeather'
import { useWeatherSites, type WeatherSite } from '@/lib/weatherSites'
import { clockLabel, fertDay, sprayDay, type Rating, type SprayDay } from '@/lib/field-work-weather'
import { WeatherIcon, WX_TINT, wxKind } from '@/components/WeatherIcon'
import { cn } from '@/lib/utils'
import { PillTabs } from '@/components/PillTabs'
import { Modal } from '@/components/Modal'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { SprayLegend, sprayCellClass } from './weather/SprayLegend'
import { rhClass } from './weather/rh'

// recharts in its own chunk, only when the 24-hour tab is opened.
const Next24 = lazyWithRetry(() => import('./weather/Next24'))

/** ECMWF's global model on Open-Meteo — the one the farm goes by. */
const MODEL = 'ecmwf_ifs025'

/** Each site keeps one colour everywhere on the page, so it can be told apart at a glance. */
const SITE_COLOUR: Record<string, { bar: string; text: string; ring: string; chip: string }> = {
  Westfield: { bar: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-400', chip: 'bg-amber-500 text-white' },
  'Home Ranch': { bar: 'bg-emerald-600', text: 'text-emerald-700', ring: 'ring-emerald-500', chip: 'bg-emerald-600 text-white' },
  'East Ranch North': { bar: 'bg-sky-600', text: 'text-sky-700', ring: 'ring-sky-500', chip: 'bg-sky-600 text-white' },
}
/**
 * Colours beyond the three named sites, given out in the order the farm lists
 * its places, so a farm's own sites are told apart too.
 */
const PALETTE = [SITE_COLOUR.Westfield, SITE_COLOUR['Home Ranch'], SITE_COLOUR['East Ranch North'], { bar: 'bg-violet-600', text: 'text-violet-700', ring: 'ring-violet-500', chip: 'bg-violet-600 text-white' }, { bar: 'bg-rose-600', text: 'text-rose-700', ring: 'ring-rose-500', chip: 'bg-rose-600 text-white' }]
/** The same name always gets the same colour, without the page keeping a list. */
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
const colourOf = (name: string) => SITE_COLOUR[name] ?? PALETTE[Math.abs(hashOf(name)) % PALETTE.length]

/** A small bee, for the bee-safe window (lucide has none). */
function Bee({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <ellipse cx="9" cy="7" rx="4" ry="2.6" fill="#e0f2fe" stroke="#7dd3fc" transform="rotate(-25 9 7)" />
      <ellipse cx="15" cy="7" rx="4" ry="2.6" fill="#e0f2fe" stroke="#7dd3fc" transform="rotate(25 15 7)" />
      <ellipse cx="12" cy="14" rx="5.5" ry="6" fill="#fbbf24" stroke="#78350f" strokeWidth="1" />
      <path d="M7 12.5h10M6.8 15.5h10.4" stroke="#78350f" strokeWidth="2" />
      <circle cx="12" cy="8.2" r="2.2" fill="#78350f" />
    </svg>
  )
}

const deg = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}°`)

/** Temperature to colour: cold blues through greens to hot reds. */
function tempColour(t: number | null | undefined): string {
  if (t == null) return 'text-gray-400'
  if (t <= -10) return 'text-violet-700'
  if (t <= 0) return 'text-blue-700'
  if (t <= 10) return 'text-sky-600'
  if (t <= 20) return 'text-emerald-600'
  if (t <= 28) return 'text-amber-600'
  return 'text-red-600'
}
/** The same scale as a colour value, for the range bars. */
function tempHex(t: number): string {
  if (t <= -10) return '#6d28d9'
  if (t <= 0) return '#1d4ed8'
  if (t <= 10) return '#0284c7'
  if (t <= 20) return '#059669'
  if (t <= 28) return '#d97706'
  return '#dc2626'
}

const RATING: Record<Rating, { label: string; cls: string }> = {
  good: { label: 'Good', cls: 'bg-green-600 text-white' },
  fair: { label: 'Fair', cls: 'bg-amber-400 text-amber-950' },
  poor: { label: 'Poor', cls: 'bg-red-600 text-white' },
}

/** Is it night at this site right now? For the moon instead of the sun. */
function isNight(data: RanchWeather | undefined): boolean {
  const today = data?.daily.find((d) => d.date === localDateKey())
  const now = data?.current.time
  if (!today?.sunrise || !today.sunset || !now) return false
  return now < today.sunrise || now > today.sunset
}

function useSite(site: WeatherSite) {
  return useRanchWeather(site.lat, site.lng, MODEL, 8, true)
}

/** The three sites now, side by side, big. Tap one to see its week. */
function NowCard({ site, active, onPick }: { site: WeatherSite; active: boolean; onPick: () => void }) {
  const { data, isLoading } = useSite(site)
  const c = data?.current
  const kind = wxKind(c?.code, isNight(data))
  const age = weatherFreshness(c?.time)
  const col = colourOf(site.name)
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 text-left shadow-sm transition',
        WX_TINT[kind],
        active ? `ring-2 ${col.ring} border-transparent` : 'border-gray-200 hover:shadow-md',
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-1.5', col.bar)} />
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-sm font-bold uppercase tracking-wide', col.text)}>{site.name}</span>
        {age && <span className={cn('text-[11px]', age.stale ? 'rounded bg-amber-100 px-1.5 font-medium text-amber-800' : 'text-gray-500')}>{age.label}</span>}
      </div>
      {isLoading || !c ? (
        <p className="py-8 text-center text-sm text-gray-400">{isLoading ? 'Loading…' : 'Unavailable'}</p>
      ) : (
        <div className="mt-1 flex items-center gap-3">
          <WeatherIcon kind={kind} className="h-20 w-20 shrink-0" title={wmo(c.code).label} />
          <div className="min-w-0">
            <p className={cn('text-6xl font-black leading-none tabular-nums', tempColour(c.temp))}>{deg(c.temp)}</p>
            <p className="mt-1 text-sm font-medium text-gray-700">{wmo(c.code).label}</p>
            <p className="text-xs text-gray-500">feels {deg(c.apparent)}</p>
          </div>
          <div className="ml-auto space-y-1 text-right text-xs text-gray-700">
            <p className="flex items-center justify-end gap-1">
              <Wind className="h-3.5 w-3.5 text-gray-400" />
              {c.wind == null ? '—' : `${Math.round(c.wind)} ${windDirLabel(c.windDir)}`}
            </p>
            {c.gusts != null && <p className="text-gray-500">gust {Math.round(c.gusts)}</p>}
            <p className="mt-1 inline-flex items-center justify-end gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-sm font-bold text-sky-900">
              <Droplets className="h-4 w-4 text-sky-600" />
              <span className={rhClass(c.humidity)}>{c.humidity == null ? '—' : `${Math.round(c.humidity)}%`}</span>
              <span className="text-[10px] font-medium text-sky-700">humidity</span>
            </p>
          </div>
        </div>
      )}
    </button>
  )
}

/** 9 am → 7 am, an hour a cell: green is a bee-safe spray hour, amber is sprayable while bees fly, grey is out. */
function SprayStrip({ spray, labelled = true }: { spray: SprayDay; labelled?: boolean }) {
  if (!spray.hours.length) return null
  const inWindow = (t: string) => !!spray.window && t >= spray.window.start && t < spray.window.end
  return (
    <div className="mt-1.5">
      {labelled && <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">Spray hours, 9 am to 7 am (see Legend)</p>}
      <div className="flex h-5 overflow-hidden rounded-md ring-1 ring-gray-200">
        {spray.hours.map((h) => (
          <div
            key={h.time}
            title={`${clockLabel(h.time)} — ${h.ok ? (h.bees ? 'sprayable, bees flying' : 'sprayable, bees home') : h.reasons.join(', ')}`}
            className={cn(
              'flex-1 border-r border-white/60 last:border-r-0',
              sprayCellClass(h, inWindow(h.time)),
            )}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
        <span>9 am</span>
        <span>noon</span>
        <span>6 pm</span>
        <span>midnight</span>
        <span>7 am</span>
      </div>
    </div>
  )
}

/**
 * One forecast day. `first` is the top row: the strip's "9 am to 7 am" label
 * and the sunrise / sunset are said there and not repeated down the week —
 * the strip's hour marks and the cell tooltips still read the same on every
 * row, and the sun moves a minute or two a day.
 */
function DayRow({ day, following, spray, today, first, weekLo, weekHi, shade, rh, show }: { day: ForecastDay; following: ForecastDay[]; spray: SprayDay; today: boolean; first: boolean; weekLo: number; weekHi: number; shade: boolean; rh: { min: number; max: number } | null; show: Shown }) {
  const kind = wxKind(day.code)
  const fert = fertDay(day, following)
  const weekday = today ? 'Today' : new Date(`${day.date}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long' })
  const lo = day.lo ?? weekLo
  const hi = day.hi ?? weekHi
  const span = Math.max(1, weekHi - weekLo)
  const pos = (t: number) => ((t - weekLo) / span) * 100
  return (
    <li className={cn('rounded-2xl border p-3 sm:p-4', today ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200' : shade ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white')}>
      <div className="grid grid-cols-[5.5rem_4rem_1fr] items-center gap-3 sm:grid-cols-[8rem_4.5rem_1fr_9rem]">
        <div>
          <p className={cn('text-lg font-bold leading-tight', today ? 'text-brand-800' : 'text-gray-900')}>{weekday}</p>
          <p className="text-xs text-gray-500">{forecastDate(day.date)}</p>
        </div>
        <WeatherIcon kind={kind} className="h-16 w-16" title={wmo(day.code).label} />
        <div>
          <div className="flex items-baseline gap-2">
            <span className={cn('text-4xl font-black tabular-nums leading-none', tempColour(day.hi))}>{deg(day.hi)}</span>
            <span className={cn('text-xl font-semibold tabular-nums', tempColour(day.lo), 'opacity-70')}>{deg(day.lo)}</span>
            <span className="ml-1 hidden text-xs text-gray-500 sm:inline">{wmo(day.code).label}</span>
          </div>
          {/* The day's low-to-high on one scale for the whole week, so the
              warm days and the cold ones separate at a glance. */}
          <div className="relative mt-2 h-2.5 rounded-full bg-gray-200" title={`This day runs ${Math.round(lo)}° to ${Math.round(hi)}°; the grey track is the whole week, ${Math.round(weekLo)}° to ${Math.round(weekHi)}°`}>
            <div
              className="absolute top-0 h-2.5 rounded-full"
              style={{
                left: `${pos(lo)}%`,
                width: `${Math.max(3, pos(hi) - pos(lo))}%`,
                backgroundImage: `linear-gradient(90deg, ${tempHex(lo)}, ${tempHex(hi)})`,
              }}
            />
          </div>
        </div>
        <div className="col-span-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-700 sm:col-span-1 sm:block sm:space-y-0.5 sm:text-right">
          {rh && (
            <p className="font-bold text-sky-900">
              <Droplets className="mr-0.5 inline h-4 w-4 text-sky-600" />
              <span className={rhClass(rh.min)}>{rh.min}</span>–<span className={rhClass(rh.max)}>{rh.max}%</span>
              <span className="ml-1 text-[10px] font-medium text-sky-700">humidity</span>
            </p>
          )}
          <p className={cn('font-medium', (day.precip ?? 0) >= 1 ? 'text-sky-700' : 'text-gray-500')}>
            <CloudRain className="mr-0.5 inline h-3.5 w-3.5" />
            {(day.precip ?? 0) > 0 ? `${day.precip} mm` : 'dry'}
            {day.pop != null && ` · ${Math.round(day.pop)}%`}
          </p>
          <p>
            <Wind className="mr-0.5 inline h-3.5 w-3.5 text-gray-400" />
            {day.windMax == null ? '—' : `${Math.round(day.windMax)} km/h`}
            {day.gustMax != null && <span className="text-gray-500"> · gust {Math.round(day.gustMax)}</span>}
          </p>
          {first && day.sunrise && day.sunset && (
            <p className="text-gray-500">
              <Sunrise className="mr-0.5 inline h-3.5 w-3.5" />
              {clockLabel(day.sunrise)} <Sunset className="ml-1 mr-0.5 inline h-3.5 w-3.5" />
              {clockLabel(day.sunset)}
            </p>
          )}
        </div>
      </div>

      {(show.spray || show.bees || show.fert) && (
        <div className={cn('mt-3 grid gap-2', (show.spray || show.bees) && show.fert && 'sm:grid-cols-2')}>
          {(show.spray || show.bees) && (
            <div className="rounded-xl border border-gray-200 bg-white p-2.5">
              {show.spray && (
                <div className="flex items-center gap-2">
                  <SprayCan className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-semibold text-gray-800">Spraying</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', RATING[spray.rating].cls)}>{RATING[spray.rating].label}</span>
                </div>
              )}
              {show.bees &&
                (spray.window ? (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-900">
                    <Bee className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      Bee-safe: spray <b>after {clockLabel(spray.window.start, day.date)}</b> and <b>before {clockLabel(spray.window.end, day.date)}</b>
                      {spray.window.quality === 'fair' && <span className="text-amber-700"> (near the limits)</span>}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-700">
                    <Moon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    No bee-safe window{spray.limits.length ? ` — ${spray.limits.join(', ')}` : ''}.
                  </p>
                ))}
              {show.spray && (
                <>
                  <p className="text-xs text-gray-500">{spray.summary}</p>
                  <SprayStrip spray={spray} labelled={first} />
                </>
              )}
            </div>
          )}
          {show.fert && (
            <div className="rounded-xl border border-gray-200 bg-white p-2.5">
              <div className="flex items-center gap-2">
                <Sprout className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">Fertilizing</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', RATING[fert.rating].cls)}>{RATING[fert.rating].label}</span>
              </div>
              <p className="mt-1 text-sm text-gray-900">{fert.summary}</p>
              {fert.reasons.length > 0 && <p className="text-xs text-gray-500">{fert.reasons.join(' · ')}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The field-work calls — spraying, the bee-safe window, fertilizing — are for
 * the growing season: shown from 1 April to 30 September unless set by hand,
 * and each can be turned off on its own. Kept on this device.
 */
type WorkMode = 'auto' | 'on' | 'off'
type WeatherSettings = { mode: WorkMode; spray: boolean; bees: boolean; fert: boolean }
type Shown = { spray: boolean; bees: boolean; fert: boolean }
const DEFAULT_SETTINGS: WeatherSettings = { mode: 'auto', spray: true, bees: true, fert: true }
const inSeason = (d = new Date()) => d.getMonth() >= 3 && d.getMonth() <= 8
function useWeatherSettings(): [WeatherSettings, (s: WeatherSettings) => void, Shown] {
  const [settings, setSettings] = useState<WeatherSettings>(() => {
    try {
      const raw = localStorage.getItem('weather_settings')
      if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<WeatherSettings>) }
      const old = localStorage.getItem('weather_work_calls')
      return { ...DEFAULT_SETTINGS, mode: old === 'on' || old === 'off' ? old : 'auto' }
    } catch {
      return DEFAULT_SETTINGS
    }
  })
  const save = (v: WeatherSettings) => {
    setSettings(v)
    try {
      localStorage.setItem('weather_settings', JSON.stringify(v))
    } catch {
      /* private window */
    }
  }
  const on = settings.mode === 'on' || (settings.mode === 'auto' && inSeason())
  return [settings, save, { spray: on && settings.spray, bees: on && settings.bees, fert: on && settings.fert }]
}

function SettingsDialog({ settings, onChange, onClose }: { settings: WeatherSettings; onChange: (s: WeatherSettings) => void; onClose: () => void }) {
  const opt = (mode: WorkMode, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-800">
      <input type="radio" name="work-mode" checked={settings.mode === mode} onChange={() => onChange({ ...settings, mode })} className="mt-1" />
      <span>
        {label}
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  )
  const box = (key: 'spray' | 'bees' | 'fert', label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-800">
      <input type="checkbox" checked={settings[key]} onChange={(e) => onChange({ ...settings, [key]: e.target.checked })} className="mt-1 h-4 w-4 rounded border-gray-300" />
      <span>
        {label}
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  )
  return (
    <Modal title="Weather settings" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">When to show the field-work calls</p>
          {opt('auto', 'Growing season only', `1 April to 30 September — ${inSeason() ? 'showing now' : 'hidden now'}`)}
          {opt('on', 'All year', 'Always shown')}
          {opt('off', 'Never', 'Always hidden')}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Which calls</p>
          {box('spray', 'Spraying', 'The day’s spray rating and the hour-by-hour spray strip')}
          {box('bees', 'Bee-safe window', 'When to spray with the bees home')}
          {box('fert', 'Fertilizing', 'Whether it’s a good day to put down nitrogen')}
        </div>
        <p className="text-[11px] text-gray-400">Saved on this device. Applies to the Week and the Next 24 hours views.</p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white">
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}

function LegendDialog({ weekLo, weekHi, onClose }: { weekLo: number | null; weekHi: number | null; onClose: () => void }) {
  return (
    <Modal title="Legend" onClose={onClose} wide>
      <div className="space-y-4 text-sm text-gray-700">
        <div>
          <p className="font-semibold text-gray-900">Temperature bar (under each day&apos;s high and low)</p>
          <TempBarKey lo={weekLo} hi={weekHi} />
        </div>
        <div>
          <p className="font-semibold text-gray-900">Spray hours strip (9 am to 7 am the next morning)</p>
          <SprayLegend />
        </div>
        <div>
          <p className="font-semibold text-gray-900">Humidity</p>
          <p className="flex flex-wrap gap-x-4 text-xs">
            <span className={rhClass(20)}>under 30% — dry air (Delta T climbs, spray drift and evaporation)</span>
            <span className={rhClass(45)}>30–60%</span>
            <span className={rhClass(70)}>60–85%</span>
            <span className={rhClass(90)}>over 85% — very humid</span>
          </p>
        </div>
        <div className="space-y-1 border-t border-gray-100 pt-3 text-xs leading-snug text-gray-600">
          <p>
            <b>Spraying</b> is judged hour by hour: wind 3–20 km/h (calm air risks an inversion, more is drift), gusts under 30, 5–28 °C, Delta T 2–10, and no rain in the
            hour or the two after. <b>Bee-safe</b> means the bees are home: from sunset until an hour after sunrise, or any hour below 13 °C or raining. The window is the
            longest stretch that is both, between 9 am and 7 am the next morning. Check the label; some products carry their own limits.
          </p>
          <p>
            <b>Fertilizing</b> is for surface-applied nitrogen: about 10 mm of rain (or 0.5 in of pivot water) within two days works urea in; warm dry weather without it
            loses N to the air; a downpour over 25 mm, frozen ground or strong wind rule a day out.
          </p>
          <p>ECMWF via Open-Meteo, three sites 80 km apart.</p>
        </div>
      </div>
    </Modal>
  )
}

function SiteWeek({ site, show }: { site: WeatherSite; show: Shown }) {
  const { data, isLoading, isError } = useSite(site)
  const today = localDateKey()
  const days = useMemo(() => fromToday(data?.daily ?? []).slice(0, 7), [data])
  const sprays = useMemo(
    () => days.map((d) => sprayDay(d.date, data?.hourly ?? [], { rise: d.sunrise ?? null, set: d.sunset ?? null })),
    [days, data],
  )
  const col = colourOf(site.name)
  if (isLoading) return <p className="py-10 text-center text-sm text-gray-400">Loading {site.name}…</p>
  if (isError || !data) return <p className="py-10 text-center text-sm text-gray-400">{site.name} forecast unavailable right now.</p>
  // Each day's humidity from the hourly forecast (the daily one has none).
  const rhRange = (date: string) => {
    const v = (data.hourly ?? []).filter((h) => h.time.startsWith(date) && h.rh != null).map((h) => h.rh as number)
    return v.length ? { min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)) } : null
  }
  const weekLo = Math.min(...days.map((d) => d.lo ?? 99))
  const weekHi = Math.max(...days.map((d) => d.hi ?? -99))
  return (
    <section>
      <h2 className={cn('mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base font-bold', col.text)}>
        <span className={cn('h-3 w-3 self-center rounded-full', col.bar)} />
        {site.name} — next 7 days
        {/* The scale every day's temperature bar is drawn on, said once here
            rather than under each of the seven bars. */}
        {Number.isFinite(weekLo) && Number.isFinite(weekHi) && (
          <span className="text-xs font-normal tabular-nums text-gray-500">
            week low {Math.round(weekLo)}° · week high {Math.round(weekHi)}°
          </span>
        )}
      </h2>
      <ul className="space-y-2.5">
        {days.map((d, i) => (
          <DayRow
            key={d.date}
            day={d}
            following={days.slice(i + 1)}
            spray={sprays[i]}
            today={d.date === today}
            first={i === 0}
            weekLo={weekLo}
            weekHi={weekHi}
            shade={i % 2 === 1}
            rh={rhRange(d.date)}
            show={show}
          />
        ))}
      </ul>
    </section>
  )
}

function SiteDay({ site, show }: { site: WeatherSite; show: Shown }) {
  const { data, isLoading, isError } = useSite(site)
  const col = colourOf(site.name)
  if (isLoading) return <p className="py-10 text-center text-sm text-gray-400">Loading {site.name}…</p>
  if (isError || !data) return <p className="py-10 text-center text-sm text-gray-400">{site.name} forecast unavailable right now.</p>
  return (
    <section>
      <h2 className={cn('mb-2 flex items-center gap-2 text-base font-bold', col.text)}>
        <span className={cn('h-3 w-3 rounded-full', col.bar)} />
        {site.name} — next 24 hours
      </h2>
      <Suspense fallback={<p className="py-10 text-center text-sm text-gray-400">Loading…</p>}>
        <Next24 data={data} showSpray={show.spray} />
      </Suspense>
    </section>
  )
}

/** What the coloured temperature bar under each day's high and low means. */
function TempBarKey({ lo, hi }: { lo: number | null; hi: number | null }) {
  const stops = [-10, 0, 10, 20, 28]
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
      <span>
        The grey track is the whole week{lo != null && hi != null ? `, ${Math.round(lo)}° to ${Math.round(hi)}°` : ''}; the coloured part is where that day&apos;s low-to-high sits in it, coloured by temperature —
      </span>
      <span className="inline-flex items-center gap-1">
        {stops.map((t) => (
          <span key={t} className="inline-flex items-center gap-0.5">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: tempHex(t) }} />
            {t === -10 ? '≤ −10°' : t === 28 ? '28°+' : `${t}°`}
          </span>
        ))}
      </span>
    </div>
  )
}

/**
 * Weather: the three sites now, then one site's week with a spray call, a
 * bee-safe spray window and a fertilizer call for every day.
 */
export function WeatherPage() {
  const { sites, main } = useWeatherSites()
  const [siteName, setSiteName] = useState(() => {
    try {
      return localStorage.getItem('weather_site') ?? main.name
    } catch {
      return main.name
    }
  })
  const [view, setView] = useState<'day' | 'week'>(() => {
    try {
      return localStorage.getItem('weather_view') === 'day' ? 'day' : 'week'
    } catch {
      return 'week'
    }
  })
  const pickView = (v: 'day' | 'week') => {
    setView(v)
    try {
      localStorage.setItem('weather_view', v)
    } catch {
      /* private window */
    }
  }
  const [settings, setSettings, shown] = useWeatherSettings()
  const [dialog, setDialog] = useState<'settings' | 'legend' | null>(null)
  const site = sites.find((s) => s.name === siteName) ?? main
  // The week's temperature range, for the legend's temperature bar (the same cached forecast).
  const { data: siteData } = useSite(site)
  const week = fromToday(siteData?.daily ?? []).slice(0, 7)
  const range: [number, number] | null = week.length ? [Math.min(...week.map((d) => d.lo ?? 99)), Math.max(...week.map((d) => d.hi ?? -99))] : null
  const pick = (name: string) => {
    setSiteName(name)
    try {
      localStorage.setItem('weather_site', name)
    } catch {
      /* private window */
    }
  }
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Weather</h1>
        <span className="text-sm font-medium text-gray-600">{describeToday()}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {sites.map((s) => (
          <NowCard key={s.name} site={s} active={s.name === site.name} onPick={() => pick(s.name)} />
        ))}
      </div>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
        <PillTabs
          tabs={[
            { key: 'day', label: 'Next 24 hours' },
            { key: 'week', label: 'Week' },
          ]}
          value={view}
          onChange={pickView}
          className="border-0 pb-0"
        />
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setDialog('legend')} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
            <BookOpen className="h-4 w-4" /> Legend
          </button>
          <button type="button" onClick={() => setDialog('settings')} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
            <Settings2 className="h-4 w-4" /> Settings
          </button>
        </span>
      </div>
      {view === 'day' ? <SiteDay key={site.name} site={site} show={shown} /> : <SiteWeek key={site.name} site={site} show={shown} />}
      {dialog === 'settings' && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
      {dialog === 'legend' && <LegendDialog weekLo={range?.[0] ?? null} weekHi={range?.[1] ?? null} onClose={() => setDialog(null)} />}

    </div>
  )
}
