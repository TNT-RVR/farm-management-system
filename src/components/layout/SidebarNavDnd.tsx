import { useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
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
import { GripVertical } from 'lucide-react'
import {
  CHILD_PREFIX,
  allowedDropTargets,
  childId,
  navEntryFor,
  parseChildId,
  useNavLayout,
  useSaveNavPrefs,
  type NavChild,
} from '@/lib/nav'
import {
  ChildRowView,
  DropPanelView,
  MoreButtonView,
  NavFrame,
  NavRowView,
  type NavProps,
} from './SidebarNavParts'
import { itemLookup, listsOf, prefsFor, toggled, type Lists } from './nav-lists'

/*
 * The old-menu sidebar with drag-to-reorder: @dnd-kit and everything that uses
 * it. Its own chunk, loaded by SidebarNav when reordering is opened — the
 * pointer entering the desktop sidebar, or Edit menu on a phone.
 */

type Container = keyof Lists

function SortableRow(props: Omit<Parameters<typeof NavRowView>[0], 'drag' | 'renderKids'> & { dragOn: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.navKey,
    disabled: !props.dragOn,
  })
  return (
    <NavRowView
      {...props}
      drag={{ setNodeRef, style: { transform: CSS.Transform.toString(transform), transition }, isDragging, props: { ...attributes, ...listeners } }}
      renderKids={(kids) => (
        <SortableContext items={kids.map((c) => childId(props.item.to, c.to))} strategy={verticalListSortingStrategy}>
          {kids.map((c) => (
            <SortableChild key={c.to} parent={props.item.to} child={c} onNavigate={props.onNavigate} dragOn={props.dragOn} />
          ))}
        </SortableContext>
      )}
    />
  )
}

function SortableChild({ parent, child, onNavigate, dragOn = true }: { parent: string; child: NavChild; onNavigate?: () => void; dragOn?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: childId(parent, child.to),
    disabled: !dragOn,
  })
  return (
    <ChildRowView
      child={child}
      onNavigate={onNavigate}
      drag={{ setNodeRef, style: { transform: CSS.Transform.toString(transform), transition }, isDragging, props: { ...attributes, ...listeners } }}
    />
  )
}

/** The "More" nav item as a drop target. */
function DroppableMore(props: { open: boolean; selected: boolean; onToggle: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'more' })
  return <MoreButtonView {...props} setNodeRef={setNodeRef} isOver={isOver} />
}

function DropPanel({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'hidden' })
  return (
    <DropPanelView setNodeRef={setNodeRef} isOver={isOver}>
      {children}
    </DropPanelView>
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
export function SidebarNavDnd({ onNavigate, variant, ui }: NavProps) {
  const layout = useNavLayout()
  const save = useSaveNavPrefs()
  const [lists, setLists] = useState<Lists>(() => listsOf(layout))
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const { openGroup, setOpenGroup, editing } = ui
  /** What was open before a drag folded it away. undefined = nothing to undo. */
  const groupBeforeDrag = useRef<string | null | undefined>(undefined)
  const dragOn = variant !== 'sheet' || editing

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
    setLists(listsOf(layout))
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

  const itemFor = itemLookup(layout)

  const sensors = useSensors(
    // A short travel before a mouse drag starts, so a click still navigates.
    // The mouse only: a touch is the TouchSensor's, a held press, so a finger
    // that wobbles a few pixels on a tap does not start a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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

  const persist = (next: Lists, childOrder = layout.childOrder) => {
    save.mutate(prefsFor(next, childOrder))
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
      const next = toggled(prev, key)
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
  const row = (key: string, inMore: boolean) => (
    <SortableRow
      key={key}
      navKey={key}
      item={itemFor(key)}
      onToggle={toggle}
      onNavigate={onNavigate}
      inMore={inMore}
      openGroup={openGroup}
      onOpenGroup={setOpenGroup}
      dragOn={dragOn}
      editing={variant === 'sheet' && editing}
    />
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
      <NavFrame
        variant={variant}
        ui={ui}
        hiddenKeys={lists.hidden}
        dragging={dragging}
        onNavigate={onNavigate}
        moreButton={(p) => <DroppableMore {...p} />}
        visibleList={
          <SortableContext items={lists.visible} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1">{lists.visible.map((key) => row(key, false))}</div>
          </SortableContext>
        }
        hiddenList={
          <SortableContext items={lists.hidden} strategy={verticalListSortingStrategy}>
            <DropPanel>
              {lists.hidden.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-gray-400">{dragging ? 'Drop here to hide' : 'No hidden views'}</p>
              ) : (
                lists.hidden.map((key) => row(key, true))
              )}
            </DropPanel>
          </SortableContext>
        }
      />

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
