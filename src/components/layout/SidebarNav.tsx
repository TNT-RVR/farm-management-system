import { useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  type CollisionDetection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, Eye, EyeOff, GripVertical, MoreHorizontal } from 'lucide-react'
import {
  NAV_ITEMS,
  CHILD_PREFIX,
  allowedDropTargets,
  childId,
  isViewDenied,
  navEntryFor,
  parseChildId,
  useNavLayout,
  useSaveNavPrefs,
  type NavChild,
  type NavItem,
} from '@/lib/nav'
import { useAuth } from '@/lib/auth'
import { isPathOff, useDisabledPaths } from '@/lib/farm-setup'
import { cn } from '@/lib/utils'

// The DEFAULT shape of each section, before anybody's saved order is applied.
// Rows are handed their resolved item instead of looking themselves up here —
// this map has the sub-views in the order they were written in the source, and
// rendering from it is why a reordered sub-view sprang back to where it
// started however carefully it was dropped.
const DEFAULTS = new Map(NAV_ITEMS.map((i) => [i.to, i]))
type Lists = { visible: string[]; hidden: string[] }
type Container = keyof Lists

function SortableRow({
  navKey,
  item,
  onToggle,
  onNavigate,
  inMore,
  openGroup,
  onOpenGroup,
}: {
  navKey: string
  /** Resolved against saved prefs, so its children are in the saved order. */
  item: NavItem
  onToggle: (key: string) => void
  onNavigate?: () => void
  inMore: boolean
  openGroup: string | null
  onOpenGroup: (key: string | null) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: navKey,
  })
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
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn('group relative flex items-center', isDragging && 'z-10 opacity-60')}
        {...attributes}
        {...listeners}
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
          className="absolute right-1 rounded p-1 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 group-hover:opacity-100"
        >
          {inMore ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Sub-sections, indented under the parent. */}
      {open && kids.length > 0 && (
        <div className="mb-1 ml-6 border-l border-gray-200 pl-2">
          <SortableContext
            items={kids.map((c) => childId(item.to, c.to))}
            strategy={verticalListSortingStrategy}
          >
            {kids.map((c) => (
              <SortableChild key={c.to} parent={item.to} child={c} onNavigate={onNavigate} />
            ))}
          </SortableContext>
        </div>
      )}
    </>
  )
}

