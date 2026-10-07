import { useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import {
  DRAINAGE,
  SALINITY,
  TEXTURE,
  soilBandColour,
  unitAvailableWater,
  useFieldSoilUnits,
} from '@/lib/soil-landscape'
import { SoilLegend } from '@/components/SoilLegend'
import { InfoPopover } from '@/components/InfoPopover'
import { HorizonTable, SoilTermInfo } from '@/components/SoilTerms'
import { cn } from '@/lib/utils'

const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/**
 * What the provincial survey says about one field.
 *
 * Beside a soil test this answers the question the test cannot: the test is a
 * handful of cores from one season, and this is the ground they came out of.
 * A field that reads two different ways between sample sites is usually a field
 * that spans two soils, and until now there was nothing on screen to say so.
 *
 * Shared rather than built into one tab — it is the same data whether the
 * question is manure, sampling or irrigation.
 */
export function FieldSoilSurvey({
  fieldId,
  className,
}: {
  fieldId: string | null | undefined
  className?: string
}) {
  const { data: units, isLoading } = useFieldSoilUnits(fieldId)
  const [open, setOpen] = useState<number | null>(null)

  if (!fieldId) return null
  if (isLoading) {
    return <p className={cn('text-sm text-gray-400', className)}>Loading soil survey…</p>
  }
  if (!units || units.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-gray-300 p-4', className)}>
        <p className="text-sm text-gray-500">
          No soil survey for this field. It needs a current boundary for the survey to be matched
          against — draw one on the field page.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.fieldBoundary(fieldId)}>Draw the boundary</SetupLink>
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <Layers className="h-4 w-4 text-brand-700" />
          <h3 className="text-sm font-semibold text-gray-900">Soil survey</h3>
          <span className="text-xs text-gray-500">
            {units.length === 1 ? 'one soil' : `${units.length} soils across this field`}
          </span>
          {/* The legend lives behind the button rather than under the table:
              read once, it was in the way of the cores below it every time. */}
          <InfoPopover title="Soil survey legend" hover width={480} className="ml-auto">
            <SoilLegend bare />
          </InfoPopover>
        </div>

        {/* The split as ground, before the table of it. */}
        <div className="flex h-5 overflow-hidden px-3 pt-3">
          <div className="flex h-full w-full overflow-hidden rounded">
            {units.map((u) => (
              <div
                key={u.poly_id}
                className="h-full"
                style={{
                  width: `${u.pct_of_field ?? 0}%`,
                  backgroundColor: soilBandColour(unitAvailableWater(u)),
                }}
                title={`${u.soil_name ?? 'unnamed'} — ${u.pct_of_field}%`}
              />
            ))}
          </div>
        </div>

        <ul className="divide-y divide-gray-100 px-3 py-2">
          {units.map((u) => {
            const aw = unitAvailableWater(u)
            const expanded = open === u.poly_id
            return (
              <li key={u.poly_id} className="py-1.5">
                {/* The info button sits BESIDE the row toggle, not inside it:
                    a button within a button is invalid, and a tap meant for the
                    explanation would expand the row instead. */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOpen(expanded ? null : u.poly_id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    )}
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: soilBandColour(aw) }}
                    />
                    <span className="text-sm font-medium text-gray-900">
                      {u.soil_name ?? u.munit ?? 'Unnamed'}
                    </span>
                    <span className="truncate text-xs text-gray-500">
                      {[
                        u.texture_top ? (TEXTURE[u.texture_top] ?? u.texture_top) : null,
                        u.drainage ? DRAINAGE[u.drainage] : null,
                        u.salinity ? SALINITY[u.salinity] : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </button>
                  {/* Texture has its own info button on the horizon table's
                      column heading below; two buttons for one word on one row
                      is clutter. Drainage has no column of its own, so this is
                      the only place to explain it. */}
                  <SoilTermInfo term="drainage" />
                  <span className="flex shrink-0 items-center text-xs tabular-nums text-gray-600">
                    {aw == null ? 'no rating' : `${aw}″ available`}
                    <SoilTermInfo term="availableWater" />
                    <span className="ml-1">
                      · {u.pct_of_field}% · {n1(u.overlap_acres)} ac
                    </span>
                  </span>
                </div>
                {expanded && (
                  <div className="mt-2 space-y-2 pl-7">
                    <p className="text-xs text-gray-500">
                      {u.munit ? `Map unit ${u.munit}. ` : ''}
                      {u.subgroup ? `Classified ${u.subgroup}. ` : ''}
                      {u.fc_pct != null && u.wp_pct != null
                        ? `Field capacity ${u.fc_pct}%, wilting point ${u.wp_pct}% by volume.`
                        : ''}
                    </p>
                    <HorizonTable horizons={u.detail.horizons ?? []} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
