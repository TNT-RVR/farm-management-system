import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, MoreHorizontal, Search } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MENU_SECTION_BY_KEY, allItems, sectionHref, isLeaf, type BarSlot, type MenuMatch } from '@/lib/nav-tree'
import { useMenu, useMenuMatch } from '@/lib/menu-prefs'
import { cn } from '@/lib/utils'
import { MenuItemLink, SectionGroups } from './SeasonSidebar'

/** Is this bar slot where you are? A section slot follows the section you are in (its landing page included). */
function slotActive(slot: BarSlot, match: MenuMatch | null, pathname: string): boolean {
  if (slot.kind === 'view') return match?.item?.view.key === slot.key
  if (pathname === `/menu/${slot.key}`) return true
  return match?.section.key === slot.key
}

/**
 * The More sheet: search, then the person's phone menu, then every view they
 * are allowed into, hidden ones included, folded away at the bottom. That last
 * list is the way back to something they hid, without a trip to Settings.
 */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const menu = useMenu('phone')
  const match = useMenuMatch()
  const [open, setOpen] = useState<string | null>(match?.section.key ?? null)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(false)
  const everything = allItems().filter((i) => menu.canSee(i.view))

  return (
    <div className="flex flex-col gap-1">
      <Link to="/search" onClick={onClose} className="mb-1 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
        <Search className="h-4 w-4" />
        Search pages, reports and records
      </Link>

      {[...menu.sections, ...menu.pinned].map((s) => {
        const Icon = s.icon
        const here = match?.section.key === s.key
        const expanded = open === s.key && !isLeaf(s)
        return (
          <div key={s.key}>
            <div className={cn('flex items-center rounded-md', here && 'bg-brand-50')}>
              {/* The name goes to the section's page; the arrow opens it here. */}
              <Link
                to={sectionHref(s)}
                onClick={onClose}
                className={cn('flex flex-1 items-center gap-3 px-2 py-2.5 text-sm font-medium', here ? 'text-brand-800' : 'text-gray-700')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {s.label}
              </Link>
              {!isLeaf(s) && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => (o === s.key ? null : s.key))}
                  aria-expanded={expanded}
                  aria-label={expanded ? `Close ${s.label}` : `Open ${s.label}`}
                  className="p-2.5 text-gray-400"
                >
                  <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                </button>
              )}
            </div>
            {expanded && (
              <div className="mb-1 ml-6 border-l border-gray-200 pl-2">
                <SectionGroups
                  section={s}
                  match={match}
                  onNavigate={onClose}
                  folded={folded}
                  onFold={(k) => setFolded((f) => ({ ...f, [k]: !f[k] }))}
                />
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => setAllOpen((o) => !o)}
        aria-expanded={allOpen}
        className="mt-2 flex items-center gap-1.5 border-t border-gray-100 px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !allOpen && '-rotate-90')} />
        All views
      </button>
      {allOpen &&
        everything.map((i) => (
          <div key={i.view.key} className="flex items-center">
            <MenuItemLink item={i} match={match} onNavigate={onClose} className="flex-1" />
            <span className="shrink-0 pr-2 text-[10px] text-gray-400">{MENU_SECTION_BY_KEY.get(i.home)?.label}</span>
          </div>
        ))}
    </div>
  )
}

/**
 * The season menu's phone bar (everyone's unless they chose the old menu): four slots of the person's
 * choosing, then More. A section slot opens that section's page, a view slot
 * goes straight to the view.
 */
export function SeasonPhoneNav() {
  const menu = useMenu('phone')
  const match = useMenuMatch()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/20 md:hidden print:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[75vh] overflow-y-auto border-t border-gray-200 bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ErrorBoundary>
              <MoreSheet onClose={() => setMoreOpen(false)} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {menu.bar.map((slot) => {
          const Icon = slot.kind === 'section' ? slot.section.icon : slot.item.view.icon
          const label = slot.kind === 'section' ? slot.section.label : slot.item.label
          const to = slot.kind === 'section' ? sectionHref(slot.section) : slot.item.view.to
          const active = !moreOpen && slotActive(slot, match, pathname)
          return (
            <Link
              key={slot.key}
              to={to}
              onClick={() => setMoreOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs',
                active ? 'text-brand-700' : 'text-gray-500',
              )}
            >
              <Icon className="h-5 w-5" />
              {/* "Planting season" is too long for a fifth of a phone; the season word is the point. */}
              <span className="max-w-full truncate">{label.replace(/ season$/, '')}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-xs', moreOpen ? 'text-brand-700' : 'text-gray-500')}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>
    </>
  )
}
