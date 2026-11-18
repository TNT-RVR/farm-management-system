import { Link } from 'react-router-dom'
import { Select } from '@/components/Select'
import { InfoPopover } from '@/components/InfoPopover'
import {
  FORAGE_YIELD_ESTIMATOR,
  FORAGE_YIELD_IRRIGATION,
  GRASS_QUALITIES,
  PASTURE_RATING_GUIDE,
  forageYieldPerAcre,
  type GrassQuality as Quality,
  type GrazingRain,
  type PastureCalc,
} from '@/lib/grazing'
import type { PastureEssr } from '@/lib/range-sites'
import type { Database } from '@/lib/database.types'

type Patch = Database['public']['Tables']['grazing_pastures']['Update']

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')

/** The estimator has four columns and these are their names; anything else reads as Fair. */
const qualityOf = (q: string): Quality =>
  (GRASS_QUALITIES as readonly string[]).includes(q) ? (q as Quality) : 'Fair'

/**
 * A paddock's grass rating, and what that word is worth.
 *
 * The popover answers the question the word raises on this screen — what does
 * calling this paddock Fair do to the feed? — out of the two reference tables
 * the calculator reads: the Forage Yield Estimator (lb/acre by zone × rating)
 * and the Pasture Rating guide (what each rating means on the ground). Both
 * were reachable only through Cattle settings → Pasture map → Reference, which
 * is three clicks from the number they explain (Sam, 12 Nov 2026).
 *
 * How the satellite picked the word is one line at the bottom. It was most of
 * the panel before, and it is the least useful thing here: the rating can be
 * changed by hand in the pasture's own pop-up, so what matters is what it costs.
 *
 * The rating itself is set from orbit (the 20261110110000 migration): peak
 * June-to-August canopy cover as a ratio to the ranch's own middle paddock,
 * averaged over the seasons measured. The middle paddock is Fair, so 1.00 is
 * Fair by construction. Picking one by hand marks the paddock manual and the
 * satellite pass then leaves it alone — a measurement that silently reverts
 * what someone typed is worse than no measurement.
 */
