import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, RotateCw } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { conv, depthToMm, useUnitSystem, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { useDeleteDepthCheck, useUpdateDepthCheck } from '@/lib/irrigation'
import { depthCheckPatch } from '@/lib/irrigation-edits'
import { keepOpenOnError } from '@/lib/record-actions'
import type { Database } from '@/lib/database.types'
import {
  CORRECTION_MAX,
  CORRECTION_MIN,
  VERDICT_LABEL,
  assessPivot,
  clampCorrection,
  impliedCorrection,
  meterToDepth,
  panelMmAtSpeed,
  panelOffline,
  readPanel,
  seasonEffectMm,
  type FlowCheck,
  type MeterUnit,
  type Verdict,
} from '@/lib/pivot-depth'

type Check = Database['public']['Tables']['pivot_depth_checks']['Row']
type Method = Check['method']

const METHOD_LABEL: Record<Method, string> = {
  catch_can: 'Catch cans',
  flow_meter: 'Flow meter',
  pump_power: 'Pump power',
  other: 'Other',
}

const md = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })

/** A depth in the active unit, with the other one beside it (FieldNET thinks in inches). */
function Depth({ mm, u, className }: { mm: number | null | undefined; u: UnitSystem; className?: string }) {
  if (mm == null) return <span className="text-gray-400">—</span>
  const other: UnitSystem = u === 'metric' ? 'imperial' : 'metric'
  return (
    <span className={cn('tabular-nums', className)}>
      {conv.depth(mm, u, u === 'metric' ? 1 : 2)} {conv.depthUnit(u)}
      <span className="text-gray-400">
        {' '}
        ({conv.depth(mm, other, other === 'metric' ? 1 : 2)} {conv.depthUnit(other)})
      </span>
    </span>
  )
}

const VERDICT_STYLE: Record<Verdict, string> = {
  consistent: 'bg-green-100 text-green-800',
  check: 'bg-amber-100 text-amber-800',
  likely_wrong: 'bg-red-100 text-red-800',
}

function VerdictChip({ v }: { v: Verdict }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', VERDICT_STYLE[v])}>{VERDICT_LABEL[v]}</span>
}

const pct = (ratio: number) => `${ratio >= 1 ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(0)}%`
const signedDepth = (mm: number, u: UnitSystem) => `${mm >= 0 ? '+' : '−'}${conv.depth(Math.abs(mm), u, u === 'metric' ? 0 : 1)} ${conv.depthUnit(u)}`

