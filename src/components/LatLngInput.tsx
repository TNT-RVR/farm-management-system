import { locationProblem } from '@/lib/road-routes'
import { farmCentre } from '@/lib/latlng-text'
import { cn } from '@/lib/utils'

/**
 * One box for a place: "lat, lng" or a Google Maps link pasted whole, in
 * place of separate latitude and longitude boxes. Says underneath when the
 * text is not a location, or is far enough from the farm to be a slip.
 * Read it back with readLatLng (lib/latlng-text); start it with latLngText.
 */
export function LatLngInput({
  value,
  onChange,
  className,
  placeholder = 'lat, lng or a Google Maps link',
  ariaLabel,
}: {
  value: string
  onChange: (text: string) => void
  className?: string
  placeholder?: string
  ariaLabel?: string
}) {
  const problem = locationProblem(value, farmCentre())
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn('w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm', className)}
      />
      {problem && <span className="mt-0.5 block text-[11px] font-normal text-amber-700">{problem}</span>}
    </>
  )
}
