import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers, Map as MapIcon } from 'lucide-react'
import {
  byField,
  WORTH_VARYING,
  fieldSpread,
  midYield,
  rangeLabel,
  useYieldZones,
  yieldBands,
  yieldColour,
} from '@/lib/yield-zones'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { ImportHint } from '@/components/ImportHint'

/**
 * Productivity zones, per field, as a table rather than a map.
 *
 * The map answers "where"; this answers "how much of the field is any good",
 * which is the question being asked when a variable-rate plan is being written.
 * Each field is a bar of its zones by acreage, so the size of the good part is
 * visible without opening anything, and the figure beside it is the SPREAD —
 * not an average. The numbers are an index normalised to each field's own mean,
 * so an average column would read 99, 100, 99, 100 all the way down and say
 * nothing at all. See lib/yield-zones.ts.
 */
export function YieldZones() {
  const { data: zones, isLoading } = useYieldZones()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const bands = useMemo(() => yieldBands(zones ?? []), [zones])
  const fields = useMemo(() => byField(zones ?? []), [zones])

  if (isLoading) return <p className="p-4 text-sm text-gray-400">Loading…</p>
  if (!fields.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-10 text-center">
        <Layers className="mx-auto h-6 w-6 text-gray-300" />
        <p className="mt-2 text-sm text-gray-500">
          No productivity zones loaded. They arrive as a shapefile archive from the agronomist —
          ask your admin to import them.
        </p>
        <ImportHint what="productivity zones from a shapefile archive" script="scripts/import-yield-zones.mjs" screen="Fertilizer → Plan → Productivity Zones">
          <p className="mt-1 text-xs text-gray-400">
            Load with <code className="text-xs">scripts/import-yield-zones.mjs</code>.
          </p>
        </ImportHint>
      </div>
    )
  }

  const farmAcres = (zones ?? []).reduce((s, z) => s + (z.acres ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Productivity zones</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {fields.length} fields · {zones?.length} zones ·{' '}
              {Math.round(farmAcres).toLocaleString('en-CA')} acres mapped
            </p>
          </div>
          <Link
            to="/map"
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <MapIcon className="h-3.5 w-3.5" /> See it on the map
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-500">% of the field&rsquo;s own average</span>
          {bands.map((b) => (
            <span key={b.colour} className="flex items-center gap-1 text-[11px] text-gray-600">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: b.colour }} />
              {b.from}–{b.to}
            </span>
          ))}
        </div>
        {/* Said plainly here and on the map legend, because a table of fields
            one above another is an invitation to rank them, and this is the one
            comparison the numbers cannot support at all. */}
        <HelpNote
          className="mt-2"
          summary={<>Index: 100 = this field&rsquo;s own average; don&rsquo;t compare fields.</>}
          title="What the zone numbers mean"
        >
          <p>
            The agronomist&rsquo;s ranking of each field&rsquo;s own ground — what a variable-rate
            plan is built on.
          </p>
          <p>
            These are an index, not bushels: 100 is each field&rsquo;s own average, so fields cannot
            be ranked against one another — every one of them averages 100 whether it grows forty
            bushels or a hundred and forty. What the numbers do say is how much a field varies
            within itself.
          </p>
        </HelpNote>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100">
          {fields.map((f) => {
            const spread = fieldSpread(f.zones)
            const acres = f.zones.reduce((s, z) => s + (z.acres ?? 0), 0)
            const isOpen = open[f.fieldId]
            return (
              <li key={f.fieldId}>
                <button
                  onClick={() => setOpen((o) => ({ ...o, [f.fieldId]: !o[f.fieldId] }))}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{f.name}</span>
                  <span className="text-xs text-gray-500">
                    {f.zones.length} zones · {Math.round(acres)} ac
                  </span>
                  {/* The bar is the field: each zone's share of the acres, in
                      its own colour. It says at a glance how much of the field
                      is the good part. */}
                  <span className="ml-auto flex h-3 w-40 overflow-hidden rounded-sm ring-1 ring-gray-200">
                    {[...f.zones]
                      .sort((a, b) => a.zone - b.zone)
                      .map((z) => (
                        <span
                          key={z.id}
                          title={`Zone ${z.zone} · ${rangeLabel(z)}`}
                          style={{
                            backgroundColor: yieldColour(bands, midYield(z)),
                            width: `${acres > 0 ? ((z.acres ?? 0) / acres) * 100 : 0}%`,
                          }}
                        />
                      ))}
                  </span>
                  {spread != null && (
                    <span className="w-28 text-right text-xs tabular-nums">
                      <span className="text-gray-800">
                        {Math.round(spread.lo)}–{Math.round(spread.hi)}
                      </span>
                      <span
                        className={cn(
                          'ml-1.5',
                          spread.spread >= WORTH_VARYING ? 'text-brand-700' : 'text-gray-400',
                        )}
                        title={
                          spread.spread >= WORTH_VARYING
                            ? 'Variable enough that splitting the rate should pay'
                            : 'Behaves as one piece of ground — one rate'
                        }
                      >
                        {spread.spread >= WORTH_VARYING ? 'vary' : 'one rate'}
                      </span>
                    </span>
                  )}
                </button>

                {isOpen && (
                  <table className="w-full border-t border-gray-100 bg-gray-50/60 text-xs">
                    <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                      <tr>
                        <th className="px-3 py-1 font-medium">Zone</th>
                        <th className="px-3 py-1 font-medium">Index</th>
                        <th className="px-3 py-1 text-right font-medium">Acres</th>
                        <th className="px-3 py-1 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...f.zones]
                        .sort((a, b) => a.zone - b.zone)
                        .map((z) => (
                          <tr key={z.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="h-2.5 w-2.5 rounded-sm"
                                  style={{ backgroundColor: yieldColour(bands, midYield(z)) }}
                                />
                                {z.zone}
                              </span>
                            </td>
                            <td className={cn('px-3 py-1.5 tabular-nums text-gray-800')}>
                              {rangeLabel(z)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                              {z.acres == null ? '—' : Math.round(z.acres)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                              {acres > 0 && z.acres != null
                                ? `${Math.round(((z.acres ?? 0) / acres) * 100)}%`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
