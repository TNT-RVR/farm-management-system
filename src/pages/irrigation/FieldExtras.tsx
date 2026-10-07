import { useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CloudRain, RotateCw } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useFieldSeasons } from '@/lib/irrigation'
import { conv, depthToMm, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { RainGaugeManager, RainReadingsList } from './RainGauges'

const md = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const mdt = (ts: string) =>
  new Date(ts).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Where the balance's rain came from, day by day, for one field this season. */
function useRainMix(fieldId: string, year: number) {
  return useQuery({
    queryKey: ['rain_mix', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('water_balance_daily')
        .select('date, rainfall_mm, rain_source, runoff_mm, is_forecast')
        .eq('field_id', fieldId)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .eq('is_forecast', false)
        .order('date')
      if (error) throw error
      // A zoned field repeats each day per zone; rain is the same on all.
      const byDate = new Map(data.map((r) => [r.date, r]))
      return [...byDate.values()]
    },
  })
}

function useGauges() {
  return useQuery({
    queryKey: ['rain_gauges'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rain_gauges').select('*').eq('active', true).order('name')
      if (error) throw error
      return data
    },
  })
}

function useFieldGauge(fieldId: string) {
  return useQuery({
    queryKey: ['field_gauge', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase.from('fields').select('rain_gauge_id').eq('id', fieldId).single()
      if (error) throw error
      return data.rain_gauge_id
    },
  })
}

function useGaugeReadings(gaugeId: string | null | undefined, year: number) {
  return useQuery({
    queryKey: ['rain_gauge_readings', gaugeId, year],
    enabled: Boolean(gaugeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rain_gauge_readings')
        .select('id, date, mm, note')
        .eq('gauge_id', gaugeId!)
        .gte('date', `${year}-01-01`)
        .order('date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

const SOURCE_LABEL: Record<string, string> = {
  gauge: 'your gauge',
  station: 'IMCIN station gauge',
  'radar_2.5km': 'radar 2.5 km',
  radar_10km: 'radar 10 km',
  model: 'weather model',
  forecast: 'forecast',
}

/**
 * Rain on this field: how much, and from what — the farm's gauge if it has
 * one, else Environment Canada's radar-and-gauge analysis at the field. A
 * gauge reading entered here wins over any model at the next sync.
 */
export function RainBlock({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const { data: mix } = useRainMix(fieldId, year)
  const { data: gauges } = useGauges()
  const { data: gaugeId } = useFieldGauge(fieldId)
  const { data: readings } = useGaugeReadings(gaugeId, year)
  const [date, setDate] = useState(() => new Date(Date.now() - 864e5).toLocaleDateString('en-CA'))
  const [amount, setAmount] = useState('')
  const [newGauge, setNewGauge] = useState('')
  const [managing, setManaging] = useState(false)
  const unit = conv.depthUnit(u)

  const link = useMutation({
    mutationFn: async (v: { gaugeId: string | null; newName?: string }) => {
      let id = v.gaugeId
      if (v.newName) {
        const { data, error } = await supabase.from('rain_gauges').insert({ name: v.newName }).select('id').single()
        if (error) throw error
        id = data.id
      }
      const { error } = await supabase.from('fields').update({ rain_gauge_id: id }).eq('id', fieldId)
      if (error) throw error
    },
    onSuccess: () => {
      setNewGauge('')
      void qc.invalidateQueries({ queryKey: ['rain_gauges'] })
      void qc.invalidateQueries({ queryKey: ['field_gauge', fieldId] })
    },
  })
  const log = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('rain_gauge_readings')
        .upsert({ gauge_id: gaugeId!, date, mm: depthToMm(Number(amount), u) }, { onConflict: 'gauge_id,date' })
      if (error) throw error
    },
    onSuccess: () => {
      setAmount('')
      void qc.invalidateQueries({ queryKey: ['rain_gauge_readings', gaugeId] })
    },
  })

  const total = (mix ?? []).reduce((a, r) => a + Number(r.rainfall_mm ?? 0), 0)
  const runoff = (mix ?? []).reduce((a, r) => a + Number(r.runoff_mm ?? 0), 0)
  const bySource = new Map<string, number>()
  for (const r of mix ?? []) if (Number(r.rainfall_mm) > 0) bySource.set(r.rain_source ?? 'model', (bySource.get(r.rain_source ?? 'model') ?? 0) + 1)
  const gauge = gauges?.find((g) => g.id === gaugeId)

  return (
    <div className="space-y-2 text-xs">
      <p className="text-gray-600">
        <b>{conv.depth(total, u, u === 'metric' ? 0 : 1)} {unit}</b> of rain in {year} so far
        {runoff > 0.5 && <> — {conv.depth(runoff, u)} {unit} ran off in storms over an inch</>}.
        {bySource.size > 0 && (
          <span className="text-gray-400">
            {' '}
            Rain days by source: {[...bySource.entries()].map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`).join(' · ')}.
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <CloudRain className="h-3.5 w-3.5 text-sky-600" />
        <span className="text-gray-600">Rain gauge:</span>
        {isMgr ? (
          <Select
            value={gaugeId ?? ''}
            size="sm"
            ariaLabel="Rain gauge"
            className="w-44"
            onChange={(v) => link.mutate({ gaugeId: v || null })}
            options={[{ value: '', label: 'none — use radar' }, ...(gauges ?? []).map((g) => ({ value: g.id, label: g.name }))]}
          />
        ) : (
          <b>{gauge?.name ?? 'none — radar'}</b>
        )}
        {isMgr && (
          <span className="flex items-center gap-1">
            <input
              value={newGauge}
              onChange={(e) => setNewGauge(e.target.value)}
              placeholder="new gauge name"
              className="w-32 rounded-md border border-gray-300 px-2 py-0.5"
            />
            <button
              type="button"
              disabled={!newGauge.trim() || link.isPending}
              onClick={() => link.mutate({ gaugeId: null, newName: newGauge.trim() })}
              className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Add &amp; link
            </button>
            <button type="button" onClick={() => setManaging(true)} className="text-[11px] text-brand-700 underline">
              all gauges
            </button>
          </span>
        )}
      </div>
      {gaugeId && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (amount !== '') log.mutate()
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <span className="font-medium text-gray-700">Log a reading</span>
            <DateField value={date} onChange={setDate} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
            <input
              type="number"
              step="0.1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={unit}
              className="w-20 rounded-md border border-gray-300 px-2 py-1"
            />
            <button type="submit" disabled={log.isPending} className="rounded-md bg-sky-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50">
              Save
            </button>
            {log.isSuccess && <span className="text-green-700">Saved — used for every field on this gauge at the next Sync.</span>}
            {log.isError && <span className="text-red-700">{(log.error as Error).message}</span>}
          </form>
          {readings && <RainReadingsList readings={readings} gaugeName={gauge?.name ?? 'this gauge'} u={u} />}
        </>
      )}
      {managing && <RainGaugeManager onClose={() => setManaging(false)} />}
      <HelpNote summary="Without a gauge, rain comes from Environment Canada's radar." title="Where the rain comes from">
        <p>
          Without a gauge the rain is Environment Canada&apos;s radar blended with its rain gauges, read at this field (2.5 km, or 10 km for older days). Today&apos;s and the
          forecast&apos;s come from the weather model until the radar total is published next morning.
        </p>
      </HelpNote>
    </div>
  )
}

function usePivot(fieldId: string, year: number) {
  return useQuery({
    queryKey: ['field_pivot_status', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const [sys, passes, piv] = await Promise.all([
        supabase.from('fieldnet_systems').select('fieldnet_id, name, comms_status, operational_status, panel_last_seen, arc_start_deg, arc_end_deg').eq('field_id', fieldId).maybeSingle(),
        supabase
          .from('fieldnet_passes')
          .select('*')
          .eq('field_id', fieldId)
          .gte('started_at', `${year}-01-01`)
          .order('started_at', { ascending: false })
          .limit(40),
        supabase.from('field_pivots').select('system_capacity_ls, gpm, acres_irrigated, application_efficiency').eq('field_id', fieldId).maybeSingle(),
      ])
      if (sys.error) throw sys.error
      if (passes.error) throw passes.error
      return { system: sys.data, passes: passes.data ?? [], pivot: piv.data ?? null }
    },
  })
}
export type PivotInfo = NonNullable<ReturnType<typeof usePivot>['data']>

/** The panel is offline and has been silent for over two days. */
function panelQuiet(system: PivotInfo['system'], now: number) {
  const seen = system?.panel_last_seen ? Date.parse(system.panel_last_seen) : null
  return system?.comms_status === 'offline' && seen != null && now - seen > 2 * 864e5
}

/**
 * Only the "panel has gone quiet" warning from PivotBlock, for the open part of
 * the field panel: Pivot & passes sits in a fold, and a warning that the graph
 * is missing its irrigation must not be folded away with it.
 */
export function PanelOfflineWarning({ fieldId, year, className }: { fieldId: string; year: number; className?: string }) {
  const { data } = usePivot(fieldId, year)
  const [openedAt] = useState(() => Date.now())
  if (!data?.system || !panelQuiet(data.system, openedAt)) return null
  return (
    <p className={cn('flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800', className)}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <b>{data.system.name}</b>&apos;s panel has not reported to FieldNET since <b>{md(data.system.panel_last_seen!)}</b>, so its passes are not being recorded — log
        them by hand until it is back online.
      </span>
    </p>
  )
}

/** FieldNET's view of this pivot: is the panel reporting, and how each pass ended. */
export function PivotBlock({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const { data } = usePivot(fieldId, year)
  const [all, setAll] = useState(false)
  const [openedAt] = useState(() => Date.now())
  if (!data) return <p className="py-2 text-center text-xs text-gray-400">Reading FieldNET…</p>
  if (!data.system)
    return <p className="text-xs text-gray-500">No FieldNET pivot is linked to this field. Log its water by hand below.</p>
  const quiet = panelQuiet(data.system, openedAt)
  const shown = all ? data.passes : data.passes.slice(0, 6)
  const unit = conv.depthUnit(u)
  return (
    <div className="space-y-2 text-xs">
      {quiet ? (
        <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>{data.system.name}</b>&apos;s panel has not reported to FieldNET since <b>{md(data.system.panel_last_seen!)}</b>. Nothing it applies is being recorded, so this
            field&apos;s graph is missing its irrigation — log each pass below until the panel is back online.
          </span>
        </p>
      ) : (
        <p className="text-gray-600">
          {data.system.name} · {data.system.comms_status ?? 'unknown'}
          {data.system.operational_status ? ` · ${data.system.operational_status.replace(/-/g, ' ')}` : ''}
          {data.system.arc_start_deg != null && data.system.arc_end_deg != null && !(data.system.arc_start_deg === 0 && data.system.arc_end_deg === 360) && (
            <> · waters {Math.round(data.system.arc_start_deg)}° to {Math.round(data.system.arc_end_deg)}°</>
          )}
        </p>
      )}
      {data.passes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-0.5 font-medium">Started</th>
                <th className="py-0.5 font-medium">Ran</th>
                <th className="py-0.5 text-right font-medium">Depth</th>
                <th className="py-0.5 pl-3 font-medium">Ended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((p) => (
                <tr key={p.id} className={cn(p.completed === false && 'bg-amber-50')}>
                  <td className="py-0.5 text-gray-700">{mdt(p.started_at)}</td>
                  <td className="py-0.5 text-gray-600">
                    {p.start_deg != null && p.end_deg != null ? `${Math.round(p.start_deg)}° → ${Math.round(p.end_deg)}°` : '—'}
                    {p.swept_deg != null && <span className="text-gray-400"> ({Math.round(p.swept_deg)}°)</span>}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{p.depth_mm != null ? `${conv.depth(p.depth_mm, u)} ${unit}` : '—'}</td>
                  <td className={cn('py-0.5 pl-3', p.completed === false ? 'font-medium text-amber-800' : 'text-gray-500')}>
                    {p.ended_at ? `${(p.end_status ?? '').replace(/-/g, ' ')}${p.completed === false ? ' — stopped short' : ''}` : 'still running'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.passes.length > 6 && (
            <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-[11px] text-brand-700 underline">
              {all ? 'show fewer' : `show all ${data.passes.length}`}
            </button>
          )}
        </div>
      )}
      <HelpNote summary="A pass that stopped halfway counts as half." title="How passes are counted">
        <p>
          Water is counted from FieldNET&apos;s record of where the pivot actually wet, one degree of the circle at a time, and averaged over the whole field — a pass that
          stopped halfway counts as half. Passes come from the panel&apos;s own history; one that ended on a fault is flagged.
        </p>
      </HelpNote>
    </div>
  )
}

/**
 * Gross depth from hours run: the pivot's flow over its irrigated acres. The
 * AIMM way of logging a pass when the panel is not reporting.
 */
export function mmFromHours(hours: number, pivot: PivotInfo['pivot']): number | null {
  if (!pivot || !(hours > 0)) return null
  const ls = pivot.system_capacity_ls != null ? Number(pivot.system_capacity_ls) : pivot.gpm != null ? Number(pivot.gpm) * 0.0630902 : null
  const acres = pivot.acres_irrigated != null ? Number(pivot.acres_irrigated) : null
  if (!ls || !acres) return null
  return (ls * 3600 * hours) / (acres * 4046.86)
}

export function usePivotInfo(fieldId: string, year: number) {
  return usePivot(fieldId, year)
}

/** The inputs AIMM takes per season: a measured spring soil moisture and a harvest date. */
export function SeasonInputs({ fieldId, year, u, fc }: { fieldId: string; year: number; u: UnitSystem; fc: number | null }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const { data: seasons } = useFieldSeasons(year)
  const mine = (seasons ?? []).filter((s) => s.field_id === fieldId)
  const save = useMutation({
    mutationFn: async (v: { id: string; patch: { start_moisture_mm?: number | null; start_moisture_on?: string | null; harvest_date?: string | null } }) => {
      const { error } = await supabase.from('field_crop_seasons').update(v.patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_crop_seasons', year] }),
  })
  const unit = conv.depthUnit(u)
  if (!mine.length)
    return (
      <p className="text-xs text-gray-500">
        No {year} season set up for this field (Setup tab). <SetupLink to={SETUP_LINKS.plantingDate(fieldId)}>Set the planting date</SetupLink>
      </p>
    )
  return (
    <div className="space-y-2 text-xs">
      {mine.map((s) => (
        <div key={s.id} className="flex flex-wrap items-end gap-3">
          {mine.length > 1 && <span className="font-medium text-gray-700">{s.zone_id ? 'Zone' : 'Whole field'}</span>}
          <label className="flex flex-col gap-0.5 text-gray-500">
            Spring soil moisture ({unit})
            <input
              type="number"
              step="0.1"
              disabled={!isMgr}
              defaultValue={s.start_moisture_mm != null ? conv.depth(s.start_moisture_mm, u) : ''}
              key={`sm-${s.start_moisture_mm}`}
              placeholder={fc != null ? `est. ${conv.depth(fc * 0.5, u, 0)}` : ''}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : depthToMm(Number(e.target.value), u)
                if (v !== s.start_moisture_mm) save.mutate({ id: s.id, patch: { start_moisture_mm: v } })
              }}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-gray-500">
            measured on
            <DateField
              value={s.start_moisture_on ?? ''}
              onChange={(v) => save.mutate({ id: s.id, patch: { start_moisture_on: v || null } })}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-gray-500">
            Harvest / swath date
            <DateField
              value={s.harvest_date ?? ''}
              onChange={(v) => save.mutate({ id: s.id, patch: { harvest_date: v || null } })}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          {save.isPending && <RotateCw className="h-3.5 w-3.5 animate-spin text-gray-400" />}
        </div>
      ))}
      {save.isError && <p className="text-red-700">{(save.error as Error).message}</p>}
      <HelpNote summary="Without a spring reading the model starts at half of field capacity. Changes show after the next Sync." title="Season inputs">
        <p>
          AIMM starts each field from a soil moisture measured in spring (hand-feel or probe, as mm of available water over the root zone). Without one the model assumes
          half of field capacity. After the harvest date the field only loses water to the soil surface. Changes show after the next Sync.
        </p>
      </HelpNote>
    </div>
  )
}
