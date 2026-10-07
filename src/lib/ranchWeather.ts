import { useQuery } from '@tanstack/react-query'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Cloudy,
  Sun,
  SunDim,
} from 'lucide-react'
import type { ComponentType } from 'react'

export type CurrentWeather = {
  time: string | null
  temp: number | null
  apparent: number | null
  humidity: number | null
  precip: number | null
  code: number | null
  wind: number | null
  gusts: number | null
  windDir: number | null
}
export type ForecastDay = {
  date: string
  code: number | null
  hi: number | null
  lo: number | null
  precip: number | null
  pop: number | null
  windMax: number | null
  gustMax?: number | null
  /** Local ISO time, e.g. '2026-09-28T07:31'. */
  sunrise?: string | null
  sunset?: string | null
}
/** One forecast hour (local time, the ranch's). */
export type ForecastHour = {
  time: string
  temp: number | null
  rh: number | null
  dew: number | null
  wind: number | null
  gust: number | null
  windDir: number | null
  precip: number | null
  pop: number | null
  code: number | null
  cloud: number | null
}
export type RanchWeather = { current: CurrentWeather; daily: ForecastDay[]; hourly?: ForecastHour[] }

/** Current conditions + 7-day forecast for a ranch's coordinates (refreshes every 15 min). */
export function useRanchWeather(
  lat: number | null | undefined,
  lon: number | null | undefined,
  model?: string,
  forecastDays = 7,
  hourly = false,
) {
  return useQuery({
    queryKey: ['ranch_weather', lat, lon, model ?? 'best', forecastDays, hourly],
    enabled: lat != null && lon != null,
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RanchWeather> => {
      const res = await fetch(
        `/api/ranch-weather?lat=${lat}&lon=${lon}${model ? `&model=${model}` : ''}${forecastDays !== 7 ? `&days=${forecastDays}` : ''}${hourly ? '&hourly=1' : ''}`,
      )
      if (!res.ok) throw new Error('Weather unavailable')
      return res.json()
    },
  })
}

/** Past this, a reading is old enough that saying so matters more than the time. */
export const WEATHER_STALE_AFTER_MIN = 90

/**
 * How to show an observation time.
 *
 * A bare clock time is how stale weather hides: a reading taken at 2:45 on
 * Tuesday renders as "2:45 p.m." on Thursday and looks exactly like a reading
 * from twenty minutes ago. Anything past an hour and a half says how old it is
 * instead, and anything from another day leads with the day.
 */
export function weatherFreshness(
  iso: string | null | undefined,
  now: Date = new Date(),
): { label: string; stale: boolean } | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  const mins = Math.round((now.getTime() - t.getTime()) / 60_000)
  const clock = t.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })

  // A forecast run can be timestamped slightly ahead of the clock; that is not
  // staleness and must not be reported as "-20 min ago".
  if (mins < WEATHER_STALE_AFTER_MIN) return { label: clock, stale: false }

  const sameDay = t.toDateString() === now.toDateString()
  if (sameDay) {
    const h = Math.round(mins / 60)
    return { label: `${clock} · ${h} h ago`, stale: true }
  }
  const days = Math.max(1, Math.round(mins / (60 * 24)))
  return {
    label: `${t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })} ${clock} · ${days}d old`,
    stale: true,
  }
}

/** WMO weather-code → icon + short label (Open-Meteo `weather_code`). */
export function wmo(code: number | null | undefined): {
  icon: ComponentType<{ className?: string }>
  label: string
} {
  switch (code) {
    case 0:
      return { icon: Sun, label: 'Clear' }
    case 1:
      return { icon: SunDim, label: 'Mainly clear' }
    case 2:
      return { icon: Cloud, label: 'Partly cloudy' }
    case 3:
      return { icon: Cloudy, label: 'Overcast' }
    case 45:
    case 48:
      return { icon: CloudFog, label: 'Fog' }
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return { icon: CloudDrizzle, label: 'Drizzle' }
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
      return { icon: CloudRain, label: 'Rain' }
    case 71:
    case 73:
    case 75:
    case 77:
      return { icon: CloudSnow, label: 'Snow' }
    case 80:
    case 81:
    case 82:
      return { icon: CloudRain, label: 'Showers' }
    case 85:
    case 86:
      return { icon: CloudSnow, label: 'Snow showers' }
    case 95:
    case 96:
    case 99:
      return { icon: CloudLightning, label: 'Thunderstorm' }
    default:
      return { icon: Cloud, label: '—' }
  }
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const windDirLabel = (deg: number | null) =>
  deg == null ? '' : DIRS[Math.round(deg / 45) % 8]

/**
 * Today, as the 'YYYY-MM-DD' Open-Meteo uses.
 *
 * Built from the LOCAL date parts on purpose. `toISOString().slice(0, 10)` is
 * the obvious version and it is wrong here: it gives the UTC date, so from 6pm
 * Mountain onwards it already reads as tomorrow and the forecast would label
 * tomorrow "Today" every evening. Open-Meteo is asked for timezone=auto, so its
 * dates are the ranch's local days and must be compared against a local day.
 */
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The forecast from today onwards.
 *
 * The request asks for three past days as well as seven forward, because the
 * Monday meeting's week grid needs them. That makes the first entry three days
 * OLD, and anything showing the array from the start — and calling its first
 * box "Today" — is three days out all week. That is the bug this exists to
 * stop: on a Saturday the card called Wednesday today.
 *
 * If nothing in the list is today or later, the whole list comes back rather
 * than nothing, so a stale payload still renders. Its labels are dates, so it
 * will say what it actually is instead of claiming to be today.
 */
export function fromToday(days: ForecastDay[], today: string = localDateKey()): ForecastDay[] {
  const ahead = days.filter((d) => d.date >= today)
  return ahead.length ? ahead : days
}

/**
 * What to write above a forecast column. Decided by the DATE, never by the
 * position in the array.
 */
export function forecastLabel(date: string, today: string = localDateKey()): string {
  if (date === today) return 'Today'
  return new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short' })
}

/**
 * "Sep 15" — the calendar date under a forecast column.
 *
 * A weekday alone cannot be checked. "Wed" looks right on any day of the week,
 * which is exactly how the card sat three days out for a week without anybody
 * being able to point at what was wrong; a date next to it is either today's or
 * it is not. Noon is used to build the Date so a timezone shift either way
 * cannot land it on the previous day.
 */
export function forecastDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
  })
}

/** "Saturday, 12 September 2026" — so the day on screen can be checked at a glance. */
export function describeToday(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
