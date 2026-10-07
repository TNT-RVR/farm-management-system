import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useFieldSeasons, useUpdateSoilReading } from '@/lib/irrigation'
import { fcFromReading, pctOfFcFor } from '@/lib/irrigation-edits'
import { keepOpenOnError } from '@/lib/record-actions'
import { DeleteButton, EditButton, RecordEditModal } from '@/components/RecordEditor'
import { conv, depthToMm, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { FEEL_GUIDE, SOIL_METHODS } from '@/lib/soil-moisture'

const md = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/** Measured soil moisture on one field this year, newest first. */
export function useSoilReadings(fieldId: string, year: number) {
  return useQuery({
    queryKey: ['soil_moisture_readings', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soil_moisture_readings')
        .select('id, read_on, avail_mm, pct_of_fc, method, depth_note, note, zone_id')
        .eq('field_id', fieldId)
        .gte('read_on', `${year}-01-01`)
        .lte('read_on', `${year}-12-31`)
        .order('read_on', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

// The methods and the hand-feel guide are shared with the field forms (scouting,
// crop inspection), which record the same readings.
const METHODS = SOIL_METHODS
const FEEL = FEEL_GUIDE

/**
 * AIMM improvement 1: a measured soil moisture, entered — the date, how much
 * water is left (as a share of what the soil holds, or a depth), how it was
 * judged, and the hand-feel guide. On its day the model line is set to it;
 * over the season the gap between model and readings calibrates the field's
 * water use. Opened from the Detailed View's "Submit soil moisture".
 */
export function SoilReadingForm({ fieldId, u, fc, onSaved }: { fieldId: string; u: UnitSystem; fc: number | null; onSaved?: () => void }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [by, setBy] = useState<'pct' | 'depth'>(fc != null ? 'pct' : 'depth')
  const [value, setValue] = useState('')
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('hand_feel')
  const [note, setNote] = useState('')
  const [guide, setGuide] = useState(false)
  const unit = conv.depthUnit(u)
  const mm = value === '' ? null : by === 'pct' ? (fc != null ? (Number(value) / 100) * fc : null) : depthToMm(Number(value), u)
  const save = useMutation({
    mutationFn: async () => {
      if (mm == null) throw new Error('Field capacity unknown — enter the reading as a depth instead.')
      const { error } = await supabase.from('soil_moisture_readings').upsert(
        {
          field_id: fieldId,
          read_on: date,
          avail_mm: Math.round(mm * 10) / 10,
          pct_of_fc: fc ? Math.round((mm / fc) * 1000) / 10 : null,
          method,
          note: note || null,
        },
        { onConflict: 'field_id,zone_id,read_on' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      setValue('')
      setNote('')
      void qc.invalidateQueries({ queryKey: ['soil_moisture_readings', fieldId] })
      onSaved?.()
    },
  })
  return (
    <div className="space-y-3 text-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value !== '') save.mutate()
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Date</span>
          <DateField value={date} onChange={setDate} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">How it was judged</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Water left in the root zone</span>
          <span className="mt-0.5 flex gap-2">
            <input
              type="number"
              step="any"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={by === 'pct' ? 'e.g. 65' : unit}
              className="w-28 rounded-md border border-gray-300 px-2 py-1.5"
            />
            <select value={by} onChange={(e) => setBy(e.target.value as 'pct' | 'depth')} className="rounded-md border border-gray-300 px-2 py-1.5" aria-label="Enter as">
              <option value="pct">% of what it holds</option>
              <option value="depth">{unit} of water</option>
            </select>
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="depths, spot in the field" className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5" />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={save.isPending || value === ''} className="rounded-md bg-emerald-700 px-4 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Submit reading'}
          </button>
          <button type="button" onClick={() => setGuide((g) => !g)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <Info className="h-3.5 w-3.5" /> hand-feel guide
          </button>
        </div>
      </form>
      {mm != null && fc != null && value !== '' && (
        <p className="text-xs text-gray-500">
          = {conv.depth(mm, u)} {unit} of {conv.depth(fc, u, 0)} {unit} capacity ({Math.round((mm / fc) * 100)}%).
        </p>
      )}
      {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
      {guide && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
          <p className="mb-1 text-gray-600">
            Take soil from the top, middle and bottom of the root zone (a probe or shovel to ~1 m), squeeze a handful from each, judge the share of available water
            left, and average the depths.
          </p>
          <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[5rem_1fr]">
            {FEEL.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold text-gray-700">{k}</dt>
                <dd className="text-gray-600">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        On a reading&apos;s day the model line is set to it (AIMM&apos;s &ldquo;corrected to measured&rdquo;), from the next model run — tomorrow morning, or press Sync.
      </p>
    </div>
  )
}

/** The season's soil moisture readings for a field, newest first. */
export function SoilReadingsBlock({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const qc = useQueryClient()
  const { data: readings } = useSoilReadings(fieldId, year)
  const update = useUpdateSoilReading()
  const [editing, setEditing] = useState<NonNullable<typeof readings>[number] | null>(null)
  const unit = conv.depthUnit(u)
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('soil_moisture_readings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['soil_moisture_readings', fieldId] }),
  })
  return (
    <div className="space-y-2 text-xs">
      {readings && readings.length > 0 ? (
        <table className="w-full">
          <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-0.5 font-medium">Date</th>
              <th className="py-0.5 text-right font-medium">Available</th>
              <th className="py-0.5 pl-3 font-medium">How</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {readings.map((r) => (
              <tr key={r.id}>
                <td className="py-0.5">{md(r.read_on)}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {conv.depth(r.avail_mm, u)} {unit}
                  {r.pct_of_fc != null && <span className="text-gray-400"> · {Math.round(r.pct_of_fc)}%</span>}
                </td>
                <td className="py-0.5 pl-3 text-gray-500">
                  {METHODS.find((m) => m.value === r.method)?.label ?? r.method}
                  {r.note ? ` — ${r.note}` : ''}
                </td>
                <td className="py-0.5 pl-2">
                  <span className="flex justify-end gap-1">
                    <EditButton
                      onClick={() => {
                        update.reset()
                        setEditing(r)
                      }}
                    />
                    <DeleteButton
                      disabled={remove.isPending}
                      onDelete={() => remove.mutate(r.id)}
                      confirm={`Delete the soil moisture reading of ${md(r.read_on)}? The model line stops being set to it from the next run.`}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-gray-500">No readings this season. Use &ldquo;Submit soil moisture&rdquo; at the top, or record one on a field inspection.</p>
      )}
      {remove.isError && <p className="text-red-700">{(remove.error as Error).message}</p>}
      <p className="text-[11px] text-gray-400">
        Two or more readings also teach the field its own water-use calibration (shown under Soil &amp; calibration).
      </p>
      {editing && (
        <RecordEditModal
          title={`Soil moisture — ${md(editing.read_on)}`}
          fields={[
            { key: 'read_on', label: 'Date', kind: 'date', required: true },
            { key: 'method', label: 'How it was judged', kind: 'select', options: METHODS.map((m) => ({ value: m.value, label: m.label })) },
            { key: 'avail', label: `Water left in the root zone (${unit})`, kind: 'number', step: 'any', required: true, hint: 'The % of what the soil holds follows a changed depth.' },
            { key: 'note', label: 'Note', kind: 'textarea' },
          ]}
          row={{ read_on: editing.read_on, method: editing.method, avail: conv.depth(editing.avail_mm, u, u === 'metric' ? 1 : 2), note: editing.note }}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            const v = p.avail as number | null
            if (v == null || v < 0) return Promise.reject(new Error('Enter the water left.'))
            const mm = Math.round(depthToMm(v, u) * 10) / 10
            return update.mutateAsync({
              id: editing.id,
              patch: {
                read_on: String(p.read_on),
                method: ((p.method as string | null) ?? editing.method) as typeof editing.method,
                avail_mm: mm,
                pct_of_fc: pctOfFcFor(mm, fcFromReading(editing.avail_mm, editing.pct_of_fc)),
                note: (p.note as string | null) ?? null,
              },
            })
          }}
          onDelete={() => keepOpenOnError(remove.mutateAsync(editing.id))}
          deleteConfirm={`Delete the soil moisture reading of ${md(editing.read_on)}?`}
          saving={update.isPending || remove.isPending}
          // A reading per field, zone and day (field_id, zone_id, read_on).
          error={update.error ? (/duplicate|unique/i.test((update.error as Error).message) ? 'There is already a reading on that day.' : (update.error as Error).message) : null}
        />
      )}
    </div>
  )
}

function useSoilProfile(fieldId: string) {
  return useQuery({
    queryKey: ['field_soil_profile', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_soil_profiles')
        .select('id, source, sample_site_name, sample_note, survey_awc_mm_m, survey_note, layers, max_root_zone_depth_m, allowable_depletion_pct')
        .eq('field_id', fieldId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

const SOURCE: Record<string, string> = {
  samples: 'your soil samples',
  survey: 'the provincial soil survey',
  manual: 'set by hand',
  aimm: 'an AIMM sample site',
  default: 'a default profile',
  decisive: 'Decisive Farming samples',
  ici: 'ICI samples',
}

/**
 * AIMM improvements 2 and 5: where this field's soil water-holding came from
 * (own samples first, the survey only without them) and what its readings
 * have taught it about its water use.
 */
export function SoilCalibrationBlock({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const { profile: me } = useAuth()
  const isMgr = hasManagerAccess(me?.role)
  const qc = useQueryClient()
  const { data: p } = useSoilProfile(fieldId)
  const { data: seasons } = useFieldSeasons(year)
  const season = (seasons ?? []).find((s) => s.field_id === fieldId && !s.zone_id) ?? (seasons ?? []).find((s) => s.field_id === fieldId)
  const unit = conv.depthUnit(u)
  const layers = (Array.isArray(p?.layers) ? p.layers : []) as { depth_cm: number; aw_fc_mm: number; soil_type?: string }[]
  const fcMm = layers.length ? Number(layers[layers.length - 1].aw_fc_mm) : null
  const useSurvey = useMutation({
    mutationFn: async () => {
      if (!p?.survey_awc_mm_m) throw new Error('No soil survey figure for this field.')
      const awc = Number(p.survey_awc_mm_m)
      const { error } = await supabase
        .from('field_soil_profiles')
        .update({
          source: 'manual',
          sample_site_name: 'Soil survey (chosen)',
          layers: [15, 30, 45, 60, 100].map((d) => ({ depth_cm: d, soil_type: 'Soil survey', aw_fc_mm: Math.round(awc * d) / 100, wp_mm: d })),
        })
        .eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_soil_profile', fieldId] }),
  })
  const useSamples = useMutation({
    mutationFn: async () => {
      if (!p) return
      const { error } = await supabase.from('field_soil_profiles').update({ source: 'default' }).eq('id', p.id)
      if (error) throw error
      const { error: e2 } = await supabase.rpc('fn_refresh_soil_from_samples', { p_years: 5 })
      if (e2) throw e2
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_soil_profile', fieldId] }),
  })
  if (!p) return <p className="text-xs text-gray-400">No soil profile for this field.</p>
  const cal = Number(season?.calibration_factor ?? 1)
  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-gray-700">
        Holds <b>{fcMm != null ? `${conv.depth(fcMm, u, u === 'metric' ? 0 : 1)} ${unit}` : '—'}</b> of plant-available water over{' '}
        {Number(p.max_root_zone_depth_m)} m ({layers[layers.length - 1]?.soil_type ?? '—'}), from <b>{SOURCE[p.source] ?? p.source}</b>.
      </p>
      {p.sample_note && <p className="text-gray-500">{p.sample_note}</p>}
      {p.survey_awc_mm_m != null && (
        <p className="text-gray-500">
          Soil survey for comparison: {conv.depth(Number(p.survey_awc_mm_m), u, 0)} {unit}/m{p.survey_note ? ` (${p.survey_note})` : ''}.
        </p>
      )}
      {isMgr && (
        <div className="flex flex-wrap gap-2">
          {p.source !== 'manual' && p.survey_awc_mm_m != null && (
            <button type="button" disabled={useSurvey.isPending} onClick={() => useSurvey.mutate()} className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50">
              Use the soil survey instead
            </button>
          )}
          {p.source === 'manual' && (
            <button type="button" disabled={useSamples.isPending} onClick={() => useSamples.mutate()} className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50">
              Back to our soil samples
            </button>
          )}
        </div>
      )}
      <p className={cn('rounded px-2 py-1', Math.abs(cal - 1) >= 0.05 ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-600')}>
        Water-use calibration: <b>× {cal.toFixed(2)}</b>
        {season?.calibration_note ? ` — ${season.calibration_note}` : ' — none yet; it learns from two or more soil readings.'}
      </p>
    </div>
  )
}

/** AIMM improvement 7: the rest of the season on normal weather. */
export function SeasonOutlookBlock({ fieldId, u }: { fieldId: string; u: UnitSystem }) {
  const { data: o } = useQuery({
    queryKey: ['field_season_outlook', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase.from('field_season_outlook').select('*').eq('field_id', fieldId).maybeSingle()
      if (error) throw error
      return data
    },
  })
  if (!o) return <p className="text-xs text-gray-400">Worked out each morning once the field has a season and a crop curve.</p>
  const unit = conv.depthUnit(u)
  const pctGdd = o.maturity_gdd ? Math.min(100, Math.round((Number(o.gdd_to_date) / Number(o.maturity_gdd)) * 100)) : null
  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-gray-700">{o.note}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <dt className="text-gray-400">Heat units</dt>
          <dd className="font-medium tabular-nums">
            {Math.round(Number(o.gdd_to_date ?? 0))}
            {o.maturity_gdd ? ` / ${Math.round(Number(o.maturity_gdd))}` : ''}
            {pctGdd != null && <span className="text-gray-400"> · {pctGdd}%</span>}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Maturity</dt>
          <dd className="font-medium">{o.maturity_on ? md(o.maturity_on) : '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Still to apply</dt>
          <dd className="font-medium tabular-nums">
            {Number(o.need_more_mm) > 0 ? `${conv.depth(Number(o.need_more_mm), u, 0)} ${unit} net · ~${o.passes_left} passes` : 'nothing'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Last irrigation by</dt>
          <dd className="font-medium">{o.last_irrigation_by ? md(o.last_irrigation_by) : '—'}</dd>
        </div>
      </dl>
      <HelpNote
        className="text-xs"
        summary={
          <>
            Season total if that is applied: <b>{o.projected_season_in != null ? `${o.projected_season_in} in` : '—'}</b> gross. Worked out {md(o.computed_on)}.
          </>
        }
        title="How the rest of the season is worked out"
      >
        <p>
          Heat units are base 5 °C from planting (AIMM&apos;s GDD5); maturity is where AIMM&apos;s crop curve ends, or your harvest date. The rest of the season runs on
          AIMM&apos;s long-term normals for the station, letting the crop finish at 60% depleted.
        </p>
      </HelpNote>
    </div>
  )
}