function usePivotDepthData(year: number) {
  return useQuery({
    queryKey: ['pivot_depth_checks', year],
    queryFn: async () => {
      const [sys, piv, checks] = await Promise.all([
        supabase
          .from('fieldnet_systems')
          .select('fieldnet_id, name, field_id, raw, depth_correction, comms_status, panel_last_seen, fields(name)')
          .not('field_id', 'is', null)
          .order('name'),
        supabase.from('field_pivots').select('field_id, gpm, acres_irrigated'),
        supabase.from('pivot_depth_checks').select('*').order('checked_on', { ascending: false }).order('created_at', { ascending: false }),
      ])
      if (sys.error) throw sys.error
      if (piv.error) throw piv.error
      if (checks.error) throw checks.error

      // FieldNET water this season, a page at a time (13 pivots × a summer of days runs past one page).
      const events: { field_id: string; zone_id: string | null; date: string; gross_mm: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('irrigation_events')
          .select('field_id, zone_id, date, gross_mm')
          .eq('source', 'fieldnet')
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`)
          .order('id')
          .range(from, from + 999)
        if (error) throw error
        events.push(...data)
        if (data.length < 1000) break
      }
      // A zoned field gets one row per zone per day: take the whole-field row, else the zones' mean.
      const byDay = new Map<string, { whole: number | null; zones: number[] }>()
      for (const e of events) {
        const k = `${e.field_id}|${e.date}`
        const d = byDay.get(k) ?? { whole: null, zones: [] }
        const mm = Number(e.gross_mm ?? 0)
        if (e.zone_id) d.zones.push(mm)
        else d.whole = (d.whole ?? 0) + mm
        byDay.set(k, d)
      }
      const seasonMm = new Map<string, number>()
      for (const [k, d] of byDay) {
        const fieldId = k.split('|')[0]
        const mm = d.whole ?? (d.zones.length ? d.zones.reduce((a, b) => a + b, 0) / d.zones.length : 0)
        seasonMm.set(fieldId, (seasonMm.get(fieldId) ?? 0) + mm)
      }

      const pivots = new Map((piv.data ?? []).map((p) => [p.field_id, p]))
      return { systems: sys.data ?? [], pivots, checks: (checks.data ?? []) as Check[], seasonMm }
    },
  })
}

type Data = NonNullable<ReturnType<typeof usePivotDepthData>['data']>
type SystemRow = Data['systems'][number]

const fieldName = (s: SystemRow) => {
  const f = s.fields as { name: string } | { name: string }[] | null
  return Array.isArray(f) ? f[0]?.name : f?.name
}

/**
 * Is each pivot really putting down what FieldNET says? Every FieldNET depth
 * the irrigation model uses comes from the panel's depth chart; this compares
 * that chart with flow × time ÷ area, records field checks, and sets the
 * per-pivot correction that multiplies every FieldNET depth.
 */
export function PivotDepthChecks() {
  const u = useUnitSystem()
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [year] = useState(() => new Date().getFullYear())
  const [openedAt] = useState(() => Date.now())
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = usePivotDepthData(year)

  if (isLoading) return <p className="py-4 text-center text-xs text-gray-400">Reading FieldNET pivots…</p>
  if (error) return <p className="text-xs text-red-700">{(error as Error).message}</p>
  if (!data?.systems.length) return <p className="text-xs text-gray-500">No FieldNET pivot is linked to a field yet.</p>

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Pivot depth checks</h3>
        <InfoPopover title="What this compares" width={460}>
          <p>
            Every FieldNET depth the water balance uses comes from the panel&apos;s depth chart — the depth at 100% speed it was set up with. If the configured flow is
            wrong or the nozzles are worn, every number is quietly off by the same share.
          </p>
          <p>
            <b>Flow-based</b> is flow × time for one revolution at 100% ÷ the irrigated area (the farm&apos;s pivot record acres, else FieldNET&apos;s, else the wetted
            circle). With FieldNET&apos;s own flow it tests the panel&apos;s arithmetic; with the flow on the farm&apos;s pivot record it tests the flow itself.
          </p>
          <p>
            Within ±5% is consistent, 5–15% worth a check, beyond 15% likely wrong. Only a measurement in the field — catch cans or a flow meter — says which number is
            right; record it below and use it to set the correction.
          </p>
        </InfoPopover>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[920px] text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2 font-medium">Pivot</th>
              <th className="px-2 py-2 font-medium">Panel at 100%</th>
              <th className="px-2 py-2 font-medium">From FieldNET flow</th>
              <th className="px-2 py-2 font-medium">From record flow</th>
              <th className="px-2 py-2 font-medium">Latest check</th>
              <th className="px-2 py-2 text-right font-medium">Correction</th>
              <th className="px-2 py-2 text-right font-medium">Season effect</th>
            </tr>
          </thead>
          <tbody>
            {data.systems.map((s) => {
              const panel = readPanel(s.raw)
              const record = s.field_id ? data.pivots.get(s.field_id) : undefined
              const a = assessPivot(panel, record ? { gpm: record.gpm, acres: record.acres_irrigated } : null)
              const fnFlow = a.flows.find((f) => f.label === 'fieldnet')
              const recFlow = a.flows.find((f) => f.label === 'record')
              const checks = data.checks.filter((c) => c.fieldnet_id === s.fieldnet_id)
              const latest = checks[0]
              const corr = Number(s.depth_correction ?? 1)
              const season = s.field_id ? (data.seasonMm.get(s.field_id) ?? 0) : 0
              const effect = seasonEffectMm(season, corr)
              const offline = panelOffline(panel.commStatus ?? s.comms_status, panel.lastUpdated ?? s.panel_last_seen, openedAt)
              const isOpen = open === s.fieldnet_id
              return (
                <Fragment key={s.fieldnet_id}>
                  <tr
                    className={cn('cursor-pointer border-b border-gray-100 hover:bg-gray-50', isOpen && 'bg-gray-50')}
                    onClick={() => setOpen(isOpen ? null : s.fieldnet_id)}
                  >
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1 font-medium text-gray-900">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        {s.name ?? s.fieldnet_id}
                      </span>
                      <span className="ml-[18px] text-gray-500">{fieldName(s) ?? '—'}</span>
                      {offline && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                          <AlertTriangle className="h-3 w-3" /> panel offline
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Depth mm={a.panelMm} u={u} />
                    </td>
                    <td className="px-2 py-1.5">
                      <FlowCell f={fnFlow} u={u} />
                    </td>
                    <td className="px-2 py-1.5">
                      {recFlow ? (
                        <FlowCell f={recFlow} u={u} />
                      ) : (
                        <span className="text-gray-400">{record?.gpm ? 'same flow' : 'no gpm on record'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {latest ? (
                        <>
                          {md(latest.checked_on)} · {METHOD_LABEL[latest.method]}
                          {latest.panel_mm ? (
                            <span className="text-gray-400"> · ×{(Number(latest.measured_mm) / Number(latest.panel_mm)).toFixed(2)}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-gray-400">never checked</span>
                      )}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right font-medium tabular-nums', corr !== 1 ? 'text-brand-700' : 'text-gray-500')}>×{corr.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                      {corr === 1 ? (
                        <span className="text-gray-400">none</span>
                      ) : (
                        <span title={`${conv.depth(season, u)} ${conv.depthUnit(u)} of FieldNET water in ${year}`}>{signedDepth(effect, u)}</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-gray-200 bg-gray-50/60">
                      <td colSpan={7} className="px-3 py-3">
                        <PivotDetail
                          s={s}
                          a={a}
                          runTime100S={panel.runTime100S}
                          checks={checks}
                          corr={corr}
                          season={season}
                          year={year}
                          u={u}
                          isMgr={isMgr}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <HelpNote summary="Click a pivot to record a check or set its correction." title="Season effect">
        <p>
          Season effect is this year&apos;s FieldNET water on the field × (correction − 1): how much the correction adds to or takes off the balance. Click a pivot to
          record a check or set its correction.
        </p>
      </HelpNote>
    </div>
  )
}

function FlowCell({ f, u }: { f: FlowCheck | undefined; u: UnitSystem }) {
  if (!f) return <span className="text-gray-400">—</span>
  return (
    <span className="flex flex-col gap-0.5">
      <Depth mm={f.mm} u={u} />
      <span className="flex items-center gap-1 text-gray-500">
        {Math.round(f.gpm)} gpm · {pct(f.ratio)} <VerdictChip v={f.verdict} />
      </span>
    </span>
  )
}

const AREA_LABEL = { record: 'pivot record', fieldnet: 'FieldNET setup', radius: 'wetted circle' } as const

function PivotDetail({
  s,
  a,
  runTime100S,
  checks,
  corr,
  season,
  year,
  u,
  isMgr,
}: {
  s: SystemRow
  a: ReturnType<typeof assessPivot>
  runTime100S: number | null
  checks: Check[]
  corr: number
  season: number
  year: number
  u: UnitSystem
  isMgr: boolean
}) {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const setCorrection = useMutation({
    mutationFn: async (value: number) => {
      const { error } = await supabase.from('fieldnet_systems').update({ depth_correction: clampCorrection(value) }).eq('fieldnet_id', s.fieldnet_id)
      if (error) throw error
    },
    onSuccess: () => {
      setTyped('')
      void qc.invalidateQueries({ queryKey: ['pivot_depth_checks'] })
      void qc.invalidateQueries({ queryKey: ['fieldnet_systems'] })
    },
  })
  const [editing, setEditing] = useState<Check | null>(null)
  const latest = checks[0]
  const implied = latest ? impliedCorrection(Number(latest.measured_mm), latest.panel_mm != null ? Number(latest.panel_mm) : null) : null
  const proposed = implied != null ? clampCorrection(implied) : null

  return (
    <div className="space-y-3 text-xs">
      <p className="text-gray-600">
        {a.area ? (
          <>
            Area <b>{a.area.acres.toFixed(1)} ac</b> from the {AREA_LABEL[a.area.source]}
          </>
        ) : (
          'No irrigated area known'
        )}
        {a.arcFrac < 1 && <> · waters {Math.round(a.arcFrac * 360)}° of the circle</>}
        {runTime100S != null && <> · {(runTime100S / 3600).toFixed(1)} h a revolution at 100%</>}
        {a.flowGap != null && Math.abs(a.flowGap) > 0.005 && (
          <>
            {' '}
            · the pivot record&apos;s flow is <b>{Math.abs(a.flowGap * 100).toFixed(0)}% {a.flowGap < 0 ? 'below' : 'above'}</b> FieldNET&apos;s
          </>
        )}
        .
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-700">Correction ×{corr.toFixed(2)}</span>
        <span className="text-gray-500">
          {corr === 1 ? (
            'FieldNET depths are used as reported.'
          ) : (
            <>
              moves {year}&apos;s <Depth mm={season} u={u} /> of FieldNET water by <b>{signedDepth(seasonEffectMm(season, corr), u)}</b>.
            </>
          )}
        </span>
        {isMgr && proposed != null && Math.abs(proposed - corr) >= 0.005 && (
          <button
            type="button"
            disabled={setCorrection.isPending}
            onClick={() => setCorrection.mutate(proposed)}
            className="rounded-md bg-sky-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
          >
            Use {proposed.toFixed(2)} as this pivot&apos;s correction
          </button>
        )}
        {isMgr && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const v = Number(typed)
              if (typed !== '' && Number.isFinite(v) && v > 0) setCorrection.mutate(v)
            }}
          >
            <input
              type="number"
              step="0.01"
              min={CORRECTION_MIN}
              max={CORRECTION_MAX}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="e.g. 0.92"
              aria-label="Correction"
              className="w-20 rounded-md border border-gray-300 px-2 py-0.5"
            />
            <button type="submit" disabled={typed === '' || setCorrection.isPending} className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              Set
            </button>
            {corr !== 1 && (
              <button
                type="button"
                disabled={setCorrection.isPending}
                onClick={() => setCorrection.mutate(1)}
                className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Reset to 1
              </button>
            )}
          </form>
        )}
        {setCorrection.isPending && <RotateCw className="h-3.5 w-3.5 animate-spin text-gray-400" />}
        {setCorrection.isSuccess && <span className="text-green-700">Saved — applies from the next hourly FieldNET rebuild and the morning model run.</span>}
        {setCorrection.isError && <span className="text-red-700">{(setCorrection.error as Error).message}</span>}
      </div>

      {isMgr && <CheckForm s={s} panelMm100={a.panelMm} acres={a.area?.acres ?? null} arcFrac={a.arcFrac} runTime100S={runTime100S} u={u} />}

      <div>
        <p className="mb-1 font-medium text-gray-700">Past checks</p>
        {checks.length === 0 ? (
          <p className="text-gray-400">No checks recorded for this pivot.</p>
        ) : (
          <table className="w-full max-w-2xl">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-0.5 font-medium">Date</th>
                <th className="py-0.5 font-medium">Method</th>
                <th className="py-0.5 text-right font-medium">Speed</th>
                <th className="py-0.5 text-right font-medium">Panel</th>
                <th className="py-0.5 text-right font-medium">Measured</th>
                <th className="py-0.5 text-right font-medium">Implied</th>
                <th className="py-0.5 pl-3 font-medium">Note</th>
                {isMgr && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checks.map((c) => {
                const imp = impliedCorrection(Number(c.measured_mm), c.panel_mm != null ? Number(c.panel_mm) : null)
                return (
                  <tr key={c.id}>
                    <td className="py-0.5 text-gray-700">{md(c.checked_on)}</td>
                    <td className="py-0.5 text-gray-600">{METHOD_LABEL[c.method]}</td>
                    <td className="py-0.5 text-right tabular-nums">{c.speed_pct != null ? `${Number(c.speed_pct)}%` : '—'}</td>
                    <td className="py-0.5 text-right">
                      <Depth mm={c.panel_mm != null ? Number(c.panel_mm) : null} u={u} />
                    </td>
                    <td className="py-0.5 text-right">
                      <Depth mm={Number(c.measured_mm)} u={u} />
                    </td>
                    <td className="py-0.5 text-right tabular-nums">{imp != null ? `×${imp.toFixed(2)}` : '—'}</td>
                    <td className="py-0.5 pl-3 text-gray-500">{c.note ?? ''}</td>
                    {isMgr && (
                      <td className="py-0.5 pl-2 text-right">
                        <EditButton onClick={() => setEditing(c)} />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && <EditCheck check={editing} panel100Mm={a.panelMm} u={u} onClose={() => setEditing(null)} />}
    </div>
  )
}

/**
 * Correct or remove a recorded check (Sam, 7 Oct 2026). Managers only, as
 * pivot_depth_checks is manager-write. The pivot's correction is set on the
 * pivot, above, so changing a check leaves it as it is.
 */
function EditCheck({ check, panel100Mm, u, onClose }: { check: Check; panel100Mm: number | null; u: UnitSystem; onClose: () => void }) {
  const update = useUpdateDepthCheck()
  const del = useDeleteDepthCheck()
  const unit = conv.depthUnit(u)
  const fields: EditField[] = [
    { key: 'checked_on', label: 'Date', kind: 'date', required: true },
    { key: 'method', label: 'Method', kind: 'select', options: (Object.keys(METHOD_LABEL) as Method[]).map((m) => ({ value: m, label: METHOD_LABEL[m] })) },
    { key: 'speed_pct', label: 'Speed %', kind: 'number', step: '1', hint: "The panel's depth for the check follows a changed speed." },
    { key: 'measured', label: `Measured (${unit} gross)`, kind: 'number', step: '0.01', required: true },
    { key: 'note', label: 'Note', kind: 'textarea' },
  ]
  // The depth is shown in the reader's unit, rounded, rather than as mm × a scale.
  const row = { ...check, measured: conv.depth(Number(check.measured_mm), u, 2) }
  const err = update.error ?? del.error
  return (
    <RecordEditModal
      title={`Depth check — ${md(check.checked_on)}`}
      fields={fields}
      row={row as unknown as Record<string, unknown>}
      onClose={onClose}
      onSave={(p) => {
        const measured = p.measured as number | null
        if (measured == null || !(measured > 0)) return Promise.reject(new Error('Enter the measured depth.'))
        return update.mutateAsync({
          id: check.id,
          patch: depthCheckPatch(
            { speed_pct: check.speed_pct, panel_mm: check.panel_mm },
            {
              checked_on: String(p.checked_on),
              method: (p.method as Method | null) ?? check.method,
              speed_pct: p.speed_pct as number | null,
              measured_mm: depthToMm(measured, u),
              note: (p.note as string | null) ?? null,
            },
            panel100Mm,
          ) as Partial<Check>,
        })
      }}
      onDelete={() => keepOpenOnError(del.mutateAsync(check.id))}
      deleteConfirm={`Delete the ${METHOD_LABEL[check.method].toLowerCase()} check of ${md(check.checked_on)}? The pivot's correction stays as it is.`}
      saving={update.isPending || del.isPending}
      error={err ? (err as Error).message : null}
    />
  )
}

function CheckForm({
  s,
  panelMm100,
  acres,
  arcFrac,
  runTime100S,
  u,
}: {
  s: SystemRow
  panelMm100: number | null
  acres: number | null
  arcFrac: number
  runTime100S: number | null
  u: UnitSystem
}) {
  const qc = useQueryClient()
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [method, setMethod] = useState<Method>('catch_can')
  const [speed, setSpeed] = useState('50')
  const [measured, setMeasured] = useState('')
  const [note, setNote] = useState('')
  const [vol, setVol] = useState('')
  const [volUnit, setVolUnit] = useState<MeterUnit>('usgal')
  const [hours, setHours] = useState('')
  const unit = conv.depthUnit(u)

  const speedPct = speed === '' ? 100 : Number(speed)
  const panelMm = panelMmAtSpeed(panelMm100, speedPct)
  const measuredMm = measured === '' ? null : depthToMm(Number(measured), u)
  const implied = impliedCorrection(measuredMm, panelMm)
  const meter = method === 'flow_meter' && vol !== '' && hours !== '' ? meterToDepth({ volume: Number(vol), unit: volUnit, hours: Number(hours), acres, runTime100S, arcFrac, speedPct }) : null

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('pivot_depth_checks').insert({
        fieldnet_id: s.fieldnet_id,
        field_id: s.field_id,
        checked_on: date,
        method,
        speed_pct: Number.isFinite(speedPct) && speedPct > 0 ? speedPct : null,
        panel_mm: panelMm != null ? Math.round(panelMm * 100) / 100 : null,
        measured_mm: Math.round(measuredMm! * 100) / 100,
        note: note.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMeasured('')
      setNote('')
      setVol('')
      setHours('')
      void qc.invalidateQueries({ queryKey: ['pivot_depth_checks'] })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (measuredMm != null && measuredMm > 0) save.mutate()
      }}
      className="space-y-2 rounded-md border border-gray-200 bg-white p-2.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-gray-700">Record a check</span>
        <InfoPopover title="Catch-can check" width={420}>
          <p>
            Set a straight line of at least 10 identical cans along the pivot, from the second span outward, equally spaced. Ignore the first span (it covers too little
            ground to matter and reads high); check the end-gun zone separately.
          </p>
          <p>Run the pivot over the line at a known speed, read every can straight away (before it evaporates), and average them. That average is the gross depth.</p>
          <p>
            Enter the speed and the average here. The panel&apos;s depth for that speed is worked out for you; the measured ÷ panel ratio is the correction. A flow meter
            works too: volume over hours gives the real flow, and the depth one pass puts down at that flow.
          </p>
          <p>A new correction applies from the next hourly FieldNET rebuild and the next morning&apos;s model run.</p>
        </InfoPopover>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-gray-500">
          Date
          <DateField value={date} onChange={setDate} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
        </label>
        <label className="flex flex-col gap-0.5 text-gray-500">
          Method
          <Select
            value={method}
            size="sm"
            ariaLabel="Method"
            className="w-32"
            onChange={(v) => {
              setMethod(v as Method)
              if (v === 'flow_meter' && speed === '50') setSpeed('100')
            }}
            options={(Object.keys(METHOD_LABEL) as Method[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-gray-500">
          Speed %
          <input
            type="number"
            step="1"
            min="1"
            max="100"
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            className="w-16 rounded-md border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-gray-500">
          Measured ({unit} gross)
          <input
            type="number"
            step="0.01"
            min="0"
            value={measured}
            onChange={(e) => setMeasured(e.target.value)}
            placeholder={method === 'catch_can' ? 'can average' : unit}
            className="w-24 rounded-md border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5 text-gray-500">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="cans, spans, wind…" className="rounded-md border border-gray-300 px-2 py-1" />
        </label>
        <button type="submit" disabled={save.isPending || measuredMm == null || !(measuredMm > 0)} className="rounded-md bg-sky-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50">
          Save check
        </button>
      </div>

      {method === 'flow_meter' && (
        <div className="flex flex-wrap items-end gap-2 rounded bg-sky-50 px-2 py-1.5">
          <span className="text-gray-600">Meter helper:</span>
          <input
            type="number"
            step="any"
            min="0"
            value={vol}
            onChange={(e) => setVol(e.target.value)}
            placeholder="volume"
            aria-label="Meter volume"
            className="w-24 rounded-md border border-gray-300 px-2 py-0.5"
          />
          <Select
            value={volUnit}
            size="sm"
            ariaLabel="Volume unit"
            className="w-24"
            onChange={(v) => setVolUnit(v as MeterUnit)}
            options={[
              { value: 'usgal', label: 'US gal' },
              { value: 'm3', label: 'm³' },
            ]}
          />
          <span className="text-gray-600">over</span>
          <input
            type="number"
            step="any"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="hours"
            aria-label="Hours"
            className="w-20 rounded-md border border-gray-300 px-2 py-0.5"
          />
          {meter && (
            <span className="text-gray-600">
              = <b>{Math.round(meter.gpm)} gpm</b> ({meter.litresPerS.toFixed(1)} L/s)
              {meter.onFieldMm != null && (
                <>
                  {' '}
                  · <Depth mm={meter.onFieldMm} u={u} /> over the field in those hours
                </>
              )}
              {meter.perPassMm != null && (
                <>
                  {' '}
                  · one pass at {speedPct}% = <Depth mm={meter.perPassMm} u={u} />{' '}
                  <button
                    type="button"
                    onClick={() => setMeasured(conv.depth(meter.perPassMm, u, 2))}
                    className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-gray-700 hover:bg-gray-50"
                  >
                    Use as measured
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      )}

      <p className="text-gray-600">
        Panel says <Depth mm={panelMm} u={u} /> at {Number.isFinite(speedPct) ? speedPct : '—'}%
        {implied != null && (
          <>
            {' '}
            → implied correction <b>×{implied.toFixed(2)}</b>
            {(implied < CORRECTION_MIN || implied > CORRECTION_MAX) && <span className="text-red-700"> (outside 0.5–1.5 — recheck the reading)</span>}
          </>
        )}
        .
      </p>
      {save.isSuccess && <p className="text-green-700">Saved. Use the button above to apply its correction.</p>}
      {save.isError && <p className="text-red-700">{(save.error as Error).message}</p>}
    </form>
  )
}
