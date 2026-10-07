import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { addDays } from './date-range'

/**
 * The day's log, written by the machines.
 *
 * Passes from Deere, water from the pivots, rain and heat from the stations,
 * tasks ticked, samples tested, cattle worked, feed put out, services logged,
 * loads delivered — assembled into one entry per day with nothing typed. It is
 * the diary nobody keeps, and most of a Monday meeting already written.
 *
 * Read straight from the tables, one query each, for one calendar day. Every
 * one of these is RLS-readable by any active user, so the page needs no
 * function behind it and works off the offline cache.
 */
export type DayItem = {
  kind: 'pass' | 'water' | 'weather' | 'task' | 'moisture' | 'cattle' | 'feed' | 'service' | 'load' | 'hail' | 'bin'
  /** ISO time if the item has one; a day-only item sorts first. */
  at: string | null
  title: string
  detail: string | null
  /** Where to go to see the whole thing. */
  to: string | null
}

type Op = {
  id: string
  field_id: string | null
  operation_type: string | null
  started_at: string | null
  ended_at: string | null
  operator_name: string | null
  products: { name?: string | null }[] | null
  treated_crop: string | null
}

type WeatherRow = {
  station_id: string
  tmax_c: number | null
  tmin_c: number | null
  precip_mm: number | null
  et0_mm: number | null
  wind_ms: number | null
}

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : ''

