import { InfoPopover } from '@/components/InfoPopover'
import { CATTLE_HELP, type CattleHelp, type CattleHelpKey } from '@/lib/cattle-help'

/** An info button for one of the cattle planning numbers: what it is, and what moving it does. */
export function CattleInfo({ k, label }: { k: CattleHelpKey; label?: string }) {
  const h: CattleHelp = CATTLE_HELP[k]
  return (
    <InfoPopover title={h.title} label={label}>
      <div className="space-y-2 text-xs leading-relaxed text-gray-700">
        {h.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {h.how && (
          <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-900">
            <p className="font-semibold">How to find your number</p>
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
