import type { CSSProperties, ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Eye, EyeOff, GripVertical, MoreHorizontal } from 'lucide-react'
import { isViewDenied, useNavLayout, type NavChild, type NavItem } from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { isPathOff, useDisabledPaths } from '@/lib/farm-setup'
import { cn } from '@/lib/utils'

/*
 * The parts of the old-menu sidebar that draw it, shared by the plain version
 * (SidebarNav.tsx, in the entry chunk) and the drag-to-reorder one
 * (SidebarNavDnd.tsx, loaded with @dnd-kit when reordering is opened). Both
 * render the same markup, so swapping one for the other changes nothing on
 * screen.
 */

/** What the sidebar keeps between the plain and drag versions, so the swap loses nothing. */
export type NavUi = {
  /**
   * Which group is expanded, or null for "whichever one you are inside".
   *
   * One value, so opening a group closes the last one — a sidebar with every
   * group expanded is the long list this was meant to shorten.
   */
  openGroup: string | null
  setOpenGroup: (g: string | null) => void
  moreOpen: boolean
  setMoreOpen: (f: (o: boolean) => boolean) => void
  /**
   * On a phone the menu is a menu: a tap held a fifth of a second started a
   * drag and swallowed the tap, so items "did nothing" (Sam, 22 Oct 2026).
   * Reordering and hiding wait for Edit menu.
   */
  editing: boolean
  setEditing: (f: (e: boolean) => boolean) => void
}

export type NavProps = { onNavigate?: () => void; variant: 'sidebar' | 'sheet'; ui: NavUi }

/** What a sortable row hands its view; nothing for the plain sidebar. */
export type DragBits = {
  setNodeRef?: (el: HTMLElement | null) => void
  style?: CSSProperties
  isDragging?: boolean
  /** The sortable's attributes and listeners, spread on the row. */
  props?: Record<string, unknown>
}

export function NavRowView({
  navKey,
  item,
  onToggle,
  onNavigate,
  inMore,
  openGroup,
  onOpenGroup,
  dragOn = true,
  editing = false,
  drag,
  renderKids,
}: {
  navKey: string
  /** Resolved against saved prefs, so its children are in the saved order. */
  item: NavItem
  onToggle: (key: string) => void
  onNavigate?: () => void
  inMore: boolean
  openGroup: string | null
  onOpenGroup: (key: string | null) => void
  /** Rows drag only when this is on: on a phone, only in Edit menu (Sam, 22 Oct 2026). */
  dragOn?: boolean
  /** Editing on a phone: the eye always shows, as there is no hover to reveal it. */
  editing?: boolean
  drag?: DragBits
  /** The open group's sub-views: sortable in the drag version, plain links otherwise. */
  renderKids: (kids: NavChild[]) => ReactNode
}) {
  const Icon = item.icon
  const { pathname } = useLocation()
  const { profile } = useAuth()
  // A child an admin has closed off never appears, same as a top-level section.
  const off = useDisabledPaths()
  const kids = (item.children ?? []).filter((c) => !isViewDenied(profile, c.to) && !isPathOff(off, c.to))
  const hasKids = kids.length > 0
  const childActive = kids.some((c) => pathname === c.to || pathname.startsWith(c.to + '/'))
  // Which group is open lives one level up, so opening one closes the other —
  // a sidebar with every group expanded is the list this was meant to shorten.
  // Falling back to childActive means the right one is open when you arrive by
  // address or reload, without anybody having clicked.
  // '' is "explicitly nothing open", which null cannot express — null means
  // "whichever group you are inside", so it cannot be used to collapse.
  const open = openGroup === null ? childActive : openGroup === item.to

  return (
    <>
      <div
        ref={drag?.setNodeRef}
        style={drag?.style}
        className={cn('group relative flex items-center', drag?.isDragging && 'z-10 opacity-60')}
        {...drag?.props}
      >
        {hasKids ? (
          // No stopPropagation here: the drag sensor only takes a press that
          // travels 6 px (or a held touch), so a tap still opens the group, and
          // stopping the press made every group row impossible to drag.
          <button
            type="button"
            onClick={() => onOpenGroup(open ? null : item.to)}
            aria-expanded={open}
            className={cn(
              'flex flex-1 items-center gap-3 rounded-md py-2 pl-2 pr-8 text-left text-sm font-medium transition-colors',
              // Highlighted while you are inside one of its children, so the menu
              // still says where you are.
              childActive ? 'bg-brand-800 text-white' : 'text-gray-700 hover:bg-gray-100',
            )}
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-300 opacity-0 transition-opacity group-hover:opacity-100" />
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        ) : (
          <NavLink
            to={item.to}
            onClick={() => {
              // Picking a different view closes the group that was open.
              onOpenGroup(null)
              onNavigate?.()
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 items-center gap-3 rounded-md py-2 pl-2 pr-8 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-800 text-white' : 'text-gray-700 hover:bg-gray-100',
              )
            }
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-300 opacity-0 transition-opacity group-hover:opacity-100" />
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        )}
        <button
          // stopPropagation on pointer-down keeps the drag sensor from claiming
          // this click, so the toggle stays reliably tappable inside a draggable row.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToggle(navKey)}
          aria-label={inMore ? `Show ${item.label} in sidebar` : `Move ${item.label} to More`}
          title={inMore ? 'Show in sidebar' : 'Move to More'}
          className={cn(
            'absolute right-1 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 group-hover:opacity-100',
            editing ? 'p-2 text-gray-500 opacity-100' : 'opacity-0',
            // Out of the way of taps on a phone when not editing.
            !dragOn && 'pointer-events-none',
          )}
        >
          {inMore ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Sub-sections, indented under the parent. */}
      {open && kids.length > 0 && <div className="mb-1 ml-6 border-l border-gray-200 pl-2">{renderKids(kids)}</div>}
    </>
  )
}

