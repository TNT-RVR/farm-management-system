import { InfoPopover } from '@/components/InfoPopover'
import { FEED_HELP, type HelpKey } from '@/lib/feed-help'

/** An info button for one of the winter-feeding numbers: what it is, where it comes from, how to find yours. */
export function FeedInfo({ k, label }: { k: HelpKey; label?: string }) {
  const h = FEED_HELP[k]
  return (
    <InfoPopover title={h.title} label={label}>
      <div className="space-y-2 text-xs leading-relaxed text-gray-700">
        {h.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {'how' in h && h.how && (
          <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-900">
            <p className="font-semibold">How to find your number</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {h.how.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {'source' in h && h.source && <p className="text-[11px] text-gray-400">Source: {h.source}</p>}
      </div>
    </InfoPopover>
  )
}
