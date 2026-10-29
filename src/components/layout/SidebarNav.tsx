import { lazy, Suspense, useState } from 'react'
import { useNavLayout, useSaveNavPrefs } from '@/lib/nav'
import { ChildRowView, DropPanelView, NavFrame, NavRowView, type NavProps, type NavUi } from './SidebarNavParts'
import { itemLookup, listsOf, prefsFor, toggled } from './nav-lists'

// Drag-to-reorder (@dnd-kit) is its own chunk, fetched when reordering is
// opened: the pointer (or focus) entering the desktop sidebar, or Edit menu on
// a phone. Until then the same menu is drawn without it.
const SidebarNavDnd = lazy(() => import('./SidebarNavDnd').then((m) => ({ default: m.SidebarNavDnd })))

/**
 * Personally customizable navigation (the old menu). Visible sidebar items
 * reorder by drag; the eye or a drag onto "More" hides a view. Persists to
 * nav_prefs. variant 'sheet' (mobile) shows the hidden list inline instead of
 * collapsed, and reorders only in Edit menu.
 */
export function SidebarNav({ onNavigate, variant = 'sidebar' }: { onNavigate?: () => void; variant?: 'sidebar' | 'sheet' }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dnd, setDnd] = useState(false)
  // Held here, not in either version, so the swap from plain to drag keeps the open group and More.
  const ui: NavUi = {
    openGroup,
    setOpenGroup,
    moreOpen,
    setMoreOpen,
    editing,
    setEditing: (f) => {
      setDnd(true)
      setEditing(f)
    },
  }
  // On a phone nothing drags until Edit menu; on a desktop a row drags any
  // time, so the code is fetched as soon as the pointer comes near it.
  const plain = <PlainNav onNavigate={onNavigate} variant={variant} ui={ui} onWake={variant === 'sheet' || dnd ? undefined : () => setDnd(true)} />
  if (!dnd) return plain
  return (
    <Suspense fallback={plain}>
      <SidebarNavDnd onNavigate={onNavigate} variant={variant} ui={ui} />
    </Suspense>
  )
}

/** The menu without drag: same markup, so the swap to the drag version shows nothing. The eye still hides and shows. */
function PlainNav({ onNavigate, variant, ui, onWake }: NavProps & { onWake?: () => void }) {
  const layout = useNavLayout()
  const save = useSaveNavPrefs()
  const lists = listsOf(layout)
  const itemFor = itemLookup(layout)
  const toggle = (key: string) => save.mutate(prefsFor(toggled(lists, key), layout.childOrder))
  const row = (key: string, inMore: boolean) => (
    <NavRowView
      key={key}
      navKey={key}
      item={itemFor(key)}
      onToggle={toggle}
      onNavigate={onNavigate}
      inMore={inMore}
      openGroup={ui.openGroup}
      onOpenGroup={ui.setOpenGroup}
      dragOn={variant !== 'sheet' || ui.editing}
      editing={variant === 'sheet' && ui.editing}
      renderKids={(kids) => kids.map((c) => <ChildRowView key={c.to} child={c} onNavigate={onNavigate} />)}
    />
  )
  return (
    <NavFrame
      variant={variant}
      ui={ui}
      hiddenKeys={lists.hidden}
      onWake={onWake}
      onNavigate={onNavigate}
      visibleList={<div className="flex flex-col gap-1">{lists.visible.map((key) => row(key, false))}</div>}
      hiddenList={
        <DropPanelView>
          {lists.hidden.length === 0 ? <p className="px-2 py-1.5 text-xs text-gray-400">No hidden views</p> : lists.hidden.map((key) => row(key, true))}
        </DropPanelView>
      }
    />
  )
}