export function daybookQuery(day: string) {
  const next = addDays(day, 1)
  return {
    queryKey: ['daybook', day],
    queryFn: async (): Promise<DayItem[]> => {
      const [
        { data: fields },
        { data: ops },
        { data: water },
        { data: weather },
        { data: tasksDone },
        { data: moisture },
        { data: cattle },
        { data: feed },
        { data: services },
        { data: loads },
        { data: hail },
        { data: binsFilled },
        { data: equipment },
        { data: crops },
        { data: binRows },
      ] = await Promise.all([
        supabase.from('fields').select('id, name'),
        supabase
          .from('jd_field_operations')
          .select('id, field_id, operation_type, started_at, ended_at, operator_name, products, treated_crop')
          .gte('started_at', `${day}T00:00:00`)
          .lt('started_at', `${next}T00:00:00`),
        supabase.from('irrigation_events').select('field_id, gross_mm, net_mm, source').eq('date', day),
        // Not in the typed schema — nothing else on the client reads the
        // weather table — so it is read untyped and shaped below.
        (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: WeatherRow[] | null }> } } })
          .from('weather_daily')
          .select('station_id, tmax_c, tmin_c, precip_mm, et0_mm, wind_ms')
          .eq('date', day),
        supabase
          .from('tasks')
          .select('id, title, completed_at, field_id')
          .gte('completed_at', `${day}T00:00:00`)
          .lt('completed_at', `${next}T00:00:00`),
        supabase
          .from('moisture_tests')
          .select('tested_at, field_id, moisture_pct, grade, bin_id')
          .gte('tested_at', `${day}T00:00:00`)
          .lt('tested_at', `${next}T00:00:00`),
        supabase.from('cattle_events').select('event_type, product, notes, cattle_id').eq('event_date', day),
        supabase.from('feed_records').select('herd_group, head_count, notes').eq('period_start', day),
        supabase.from('equipment_service_log').select('equipment_id, plan_id, engine_hours, notes').eq('done_on', day),
        supabase.from('scale_tickets').select('buyer, net_units, unit, ticket_no, crop_id').eq('delivered_on', day),
        supabase.from('field_hail_events').select('field_id, notes').eq('event_date', day),
        supabase.from('bin_contents').select('bin_id, crop_id, bushels').eq('filled_on', day),
        supabase.from('jd_equipment').select('id, name'),
        supabase.from('crops').select('id, name'),
        supabase.from('bins').select('id, name'),
      ])

      const fieldName = (id: string | null) => fields?.find((f) => f.id === id)?.name ?? 'a field'
      const cropName = (id: string | null) => crops?.find((c) => c.id === id)?.name ?? 'crop'
      const binName = (id: string | null) => binRows?.find((b) => b.id === id)?.name ?? 'a bin'
      const items: DayItem[] = []

      for (const o of (ops ?? []) as unknown as Op[]) {
        const products = (o.products ?? []).map((p) => p.name).filter(Boolean).join(', ')
        items.push({
          kind: 'pass',
          at: o.started_at,
          title: `${o.operation_type ? o.operation_type[0].toUpperCase() + o.operation_type.slice(1) : 'Pass'} on ${fieldName(o.field_id)}`,
          detail: [
            o.operator_name,
            products || null,
            o.started_at && o.ended_at ? `${hhmm(o.started_at)}–${hhmm(o.ended_at)}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          to: o.field_id ? `/fields/${o.field_id}/work` : null,
        })
      }
      for (const w of water ?? []) {
        items.push({
          kind: 'water',
          at: null,
          title: `${w.gross_mm ?? w.net_mm ?? '?'} mm on ${fieldName(w.field_id)}`,
          detail: w.source ? `from ${w.source}` : null,
          to: w.field_id ? `/fields/${w.field_id}/irrigation` : null,
        })
      }
      for (const w of weather ?? []) {
        items.push({
          kind: 'weather',
          at: null,
          title: `${w.tmax_c != null ? `${Math.round(w.tmax_c)}°` : '—'} / ${w.tmin_c != null ? `${Math.round(w.tmin_c)}°` : '—'}${
            w.precip_mm ? ` · ${w.precip_mm} mm rain` : ''
          }`,
          detail: [w.et0_mm != null ? `ET₀ ${w.et0_mm} mm` : null, w.wind_ms != null ? `wind ${Math.round(w.wind_ms * 3.6)} km/h` : null]
            .filter(Boolean)
            .join(' · '),
          to: '/weather',
        })
      }
      for (const t of tasksDone ?? []) {
        items.push({
          kind: 'task',
          at: t.completed_at,
          title: `Done: ${t.title}`,
          detail: t.field_id ? fieldName(t.field_id) : null,
          to: `/tasks/${t.id}`,
        })
      }
      for (const m of moisture ?? []) {
        items.push({
          kind: 'moisture',
          at: m.tested_at,
          title: `${m.moisture_pct}% ${m.grade ?? ''} — ${fieldName(m.field_id)}`.trim(),
          detail: m.bin_id ? `into ${binName(m.bin_id)}` : null,
          to: '/harvest',
        })
      }
      for (const c of cattle ?? []) {
        items.push({
          kind: 'cattle',
          at: null,
          title: `${c.event_type}${c.product ? ` · ${c.product}` : ''}`,
          detail: c.notes ?? null,
          to: c.cattle_id ? `/cattle/${c.cattle_id}` : '/herd',
        })
      }
      for (const f of feed ?? []) {
        items.push({
          kind: 'feed',
          at: null,
          title: `Fed ${f.herd_group ?? 'the herd'}${f.head_count ? ` · ${f.head_count} head` : ''}`,
          detail: f.notes ?? null,
          to: '/feed-records',
        })
      }
      for (const s of services ?? []) {
        items.push({
          kind: 'service',
          at: null,
          title: `Service on ${equipment?.find((e) => e.id === s.equipment_id)?.name ?? 'a machine'}`,
          detail: [s.engine_hours != null ? `${Math.round(s.engine_hours)} h` : null, s.notes].filter(Boolean).join(' · '),
          to: s.equipment_id ? `/equipment/${s.equipment_id}` : '/equipment',
        })
      }
      for (const l of loads ?? []) {
        items.push({
          kind: 'load',
          at: null,
          title: `Delivered ${l.net_units != null ? `${Math.round(l.net_units).toLocaleString()} ${l.unit ?? ''} ` : ''}${cropName(l.crop_id)} to ${l.buyer ?? 'the buyer'}`,
          detail: l.ticket_no ? `ticket ${l.ticket_no}` : null,
          to: '/contracts',
        })
      }
      for (const h of hail ?? []) {
        items.push({ kind: 'hail', at: null, title: `Hail on ${fieldName(h.field_id)}`, detail: h.notes ?? null, to: '/hail' })
      }
      for (const b of binsFilled ?? []) {
        items.push({
          kind: 'bin',
          at: null,
          title: `${binName(b.bin_id)} filled with ${cropName(b.crop_id)}`,
          detail: b.bushels != null ? `${Math.round(b.bushels).toLocaleString()} bu` : null,
          to: '/harvest?tab=bins',
        })
      }

      // Timed items in order; the day-only ones (weather, feed, water) first,
      // because they are the day's conditions rather than its events.
      return items.sort((a, b) => {
        if (a.at == null && b.at == null) return 0
        if (a.at == null) return -1
        if (b.at == null) return 1
        return a.at.localeCompare(b.at)
      })
    },
  }
}

export function useDaybook(day: string) {
  return useQuery(daybookQuery(day))
}
