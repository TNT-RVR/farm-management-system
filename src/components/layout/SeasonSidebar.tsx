import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { MENU_SECTION_BY_KEY, isLeaf, type MenuItem, type MenuMatch, type MenuSection } from '@/lib/nav-tree'
import { useMenu, useMenuMatch } from '@/lib/menu-prefs'
import { cn } from '@/lib/utils'

/**
 * "↗ Financials": this view lives in another section. `compact` is the bare ↗
 * (the home in its tooltip), for the sidebar, where the section's name crowded
 * out the view's own (Sam's screen, 24 Oct 2026: "Tissue tests" read "T…").
 */
export function ShortcutMark({ home, className, compact = false }: { home: string; className?: string; compact?: boolean }) {
  const label = MENU_SECTION_BY_KEY.get(home)?.label ?? home
  return (
    <span className={cn('ml-auto flex shrink-0 items-center gap-0.5 text-[10px] font-normal text-gray-400', className)} title={`Lives in ${label}`}>
      <ArrowUpRight className="h-3 w-3" aria-label={`Lives in ${label}`} />
      {!compact && label}
    </span>
  )
}

/** One view in a section, highlighted when it is where you are. */
export function MenuItemLink({
  item,
  match,
  onNavigate,
  className,
}: {
  item: MenuItem
  match: MenuMatch | null
  onNavigate?: () => void
  className?: string
}) {
  const Icon = item.view.icon
  const active = match?.item?.view.key === item.view.key
  return (
    <Link
      to={item.view.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-600 hover:bg-gray-100',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
      {item.shortcut && <ShortcutMark home={item.home} compact />}
    </Link>
  )
}

/**
 * The views of one section, under their headings.
 *
 * A heading is drawn as a row of its own kind: the same arrow a section has,
 * an icon, and the type, size and colour of the views under it (Sam,
 * 29 Oct 2026 — as tiny grey capitals, Fertility "seemed out of place").
 * It is still not a link, so it never adds a click on the way to a view; its
 * views sit one step in, their icons under its own. Folded with the page you
 * are on inside it, it goes green with a dot, exactly as a folded section does.
 */
export function SectionGroups({
  section,
  match,
  onNavigate,
  folded,
  onFold,
}: {
  section: MenuSection
  match: MenuMatch | null
  onNavigate?: () => void
  folded: Record<string, boolean>
  onFold: (groupKey: string) => void
}) {
  return (
    <>
      {section.groups.map((g) => {
        const isFolded = !!g.heading && folded[g.key] === true
        const Icon = g.icon
        const here = g.items.some((i) => i.view.key === match?.item?.view.key)
        return (
          <div key={g.key}>
            {g.heading && (
              <button
                type="button"
                onClick={() => onFold(g.key)}
                aria-expanded={!isFolded}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-gray-100',
                  here && isFolded ? 'font-medium text-brand-800' : 'text-gray-600',
                )}
              >
                <ChevronRight
                  className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', !isFolded && 'rotate-90')}
                />
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 truncate">{g.heading}</span>
                {here && isFolded && (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700" aria-label="You are in this group" />
                )}
              </button>
            )}
            {!isFolded && (
              <div className={cn(g.heading && 'ml-3 border-l border-gray-200 pl-2')}>
                {g.items.map((i) => (
                  <MenuItemLink key={i.view.key} item={i} match={match} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function SectionRow({
  section,
  match,
  open,
  onToggle,
  folded,
  onFold,
}: {
  section: MenuSection
  match: MenuMatch | null
  open: boolean
  onToggle: () => void
  folded: Record<string, boolean>
  onFold: (groupKey: string) => void
}) {
  const Icon = section.icon
  const here = match?.section.key === section.key
  const rowClass = (on: boolean) =>
    cn(
      'flex w-full items-center gap-3 rounded-md py-2 pl-2 pr-2 text-left text-sm font-medium transition-colors',
      on ? 'bg-brand-800 text-white' : 'text-gray-700 hover:bg-gray-100',
    )
  if (isLeaf(section)) {
    return (
      <Link to={section.to} className={rowClass(here)} aria-current={here ? 'page' : undefined}>
        <span className="h-4 w-4 shrink-0" />
        <Icon className="h-4 w-4 shrink-0" />
        {section.label}
      </Link>
    )
  }
  return (
    <>
      {/* The solid fill is only ever the page you are on (a view row, or Home
          and Map). A folded section holding that page gets green text and a
          dot instead: filled, it read as the menu you had chosen while the
          one you had just opened sat plain beside it (Sam, 24 Oct 2026). */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(rowClass(false), here && !open && 'text-brand-800 hover:text-brand-900')}
      >
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{section.label}</span>
        {here && !open && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700" aria-label="You are in this section" />}
      </button>
      {open && (
        <div className="mb-1 ml-6 border-l border-gray-200 pl-2">
          <SectionGroups section={section} match={match} folded={folded} onFold={onFold} />
        </div>
      )}
    </>
  )
}

/**
 * The season menu's desktop sidebar (everyone's unless they chose the old menu).
 *
 * Same width, colours and icon sizes as SidebarNav, so switching between the
 * two is a change of grouping, not of look. Several sections can be open at
 * once: unlike the old groups these are long-lived, and someone working through
 * harvest wants Harvest to stay open while they glance into Cattle. The section
 * you are in opens by itself when you arrive by address or reload. Reordering
 * and hiding live in Settings → My account → Menu, not in drags here.
 */
export function SeasonSidebar() {
  const menu = useMenu('desktop')
  const match = useMenuMatch()
  /** Open/closed by hand. Unset means "open if you are in it". */
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const isOpen = (s: MenuSection) => toggled[s.key] ?? match?.section.key === s.key
  const toggle = (s: MenuSection) => setToggled((t) => ({ ...t, [s.key]: !isOpen(s) }))
  const fold = (k: string) => setFolded((f) => ({ ...f, [k]: !f[k] }))

  return (
    <div className="flex min-h-full flex-col gap-1">
      {menu.sections.map((s) => (
        <SectionRow key={s.key} section={s} match={match} open={isOpen(s)} onToggle={() => toggle(s)} folded={folded} onFold={fold} />
      ))}
      {/* Pinned to the bottom: Settings is where you go to undo a menu change. */}
      {menu.pinned.length > 0 && (
        <div className="mt-auto flex flex-col gap-1 border-t border-gray-200 pt-2">
          {menu.pinned.map((s) => (
            <SectionRow key={s.key} section={s} match={match} open={isOpen(s)} onToggle={() => toggle(s)} folded={folded} onFold={fold} />
          ))}
        </div>
      )}
    </div>
  )
}
