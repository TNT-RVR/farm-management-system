import { InfoPopover } from '@/components/InfoPopover'
import { CATTLE_HELP, type CattleHelp, type CattleHelpKey } from '@/lib/cattle-help'

/**
 * An info button for one of the cattle planning numbers: what it is, and what
 * moving it does.
 *
 * `hover` and `className` are for the ones that sit in a table header: a column
 * explains itself on the way past (Sam, 29 Oct 2026), and the header bar is
 * brand green, where the button's own grey would all but disappear.
 */
export function CattleInfo({
  k,
  label,
  hover,
  className,
}: {
  k: CattleHelpKey
  label?: string
  hover?: boolean
  className?: string
}) {
  const h: CattleHelp = CATTLE_HELP[k]
  return (
    <InfoPopover title={h.title} label={label} hover={hover} className={className}>
      <div className="space-y-2 text-xs leading-relaxed text-gray-700">
        {h.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {h.how && (
          <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-900">
            <p className="font-semibold">{h.howLabel ?? 'How to find your number'}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {h.how.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </InfoPopover>
  )
}