function SortableChild({
  parent,
  child,
  onNavigate,
}: {
  parent: string
  child: NavChild
  onNavigate?: () => void
}) {
  const id = childId(parent, child.to)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const CIcon = child.icon
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/child relative flex items-center', isDragging && 'z-10 opacity-60')}
      {...attributes}
      {...listeners}
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

/** The "More" nav item: a drop target that toggles a dropdown of hidden views. */
function MoreButton({
  open,
  selected,
  onToggle,
}: {
  open: boolean
  selected: boolean
  onToggle: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'more' })
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

function DropPanel({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hidden' })
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
 * Personally customizable navigation. Visible sidebar items reorder by drag;
 * dragging onto the "More" button (or the eye toggle) hides a view. "More" is a
 * nav-styled button that highlights when selected and opens a dropdown of hidden
 * views — pick one, or drag it back onto the main list. The dropdown also
 * auto-opens while dragging so views can move both ways. Persists to nav_prefs.
 * variant 'sheet' (mobile) shows the hidden list inline instead of collapsed.
 */
export function SidebarNav({
  onNavigate,
  variant = 'sidebar',
}: {
  onNavigate?: () => void
  variant?: 'sidebar' | 'sheet'
}) {
  const layout = useNavLayout()
  const save = useSaveNavPrefs()
  const { pathname } = useLocation()
  const fromLayout = (): Lists => ({
    visible: layout.visible.map((i) => i.to),
    hidden: layout.hidden.map((i) => i.to),
  })
  const [lists, setLists] = useState<Lists>(fromLayout)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /**
   * Which group is expanded, or null for "whichever one you are inside".
   *
   * One value, so opening a group closes the last one — a sidebar with every
   * group expanded is the long list this was meant to shorten.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  /** What was open before a drag folded it away. undefined = nothing to undo. */
  const groupBeforeDrag = useRef<string | null | undefined>(undefined)

  // Re-sync from the saved profile when it changes (another device, a new view)
  // — but not mid-drag. Adjusting state during render on a signature change is
  // React's recommended pattern; no effect, no cascade.
  const layoutSig =
    [...layout.visible, ...layout.hidden].map((i) => i.to).join() +
    '|' +
    layout.hidden.map((i) => i.to).join()
  const [syncedSig, setSyncedSig] = useState(layoutSig)
  if (layoutSig !== syncedSig && !activeKey) {
    setSyncedSig(layoutSig)
    setLists(fromLayout())
  }

  // Sections collide only with sections, sub-views only with their siblings.
  const collisionDetection: CollisionDetection = (a) => {
    const allowed = new Set(
      allowedDropTargets(
        String(a.active.id),
        a.droppableContainers.map((c) => String(c.id)),
      ),
    )
    return closestCorners({
      ...a,
      droppableContainers: a.droppableContainers.filter((c) => allowed.has(String(c.id))),
    })
  }

  /**
   * The section behind a key, with its sub-views in the person's saved order.
   *
   * `lists` holds keys, not items, because hiding and reordering only ever move
   * keys around — but the thing rendered has to come from the resolved layout
   * or the saved sub-view order never reaches the screen.
   */
  const resolved = new Map(
    [...layout.visible, ...layout.hidden, ...layout.pinned].map((i) => [i.to, i]),
  )
  const itemFor = (key: string) => resolved.get(key) ?? DEFAULTS.get(key)!

  const sensors = useSensors(
    // A short travel/hold before a drag starts, so a tap/click still navigates.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // 'more' (the button) and 'hidden' (the dropdown) both mean the hidden group.
  const containerOf = (id: string): Container | null =>
    id === 'visible'
      ? 'visible'
      : id === 'hidden' || id === 'more'
        ? 'hidden'
        : lists.visible.includes(id)
          ? 'visible'
          : lists.hidden.includes(id)
            ? 'hidden'
            : null

  // Sub-view order is not part of `lists` — it never interacts with hiding or
  // with the top-level order — so it is carried through untouched on every
  // save, and only replaced when a sub-view is what moved.
  const persist = (next: Lists, childOrder = layout.childOrder) => {
    save.mutate({
      order: [...next.visible, ...next.hidden],
      hidden: next.hidden,
      ...(Object.keys(childOrder).length > 0 ? { childOrder } : {}),
    })
  }

  /**
   * A sub-view moved. Only within its own section: a drop anywhere else is
   * ignored rather than guessed at, because every other interpretation would
   * move a view to a section it does not belong to.
   */
  const moveChild = (activeId: string, overId: string) => {
    const from = parseChildId(activeId)
    const to = parseChildId(overId)
    if (!from || !to || from.parent !== to.parent) return
    const section = [...layout.visible, ...layout.hidden, ...layout.pinned].find(
      (i) => i.to === from.parent,
    )
    const kids = section?.children?.map((c) => c.to)
    if (!kids) return
    const oldIndex = kids.indexOf(from.to)
    const newIndex = kids.indexOf(to.to)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    persist(lists, { ...layout.childOrder, [from.parent]: arrayMove(kids, oldIndex, newIndex) })
  }

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    // Sub-views settle on drop, not on hover: they live in the saved prefs
    // rather than in local state, and re-saving on every hover would be a write
    // per pixel of travel.
    if (String(active.id).startsWith(CHILD_PREFIX)) return
    const from = containerOf(String(active.id))
    const to = containerOf(String(over.id))
    if (!from || !to || from === to) return
    setLists((prev) => {
      const src = [...prev[from]]
      const dst = [...prev[to]]
      const i = src.indexOf(String(active.id))
      if (i < 0) return prev
      src.splice(i, 1)
      const overIdx = dst.indexOf(String(over.id))
      dst.splice(overIdx < 0 ? dst.length : overIdx, 0, String(active.id))
      return { ...prev, [from]: src, [to]: dst }
    })
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    setActiveKey(null)
    if (!over) return
    if (String(active.id).startsWith(CHILD_PREFIX)) {
      moveChild(String(active.id), String(over.id))
      return
    }
    const container = containerOf(String(active.id))
    if (!container) return
    setLists((prev) => {
      const ids = prev[container]
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      const next =
        newIndex >= 0 && oldIndex !== newIndex
          ? { ...prev, [container]: arrayMove(ids, oldIndex, newIndex) }
          : prev
      persist(next)
      return next
    })
  }

  const toggle = (key: string) => {
    setLists((prev) => {
      const inHidden = prev.hidden.includes(key)
      const next: Lists = inHidden
        ? { visible: [...prev.visible, key], hidden: prev.hidden.filter((k) => k !== key) }
        : { visible: prev.visible.filter((k) => k !== key), hidden: [...prev.hidden, key] }
      persist(next)
      return next
    })
  }

  // Put the expanded group back exactly as it was, rather than leaving the
  // sidebar folded up after every drag.
  const restoreGroup = () => {
    if (groupBeforeDrag.current !== undefined) {
      setOpenGroup(groupBeforeDrag.current)
      groupBeforeDrag.current = undefined
    }
  }

  const dragging = activeKey != null
  const activeRouteHidden = lists.hidden.some((k) => pathname === k || pathname.startsWith(k + '/'))
  const showHidden = variant === 'sheet' || moreOpen || dragging

  const hiddenList = (
    <SortableContext items={lists.hidden} strategy={verticalListSortingStrategy}>
      <DropPanel>
        {lists.hidden.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-gray-400">
            {dragging ? 'Drop here to hide' : 'No hidden views'}
          </p>
        ) : (
          lists.hidden.map((key) => (
            <SortableRow
              key={key}
              navKey={key}
              item={itemFor(key)}
              onToggle={toggle}
              onNavigate={onNavigate}
              inMore
              openGroup={openGroup}
              onOpenGroup={setOpenGroup}
            />
          ))
        )}
      </DropPanel>
    </SortableContext>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e: DragStartEvent) => {
        const id = String(e.active.id)
        setActiveKey(id)
        // Collapse the open group while a SECTION is being dragged.
        //
        // An expanded group renders its sub-views between two sortable rows,
        // and the sorting strategy measures the list as a contiguous run of
        // rows — so a couple of hundred pixels of children wedged into the
        // middle throws off every row below the gap, which is why the lower
        // sections would not reorder while a group was open. Collapsing makes
        // the list contiguous for the length of the drag.
        //
        // Not for a sub-view drag, obviously: that would fold away the very
        // rows being dragged.
        if (!id.startsWith(CHILD_PREFIX)) {
          groupBeforeDrag.current = openGroup
          setOpenGroup('')
        }
      }}
      onDragOver={handleDragOver}
      onDragEnd={(e) => {
        restoreGroup()
        handleDragEnd(e)
      }}
      onDragCancel={() => {
        restoreGroup()
        setActiveKey(null)
      }}
    >
      {/* min-h-full so the pinned block's mt-auto reaches the bottom of a short
          sidebar, while still flowing after the list when it overflows. */}
      <div className="flex min-h-full flex-col gap-1">
        <SortableContext items={lists.visible} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1">
            {lists.visible.map((key) => (
              <SortableRow
                key={key}
                navKey={key}
                item={itemFor(key)}
                onToggle={toggle}
                onNavigate={onNavigate}
                inMore={false}
                openGroup={openGroup}
                onOpenGroup={setOpenGroup}
              />
            ))}
          </div>
        </SortableContext>

        {variant === 'sheet' ? (
          <>
            <div className="mt-2 flex items-center gap-1.5 px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <MoreHorizontal className="h-3.5 w-3.5" /> More
            </div>
            {hiddenList}
          </>
        ) : (
          <div className="mt-1">
            <MoreButton
              open={moreOpen}
              selected={moreOpen || activeRouteHidden}
              onToggle={() => setMoreOpen((o) => !o)}
            />
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

      <DragOverlay>{activeKey ? <NavOverlay navKey={activeKey} /> : null}</DragOverlay>
    </DndContext>
  )
}

function NavOverlay({ navKey }: { navKey: string }) {
  // Nothing is asserted here. A drag id that resolves to no nav entry draws no
  // overlay, which costs a shadow under the cursor; the alternative cost the
  // whole screen.
  const item = navEntryFor(navKey)
  if (!item) return null
  const Icon = item.icon
  return (
    <div className="flex items-center gap-3 rounded-md border border-brand-200 bg-white py-2 pl-2 pr-4 text-sm font-medium text-gray-800 shadow-lg">
      <GripVertical className="h-4 w-4 text-gray-300" />
      <Icon className="h-4 w-4" />
      {item.label}
    </div>
  )
}
