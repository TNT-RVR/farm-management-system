import { Select } from '@/components/Select'
import { InfoPopover } from '@/components/InfoPopover'
import { GRASS_QUALITIES } from '@/lib/grazing'
import type { Database } from '@/lib/database.types'

type Row = Database['public']['Tables']['grazing_pastures']['Row']
type Patch = Database['public']['Tables']['grazing_pastures']['Update']

const n2 = (v: number | string | null | undefined) =>
  v == null ? null : Number(v).toFixed(2)

/**
 * A paddock's grass rating, and where the word came from.
 *
 * The rating is set from orbit now (see the 20261110110000 migration): peak
 * June-to-August canopy cover, as a ratio to the ranch's own middle paddock
 * that year, averaged over the seasons measured. Sam's anchor is that the
 * average paddock is Fair, so 1.00 is Fair by construction.
 *
 * The dropdown stays. Changing it marks the paddock manual and the satellite
 * pass then leaves it alone — a measurement that silently reverts what someone
 * typed is worse than no measurement. The popover is there because a word that
 * changes 34 % of the ranch's grass supply should be able to show its working.
 */
export function GrassQuality({
  p,
  disabled,
  onChange,
  className = 'w-28',
}: {
  p: Row
  disabled?: boolean
  onChange: (patch: Patch) => void
  className?: string
}) {
  const fromSat = p.grass_quality_source === 'satellite'
  const rel = n2(p.grass_quality_rel)

  return (
    <span className="inline-flex items-center gap-1">
      <Select
        value={p.grass_quality}
        size="sm"
        disabled={disabled}
        ariaLabel="Grass quality"
        className={className}
        // A hand-set rating sticks: the satellite pass skips 'manual'.
        onChange={(v) => onChange({ grass_quality: v, grass_quality_source: 'manual' })}
        options={GRASS_QUALITIES.map((q) => ({ value: q, label: q }))}
      />
      {fromSat && rel && (
        <InfoPopover title={`${p.name}: measured ${rel}× the ranch middle`} width={420}>
          <p>
            Set from satellite{p.grass_quality_set_on ? ` on ${p.grass_quality_set_on}` : ''}, not
            typed in. Peak canopy cover from June to August came out {rel} times the middle paddock
            on this ranch. The middle paddock is Fair, so the cut points are 0.84, 1.18 and 1.72 —
            the midpoints between what the Alberta Forage Yield Estimator pays Poor, Fair, Good and
            Excellent.
          </p>
          <p className="mt-2">
            Measured as cover rather than as NDVI, because NDVI climbs fast over thin grass and then
            flattens; the squared relation is the one the irrigation side already uses. The ratio is
            taken inside each year, so a wet season lifts the whole ranch without promoting any
            paddock — the rain is already counted once, in the pounds per acre.
          </p>
          <p className="mt-2">
            Pick a quality by hand and it stays picked; the satellite pass skips a paddock somebody
            has set.
          </p>
        </InfoPopover>
      )}
      {fromSat && !rel && (
        <InfoPopover title={`${p.name}: not measured yet`} width={400}>
          <p>
            This paddock has irrigated cropland inside the fence, so the satellite sees mostly crop.
            Its grass has its own polygon now and is collecting looks; until that has a June-to-
            August season of its own, the rating stays where it is rather than reporting the potato
            crop as range.
          </p>
        </InfoPopover>
      )}
      {!fromSat && (
        <InfoPopover title={`${p.name}: set by hand`} width={380}>
          <p>
            Somebody picked this one, so the satellite pass leaves it alone. Clearing it back to the
            measured rating means picking the quality the satellite reads — or asking for it to be
            handed back.
          </p>
        </InfoPopover>
      )}
    </span>
  )
}
