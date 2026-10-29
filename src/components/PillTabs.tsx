import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, matchPath, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fitMeasured } from '@/lib/fitTabs'

/**
 * The one place the look is defined. Both variants read from it, so a change
 * here reaches the state tabs and the routed ones together — which is the whole
 * reason there is a component rather than a class string people copy.
 */
export const PILL_BASE = 'rounded-md px-3 py-1 text-sm font-medium transition-colors'
export const PILL_ON = 'bg-brand-700 text-white'
export const PILL_OFF = 'text-gray-600 hover:bg-gray-100'

/** A pill on the row: never shrinks, never breaks its label over two lines. */
const PILL_ROW = 'shrink-0 whitespace-nowrap'

/** A tab in the ▾ list — a full-width row tall enough for a thumb. */
const MENU_ITEM =
  'block w-full whitespace-nowrap px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none'

type Measure = { width: number; widths: number[]; more: number; gap: number }

const sameMeasure = (a: Measure | null, b: Measure) =>
  !!a &&
  a.width === b.width &&
  a.more === b.more &&
  a.gap === b.gap &&
  a.widths.length === b.widths.length &&
  a.widths.every((w, i) => w === b.widths[i])

/**
 * One row of tabs that never wraps and never scrolls.
 *
 * Sam, 24 Oct 2026: "One tab bar, six tabs at most, one row, no scrolling…
 * I would prefer that there is just a little drop down arrow that expands
 * additional options." So the tabs that fit show; the rest sit behind a ▾ at
 * the end of the bar; and the tab you're on always shows, even when it's one
 * from the list.
 *
 * Widths come from a hidden copy of every tab laid out off to the side, so
 * they're known before the first paint (a layout effect measures, the row
 * draws once) and a tab that is currently in the list still has a width.
 * That copy also sits in the flow at zero height, which keeps the bar's
 * natural width at "all the tabs" — in a flex row beside other controls the
 * bar still claims the room it would like and gives tabs back when it gets it.
 */
