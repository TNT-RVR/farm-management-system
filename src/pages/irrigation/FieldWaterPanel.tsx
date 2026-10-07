import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarCog, CloudRain, Droplets, FlaskConical, Gauge, Hourglass, Layers, RotateCw, Waves } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { STATUS_COLOR, STATUS_LABEL, useFieldSeasons, useForecastCrossings, useLatestBalance, useSeasonEtTotals } from '@/lib/irrigation'
import { conv, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { allocationRows, FieldAllocation, SmridAllotment, useAllocation, VERDICT } from './AllocationTab'
import { FieldWaterRights, useWaterRightsView } from './WaterRights'
import { PanelOfflineWarning, PivotBlock, RainBlock, SeasonInputs, usePivotInfo } from './FieldExtras'
import { SeasonOutlookBlock, SoilCalibrationBlock, SoilReadingsBlock } from './FieldAimmBlocks'
import { HandEventActions } from './HandEventActions'
import { DetailList, rowClick } from '@/components/RecordEditor'

/** Every irrigation event on one field in a year, newest first. */
export function useFieldEvents(fieldId: string, year: number) {
  return useQuery({
    queryKey: ['irrigation_events', fieldId, year],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('irrigation_events')
        .select('id, field_id, date, gross_mm, net_mm, source, fieldnet_ref, created_by, zone_id, coverage_deg, note, source_gross_mm, adjusted_gross_mm, adjusted_note, adjusted_at')
        .eq('field_id', fieldId)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/**
 * Everything the old Records and Allocation tabs said, for one field: where
 * the soil is today, the water put on it, the water left to put on it, and
 * the right it comes under. The Graph page and its PDF both read this.
 */
export function useFieldWater(fieldId: string, year: number) {
  const { data: balance, isLoading: balanceLoading } = useLatestBalance()
  const { data: crossings, isLoading: crossingsLoading } = useForecastCrossings()
  const { data: seasonEt, isLoading: etLoading } = useSeasonEtTotals(year)
  const alloc = useAllocation(year)
  const rights = useWaterRightsView(year)
  const { data: events, isLoading: eventsLoading } = useFieldEvents(fieldId, year)
  const [seasonEnd, setSeasonEnd] = useState(`${year}-10-15`)
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))
  const allocRow = useMemo(
    () => allocationRows(alloc.data, today, seasonEnd).find((r) => r.fieldId === fieldId) ?? null,
    [alloc.data, today, seasonEnd, fieldId],
  )
  return {
    latest: balance?.find((b) => b.field_id === fieldId) ?? null,
    crossing: crossings?.get(fieldId) ?? null,
    seasonEt: seasonEt?.get(fieldId) ?? null,
    events: events ?? [],
    eventsLoading,
    allocRow,
    allocLoading: alloc.isLoading,
    smrid: alloc.data?.smrid ?? null,
    allotments: alloc.data?.allotments ?? [],
    rights: rights.view,
    thisSeason: rights.thisSeason,
    seasonEnd,
    setSeasonEnd,
    /** Everything above has answered: what a report made off-screen waits for. */
    ready: !balanceLoading && !crossingsLoading && !etLoading && !alloc.isLoading && !rights.isLoading && !eventsLoading,
  }
}
export type FieldWater = ReturnType<typeof useFieldWater>

const md = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

function Section({ icon, title, children, wide }: { icon: ReactNode; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={cn('rounded-lg border border-gray-200 bg-white p-3', wide && 'lg:col-span-2')}>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        {icon} {title}
      </h3>
      {children}
    </section>
  )
}

function StatusBlock({ w, u, fieldId }: { w: FieldWater; u: UnitSystem; fieldId: string }) {
  const b = w.latest
  if (!b)
    return (
      <p className="text-xs text-gray-400">
        No balance for this field in the last 30 days. It needs a planting date, then Sync.{' '}
        <SetupLink to={SETUP_LINKS.plantingDate(fieldId)}>Set the planting date</SetupLink>
      </p>
    )
  const rawUsed = b.raw_mm && b.dr_mm != null ? Math.min(100, (b.dr_mm / b.raw_mm) * 100) : 0
  const unit = conv.depthUnit(u)
  const needsWater = b.status === 'now' || b.status === 'stress'
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 font-medium', STATUS_COLOR[b.status ?? 'ok'])}>{STATUS_LABEL[b.status ?? 'ok']}</span>
        <span className="text-gray-400">as of {md(b.date)}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={cn('h-full rounded-full', rawUsed >= 100 ? 'bg-red-500' : rawUsed >= 75 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${rawUsed}%` }} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div title="How far the root zone has dried from field capacity, against the most it can dry before the crop is stressed (RAW)">
          <dt className="text-gray-400">Depletion</dt>
          <dd className="font-medium tabular-nums">
            {conv.depth(b.dr_mm, u)} <span className="text-gray-400">/ {conv.depth(b.raw_mm, u)} {unit}</span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-400" title="What the crop used today (ETc)">Crop use today</dt>
          <dd className="font-medium tabular-nums">
            {conv.depth(b.etc_mm, u, 1)} {unit}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">{needsWater ? 'Apply' : 'Days left'}</dt>
          <dd className="font-medium tabular-nums">{needsWater ? `${conv.depth(b.rec_gross_mm ?? 0, u)} ${unit}` : (b.days_to_irrigate ?? '—')}</dd>
        </div>
        <div>
          <dt className="text-gray-400" title="What the crop has used since planting (ETc)">Crop use, season</dt>
          <dd className="font-medium tabular-nums">{w.seasonEt != null ? `${conv.depth(w.seasonEt, u, 0)} ${unit}` : '—'}</dd>
        </div>
      </dl>
      {!needsWater && (
        <p className="mt-2 rounded bg-sky-50 px-2 py-1 text-sky-900">
          {w.crossing ? (
            <>
              Forecast: needs water <b>{md(w.crossing.date)}</b>
              {w.crossing.recGross ? ` · ~${conv.depth(Number(w.crossing.recGross), u, 0)} ${unit}` : ''}
            </>
          ) : (
            'Forecast: no irrigation needed in the next 7 days'
          )}
        </p>
      )}
    </div>
  )
}

function AppliedBlock({ fieldId, w, u, year }: { fieldId: string; w: FieldWater; u: UnitSystem; year: number }) {
  const { data: pivot } = usePivotInfo(fieldId, year)
  const { data: seasons } = useFieldSeasons(year)
  // Net is what the model counts as reaching the root zone: the gross depth
  // times the pivot's efficiency (the season's own figure first). FieldNET
  // only reports gross, so this is worked out, not stored.
  const season = seasons?.find((s) => s.field_id === fieldId && s.active)
  const eff = Number(season?.application_efficiency ?? pivot?.pivot?.application_efficiency ?? 0.85) || 0.85
  const netOf = (e: { gross_mm: number | null; net_mm: number | null }) => (e.net_mm != null ? Number(e.net_mm) : e.gross_mm != null ? Number(e.gross_mm) * eff : null)
  const unit = conv.depthUnit(u)
  const total = w.events.reduce((a, e) => a + Number(e.gross_mm ?? e.net_mm ?? 0), 0)
  const totalNet = w.events.reduce((a, e) => a + (netOf(e) ?? 0), 0)
  const [showAll, setShowAll] = useState(false)
  const [openEvent, setOpenEvent] = useState<string | null>(null)
  const shown = showAll ? w.events : w.events.slice(0, 8)
  const dp = 1
  const adjustedCount = w.events.filter((e) => e.adjusted_gross_mm != null).length
  if (w.eventsLoading) return <p className="py-3 text-center text-xs text-gray-400">Reading the season&apos;s irrigation…</p>
  return (
    <div className="text-xs">
      <p className="text-gray-600">
        {w.events.length} application{w.events.length === 1 ? '' : 's'} in {year}: <b>{conv.depth(total, u)} {unit}</b> gross,{' '}
        <b>{conv.depth(totalNet, u)} {unit}</b> net into the soil.
        {adjustedCount > 0 && <span className="text-amber-700"> {adjustedCount} corrected by hand.</span>}
      </p>
      {w.events.length > 0 && (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full min-w-[320px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-0.5 font-medium">Date</th>
                <th className="py-0.5 text-right font-medium">Gross ({unit})</th>
                <th className="py-0.5 text-right font-medium" title={`Gross × the pivot's ${Math.round(eff * 100)}% application efficiency — what the model counts as reaching the root zone`}>
                  Net ({unit})
                </th>
                <th className="py-0.5 pl-3 font-medium">From</th>
                <th className="py-0.5 text-right font-medium" title="Degrees of the circle FieldNET recorded water on that day">Covered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((e) => (
                <Fragment key={e.id}>
                <tr
                  className={cn('cursor-pointer hover:bg-gray-50', e.adjusted_gross_mm != null && 'bg-amber-50/60', openEvent === e.id && 'bg-gray-50')}
                  onClick={rowClick(() => setOpenEvent(openEvent === e.id ? null : e.id))}
                >
                  <td className="py-0.5 text-gray-700">{md(e.date)}</td>
                  <td className="py-0.5 text-right tabular-nums" title={e.adjusted_gross_mm != null ? `Corrected from ${conv.depth(e.source_gross_mm, u, dp)} ${unit}${e.adjusted_note ? ` — ${e.adjusted_note}` : ''}` : undefined}>
                    {conv.depth(e.gross_mm, u, dp)}
                    {e.adjusted_gross_mm != null && <span className="text-amber-700">*</span>}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-gray-500">{conv.depth(netOf(e), u, dp)}</td>
                  <td className="py-0.5 pl-3 text-gray-500">{e.source === 'fieldnet' ? 'FieldNET' : e.source === 'manual' ? 'logged by hand' : e.source}</td>
                  <td className="py-0.5 text-right tabular-nums text-gray-500">{e.coverage_deg != null ? `${e.coverage_deg}°` : ''}</td>
                </tr>
                {/* The pass in full, and for one logged by hand its Edit and
                    Delete (Sam, 7 Oct 2026). */}
                {openEvent === e.id && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={5} className="px-2 pb-2 pt-1">
                      <DetailList
                        className="text-xs"
                        rows={[
                          ['From', e.source === 'fieldnet' ? 'FieldNET' : e.source === 'manual' ? 'logged by hand' : e.source],
                          ['Gross', `${conv.depth(e.gross_mm, u, 2)} ${unit}`],
                          [
                            'Corrected',
                            e.adjusted_gross_mm != null
                              ? `from ${conv.depth(e.source_gross_mm, u, 2)} ${unit}${e.adjusted_note ? ` — ${e.adjusted_note}` : ''}${e.adjusted_at ? ` (${new Date(e.adjusted_at).toLocaleDateString('en-CA')})` : ''}`
                              : null,
                          ],
                          ['Net', netOf(e) != null ? `${conv.depth(netOf(e), u, 2)} ${unit}` : null],
                          ['Covered', e.coverage_deg != null ? `${e.coverage_deg}° of the circle` : null],
                          ['Note', e.note],
                        ]}
                      />
                      <span className="mt-1.5 flex flex-wrap items-center gap-1 empty:hidden">
                        <HandEventActions e={e} u={u} />
                      </span>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {w.events.length > 8 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-1 text-[11px] text-brand-700 underline">
              {showAll ? 'show fewer' : `show all ${w.events.length}`}
            </button>
          )}
        </div>
      )}
      <HelpNote className="mt-1.5" summary={<>Net = gross × {Math.round(eff * 100)}% efficiency · * corrected by hand</>} title="Gross and net">
        <p>
          Net = gross × {Math.round(eff * 100)}% application efficiency. Amounts wrong? Use &ldquo;Adjust irrigation amounts&rdquo; at the top. * corrected by hand.
        </p>
      </HelpNote>
    </div>
  )
}

const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))

/**
 * The selected field's records, water use and water right, under its graph.
 *
 * Today and the water applied stay open — they are what the page is opened
 * for. Records, the model's inputs and the water allowance fold to a line that
 * says what is inside, and the choice is remembered on the device.
 */
export function FieldWaterPanel({ fieldId, w, u, year, fc }: { fieldId: string; w: FieldWater; u: UnitSystem; year: number; fc: number | null }) {
  const onCanal = w.rights?.canal.some((c) => c.fieldId === fieldId) ?? false
  const a = w.allocRow
  const allowanceSummary = a
    ? `${n1(a.usedInches)} in used${a.allottedInches != null ? ` of ${n1(a.allottedInches)} in` : ''} · ${VERDICT[a.verdict].label}`
    : w.allocLoading
      ? undefined
      : 'no pivot linked'
  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Section icon={<Gauge className="h-4 w-4 text-brand-700" />} title="Today">
          <StatusBlock w={w} u={u} fieldId={fieldId} />
        </Section>
        <Section icon={<Droplets className="h-4 w-4 text-sky-500" />} title={`Irrigation applied ${year}`}>
          {/* A silent panel is a warning about the data, so it stays in view
              while Records — where the pivot's own card lives — is folded. */}
          <PanelOfflineWarning fieldId={fieldId} year={year} className="mb-2" />
          <AppliedBlock fieldId={fieldId} w={w} u={u} year={year} />
        </Section>
        <Section icon={<Hourglass className="h-4 w-4 text-amber-700" />} title="Rest of the season" wide>
          <SeasonOutlookBlock fieldId={fieldId} u={u} />
        </Section>
      </div>
      <Fold
        title={
          <span className="inline-flex items-center gap-1.5">
            <Waves className="h-4 w-4 text-sky-700" /> Water allowance {year}
          </span>
        }
        summary={allowanceSummary}
        storageKey="irr-field-allowance"
      >
        <div className="space-y-2">
          <FieldAllocation row={w.allocRow} seasonEnd={w.seasonEnd} setSeasonEnd={w.setSeasonEnd} loading={w.allocLoading} />
          <FieldWaterRights fieldId={fieldId} view={w.rights} thisSeason={w.thisSeason} year={year} />
          {onCanal && w.smrid && <SmridAllotment year={year} smrid={w.smrid} allotments={w.allotments} />}
        </div>
      </Fold>
      <Fold title="Records" summary="rain, pivot passes and measured soil moisture" storageKey="irr-field-records">
        <div className="grid gap-3 lg:grid-cols-2">
          <Section icon={<CloudRain className="h-4 w-4 text-sky-600" />} title={`Rain ${year}`}>
            <RainBlock fieldId={fieldId} year={year} u={u} />
          </Section>
          <Section icon={<RotateCw className="h-4 w-4 text-sky-700" />} title="Pivot & passes (FieldNET)">
            <PivotBlock fieldId={fieldId} year={year} u={u} />
          </Section>
          <Section icon={<FlaskConical className="h-4 w-4 text-emerald-700" />} title="Measured soil moisture" wide>
            <SoilReadingsBlock fieldId={fieldId} year={year} u={u} />
          </Section>
        </div>
      </Fold>
      <Fold title="Model inputs" summary="soil, calibration, spring moisture and harvest date" storageKey="irr-field-inputs">
        <div className="grid gap-3 lg:grid-cols-2">
          <Section icon={<Layers className="h-4 w-4 text-stone-600" />} title="Soil & calibration">
            <SoilCalibrationBlock fieldId={fieldId} year={year} u={u} />
          </Section>
          <Section icon={<CalendarCog className="h-4 w-4 text-gray-600" />} title="Season inputs">
            <SeasonInputs fieldId={fieldId} year={year} u={u} fc={fc} />
          </Section>
        </div>
      </Fold>
    </div>
  )
}
