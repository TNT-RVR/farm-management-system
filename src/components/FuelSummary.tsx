import { Link } from 'react-router-dom'
import { Fuel } from 'lucide-react'
import { sumFuel, type OpFuel } from '@/lib/fuel'
import { cn } from '@/lib/utils'

const L = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-CA')} L`
const $ = (v: number) => v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })

const BASIS: Record<OpFuel['inField']['basis'], string> = {
  logged: 'logged',
  farm: 'estimated',
  default: 'estimated',
  none: '',
}

/**
 * One pass's fuel: in the field, and the road to it and back. The words say
 * which half was measured and which estimated, because a logged 41 L and an
 * estimated 41 L are not the same claim.
 */
export function PassFuel({ fuel, dieselPerL }: { fuel: OpFuel; dieselPerL: number }) {
  if (fuel.inField.basis === 'none') return null
  const t = fuel.travel
  return (
    <div className="mt-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        <Fuel className="h-3.5 w-3.5" /> Fuel
      </h4>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm text-gray-700">
        <span>
          <span className="font-semibold tabular-nums">{L(fuel.inField.litres)}</span>{' '}
          <span className={cn('text-gray-500', fuel.inField.basis !== 'logged' && 'italic')}>in the field, {BASIS[fuel.inField.basis]}</span>
        </span>
        {t && (
          <span>
            <span className="font-semibold tabular-nums">{L(t.litres)}</span>{' '}
            <span className="text-gray-500">
              to the field and back · {t.trips} trip{t.trips === 1 ? '' : 's'}, {Math.round(t.km)} km, {t.hours < 1 ? `${Math.round(t.hours * 60)} min` : `${t.hours.toFixed(1)} h`}
            </span>
          </span>
        )}
        <span className="ml-auto font-medium tabular-nums text-gray-900">{$(fuel.litres * dieselPerL)}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-400">
        {fuel.inField.note[0].toUpperCase() + fuel.inField.note.slice(1)}.{t?.note ? ` Road: ${t.note}` : ''}
      </p>
    </div>
  )
}

/** Every shown pass's fuel added up, for the head of the Work list. */
export function FuelTotal({ rows, dieselPerL, acres }: { rows: OpFuel[]; dieselPerL: number; acres: number | null }) {
  const s = sumFuel(rows)
  if (s.litres <= 0) return null
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <span className="font-medium text-gray-900">{$(s.litres * dieselPerL)}</span>
      <span className="text-gray-500">
        {' '}
        in fuel across these passes{acres ? ` · ${$((s.litres * dieselPerL) / acres)}/ac` : ''} — {L(s.inField)} in the field
        {s.logged > 0 && s.logged < s.inField ? ` (${L(s.logged)} of it logged by the machines)` : s.logged > 0 ? ' (logged by the machines)' : ' (estimated)'}, {L(s.travel)} driving to it
        and back ({Math.round(s.travelKm)} km) · diesel ${dieselPerL.toFixed(2)}/L ·{' '}
        <Link to="/hauling?tab=fuel" className="text-brand-700 underline decoration-dotted">
          how it is worked out
        </Link>
      </span>
    </div>
  )
}