export function GrassQuality({
  p,
  rain,
  utilization,
  measuredFromOrbit = false,
  essr,
  disabled,
  onChange,
  readOnly = false,
  className = 'w-28',
}: {
  p: PastureCalc
  /** The ranch's forage zone and this season's scaling (grazingRain). */
  rain: GrazingRain
  /** The ranch's grazing utilization rate, 0–1. */
  utilization: number
  /**
   * True when this paddock's season factor is the satellite's own measurement
   * of it rather than the ranch's rainfall ratio — computePastures picks one or
   * the other, never both, so the panel has to be told which it got.
   */
  measuredFromOrbit?: boolean
  /**
   * What this paddock's own soils sustain year after year, from the range-site
   * guide (range-sites.ts). Absolute, where everything above it is relative —
   * which is the whole reason it is here. Undefined for a paddock with no
   * boundary drawn, since then there is no soil to read.
   */
  essr?: PastureEssr | null
  disabled?: boolean
  onChange?: (patch: Patch) => void
  /**
   * The word and its ⓘ, with no dropdown. The grazing table edits a pasture
   * in a pop-up now, so a row that still carried a live Select was the one
   * thing on it you could change by brushing past it.
   */
  readOnly?: boolean
  className?: string
}) {
  const q = qualityOf(p.grass_quality)
  const fromSat = p.grass_quality_source === 'satellite'
  const rel = p.grass_quality_rel == null ? null : Number(p.grass_quality_rel).toFixed(2)

  // The zone picks the row and never moves; the season factor scales what that
  // row yields. p.foragePerAcre is the two multiplied (computePasture).
  const zoneLb = forageYieldPerAcre(rain.zoneMm, q)
  const scaled = p.seasonFactor !== 1
  /*
   * What this paddock is read at in an ordinary year, and where that came
   * from, so the popover explains the arithmetic the app actually did.
   *
   * It used to explain the table whatever the paddock was read at, which
   * since the rating and the level were told apart is wrong for every paddock
   * with a measured cover: Pasture K's "Poor grass grows 435 lb/acre" while
   * the plan reads it at 618.
   */
  const normalLb = p.seasonFactor > 0 ? p.foragePerAcre / p.seasonFactor : p.foragePerAcre
  const relNum = p.grass_quality_rel == null ? null : Number(p.grass_quality_rel)
  const baseLb = relNum && relNum > 0 ? normalLb / relNum : null
  const grazeLb = p.foragePerAcre * utilization
  const belowTable = rain.zoneMm < FORAGE_YIELD_ESTIMATOR[0].lo

  return (
    <span className="inline-flex items-center gap-1">
      {readOnly ? (
        /* The measurement, not the word it used to be rounded to (Sam,
           14 Nov 2026). A paddock nobody has measured still gets the word,
           because for that one the word is all there is. */
        <span
          className="text-sm tabular-nums text-gray-700"
          title={
            relNum != null
              ? `${relNum.toFixed(2)} times this ranch's median paddock, measured from orbit. The level it is read against is the median paddock figure on the rain card.`
              : 'Nobody has measured this paddock, so it falls back to the estimator at the ranch’s zone.'
          }
        >
          {relNum != null ? `${relNum.toFixed(2)}×` : p.grass_quality}
        </span>
      ) : (
        <Select
          value={p.grass_quality}
          size="sm"
          disabled={disabled}
          ariaLabel="Grass quality"
          className={className}
          // A hand-set rating sticks: the satellite pass skips 'manual'.
          onChange={(v) => onChange?.({ grass_quality: v, grass_quality_source: 'manual' })}
          options={GRASS_QUALITIES.map((qq) => ({ value: qq, label: qq }))}
        />
      )}
      <InfoPopover
        title={relNum != null ? `${p.name}: ${relNum.toFixed(2)}× the median paddock` : `${p.name}: ${q} grass`}
        width={460}
      >
        {p.yieldSource === 'measured' ? (
          <p>
            This paddock has been cut and weighed, so it is read off its own grass:{' '}
            <b>{n0(normalLb)} lb/acre</b> in an ordinary year. Nothing below applies to it — the
            table is for a paddock nobody has sampled.
          </p>
        ) : baseLb != null && relNum != null ? (
          <p>
            Its canopy cover measures <b>{relNum.toFixed(2)}×</b> this ranch&apos;s median paddock,
            and a median paddock here grows <b>{n0(baseLb)} lb/acre</b> in an ordinary year, so
            this one is read at <b>{n0(normalLb)} lb/acre</b>. The rating says which paddock is
            better than which and nothing about pounds; the level it is measured against is the{' '}
            <i>median paddock</i> figure on the rain card.
            {p.yieldSource === 'grazed' && ' That level has been lifted to meet what the cattle took off these paddocks.'}
          </p>
        ) : (
          <p>
            Nothing has measured this paddock, so it falls back to the estimator at this
            ranch&apos;s <b>{n0(rain.zoneMm)} mm zone</b> — the long-term annual average, which
            classifies where the ranch is and does not move with the weather. {q} grass in that
            zone grows about <b>{n0(zoneLb)} lb/acre</b>.
          </p>
        )}
        <p>
          {scaled ? (
            <>
              This season {measuredFromOrbit ? 'measured' : 'is running at'}{' '}
              <b>{p.seasonFactor.toFixed(2)}×</b>{' '}
              {measuredFromOrbit
                ? "normal on this paddock's own canopy cover"
                : 'a normal one on the rain gauge'}
              , so the plan uses {n0(p.foragePerAcre)} lb/acre.{' '}
            </>
          ) : (
            <>Nothing is scaling it this season, so the zone&apos;s figure stands. </>
          )}
          Grazing takes {Math.round(utilization * 100)} % and leaves the rest standing, so{' '}
          <b>{n0(grazeLb)} lb/acre</b> is feed.
        </p>
        <p>
          Over this paddock&apos;s {n0(p.totalGrazeableAc)} grazeable acres that comes to{' '}
          <b>{n0(p.auds)} animal-unit days</b>
          {p.fieldAuds > 0 && <>, {n0(p.fieldAuds)} of them off the crop fields inside the fence</>}.
          One animal unit draws {p.lbPerAuDay.toFixed(1)} lb a day here
          {p.countsWaste ? ' — what it eats plus what it tramples and fouls' : ', counting only what it eats'}.
        </p>

        <div>
          <p className="font-medium text-gray-700">
            {baseLb != null ? 'Where the level came from' : 'What the zone does to it'}
          </p>
          <table className="mt-1 w-full tabular-nums">
            <tbody>
              {FORAGE_YIELD_ESTIMATOR.map((b) => {
                const here = rain.zoneMm >= b.lo && rain.zoneMm < b.hi
                return (
                  <tr key={b.label} className={here ? 'font-semibold text-gray-900' : undefined}>
                    <td className="py-0.5 pr-2">{b.label}</td>
                    <td className="py-0.5 text-right">{n0(b.yields[q])} lb/ac</td>
                    <td className="py-0.5 pl-2 text-xs font-normal text-gray-400">
                      {here ? 'this ranch' : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-1">
            {baseLb != null && (
              <>
                This is the table the ranch&apos;s level started from, and the row it sits on. It
                no longer sets this paddock — the level does — but it is why the level is the size
                it is.{' '}
              </>
            )}
            {belowTable
              ? `The table has no row under ${FORAGE_YIELD_ESTIMATOR[0].lo} mm, so below that the yield falls in proportion, to nothing at no rain.`
              : 'Read between the rows, not row by row, so a zone a few millimetres either side of an edge is a pound or two rather than half the grass.'}{' '}
            A wet year does not move the ranch to a wetter row; it scales the row the ranch is on.
            Irrigated grass of this rating pays {n0(FORAGE_YIELD_IRRIGATION[q])} lb/acre whatever
            the rain.
          </p>
        </div>

        {essr?.essr_auds != null && (
          <div>
            <p className="font-medium text-gray-700">What this ground sustains</p>
            <p className="mt-1">
              The soil under this paddock is {n0(essr.grazed_acres ?? 0)} grazeable acres of range
              site, and Alberta&apos;s guide puts its long-run rate at{' '}
              <b>{n0(essr.essr_auds)} animal-unit days</b>
              {essr.essr_auds_low != null && essr.essr_auds_high != null && (
                <> ({n0(essr.essr_auds_low)}–{n0(essr.essr_auds_high)} depending on the plant community)</>
              )}
              . That is what it carries <i>every</i> year without going backwards — not what it grew
              this one, which is the {n0(p.auds)} above.
              {essr.pct_rated != null && essr.pct_rated < 100 && (
                <> Only {Math.round(essr.pct_rated)} % of its acres carry a published rate; the rest sit
                on ground the guide lists no community for.</>
              )}
            </p>
          </div>
        )}

        <div>
          <p className="font-medium text-gray-700">What “{q}” means on the ground</p>
          <dl className="mt-1 space-y-0.5">
            {PASTURE_RATING_GUIDE.map((row) => (
              <div key={row.category} className="flex items-baseline justify-between gap-3">
                <dt className="text-gray-500">{row.category}</dt>
                <dd className="shrink-0 font-medium text-gray-700">{row.values[q]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-gray-500">
          {fromSat && rel
            ? `The rating itself was measured from satellite${p.grass_quality_set_on ? ` on ${p.grass_quality_set_on}` : ''}, ${rel}× the middle paddock on this ranch. Pick one by hand and it stays picked.`
            : fromSat
              ? 'The rating is not measured yet: there is irrigated cropland inside this fence, so the satellite sees mostly crop.'
              : 'The rating was set by hand, so the satellite pass leaves this one alone.'}{' '}
          <Link to="/cattle-settings?tab=map" className="font-medium text-brand-700 hover:underline">
            Both tables in full
          </Link>
          .
        </p>
      </InfoPopover>
    </span>
  )
}