export function ChildRowView({ child, onNavigate, drag }: { child: NavChild; onNavigate?: () => void; drag?: DragBits }) {
  const CIcon = child.icon
  return (
    <div
      ref={drag?.setNodeRef}
      style={drag?.style}
      className={cn('group/child relative flex items-center', drag?.isDragging && 'z-10 opacity-60')}
      {...drag?.props}
    >
      <NavLink
        to={child.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-600 hover:bg-gray-100',
          )
        }
      >
        <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-gray-300 opacity-0 transition-opacity group-hover/child:opacity-100" />
        <CIcon className="h-3.5 w-3.5 shrink-0" />
        {child.label}
      </NavLink>
    </div>
  )
}

/** The "More" nav item: a drop target (in the drag version) that toggles a dropdown of hidden views. */
export function MoreButtonView({
  open,
  selected,
  onToggle,
  setNodeRef,
  isOver,
}: {
  open: boolean
  selected: boolean
  onToggle: () => void
  setNodeRef?: (el: HTMLElement | null) => void
  isOver?: boolean
}) {
  return (
    <button
      ref={setNodeRef}
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'flex w-full items-center gap-3 rounded-md py-2 pl-2 pr-3 text-sm font-medium transition-colors',
        selected ? 'bg-brand-800 text-white' : 'text-gray-700 hover:bg-gray-100',
        isOver && 'ring-2 ring-brand-400',
      )}
    >
      <span className="h-4 w-4 shrink-0" />
      <MoreHorizontal className="h-4 w-4 shrink-0" />
      More
      <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
    </button>
  )
}

export function DropPanelView({ children, setNodeRef, isOver }: { children: ReactNode; setNodeRef?: (el: HTMLElement | null) => void; isOver?: boolean }) {
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mt-1 flex min-h-[2.25rem] flex-col gap-1 rounded-md border border-gray-200 bg-gray-50 p-1',
        isOver && 'border-brand-300 bg-brand-50',
      )}
    >
      {children}
    </div>
  )
}

/**
 * Everything around the two lists: the phone's Edit menu bar, More, and the
 * pinned views. `onWake` is the plain sidebar's cue to fetch the drag code.
 */
export function NavFrame({
  variant,
  ui,
  hiddenKeys,
  dragging = false,
  visibleList,
  hiddenList,
  moreButton,
  onWake,
  onNavigate,
}: {
  variant: 'sidebar' | 'sheet'
  ui: NavUi
  hiddenKeys: string[]
  dragging?: boolean
  visibleList: ReactNode
  hiddenList: ReactNode
  /** The More button; the plain one when not given. */
  moreButton?: (props: { open: boolean; selected: boolean; onToggle: () => void }) => ReactNode
  onWake?: () => void
  onNavigate?: () => void
}) {
  const layout = useNavLayout()
  const { pathname } = useLocation()
  const { editing, setEditing, moreOpen, setMoreOpen } = ui
  const activeRouteHidden = hiddenKeys.some((k) => pathname === k || pathname.startsWith(k + '/'))
  const showHidden = variant === 'sheet' || moreOpen || dragging
  const more = { open: moreOpen, selected: moreOpen || activeRouteHidden, onToggle: () => setMoreOpen((o) => !o) }
  return (
    // min-h-full so the pinned block's mt-auto reaches the bottom of a short
    // sidebar, while still flowing after the list when it overflows.
    <div className="flex min-h-full flex-col gap-1" onPointerEnter={onWake} onFocus={onWake}>
      {variant === 'sheet' && (
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <span className="text-[11px] text-gray-400">{editing ? 'Hold and drag to reorder · tap the eye to hide' : ''}</span>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs font-medium',
              editing ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-600',
            )}
          >
            {editing ? 'Done' : 'Edit menu'}
          </button>
        </div>
      )}
      {visibleList}

      {variant === 'sheet' ? (
        <>
          <div className="mt-2 flex items-center gap-1.5 px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <MoreHorizontal className="h-3.5 w-3.5" /> More
          </div>
          {hiddenList}
        </>
      ) : (
        <div className="mt-1">
          {moreButton ? moreButton(more) : <MoreButtonView {...more} />}
          {showHidden && hiddenList}
        </div>
      )}

      {/* Pinned to the bottom and outside the drag context: Settings is where
          you go to undo a nav change, so it must never be draggable or hidden. */}
      {layout.pinned.length > 0 && (
        <div className="mt-auto flex flex-col gap-1 border-t border-gray-200 pt-2">
          {layout.pinned.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md py-2 pl-2 pr-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-800 text-white' : 'text-gray-700 hover:bg-gray-100',
                )
              }
            >
              <span className="h-4 w-4 shrink-0" />
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
