import { supabase } from '@/lib/supabase'
import { farmTz } from '@/lib/farm-context'
import { binsKey, fieldKey, routeBetween, siteKey } from '@/lib/road-routes'
import { truckSettingsFrom } from '@/lib/hauling-data'
import type { ReportSection } from '@/lib/table-report'
import { fetchAll, longDate, type GatherContext, type ParamValues, type SectionedReport } from './framework'
import { daysOf, driverOf, hours, tripOf, type Driver, type LogLoad, type Route, type Trip } from './driver-log'

/**
 * The drivers' log, gathered (driver-log.ts has the arithmetic): the loads in
 * the range, who drove them, the road routes, and the farm's trucking times.
 * One driver, or every driver on pages of their own.
 */
export async function gatherDriverLog(p: ParamValues, ctx: GatherContext): Promise<SectionedReport> {
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const [loads, users, fields, bins, sites, routes, settings] = await Promise.all([
    fetchAll<LogLoad>((a, b) =>
      supabase
        .from('bin_loads')
        .select('id, loaded_on, created_at, full_at, driver_id, driver, field_id, bin_id, delivery_site_id, entry_kind, load_count, net_kg, estimated, truck, trailer')
        .gte('loaded_on', from)
        .lte('loaded_on', to)
        .order('loaded_on')
        .order('created_at')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ id: string; full_name: string | null }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('bins').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('delivery_sites').select('id, name').order('id').range(a, b)),
    fetchAll<{ from_key: string; to_key: string; distance_km: number | string; duration_min: number | string }>((a, b) =>
      supabase.from('road_routes').select('from_key, to_key, distance_km, duration_min').order('from_key').order('to_key').range(a, b),
    ),
    supabase.from('operating_settings').select('key, value').in('key', ['truck_field', 'truck_highway']),
  ])
  if (settings.error) throw new Error(settings.error.message)
  const truck = truckSettingsFrom(new Map((settings.data ?? []).map((r) => [r.key, r.value as unknown])))
  const person = new Map(users.map((u) => [u.id, u.full_name]))
  const byName = peopleByName(users)
  const nameOf = <T extends { id: string; name: string }>(xs: T[]) => {
    const m = new Map(xs.map((x) => [x.id, x.name]))
    return (id: string | null) => (id ? (m.get(id) ?? null) : null)
  }
  const field = nameOf(fields)
  const bin = nameOf(bins)
  const site = nameOf(sites)

  // A load is only a trip once it has somewhere it came from or went to.
  const routeOf = (l: LogLoad): Route | null => {
    if (!l.field_id) return null
    const r = l.delivery_site_id ? routeBetween(routes, fieldKey(l.field_id), siteKey(l.delivery_site_id)) : l.bin_id ? routeBetween(routes, binsKey, fieldKey(l.field_id)) : null
    return r ? { km: Number(r.distance_km), min: Number(r.duration_min) } : null
  }
  const tz = farmTz()
  let trips: Trip[] = loads.map((l) => tripOf(l, driverOf(l, (id) => person.get(id) ?? null, (n) => byName.get(n) ?? null), routeOf(l), l.delivery_site_id ? truck.highway : truck.field, tz))
  if (p.driver) trips = trips.filter((t) => t.driver.key === p.driver)
  if (!trips.length) throw new Error(p.driver ? 'No loads for that driver in those dates.' : 'No loads weighed in between those dates.')

  // Drivers by name, nobody last.
  const drivers = [...new Map(trips.map((t) => [t.driver.key, t.driver])).values()].sort((a, b) =>
    a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name),
  )
  const sections: ReportSection[] = []
  const all = { loads: 0, km: 0, drive: 0, duty: 0 }
  drivers.forEach((d: Driver, i) => {
    const mine = trips.filter((t) => t.driver.key === d.key)
    const days = daysOf(mine)
    const tot = {
      loads: days.reduce((s, x) => s + x.loads, 0),
      km: days.reduce((s, x) => s + x.km, 0),
      drive: days.reduce((s, x) => s + x.driveMin, 0),
      duty: days.reduce((s, x) => s + x.dutyMin, 0),
    }
    all.loads += tot.loads
    all.km += tot.km
    all.drive += tot.drive
    all.duty += tot.duty
    sections.push({
      title: `${d.name}: by day`,
      // Every driver after the first on a page of their own.
      pageBreakBefore: i > 0,
      head: ['Date', 'Loads', 'Km', 'Driving (h)', 'On duty (h)', 'On duty from', 'To', 'Note'],
      rows: days.map((x) => [
        longDate(x.day),
        x.loads,
        Math.round(x.km),
        hours(x.driveMin),
        hours(x.dutyMin),
        x.start ? `~${x.start}` : '',
        x.end ? `~${x.end}` : '',
        [x.start ? null : 'no clock times: loads entered later', x.noRoute ? `${x.noRoute} load${x.noRoute === 1 ? '' : 's'} with no route` : null].filter(Boolean).join('; '),
      ]),
      foot: ['Total', tot.loads, Math.round(tot.km), hours(tot.drive), hours(tot.duty), '', '', `${days.length} day${days.length === 1 ? '' : 's'}`],
    })
    sections.push({
      title: `${d.name}: trips`,
      head: ['Date', 'At the scale', 'From', 'To', 'Net (kg)', 'Round trip (km)', 'Driving (h)', 'On duty (h)', 'Truck', 'Trailer'],
      rows: mine.map((t) => [
        longDate(t.day),
        t.time ? `~${t.time}` : '',
        field(t.load.field_id) ?? 'No field',
        `${(t.toPlant ? site(t.load.delivery_site_id) : bin(t.load.bin_id)) ?? (t.toPlant ? 'A plant' : 'A bin')}${t.trips > 1 ? ` (${t.trips} loads)` : ''}${t.load.estimated ? ' (estimate)' : ''}`,
        // A load still waiting for its second weight has no net yet.
        t.load.net_kg == null ? '' : Math.round(Number(t.load.net_kg)),
        t.km == null ? 'no route' : Math.round(t.km),
        t.driveMin == null ? '' : hours(t.driveMin),
        hours(t.dutyMin),
        t.load.truck ?? '',
        t.load.trailer ?? '',
      ]),
    })
  })

  const who = p.driver ? drivers[0].name : 'All drivers'
  return {
    title: 'Drivers’ log',
    subtitle: `${who} · ${longDate(from)} to ${longDate(to)}`,
    meta: [
      ['Drivers', drivers.length],
      ['Loads', all.loads],
      ['Km', Math.round(all.km)],
      ['Driving (h)', hours(all.drive)],
      ['On duty (h)', hours(all.duty)],
    ],
    lead: [
      'Worked out from the loads weighed in; nobody enters anything for it. Each load is a round trip on the road from the field to the bins or the plant and back empty, at the road distances on the Distances map; driving is slowed by the loaded-truck factor, and on duty adds the minutes to fill and to dump (Trucking settings).',
      'A clock time is when the load was saved, kept only when it was saved the same day. A day with clock times is on duty from before its first load to after its last, or the trips added up if longer. An estimate from the scale records, not a certified hours-of-service logbook.',
    ],
    sections,
    orientation: 'landscape',
    filename: `Drivers log ${p.driver ? `${drivers[0].name} ` : ''}${from} to ${to}`,
  }
}

/** People by their full name, lower-cased: a typed driver's name to the person. */
function peopleByName(users: { id: string; full_name: string | null }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const u of users) if (u.full_name) m.set(u.full_name.trim().toLowerCase().replace(/\s+/g, ' '), u.id)
  return m
}

/** The drivers the log can be run for: everyone who has driven a load, by name. */
export async function driverChoices(): Promise<{ value: string; label: string }[]> {
  const [loads, users] = await Promise.all([
    fetchAll<{ driver_id: string | null; driver: string | null }>((a, b) => supabase.from('bin_loads').select('driver_id, driver').order('id').range(a, b)),
    fetchAll<{ id: string; full_name: string | null }>((a, b) => supabase.from('users').select('id, full_name').order('id').range(a, b)),
  ])
  const person = new Map(users.map((u) => [u.id, u.full_name]))
  const byName = peopleByName(users)
  const out = new Map<string, string>()
  for (const l of loads) {
    const d = driverOf(l, (id) => person.get(id) ?? null, (n) => byName.get(n) ?? null)
    if (d.key !== 'none') out.set(d.key, d.name)
  }
  return [...out.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
}
