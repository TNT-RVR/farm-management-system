import { BellRing } from 'lucide-react'
import { MOVE_DEFAULTS } from '@/lib/pasture-move'
import { useSetRanch, type Ranch } from '@/lib/ranches'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

type Key = 'move_days_left_min' | 'move_forage_index_min' | 'move_decline_pct' | 'move_dry_pct'

const FIELDS: { key: Key; label: string; unit: string; step: string; dflt: number; hint: string }[] = [
  {
    key: 'move_days_left_min',
    label: 'Days of grazing left',
    unit: 'days',
    step: '1',
    dflt: MOVE_DEFAULTS.daysLeftMin,
    hint: 'Say move when the forage estimate is down to this. Doubled in a dry year.',
  },
  {
    key: 'move_forage_index_min',
    label: 'Forage index floor',
    unit: '0–1',
    step: '0.01',
    dflt: MOVE_DEFAULTS.forageIndexMin,
    hint: 'Satellite forage index under which a stocked paddock is grazed down — when the rested paddocks are clearly greener.',
  },
  {
    key: 'move_decline_pct',
    label: 'Drop since turn-in',
    unit: '%',
    step: '1',
    dflt: MOVE_DEFAULTS.declinePct,
    hint: 'How much more the index may fall than the rested paddocks fell over the same days.',
  },
  {
    key: 'move_dry_pct',
    label: 'Dry year below',
    unit: '% of normal',
    step: '5',
    dflt: MOVE_DEFAULTS.dryPct,
    hint: 'Rain to date under this share of the 10-year average to date makes it a dry year.',
  },
]

/**
 * The thresholds for the daily "move the herd out?" alert, per ranch.
 *
 * On the Cattle settings tab, one card per ranch, because the two ranches
 * graze and dry out differently. Set once a season, so it no longer sits on
 * the Grazing tab that gets read daily. The check itself runs on the server
 * every morning.
 */
export function MoveAlertSettings({ ranch, isManager }: { ranch: Ranch; isManager: boolean }) {
  const setRanch = useSetRanch()
  const save = (patch: Parameters<typeof setRanch.mutate>[0]['patch']) => setRanch.mutate({ id: ranch.id, patch })

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <BellRing className="h-4 w-4 text-gray-400" /> Move-out alert — {ranch.name}
        </h2>
        {isManager && (
          <button
            onClick={() => save({ move_alerts_on: !ranch.move_alerts_on })}
            className={cn(
              'rounded border px-2 py-0.5 text-[11px] font-semibold',
              ranch.move_alerts_on ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500',
            )}
          >
            {ranch.move_alerts_on ? 'On' : 'Off'}
          </button>
        )}
      </div>
      <HelpNote
        className="mt-1 text-xs"
        summary="Tells the managers each morning when a herd should move."
        title="How the move-out alert works"
      >
        <p>
          Every morning the app looks at each paddock with a herd on it (from the collar import) and tells
          the managers when it is time to move: days of grazing left from the Grazing tab&apos;s forage
          estimate at this year&apos;s rain, less what the herd has eaten since it went in; the satellite
          forage index against the paddocks nobody grazed; and this year&apos;s rain against the last ten.
        </p>
        <ul className="list-disc space-y-1 pl-4">
          {FIELDS.map((f) => (
            <li key={f.key}>
              <b>{f.label}</b> — {f.hint} Default {f.dflt}.
            </li>
          ))}
        </ul>
      </HelpNote>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          // Keyed on the ranch too: the inputs are uncontrolled, and switching
          // ranch must show the other ranch's figure, not keep this one's.
          <label key={`${ranch.id}-${f.key}`} className="text-xs text-gray-600" title={`${f.hint} Default ${f.dflt}.`}>
            {f.label}
            <span className="mt-0.5 flex items-center gap-1">
              <input
                type="number"
                step={f.step}
                disabled={!isManager}
                defaultValue={ranch[f.key]}
                onBlur={(e) => {
                  const v = e.target.value === '' ? f.dflt : Number(e.target.value)
                  if (Number.isFinite(v) && v >= 0 && v !== Number(ranch[f.key])) save({ [f.key]: v })
                }}
                className="w-20 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent"
              />
              <span className="text-gray-400">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      {/* Sam, 5 Oct 2026: "calves will be at side till weaning either in November or later". */}
      <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-700"
          checked={ranch.move_count_calves}
          disabled={!isManager}
          onChange={(e) => save({ move_count_calves: e.target.checked })}
        />
        <span>
          Count the calves at side with the cows until weaning
          <span className="block text-[11px] text-gray-500">
            Calves wear no collars, so each cow in a mob is given a calf at the calves&apos; AU from the Herd tab
            {ranch.weaning_date
              ? `, until weaning on ${new Date(ranch.weaning_date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}.`
              : '. No weaning date is set (Weaning and calf sale, above), so they are counted all season.'}
          </span>
        </span>
      </label>
    </section>
  )
}
