import { Info, X } from 'lucide-react'
import { useAnchoredPanel } from '@/lib/useAnchoredPanel'
import { cn } from '@/lib/utils'
import { bandFor, type ColumnHelp as Help } from '@/lib/column-help'

/**
 * "What is this column?" popover for a table header.
 *
 * Positioned `fixed` rather than `absolute` on purpose: these sit inside a
 * table wrapped in `overflow-x-auto`, which would clip an absolutely positioned
 * panel to the scroll box. Fixed descendants escape that clipping, which is the
 * same reason Modal is fixed rather than portalled.
 *
 * Click to open, not hover — the panels carry several paragraphs and a worked
 * example, which is not something to read while holding a mouse still, and
 * hover does not exist on the tablet these get read on in the field.
 */
const BAND_CLASS: Record<string, string> = {
  low: 'bg-red-50 text-red-900 ring-red-300',
  marginal: 'bg-amber-50 text-amber-900 ring-amber-300',
  ok: 'bg-emerald-50 text-emerald-900 ring-emerald-300',
  high: 'bg-sky-50 text-sky-900 ring-sky-300',
}

export function ColumnHelp({
  help,
  children,
  width = 440,
  value,
  valueLabel,
  note,
}: {
  help: Help
  /** Extra content below the text — the soil guide passes its swatches here. */
  children?: React.ReactNode
  width?: number
  /** This field's own result, so the band it falls in can be marked. */
  value?: number | null
  /** How to render that result, e.g. "12.4 ppm (field average)". */
  valueLabel?: string
  /** Generated commentary for this column on this report. */
  note?: { summary?: string; priorCrop?: string; nextCrop?: string } | null
}) {
  const hit = bandFor(help, value)
  const { open, setOpen, btnRef, panelRef, pos } = useAnchoredPanel(width)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ml-1 inline-flex shrink-0 align-middle text-gray-400 hover:text-brand-700"
        aria-label={`About ${help.title}`}
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={help.title}
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
          className="fixed z-50 overflow-y-auto overflow-x-hidden overscroll-contain whitespace-normal break-words rounded-lg border border-gray-200 bg-white p-3 text-left normal-case tracking-normal shadow-xl"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{help.title}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-mr-1 -mt-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {help.body.map((para, i) => (
            <p key={i} className="mt-1.5 text-xs font-normal leading-relaxed text-gray-600">
              {para}
            </p>
          ))}

          {help.ranges && (
            <div className="mt-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {help.ranges.label}
              </p>
              {valueLabel && (
                <p className="mt-0.5 text-xs font-medium text-gray-700">
                  This field: <span className="tabular-nums">{valueLabel}</span>
                </p>
              )}
              <ul className="mt-1 space-y-0.5">
                {help.ranges.bands.map((band) => {
                  const isHit = hit === band
                  return (
                    <li
                      key={band.label}
                      className={cn(
                        'rounded px-1.5 py-1 text-xs font-normal leading-relaxed',
                        // The band this field is actually in gets a ring rather
                        // than only a tint, so it is findable at a glance in a
                        // list where several rows are already coloured.
                        isHit ? `font-medium ring-1 ${BAND_CLASS[band.rating]}` : 'text-gray-600',
                      )}
                    >
                      <span className="font-semibold">{band.label}</span>
                      <span className={isHit ? '' : 'text-gray-500'}>
                        {' — '}
                        {band.note}
                      </span>
                      {isHit && <span className="ml-1 text-[10px] uppercase tracking-wide">← this field</span>}
                    </li>
                  )
                })}
              </ul>
              {help.ranges.footnote && (
                <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{help.ranges.footnote}</p>
              )}
            </div>
          )}

          {note && (note.summary || note.priorCrop || note.nextCrop) && (
            <div className="mt-2.5 rounded-md border border-brand-100 bg-brand-50/60 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800">
                For this field
              </p>
              {note.summary && (
                <p className="mt-1 text-xs font-normal leading-relaxed text-gray-700">{note.summary}</p>
              )}
              {note.priorCrop && (
                <p className="mt-1 text-xs font-normal leading-relaxed text-gray-600">
                  <span className="font-medium text-gray-700">Last crop: </span>
                  {note.priorCrop}
                </p>
              )}
              {note.nextCrop && (
                <p className="mt-1 text-xs font-normal leading-relaxed text-gray-600">
                  <span className="font-medium text-gray-700">Next crop: </span>
                  {note.nextCrop}
                </p>
              )}
            </div>
          )}

          {help.how && (
            <div className="mt-2.5 rounded-md bg-gray-50 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {help.how.label}
              </p>
              <ul className="mt-1 space-y-1">
                {help.how.lines.map((line, i) => (
                  <li key={i} className="text-xs font-normal leading-relaxed text-gray-600">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {children}
        </div>
      )}
    </>
  )
}
