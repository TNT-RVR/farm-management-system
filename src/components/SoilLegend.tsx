import { ExternalLink } from 'lucide-react'
import {
  AGRASID_SOURCE,
  SOIL_NO_DATA_COLOUR,
  SOIL_VIEWER,
  SOIL_WATER_BANDS,
} from '@/lib/soil-landscape'
import { cn } from '@/lib/utils'

/**
 * What the soil colours mean, and where they came from.
 *
 * The link matters as much as the swatches. These are somebody else's numbers —
 * a provincial survey mapped at a scale where one polygon covers a quarter
 * section — and a person deciding what to do with a field is entitled to see
 * whose survey it is before trusting it against their own knowledge of the
 * ground.
 */
export function SoilLegend({ className, bare = false }: { className?: string; bare?: boolean }) {
  return (
    <div className={cn(!bare && 'rounded-lg border border-gray-200 bg-white p-3', 'text-xs', className)}>
      <div className="mb-1.5 font-medium text-gray-900">
        {bare ? 'Plant-available water in the top metre' : 'Soil survey — plant-available water in the top metre'}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {SOIL_WATER_BANDS.map((b) => (
          <span key={b.label} className="flex items-center gap-1.5 text-gray-700">
            <span
              className="inline-block h-3 w-5 rounded-sm ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: b.colour }}
            />
            {b.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-gray-700">
          <span
            className="inline-block h-3 w-5 rounded-sm ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: SOIL_NO_DATA_COLOUR }}
          />
          no rating — water or disturbed ground
        </span>
      </div>
      <p className="mt-2 text-gray-500">
        Field capacity minus wilting point, depth-weighted over the rooting zone. A soil holding
        under 1.5″ runs out in a few hot days; over 3.5″ carries a crop through a week. Mapped by
        soil landscape polygon, so one colour can cover a quarter section — it describes the
        dominant soil, not every acre of it.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        <a
          href={AGRASID_SOURCE.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand-700 hover:underline"
        >
          {AGRASID_SOURCE.name}
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={SOIL_VIEWER.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand-700 hover:underline"
        >
          {SOIL_VIEWER.name} — look any spot up
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}
