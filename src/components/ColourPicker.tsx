import { useEffect, useRef, useState } from 'react'
import { isHexColour } from '@/lib/crop-colour'
import { cn } from '@/lib/utils'

/** How long after the last drag of the colour wheel the choice is saved. */
const SETTLE_MS = 400

/**
 * Choosing the colour a crop is drawn in.
 *
 * A circle of the current colour; clicking it opens the operating system's own
 * colour chooser, with no menu of suggestions in between — somebody picking a
 * crop colour has a colour in mind, and a list of twelve is a detour.
 *
 * There is no Save button because there is nothing to save separately: the
 * chooser reports every colour as you move through it, and the last one you
 * land on is written a moment after you stop. That means no state where the
 * circle shows one colour and the database holds another, which is what a Save
 * button quietly allows whenever somebody closes the dialog without pressing
 * it.
 */
export function ColourPicker({
  value,
  onCommit,
  disabled,
  ariaLabel,
  className,
}: {
  value: string
  /** Called once the choice settles. Safe to write straight to the database. */
  onCommit: (hex: string) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
}) {
  // Null except while a choice is in flight, so the circle otherwise shows
  // whatever is actually stored — including a change made on another screen.
  const [dragging, setDragging] = useState<string | null>(null)
  const shown = dragging ?? value

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const settle = (hex: string) => {
    setDragging(hex)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      commitRef.current(hex)
      // Held until the save comes back through the query cache; clearing it
      // here would flash the old colour for as long as the round trip takes.
      timer.current = null
    }, SETTLE_MS)
  }

  // Once the stored value has caught up, the local copy is redundant. Compared
  // during render rather than corrected in an effect: an effect would render
  // the stale colour once before fixing it, which is a visible flicker on a
  // page of thirty swatches.
  if (dragging && dragging.toLowerCase() === value.toLowerCase()) setDragging(null)

  return (
    <input
      type="color"
      disabled={disabled}
      aria-label={ariaLabel ?? 'Choose a colour'}
      value={isHexColour(shown) ? shown : '#16a34a'}
      onChange={(e) => settle(e.target.value)}
      onBlur={(e) => {
        // Leaving the control saves immediately rather than waiting out the
        // timer — a click straight onto the next crop must not lose this one.
        if (timer.current) {
          clearTimeout(timer.current)
          timer.current = null
          onCommit(e.target.value)
        }
      }}
      className={cn(
        // A plain circle of colour. The native control draws its own swatch
        // inside, so the padding and border-radius below are what turn a grey
        // rounded rectangle into it.
        'h-7 w-7 cursor-pointer rounded-full border border-black/15 bg-transparent p-0',
        'disabled:cursor-default disabled:opacity-50',
        '[&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0',
        '[&::-webkit-color-swatch-wrapper]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0',
        '[&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0',
        className,
      )}
    />
  )
}
