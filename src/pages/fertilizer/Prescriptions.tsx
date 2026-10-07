import { useMemo, useState } from 'react'
import { FileText, Layers } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'
import { useFields } from '@/lib/queries'
import { useSeasonOperations } from '@/lib/fieldOps'
import {
  appliedFertiliser,
  appliedKind,
  NUTRIENTS,
  rxIsEmpty,
  rxKind,
  useRxMap,
  useRxMapsForYear,
  useRxYears,
  usePrescriptions,
  weightedRate,
  type Nutrient,
  type Prescription,
  type RxMapPolygon,
  type RxZoneRow,
} from '@/lib/fertility-rx'
import { RxZoneMap } from '@/pages/fertilizer/RxZoneMap'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { AdminOnly } from '@/components/TechnicalDetails'
import { ImportHint } from '@/components/ImportHint'

const n0 = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString('en-CA')
const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/**
 * Variable rate or blanket, said plainly.
 *
 * Computed from whether the zone rates differ rather than stored, because the
 * two can only disagree in one direction: a field can be split into five
 * fertility zones and then given one rate on all five, and calling that
 * variable because a zone map exists is the mistake worth preventing.
 */
function KindBadge({ kind }: { kind: 'variable' | 'blanket' | 'unknown' }) {
  const look =
    kind === 'variable'
      ? 'bg-brand-50 text-brand-800 ring-brand-200'
      : kind === 'blanket'
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-gray-50 text-gray-600 ring-gray-200'
  const text =
    kind === 'variable' ? 'Variable rate' : kind === 'blanket' ? 'Blanket' : 'Not known'
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', look)}>
      {text}
    </span>
  )
}

/**
 * The zones as ground rather than as rows.
 *
 * The report gives each zone a fertility band and an acreage but no shape, so
 * this is the honest picture of the map: how much of the field sits in each
 * band, in order, darkest where the index is highest. It answers "is this field
 * mostly good ground with a poor corner, or genuinely mixed" at a glance, which
 * the table does not.
 */
function ZoneBar({ zones }: { zones: RxZoneRow[] }) {
  const total = zones.reduce((a, z) => a + (z.acres ?? 0), 0)
  if (total <= 0) return null
  const shades = ['bg-brand-100', 'bg-brand-200', 'bg-brand-400', 'bg-brand-600', 'bg-brand-700', 'bg-brand-800']
  return (
    <div className="flex h-6 w-full overflow-hidden rounded" role="img" aria-label="Zone acres">
      {zones.map((z, i) => (
        <div
          key={z.id}
          className={cn(
            'flex items-center justify-center text-[10px] font-medium',
            shades[Math.min(i, shades.length - 1)],
            i > 2 ? 'text-white' : 'text-brand-900',
          )}
          style={{ width: `${((z.acres ?? 0) / total) * 100}%` }}
          title={`Zone ${z.zone} · ${z.fertility_index ?? 'no band'} · ${n1(z.acres)} ac`}
        >
          {(z.acres ?? 0) / total > 0.08 ? z.zone : ''}
        </div>
      ))}
    </div>
  )
}

