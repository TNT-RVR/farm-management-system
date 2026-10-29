import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, ChevronDown, Plus, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One Move button for everything that changes what is in a bin (Sam,
 * 26 Oct 2026: "simpler having it under one button instead of 2–3"): add to
 * it (bought seed, fertilizer, grain left from an earlier year), move it to
 * another bin, or ship it out. Moving and shipping need something in the bin.
 */
export function MoveMenu({
  held,
  onAdd,
  onMove,
  onShip,
  className,
}: {
  /** Whether there is grain in the bin to move or ship. */
  held: boolean
  onAdd: () => void
  onMove: () => void
  onShip: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (go: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(false)
    go()
  }
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50'

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={cn('flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50', className)}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" /> Move <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <span role="menu" className="absolute right-0 top-full z-40 mt-1 w-60 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {held && (
            <>
              <button type="button" role="menuitem" onClick={pick(onShip)} className={item}>
                <Truck className="h-4 w-4 text-brand-700" />
                <span>
                  Ship out
                  <span className="block text-[11px] text-gray-500">All or some, to a plant or picked up at the yard</span>
                </span>
              </button>
              <button type="button" role="menuitem" onClick={pick(onMove)} className={item}>
                <ArrowRightLeft className="h-4 w-4 text-brand-700" />
                <span>
                  To another bin
                  <span className="block text-[11px] text-gray-500">All or some of it</span>
                </span>
              </button>
            </>
          )}
          <button type="button" role="menuitem" onClick={pick(onAdd)} className={item}>
            <Plus className="h-4 w-4 text-brand-700" />
            <span>
              Add to this bin
              <span className="block text-[11px] text-gray-500">Bought seed, fertilizer, grain left from an earlier year</span>
            </span>
          </button>
        </span>
      )}
    </span>
  )
}
