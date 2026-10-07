import { lazy, Suspense, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { STATUS_COLOR, STATUS_LABEL, useFieldSeasons, useForecastCrossings, useLatestBalance, useSeasonTotals } from '@/lib/irrigation'
import { useFieldnetByField } from '@/lib/fieldnet'
import { conv, useUnitSystem, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { ColumnHelp } from '@/components/ColumnHelp'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { OVERVIEW_HELP } from '@/lib/irrigation-overview-help'
import { allocationRows, useAllocation, VERDICT } from './AllocationTab'
import { IrrigationPlanner } from './IrrigationPlanner'

const WaterSeasonReview = lazy(() => import('./WaterSeasonReview').then((m) => ({ default: m.WaterSeasonReview })))

const md = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * A depth in the chosen unit. The other unit is on hover only — the Metric /
 * Imperial toggle above the tabs switches the whole page.
 */
function Depth({ mm, u, strong }: { mm: number | null; u: UnitSystem; strong?: boolean }) {
  if (mm == null) return <span className="text-gray-300">—</span>
  const other: UnitSystem = u === 'metric' ? 'imperial' : 'metric'
  return (
    <span className={cn('tabular-nums', strong && 'font-semibold')} title={`${conv.depth(mm, other, other === 'metric' ? 0 : 1)} ${conv.depthUnit(other)}`}>
      {conv.depth(mm, u, u === 'metric' ? 0 : 1)} {conv.depthUnit(u)}
    </span>
  )
}

/**
 * Every irrigated field on one screen: where its soil water stands, the water
 * it has had this year from rain and from the pivot, how much it is allowed,
 * and when its pivot last ran. A row opens that field's Detailed View.
 */
export function IrrigationOverview({ year, onOpenField }: { year: number; onOpenField: (fieldId: string) => void }) {
  const u = useUnitSystem()
  const { data: fields } = useFields()
  const { data: seasons, isLoading: seasonsLoading } = useFieldSeasons(year)
  const { data: plans } = useCropPlans(year)
  const { data: crops } = useCrops()
  const { data: latest } = useLatestBalance()
  const { data: crossings } = useForecastCrossings()
  const { data: totals, isLoading: totalsLoading } = useSeasonTotals(year)
  const alloc = useAllocation(year)
  const { byField: fieldnet } = useFieldnetByField()
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'))

  const rows = useMemo(() => {
    const withSeason = new Set((seasons ?? []).filter((s) => s.active).map((s) => s.field_id))
    const allocBy = new Map(allocationRows(alloc.data, today, `${year}-10-15`).map((r) => [r.fieldId, r]))
    const lastEvent = new Map<string, string>()
    for (const e of alloc.data?.events ?? []) {
      if (Number(e.gross_mm ?? e.net_mm ?? 0) <= 0) continue
      if (!lastEvent.has(e.field_id) || e.date > lastEvent.get(e.field_id)!) lastEvent.set(e.field_id, e.date)
    }
    return (fields ?? [])
      .filter((f) => f.active && withSeason.has(f.id))
      .map((f) => {
        const b = latest?.find((x) => x.field_id === f.id) ?? null
        const t = totals?.get(f.id) ?? null
        const a = allocBy.get(f.id) ?? null
        const grossMm = a ? a.usedInches * 25.4 : null
        // Allowed: the inches allotment where there is one, else the licence share spread over the pivot's acres.
        const allowedIn = a?.allottedInches ?? (a?.licenceAcreFeet != null && a.acres ? (a.licenceAcreFeet * 12) / a.acres : null)
        const sys = fieldnet.get(f.id)
        const crop = [
          ...new Set(
            (plans ?? [])
              .filter((p) => p.field_id === f.id)
              .sort((x, y) => Number(y.planned_acres ?? 0) - Number(x.planned_acres ?? 0))
              .map((p) => crops?.find((c) => c.id === p.crop_id)?.name)
              .filter((x): x is string => Boolean(x)),
          ),
        ].join(', ')
        // Marked finished for the season (Fields → done watering): the model
        // does not know the pivot is shut off, so its "irrigate now" late in
        // the year is not a call to act — the to-dos are already held back.
        const done = (seasons ?? []).some((s) => s.field_id === f.id && s.active && s.irrigation_done_at)
        return {
          id: f.id,
          name: f.name,
          crop: crop || null,
          status: b?.status ?? null,
          done,
          // No FieldNET panel on the field, or one that logs no depth, means
          // irrigation only shows if it is logged by hand.
          unlogged: !(grossMm ?? 0) ? (sys ? 'FieldNET logged none' : 'no FieldNET panel') : null,
          statusAsOf: b?.date ?? null,
          rainMm: t?.rainMm ?? null,
          grossMm,
          totalMm: t || grossMm != null ? (t?.rainMm ?? 0) + (grossMm ?? 0) : null,
          etcMm: t?.etcMm ?? null,
          allowedMm: allowedIn != null ? allowedIn * 25.4 : null,
          pct: a ? (a.inchesPct ?? a.licencePct) : null,
          verdict: a?.verdict ?? null,
          last: lastEvent.get(f.id) ?? null,
          running: Boolean(sys?.is_water_on),
          next: crossings?.get(f.id)?.date ?? null,
        }
      })
      .sort((x, y) => Number(x.done) - Number(y.done) || rank(x.status) - rank(y.status) || x.name.localeCompare(y.name))
  }, [fields, seasons, latest, totals, alloc.data, today, year, fieldnet, plans, crops, crossings])

  const loading = seasonsLoading || totalsLoading || alloc.isLoading
  // What a folded table must still say: fields whose irrigation is not being
  // recorded, and fields at or heading past their water allowance.
  const unloggedCount = rows.filter((r) => r.unlogged && !r.done).length
  const shortCount = rows.filter((r) => r.verdict === 'over' || r.verdict === 'will_run_out').length
  const foldSummary = loading
    ? undefined
    : [
        `${rows.length} field${rows.length === 1 ? '' : 's'}`,
        unloggedCount ? `${unloggedCount} with no irrigation logged` : null,
        shortCount ? `${shortCount} over or on pace to run out of water allowance` : null,
      ]
        .filter(Boolean)
        .join(' · ')

  return (
    <div className="space-y-3">
      {/* The week's plan is the main table: it says what to do. The season
          totals below are the record behind it, folded until wanted. */}
      <IrrigationPlanner year={year} onPickField={onOpenField} />

      <Fold title={`Water so far, every field ${year}`} summary={foldSummary} storageKey="irr-overview-totals">
        <p className="text-xs text-gray-500">Most in need of water first. Tap a field for its Detailed View.</p>
        {loading ? (
          <p className="py-6 text-center text-xs text-gray-400">Adding up the season…</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-xs text-gray-500">No field has an irrigation season set up for {year}. <SetupLink to={SETUP_LINKS.plantingDate()}>Add planting dates</SetupLink></p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-1 pr-2 font-medium">Field</th>
                  <Th help="status">Status</Th>
                  <Th help="total" right>
                    Total water
                  </Th>
                  <Th help="rain" right>
                    Rain
                  </Th>
                  <Th help="irrigation" right>
                    Irrigation
                  </Th>
                  <Th help="cropUsed" right>
                    Crop used
                  </Th>
                  <Th help="lastOn">Pivot last on</Th>
                  <Th help="needs">Needs water</Th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => onOpenField(r.id)} className="cursor-pointer align-top hover:bg-gray-50">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-brand-700">{r.name}</span>
                      <span className="block text-gray-500">{r.crop ?? 'no crop planned'}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.done ? (
                        <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">Done for the season</span>
                      ) : r.status ? (
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 font-medium', STATUS_COLOR[r.status])}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      ) : (
                        <span className="text-gray-400">no balance</span>
                      )}
                      {r.done && r.status && <span className="mt-0.5 block text-[10px] text-gray-400">model: {STATUS_LABEL[r.status] ?? r.status}</span>}
                      {r.statusAsOf && <span className="mt-0.5 block text-[10px] text-gray-400">as of {md(r.statusAsOf)}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <Depth mm={r.totalMm} u={u} strong />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <Depth mm={r.rainMm} u={u} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <Depth mm={r.grossMm} u={u} />
                      {r.unlogged && <span className="block text-[10px] text-amber-700">{r.unlogged}</span>}
                      {/* The allowance, in brief — the field's Water allowance
                          card in its Detailed View has the full working. */}
                      {r.verdict && r.verdict !== 'unknown' && (
                        <span
                          className={cn('mt-0.5 inline-block whitespace-nowrap rounded px-1 text-[10px]', VERDICT[r.verdict].cls)}
                          title={`${VERDICT[r.verdict].label} — see Water allowance in the field's Detailed View`}
                        >
                          {r.pct != null ? `${Math.round(r.pct)}% of allowance` : VERDICT[r.verdict].label}
                          {r.allowedMm != null && ` · ${conv.depth(r.allowedMm, u, u === 'metric' ? 0 : 1)} ${conv.depthUnit(u)} allowed`}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <Depth mm={r.etcMm} u={u} />
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {r.running ? <span className="font-medium text-sky-700">running now</span> : r.last ? md(r.last) : <span className="text-gray-400">not this year</span>}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {r.done ? (
                        <span className="text-gray-400">—</span>
                      ) : r.status === 'now' || r.status === 'stress' ? (
                        <span className="font-medium text-red-700">now</span>
                      ) : r.next ? (
                        md(r.next)
                      ) : (
                        <span className="text-gray-400">not this week</span>
                      )}
                    </td>
                    <td className="py-1.5 text-gray-300">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <HelpNote className="mt-2" summary="Irrigation is the gross depth pumped. Fields with no FieldNET panel need water logged by hand." title="Where these numbers come from">
          <p>
            Rain and crop use are what the model counted for each field (its own gauge, the station or radar). Irrigation is the gross depth pumped; the crop keeps it less
            the pivot&apos;s losses. A field with no FieldNET panel (or a panel with no flow set, so it logs no depth) shows irrigation only when it is logged by hand in its
            Detailed View — until then the model counts it as dry and says it is stressed. &quot;Done for the season&quot; is set on Fields.
          </p>
          <p>The allowance under Irrigation is the field&apos;s allotment in inches, or its licence share spread over the pivot&apos;s acres.</p>
        </HelpNote>
      </Fold>

      <Fold title="Season review" summary="water against yield and dollars, every field" storageKey="irr-overview-review">
        <Suspense fallback={<p className="py-6 text-center text-xs text-gray-400">Loading the review…</p>}>
          <WaterSeasonReview year={year} />
        </Suspense>
      </Fold>
    </div>
  )
}

/** A header with its "what is this?" button. */
function Th({ help, right, children }: { help: keyof typeof OVERVIEW_HELP; right?: boolean; children: React.ReactNode }) {
  return (
    <th className={cn('py-1 pr-2 font-medium', right && 'text-right')}>
      <span className={cn('inline-flex items-center gap-0.5', right && 'justify-end')}>
        {children}
        <ColumnHelp help={OVERVIEW_HELP[help]} width={360} />
      </span>
    </th>
  )
}

function rank(s: string | null) {
  return s === 'stress' ? 0 : s === 'now' ? 1 : s === 'soon' ? 2 : s === 'ok' ? 3 : 4
}