/** Every zone the retailer wrote, with what it was told to get. */
function ZoneTable({ rx }: { rx: Prescription }) {
  const extraKeys = useMemo(
    () => [...new Set(rx.zones.flatMap((z) => Object.keys(z.extra)))],
    [rx.zones],
  )
  const productKeys = useMemo(
    () => [...new Set(rx.zones.flatMap((z) => Object.keys(z.products)))],
    [rx.zones],
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
            <th className="py-2 pr-3 font-medium">Zone</th>
            <th className="py-2 pr-3 font-medium">Fertility index</th>
            <th className="py-2 pr-3 text-right font-medium">Acres</th>
            <th className="py-2 pr-3 text-right font-medium">Yield goal</th>
            {NUTRIENTS.map((n) => (
              <th key={n.key} className="py-2 pr-3 text-right font-medium">
                {n.label}
              </th>
            ))}
            {extraKeys.map((k) => (
              <th key={k} className="py-2 pr-3 text-right font-medium">
                {k}
              </th>
            ))}
            {productKeys.map((k) => (
              <th key={k} className="py-2 pr-3 text-right font-medium">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rx.zones.map((z) => (
            <tr key={z.id} className="border-b border-gray-100">
              <td className="py-1.5 pr-3 font-medium text-gray-900">{z.zone}</td>
              <td className="py-1.5 pr-3 text-gray-600">{z.fertility_index ?? '—'}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{n1(z.acres)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                {n0(z.yield_goal)}
              </td>
              {NUTRIENTS.map((n) => (
                <td key={n.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {n0(z[n.key])}
                </td>
              ))}
              {extraKeys.map((k) => (
                <td key={k} className="py-1.5 pr-3 text-right tabular-nums">
                  {n1(z.extra[k] ?? null)}
                </td>
              ))}
              {productKeys.map((k) => (
                <td key={k} className="py-1.5 pr-3 text-right tabular-nums">
                  {n0(z.products[k] ?? null)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="text-sm font-medium text-gray-900">
            <td className="py-1.5 pr-3">Field</td>
            <td className="py-1.5 pr-3 text-xs font-normal text-gray-500">acre-weighted</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">
              {n1(rx.total_acres ?? rx.zones.reduce((a, z) => a + (z.acres ?? 0), 0))}
            </td>
            <td />
            {NUTRIENTS.map((n) => (
              <td key={n.key} className="py-1.5 pr-3 text-right tabular-nums">
                {n0(weightedRate(rx.zones, n.key))}
              </td>
            ))}
            {extraKeys.map((k) => (
              <td key={k} />
            ))}
            {productKeys.map((k) => (
              <td key={k} className="py-1.5 pr-3 text-right tabular-nums">
                {n0(rx.products.find((p) => p.analysis === k)?.avgRate ?? null)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/**
 * The zones, drawn where they are if we know and split proportionally if not.
 *
 * The PDF gives each zone a band and an acreage but never its shape, so most
 * fields only have the bar. Where the applicator file has been imported the
 * real polygons exist and the map is shown instead — the same zones, on the
 * ground, which is what somebody actually wants to look at.
 */
function ZoneShapes({ rx, year }: { rx: Prescription; year: number }) {
  const { data: polygons } = useRxMap(rx.field_id, year)
  if (polygons && polygons.length > 0) {
    // Acres per product, not across them: a field written urea and phosphate
    // over the same ground would otherwise read as twice its own size.
    const byProduct = new Map<string, number>()
    for (const p of polygons) {
      const key = p.product ?? 'Prescription'
      byProduct.set(key, (byProduct.get(key) ?? 0) + (p.acres ?? 0))
    }
    const widest = Math.max(...byProduct.values())
    const overruns =
      rx.total_acres != null && widest - rx.total_acres > rx.total_acres * 0.25
    return (
      <div className="space-y-1">
        <RxZoneMap polygons={polygons} />
        {overruns && (
          <p className="text-xs text-gray-500">
            This prescription covers {n1(widest)} acres against the {n1(rx.total_acres)} on the
            report, so it reaches beyond the field's boundary.
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <ZoneBar zones={rx.zones} />
      <HelpNote summary="Zone acres, lowest fertility index first — a split of the field, not a map." title="Why this is a bar, not a map">
        Zone acres, lowest fertility index first. The report gives each zone a band and an acreage
        but not its shape, so this is the split of the field rather than a map of it. Import the
        applicator file for this field and the real zones are drawn here instead.
      </HelpNote>
    </div>
  )
}

/**
 * What was prescribed against what the machines put out.
 *
 * The applied side is per pass and is only as good as the product name: a rate
 * given in gallons cannot be turned into pounds of nutrient without a density,
 * and this farm's records carry urea in gallons, so those passes are listed
 * with their rate and left out of the nutrient total rather than guessed at.
 */
function AgainstActual({ rx, season }: { rx: Prescription; season: number }) {
  const { data: ops, isLoading } = useSeasonOperations(season)
  const passes = useMemo(() => {
    if (!ops || !rx.field_id) return []
    return appliedFertiliser(ops.filter((o) => o.field_id === rx.field_id))
  }, [ops, rx.field_id])

  if (!rx.field_id) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        This prescription is not attached to one of our fields yet, so there is nothing to compare
        it against. Its legal description is {rx.legal ?? 'missing'}.
      </p>
    )
  }
  if (isLoading) return <p className="text-sm text-gray-400">Loading applications…</p>

  // Only ever "variable" or "unknown" — see appliedKind. Shown when the passes
  // themselves disagree, which is the one thing the machine records can prove.
  const machineVaried = appliedKind(passes) === 'variable'
  const counted = passes.filter((p) => p.nutrients)
  const uncounted = passes.filter((p) => !p.nutrients)
  const applied: Record<Nutrient, number> = { n: 0, p2o5: 0, k2o: 0, s: 0 }
  for (const p of counted) {
    applied.n += p.nutrients!.n
    applied.p2o5 += p.nutrients!.p2o5
    applied.k2o += p.nutrients!.k2o
    applied.s += p.nutrients!.s
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-3 font-medium">lbs/ac</th>
              {NUTRIENTS.map((n) => (
                <th key={n.key} className="py-2 pr-3 text-right font-medium">
                  {n.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-1.5 pr-3 text-gray-600">Recommended</td>
              {NUTRIENTS.map((n) => (
                <td key={n.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {n0(weightedRate(rx.zones, n.key))}
                </td>
              ))}
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-1.5 pr-3 text-gray-600">Applied</td>
              {NUTRIENTS.map((n) => (
                <td key={n.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {counted.length ? n0(applied[n.key]) : '—'}
                </td>
              ))}
            </tr>
            <tr className="font-medium text-gray-900">
              <td className="py-1.5 pr-3">Difference</td>
              {NUTRIENTS.map((n) => {
                const want = weightedRate(rx.zones, n.key)
                const diff = want == null || !counted.length ? null : applied[n.key] - want
                return (
                  <td
                    key={n.key}
                    className={cn(
                      'py-1.5 pr-3 text-right tabular-nums',
                      diff != null && Math.abs(diff) > 10
                        ? diff > 0
                          ? 'text-amber-700'
                          : 'text-red-700'
                        : '',
                    )}
                  >
                    {diff == null ? '—' : `${diff > 0 ? '+' : ''}${n0(diff)}`}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {machineVaried && (
        <p className="text-xs text-brand-800">
          The machine recorded more than one rate for the same product on this field, so the
          application itself varied.
        </p>
      )}
      {passes.length === 0 ? (
        <p className="text-sm text-gray-500">
          No fertiliser applications recorded on this field for {season}.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {passes.map((p) => (
            <li key={p.key} className="flex flex-wrap items-baseline gap-x-2 text-gray-700">
              <span className="tabular-nums text-gray-500">{p.date ?? '—'}</span>
              <span className="font-medium text-gray-900">{p.product}</span>
              <span className="tabular-nums">
                {p.rate == null ? '—' : `${n1(p.rate)} ${p.unitId ?? ''}`}
              </span>
              {!p.nutrients && (
                <span className="text-xs text-amber-700">
                  rate is a volume — not counted in the nutrient total
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {uncounted.length > 0 && counted.length > 0 && (
        <p className="text-xs text-gray-500">
          {uncounted.length} pass{uncounted.length === 1 ? '' : 'es'} left out of the applied total:
          a rate in gallons or litres needs the product's density to become pounds of nutrient.
        </p>
      )}
      <HelpNote summary="Applied is what the machine recorded, one rate per pass." title="What “applied” means here">
        Applied is what the machine recorded, one rate per pass. Deere does not send the rate map,
        so a pass that followed a prescription file looks the same here as one at a fixed rate —
        the recommendation above is where variable rate can be read.
      </HelpNote>
    </div>
  )
}

/**
 * Applicator files for fields with no report this year.
 *
 * The two arrive independently — the 2024 urea trial exists as a shapefile and
 * was never a Rx Rates PDF — and a screen driven only by the reports would hold
 * this data and never show it.
 */
function MapsWithoutReports({ year, covered }: { year: number; covered: Set<string> }) {
  const { data: byField } = useRxMapsForYear(year)
  const { data: fields } = useFields()
  const orphans = [...(byField ?? new Map<string, RxMapPolygon[]>())].filter(
    ([fieldId]) => !covered.has(fieldId),
  )
  if (orphans.length === 0) return null
  const nameOf = (id: string) => fields?.find((f) => f.id === id)?.name ?? 'Unknown field'
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">
        Applicator files with no report for {year}
      </h2>
      {orphans.map(([fieldId, polygons]) => (
        <div key={fieldId} className="space-y-1 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-gray-900">{nameOf(fieldId)}</span>
            <span className="text-sm text-gray-500">
              {polygons[0].product ?? 'unnamed product'} · {polygons.length} polygons ·{' '}
              {n1(polygons.reduce((a, p) => a + (p.acres ?? 0), 0))} ac
            </span>
            <AdminOnly>
              <span className="ml-auto text-xs text-gray-400">{polygons[0].source_file}</span>
            </AdminOnly>
          </div>
          <RxZoneMap polygons={polygons} />
        </div>
      ))}
    </div>
  )
}

/**
 * Prescriptions, zone by zone, against what actually went on.
 *
 * Built around one question a person asks in front of a bin ticket: was this
 * field variable rated, and did it get what it was supposed to get.
 */
export function Prescriptions() {
  const { cropYear } = useCropYear()
  const { data: years } = useRxYears()
  const [year, setYear] = useState<number | null>(null)
  const effectiveYear = year ?? (years?.includes(cropYear) ? cropYear : (years?.[0] ?? cropYear))
  const { data: rows, isLoading } = usePrescriptions(effectiveYear)
  const [selected, setSelected] = useState<string | null>(null)
  // Every field in one table, or one field on its own. The table is for
  // comparing across the farm; the single view is for reading one
  // prescription without scrolling past twenty others to reach it.
  const [view, setView] = useState<'all' | 'one'>('all')

  const list = rows ?? []
  const current = list.find((r) => r.id === selected) ?? list[0] ?? null

  if (isLoading) return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(effectiveYear)}
          options={(years?.length ? years : [effectiveYear]).map((y) => ({
            value: String(y),
            label: String(y),
          }))}
          onChange={(v) => {
            setYear(Number(v))
            setSelected(null)
          }}
          ariaLabel="Crop year"
          size="sm"
          className="w-28"
        />
        <span className="text-sm text-gray-500">
          {list.length} prescription{list.length === 1 ? '' : 's'}
        </span>
        {list.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={view}
              options={[
                { value: 'all', label: 'All fields' },
                { value: 'one', label: 'One field' },
              ]}
              onChange={(v) => setView(v as 'all' | 'one')}
              ariaLabel="Show"
              size="sm"
              className="w-32"
            />
            {view === 'one' && (
              <Select
                value={current?.id ?? ''}
                options={list.map((r) => ({ value: r.id, label: r.field_label }))}
                onChange={(v) => setSelected(v)}
                ariaLabel="Field"
                size="sm"
                className="w-56"
              />
            )}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">
          <p>No prescription report on file for {effectiveYear}. Ask your admin to import one.</p>
          <ImportHint what="variable-rate prescription reports (PDF)" script="scripts/import-rx.mjs" screen="Fertilizer → Plan → Prescriptions">
            <p className="mt-1 text-xs">Import the RX Rates PDF with scripts/import-rx.mjs.</p>
          </ImportHint>
        </div>
      ) : (
        <>
          {view === 'all' && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Crop</th>
                  <th className="px-3 py-2 text-right font-medium">Acres</th>
                  <th className="px-3 py-2 text-right font-medium">Zones</th>
                  <th className="px-3 py-2 font-medium">Application</th>
                  {NUTRIENTS.map((n) => (
                    <th key={n.key} className="px-3 py-2 text-right font-medium">
                      {n.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Product</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    // Picking a row folds the list away: the detail is what
                    // was wanted, and it sat under twenty other rows.
                    onClick={() => {
                      setSelected(r.id)
                      setView('one')
                    }}
                    className={cn(
                      'cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50',
                      current?.id === r.id && 'bg-brand-50/60',
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.field_label}
                      {!r.field_id && (
                        <span className="ml-2 text-xs font-normal text-amber-700">
                          not linked to a field
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.crop_type ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{n1(r.total_acres)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.zones.length}</td>
                    <td className="px-3 py-2">
                      {rxIsEmpty(r.zones) ? (
                        <span className="text-xs text-gray-500">Nothing prescribed</span>
                      ) : (
                        <KindBadge kind={rxKind(r.zones)} />
                      )}
                    </td>
                    {NUTRIENTS.map((n) => (
                      <td key={n.key} className="px-3 py-2 text-right tabular-nums">
                        {n0(weightedRate(r.zones, n.key))}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-gray-600">
                      {r.products.map((p) => p.analysis).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {current && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Layers className="h-4 w-4 text-brand-700" />
                <h2 className="text-base font-semibold text-gray-900">{current.field_label}</h2>
                {!rxIsEmpty(current.zones) && <KindBadge kind={rxKind(current.zones)} />}
                <span className="text-sm text-gray-500">
                  {[
                    current.crop_type,
                    current.variety,
                    current.yield_goal
                      ? `${n0(current.yield_goal)} ${current.yield_unit ?? ''}`.trim()
                      : null,
                    current.description,
                    current.legal,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {/* Which PDF and page it was read from is for whoever runs
                    the import, not for someone reading the rates. */}
                {current.source_file && (
                  <AdminOnly>
                    <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
                      <FileText className="h-3 w-3" />
                      {current.source_file}
                      {current.source_page ? ` p.${current.source_page}` : ''}
                    </span>
                  </AdminOnly>
                )}
              </div>

              <ZoneShapes rx={current} year={effectiveYear} />

              <ZoneTable rx={current} />

              <div className="border-t border-gray-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Against what was applied</h3>
                <AgainstActual rx={current} season={effectiveYear} />
              </div>
            </div>
          )}
        </>
      )}

      <MapsWithoutReports
        year={effectiveYear}
        covered={new Set(list.map((r) => r.field_id).filter((id): id is string => Boolean(id)))}
      />
    </div>
  )
}
