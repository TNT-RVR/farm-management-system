import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'

/**
 * What the soil-test highlighting means, behind an info button.
 *
 * Colour with no key is a guessing game, and these numbers get read by people
 * who did not choose the bands. The same four words on the Fertilizer page
 * and the field page; the classes differ because one highlights a cell and
 * the other colours a figure, so the caller passes its own.
 */
export function RatingLegendInfo({
  classes,
  compact = false,
}: {
  classes: Record<string, string>
  /** The field card's short form: the four words only, without the rating notes. */
  compact?: boolean
}) {
  const items: { rating: string; label: string; note: string }[] = [
    { rating: 'low', label: 'Low', note: 'below the usual sufficiency range' },
    { rating: 'marginal', label: 'Marginal', note: 'adequate for some crops, short for others' },
    { rating: 'ok', label: 'Adequate', note: 'no highlight' },
    { rating: 'high', label: 'High', note: 'above the range — for sodium and salts, a problem' },
  ]
  return (
    <InfoPopover title="Highlighting" hover width={compact ? 380 : 460}>
      <div className="flex flex-col gap-1.5">
        {items.map((i) => (
          <span key={i.rating} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className={cn(
                'rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                i.rating === 'ok' ? 'border-gray-200 text-gray-700' : 'border-transparent',
                classes[i.rating],
              )}
            >
              {i.label}
            </span>
            <span className="text-gray-500">{i.note}</span>
          </span>
        ))}
      </div>
      {compact ? (
        <p className="mt-2">
          Topsoil averages across the field’s sample sites, rated against typical prairie ranges.
          Nitrate is summed through the profile because lb/ac adds between depths; sulphate is a
          concentration and is not. Open a figure’s info button for that column’s ranges.
        </p>
      ) : (
        <>
          <p className="mt-2 font-medium text-gray-800">What gets rated, and what does not</p>
          <p>
            Only topsoil rows are rated, and only the columns with a well-established sufficiency
            range — organic matter, both phosphorus tests, potassium, the micronutrients, sodium
            and salts.
          </p>
          <p>
            <b>Nitrate</b> is in lb/ac, which is an amount and so adds between depths: each core is
            rated against its share of the 0–24″ scale, and the field total is rated at the top of
            the report.
          </p>
          <p>
            <b>Sulphate</b> is in ppm, a concentration — it reads the same at either depth and is
            never added between them, so each core is rated directly.
          </p>
          <p>
            pH, CEC and %Ca are left plain because they are context rather than good or bad. The
            info button on each heading gives that column&rsquo;s ranges and marks the one this
            field is in.
          </p>
        </>
      )}
    </InfoPopover>
  )
}
