import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Droplets, ExternalLink } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import { fieldSalinity, saltColour, SALT_CLASSES, zoneSalinity, useFieldSalinity } from '@/lib/salinity'
import { midYield, useFieldYieldZones, type FieldZone } from '@/lib/yield-zones'
import { CARD_HEAD } from '@/lib/table-style'
import { n1 } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Which class a figure falls in, for the row's wording. */
const classLabel = (ec: number) => SALT_CLASSES.find((c) => ec < c.max)!.label

/**
 * Where the salt is inside one field, on the field page's Soil tab.
 *
 * The soil test card above it gives the year's numbers; this answers the
 * question those numbers raise and cannot settle — the report says the field
 * averaged 0.56 and one sample came back 1.18, and the obvious next question
 * is which end. The lab took no coordinates, so the honest answer comes from
 * the productivity zones: the ground that runs below its field's own average
 * year after year is usually the ground carrying the salt.
 *
 * Same arithmetic as the map's Salinity layer (`zoneSalinity`), so the colour
 * of a zone here is the colour of that ground on the map.
 */
export function FieldSalinityCard({
  fieldId,
  className,
}: {
  fieldId: string | null | undefined
  className?: string
}) {
  const { data: saltRows } = useFieldSalinity(!!fieldId)
  const { data: zones } = useFieldYieldZones(fieldId)

  const salt = useMemo(
    () => (fieldId ? (fieldSalinity(saltRows ?? []).get(fieldId) ?? null) : null),
    [saltRows, fieldId],
  )
  const byZone = useMemo(
    () => (salt && zones?.length ? zoneSalinity(salt, zones) : new Map<string, number>()),
    [salt, zones],
  )

  // Nothing measured means nothing to say. The soil test card above already
  // tells you whether this field has been sampled at all.
  if (!fieldId || !salt) return null

  const rows: (FieldZone & { ec: number })[] = (zones ?? [])
    .map((z) => ({ ...z, ec: byZone.get(z.id) ?? salt.ec }))
    .sort((a, b) => b.ec - a.ec)
  const totalAcres = rows.reduce((s, z) => s + (z.acres ?? 0), 0)
  const split = rows.length > 1 && rows[0].ec - rows[rows.length - 1].ec > 0.01

  return (
    <div className={cn('overflow-hidden rounded-lg border border-gray-200 bg-white', className)}>
      <div className={cn('flex flex-wrap items-center gap-2', CARD_HEAD)}>
        <Droplets className="h-4 w-4 text-white" />
        <h3 className="font-medium">Salinity</h3>
        <span className="text-xs text-brand-100">
          {n1(salt.ec)} EC on average, {n1(salt.worst)} at worst · {salt.year}
          {salt.naPct != null && salt.naPct >= 5 ? ` · sodium ${Math.round(salt.naPct)}%` : ''}
        </span>
        <InfoPopover title="Where this comes from" width={320} className="ml-auto">
          <p>
            Topsoil EC in mS/cm from this field&rsquo;s latest soil report
            {salt.samples > 1 ? `, ${salt.samples} samples` : ', a single sample'}. Under 1 costs no
            yield; dry beans and peas are the first to feel it above that.
          </p>
          {split && (
            <p className="mt-1.5">
              The lab took no coordinates, so the split below is an estimate, not a reading: the
              measured average and worst sample laid across the productivity zones, worst on the
              poorest ground. The acres still average what the lab measured. Dig or sample before
              acting on it.
            </p>
          )}
        </InfoPopover>
      </div>

      {!split ? (
        <p className="px-3 py-3 text-sm text-gray-600">
          {rows.length === 0
            ? 'No productivity zone map for this field, so there is nothing to split the measurement across.'
            : rows.length === 1
              ? 'One productivity zone covers this field, so there is nowhere to lay a spread.'
              : 'One sample on the latest report, so there is no measured spread to lay across the zones.'}{' '}
          <span className="text-gray-500">
            The whole field reads {classLabel(salt.ec).toLowerCase()}.
          </span>
        </p>
      ) : (
        <>
          {/* The split as ground, before the table of it — the same band the
              soil survey card uses, so the two read as one page. */}
          <div className="flex h-5 overflow-hidden px-3 pt-3">
            <div className="flex h-full w-full overflow-hidden rounded">
              {rows.map((z) => (
                <div
                  key={z.id}
                  className="h-full"
                  style={{
                    width: `${totalAcres > 0 ? ((z.acres ?? 0) / totalAcres) * 100 : 100 / rows.length}%`,
                    backgroundColor: saltColour(z.ec),
                  }}
                  title={`Zone ${z.zone} — about ${n1(z.ec)} EC`}
                />
              ))}
            </div>
          </div>

          <ul className="divide-y divide-gray-100 px-3 py-2">
            {rows.map((z) => {
              const mid = midYield(z)
              return (
                <li key={z.id} className="flex items-center gap-2 py-1.5">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: saltColour(z.ec) }}
                  />
                  <span className="text-sm font-medium text-gray-900">Zone {z.zone}</span>
                  <span className="truncate text-xs text-gray-500">
                    {mid == null ? 'not rated' : `runs ${Math.round(mid)}% of this field`}
                    {z.acres != null && ` · ${n1(z.acres)} ac`}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-gray-600">
                    about {n1(z.ec)} EC
                  </span>
                </li>
              )
            })}
          </ul>

          <p className="px-3 pb-3 text-[11px] leading-relaxed text-gray-500">
            Estimated from the measured average and worst sample, laid across the zones — not a
            reading per zone.{' '}
            <Link to="/map" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              See it on the map
              <ExternalLink className="h-3 w-3" />
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