function TabRow({
  count,
  activeIndex,
  className,
  tablist,
  label,
  pill,
  menuItem,
}: {
  count: number
  activeIndex: number
  className?: string
  /** State tabs are a tablist; route tabs are plain links. */
  tablist: boolean
  label: (i: number) => React.ReactNode
  /** The visible tab. Must carry its own key. */
  pill: (i: number, className: string) => React.ReactNode
  /** The tab as a row in the ▾ list. Must carry its own key. */
  menuItem: (i: number, className: string, close: () => void) => React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<Measure | null>(null)
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)

  const measure = useCallback(() => {
    const box = boxRef.current
    const probe = probeRef.current
    if (!box || !probe) return
    const cs = getComputedStyle(box)
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const kids = Array.from(probe.children) as HTMLElement[]
    // Round against ourselves: a tab given half a pixel too few wraps nothing
    // here, but the ▾ would end up hanging off the edge.
    const next: Measure = {
      width: Math.floor(box.clientWidth - pad),
      widths: kids.slice(0, count).map((k) => Math.ceil(k.getBoundingClientRect().width)),
      more: Math.ceil(kids[count]?.getBoundingClientRect().width ?? 0),
      gap: parseFloat(getComputedStyle(probe).columnGap) || 0,
    }
    setM((prev) => (sameMeasure(prev, next) ? prev : next))
  }, [count])

  // Every render: labels carry counts that change, and it is cheap. Setting
  // the same numbers back is a no-op, so this settles in one pass.
  useLayoutEffect(() => measure())

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    if (boxRef.current) ro.observe(boxRef.current)
    // The copy's own size moves when a label changes or a web font lands.
    if (probeRef.current) ro.observe(probeRef.current)
    return () => ro.disconnect()
  }, [measure])

  // A bar not laid out yet (hidden, or a test without a browser) has no width,
  // and one whose tab count just changed still holds the old widths; either
  // way showing every tab is the honest fallback, not showing none.
  const all = Array.from({ length: count }, (_, i) => i)
  const { shown, overflow } = fitMeasured(m, count, activeIndex)
  const menuOpen = open && overflow.length > 0

  // Picking a tab closes the list; Escape also hands focus back to the ▾.
  const close = useCallback(() => setOpen(false), [])

  // Outside click closes it.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  // Opening puts focus on the first tab in the list, so the arrow keys work
  // straight away.
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menuOpen])

  const toggle = () => {
    if (!open && wrapRef.current) {
      // Open towards the side with room: a ▾ near the right edge of a phone
      // drops its list leftwards rather than off the screen.
      const r = wrapRef.current.getBoundingClientRect()
      setAlignRight(r.left + 224 > window.innerWidth - 8)
    }
    setOpen((o) => !o)
  }

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => items[(i + items.length) % items.length]?.focus()
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      close()
      moreRef.current?.focus()
    }
    else if (e.key === 'Tab') return close()
    else return
    e.preventDefault()
  }

  const pillClass = (i: number) => cn(PILL_BASE, PILL_ROW, i === activeIndex ? PILL_ON : PILL_OFF)
  const moreClass = cn(PILL_BASE, PILL_ROW, PILL_OFF, 'flex items-center gap-0.5')
  const moreBody = (n: number) => (
    <>
      <span>+{n}</span>
      <ChevronDown className="h-4 w-4" />
    </>
  )

  return (
    <div ref={boxRef} className={cn('relative min-w-0 border-b border-gray-200 pb-2', className)}>
      <div aria-hidden className="pointer-events-none invisible h-0 overflow-hidden">
        <div ref={probeRef} className="flex w-max gap-1">
          {all.map((i) => (
            <span key={i} className={pillClass(i)}>
              {label(i)}
            </span>
          ))}
          <span className={moreClass}>{moreBody(count)}</span>
        </div>
      </div>
      <div role={tablist ? 'tablist' : undefined} className="flex min-w-0 flex-nowrap items-center gap-1">
        {shown.map((i) => pill(i, pillClass(i)))}
        {overflow.length > 0 && (
          <div ref={wrapRef} className="relative shrink-0">
            <button
              ref={moreRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`${overflow.length} more ${overflow.length === 1 ? 'tab' : 'tabs'}`}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && !open) {
                  e.preventDefault()
                  toggle()
                }
              }}
              className={cn(moreClass, menuOpen && 'bg-gray-100')}
            >
              {moreBody(overflow.length)}
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                onKeyDown={onMenuKey}
                className={cn(
                  'absolute top-full z-40 mt-1 max-h-[70vh] min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg',
                  alignRight ? 'right-0' : 'left-0',
                )}
              >
                {overflow.map((i) => menuItem(i, MENU_ITEM, close))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The tab bar the irrigation section uses everywhere.
 *
 * It existed three times in slightly different forms — the turbine station had
 * filled pills, AIMM and River had small underlined text, General Info had big
 * uppercase underlines — so moving between them looked like moving between
 * three applications. This is the turbine one, which was the best of them: a
 * filled pill reads as a chosen thing at a glance, and it survives being
 * tapped with a glove on better than a two-pixel underline.
 *
 * Shared rather than copied, because the reason there were three was that each
 * was written where it was needed.
 */
/**
 * `label` takes a node, not just a string, so a tab can carry a count beside
 * its name without the count having to be styled into the same word.
 */
export type PillTab<K extends string> = { key: K; label: React.ReactNode }

export function PillTabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly PillTab<K>[]
  value: K
  onChange: (key: K) => void
  className?: string
}) {
  if (tabs.length === 0) return null
  return (
    <TabRow
      tablist
      count={tabs.length}
      activeIndex={tabs.findIndex((t) => t.key === value)}
      className={className}
      label={(i) => tabs[i].label}
      pill={(i, cls) => (
        <button
          key={tabs[i].key}
          type="button"
          role="tab"
          aria-selected={value === tabs[i].key}
          onClick={() => onChange(tabs[i].key)}
          className={cls}
        >
          {tabs[i].label}
        </button>
      )}
      menuItem={(i, cls, close) => (
        <button
          key={tabs[i].key}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            close()
            onChange(tabs[i].key)
          }}
          className={cls}
        >
          {tabs[i].label}
        </button>
      )}
    />
  )
}

/**
 * The same tabs, when each is its own route.
 *
 * Sections built from routes — Tasks/Checklists, Calendar/Monthly, a field's
 * sections — need real links so the address bar and the back button keep
 * working. Only the mechanism differs; the look must not, or the app has two
 * kinds of tab again.
 *
 * `activeTo` names the tab that is on when the address alone can't say — a
 * field's /notes opens the Overview tab, which a route match would miss.
 */
export function PillNavTabs({
  tabs,
  className,
  activeTo,
}: {
  tabs: readonly { to: string; label: React.ReactNode; end?: boolean }[]
  className?: string
  activeTo?: string
}) {
  const { pathname } = useLocation()
  if (tabs.length === 0) return null
  // Matched the way NavLink matches (`end` = exact), but here, so the bar
  // knows which tab must stay out of the ▾ list.
  const activeIndex =
    activeTo !== undefined
      ? tabs.findIndex((t) => t.to === activeTo)
      : tabs.findIndex(
          (t) => !!matchPath({ path: t.to.split('?')[0].split('#')[0], end: !!t.end }, pathname),
        )
  return (
    <TabRow
      tablist={false}
      count={tabs.length}
      activeIndex={activeIndex}
      className={className}
      label={(i) => tabs[i].label}
      pill={(i, cls) => (
        <Link
          key={tabs[i].to}
          to={tabs[i].to}
          aria-current={i === activeIndex ? 'page' : undefined}
          className={cls}
        >
          {tabs[i].label}
        </Link>
      )}
      menuItem={(i, cls, close) => (
        <Link key={tabs[i].to} to={tabs[i].to} role="menuitem" tabIndex={-1} onClick={close} className={cls}>
          {tabs[i].label}
        </Link>
      )}
    />
  )
}
