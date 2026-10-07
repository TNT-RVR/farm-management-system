import { useMemo } from 'react'
import { farmMapCenter, useFarmSetup } from './farm-setup'

/**
 * The three places the farm wants a forecast for.
 *
 * The dashboard used to show one location under two models, to compare them.
 * That question is settled — ECMWF is the one the farm trusts — so the second
 * axis is spent on ground instead: three sites, one model, side by side. Eighty
 * kilometres separates Westfield from East Ranch and a shower routinely lands
 * on one and not the other.
 */
export type WeatherSite = {
  name: string
  lat: number
  lng: number
  /** Where the coordinate came from, so a wrong pin can be recognised. */
  note: string
  /** The place used where only one fits; the first in the list if none is marked. */
  main?: boolean
}

/**
 * The farm's forecast places: the list saved on Farm setup, or the built-in
 * one below until a list is saved. `main` is the place to use where only one
 * fits (the meeting's week, the weather page's first view) — the first of a
 * saved list, or Home Ranch in the built-in one, as it always was.
 */
export function useWeatherSites(): { sites: WeatherSite[]; main: WeatherSite } {
  const { data } = useFarmSetup()
  const stored = data?.forecast_sites
  const lat = data?.map_center_lat ?? null
  const lng = data?.map_center_lng ?? null
  const name = data?.farm_name ?? ''
  return useMemo(() => {
    const saved = Array.isArray(stored) ? (stored as WeatherSite[]).filter((s) => s?.name && Number.isFinite(s.lat) && Number.isFinite(s.lng)) : []
    if (saved.length) return { sites: saved, main: saved.find((s) => s.main) ?? saved[0] }
    // Nothing saved: the farm's own location from setup, which is where a new
    // farm wants its forecast. The built-in list is only for an install that
    // has not been set up at all.
    if (lat != null && lng != null) {
      const home = { name: name || 'The farm', lat, lng, note: 'Farm location' }
      return { sites: [home], main: home }
    }
    // Setup has loaded and there is no row at all: a new install. Its map centre,
    // not the original farm's places, until it saves a location.
    if (data === null) {
      const [cLng, cLat] = farmMapCenter()
      const here = { name: 'The farm', lat: cLat, lng: cLng, note: 'Map centre until Farm setup is saved' }
      return { sites: [here], main: here }
    }
    return { sites: WEATHER_SITES, main: WEATHER_SITES.find((s) => s.name === 'Home Ranch') ?? WEATHER_SITES[0] }
  }, [data, stored, lat, lng, name])
}

export const WEATHER_SITES: WeatherSite[] = [
  { name: 'Westfield', lat: 49.8, lng: -109.0018, note: 'Westfield, AB' },
  { name: 'Home Ranch', lat: 52.4106, lng: -108.7024, note: 'Home Ranch ranch' },
  { name: 'East Ranch North', lat: 49.981, lng: -108.3997, note: 'North of East Ranch Main' },
]
