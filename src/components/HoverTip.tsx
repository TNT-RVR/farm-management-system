import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const WIDTH = 256
const DELAY_MS = 250

/**
 * A short card that appears when the mouse rests on something, saying what it
 * is (the map's layer names, Sam 29 Oct 2026).
 *
 * Mouse only: a tap on a phone is a choice, not a question, so it never opens
 * there. Also opens on keyboard focus. Drawn `fixed` in a portal, because the
 * map's layer panel scrolls and would clip a card positioned inside it.
 */
export function HoverTip({
  title,
  text,
  children,
  className,
}: {
  title: string
  text: string
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const id = useId()

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }
  const hide = () => {
    clear()
    setPos(null)
  }
  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const margin = 8
    const w = Math.min(WIDTH, window.innerWidth - margin * 2)
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin)
    // Below, unless that runs off the bottom of the screen.
    setPos(r.bottom + 140 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const show = (now = false) => {
    clear()
    if (now) place()
    else timer.current = window.setTimeout(place, DELAY_MS)
  }

  useEffect(() => clear, [])
  // Scrolling moves the thing under the card; take the card away.
  const open = pos != null
  useEffect(() => {
    if (!open) return
    const onScroll = () => setPos(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  return (
    <span
      ref={ref}
      className={cn('inline-flex', className)}
      aria-describedby={pos ? id : undefined}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => e.target.matches(':focus-visible') && show(true)}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(WIDTH, window.innerWidth - 16) }}
            className="pointer-events-none fixed z-[60] rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-gray-700 shadow-lg"
          >
            <span className="mb-0.5 block font-semibold text-gray-900">{title}</span>
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
