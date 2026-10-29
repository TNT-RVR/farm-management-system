/**
 * The drivers' log (Sam, 20 Oct 2026): how far each driver drove, how long
 * they drove and how long they were on duty, day by day and trip by trip,
 * worked out from the loads weighed in and nothing else. Nobody types
 * anything for it.
 *
 * Each load is a round trip: loaded from the field to where it went (our
 * bins, or straight to a plant), and back empty. The distance and the time
 * are the road route the app already keeps (road-routes.ts: the bins to each
 * field, each field to each plant), the time slowed by the farm's own
 * loaded-truck factor; on duty adds the farm's minutes to fill and to dump
 * (Trucking settings, trucking.ts). A bin total over several loads counts
 * each of them.
 *
 * A load only says its day. The clock time is the moment it was first saved,
 * used only when that was the same day on the farm's clock (entered at the
 * scale, not typed in later). A day with clock times is on duty from before
 * its first load (driving out, filling, driving in) to after its last
 * (dumping), or the trips added up if that is longer.
 *
 * An estimate from the scale records, not a certified hours-of-service
 * logbook; the report says so.
 */
import type { TruckSettings } from '@/lib/trucking'

export type LogLoad = {
  id: string
  loaded_on: string
  created_at: string
  /** When it was weighed in, when known: the clock time used before the time it was saved. */
  full_at?: string | null
  driver_id: string | null
  driver: string | null
  field_id: string | null
  bin_id: string | null
  delivery_site_id: string | null
  entry_kind: 'weighed' | 'net' | 'bin_total'
  load_count: number | null
  net_kg: number | string | null
  estimated: boolean
  truck: string | null
  trailer: string | null
}

/** One way, on the road. */
export type Route = { km: number; min: number }

export type Driver = { key: string; name: string }

/**
 * Who drove a load: the person on file, else the name typed, else nobody. A
 * typed name that is a person's name (older loads typed "John Berg") is that
 * person, so they are not listed twice.
 */
export function driverOf(
  l: Pick<LogLoad, 'driver_id' | 'driver'>,
  personName: (id: string) => string | null,
  personByName: (name: string) => string | null = () => null,
): Driver {
  if (l.driver_id) return { key: `id:${l.driver_id}`, name: personName(l.driver_id) ?? l.driver ?? 'Unknown driver' }
  const typed = l.driver?.trim()
  const known = typed ? personByName(typed.toLowerCase().replace(/\s+/g, ' ')) : null
  if (known) return { key: `id:${known}`, name: personName(known) ?? typed! }
  if (typed) return { key: `name:${typed.toLowerCase()}`, name: typed }
  return { key: 'none', name: 'No driver recorded' }
}

/** "07:42" on the farm's clock, when the load was saved on the day it was hauled; else null. */
export function sameDayTime(createdAt: string, loadedOn: string, tz: string): string | null {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(
    new Date(createdAt),
  )
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  if (`${get('year')}-${get('month')}-${get('day')}` !== loadedOn) return null
  return `${get('hour')}:${get('minute')}`
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
export const clock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export type Trip = {
  load: LogLoad
  driver: Driver
  day: string
  /** When it was saved, on the day: about when it crossed the scale. */
  time: string | null
  toPlant: boolean
  /** Truckloads: a bin total over several loads is several. */
  trips: number
  /** Round trips, all of them. Null without a route. */
  km: number | null
  driveMin: number | null
  /** Driving plus filling and dumping. */
  dutyMin: number
  /** Before the scale on this trip: out empty, filling, in loaded. */
  leadMin: number
  unloadMin: number
}

export function tripOf(l: LogLoad, driver: Driver, route: Route | null, t: TruckSettings, tz: string): Trip {
  const trips = l.entry_kind === 'bin_total' ? Math.max(1, l.load_count ?? 1) : 1
  const km = route ? 2 * route.km * trips : null
  const oneWayMin = route ? route.min * t.timeFactor : null
  const driveMin = oneWayMin != null ? 2 * oneWayMin * trips : null
  return {
    load: l,
    driver,
    day: l.loaded_on,
    time: sameDayTime(l.full_at ?? l.created_at, l.loaded_on, tz),
    toPlant: !!l.delivery_site_id,
    trips,
    km,
    driveMin,
    dutyMin: (driveMin ?? 0) + (t.loadMin + t.unloadMin) * trips,
    leadMin: (oneWayMin ?? 0) * 2 + t.loadMin,
    unloadMin: t.unloadMin,
  }
}

export type Day = {
  day: string
  loads: number
  km: number
  /** Loads with no route, so their km and driving are not counted. */
  noRoute: number
  driveMin: number
  /** The trips added up. */
  tripsDutyMin: number
  /** From the clock times, when any trip had one. */
  start: string | null
  end: string | null
  /** The longer of the trips added up and the day's span. */
  dutyMin: number
}

/** A driver's trips gathered into days, oldest first. */
export function daysOf(trips: Trip[]): Day[] {
  const byDay = new Map<string, Trip[]>()
  for (const t of trips) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t])
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ts]) => {
      const tripsDutyMin = ts.reduce((s, t) => s + t.dutyMin, 0)
      const timed = ts.filter((t) => t.time).sort((a, b) => a.time!.localeCompare(b.time!))
      let start: number | null = null
      let end: number | null = null
      if (timed.length) {
        start = minutesOf(timed[0].time!) - timed[0].leadMin
        const last = timed[timed.length - 1]
        end = minutesOf(last.time!) + last.unloadMin
      }
      const span = start != null && end != null ? end - start : 0
      return {
        day,
        loads: ts.reduce((s, t) => s + t.trips, 0),
        km: ts.reduce((s, t) => s + (t.km ?? 0), 0),
        noRoute: ts.filter((t) => t.km == null).length,
        driveMin: ts.reduce((s, t) => s + (t.driveMin ?? 0), 0),
        tripsDutyMin,
        start: start != null ? clock(start) : null,
        end: end != null ? clock(end) : null,
        dutyMin: Math.max(tripsDutyMin, span),
      }
    })
}

/** Hours to one place, as a number for the CSV. */
export const hours = (min: number) => Math.round((min / 60) * 10) / 10
