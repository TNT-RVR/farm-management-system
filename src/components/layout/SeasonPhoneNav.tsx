import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, Menu as MenuIcon, Plus, Search } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { BAR_TOOL_LABEL, MENU_SECTION_BY_KEY, allItems, sectionHref, isLeaf, type BarSlot, type BarTool, type MenuMatch } from '@/lib/nav-tree'
import { useMenu, useMenuMatch } from '@/lib/menu-prefs'
import { QUICK_ADDS } from '@/lib/quick-add'
import { cn } from '@/lib/utils'
import { MenuItemLink, SectionGroups } from './SeasonSidebar'
import { PhoneSearchSheet } from './PhoneSearchSheet'

/** Is this bar slot where you are? A section slot follows the section you are in (its landing page included). */
function slotActive(slot: BarSlot, match: MenuMatch | null, pathname: string): boolean {
  if (slot.kind === 'tool') return false
  if (slot.kind === 'view') return match?.item?.view.key === slot.key
  if (pathname === `/menu/${slot.key}`) return true
  return match?.section.key === slot.key
}

/**
 * The Menu sheet: search (when the bar has no Search button), then the person's phone menu, then every view they
 * are allowed into, hidden ones included, folded away at the bottom. That last
 * list is the way back to something they hid, without a trip to Settings.
 */
function MoreSheet({ onClose, onSearch }: { onClose: () => void; onSearch?: () => void }) {
  const menu = useMenu('phone')
  const match = useMenuMatch()
  const [open, setOpen] = useState<string | null>(match?.section.key ?? null)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [allOpen, setAllOpen] = useState(false)
  // A to Z, so a view is found by its name rather than by where it lives (Sam, 29 Oct 2026).
  const everything = allItems()
    .filter((i) => menu.canSee(i.view))
    .sort((x, y) => x.label.localeCompare(y.label))

  return (
    <div className="flex flex-col gap-1">
      {onSearch && (
        <button type="button" onClick={onSearch} className="mb-1 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-left text-sm text-gray-500">
          <Search className="h-4 w-4" />
          Find or ask anything
        </button>
      )}

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

/** The Add (+) list: the forms filled in standing up, those this person may open. */
function AddSheet({ onClose }: { onClose: () => void }) {
  const menu = useMenu('phone')
  const adds = QUICK_ADDS.filter((a) => menu.canSee({ to: a.to }))
  return (
    <ul className="p-1">
      {adds.map((a) => {
        const Icon = a.icon
        return (
          <li key={a.key}>
            <Link to={a.to} onClick={onClose} className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-gray-800 active:bg-gray-100">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon className="h-4 w-4" />
              </span>
              {a.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

const TOOL_ICON: Record<BarTool, typeof Search> = { search: Search, add: Plus, menu: MenuIcon }

/**
 * The season menu's phone bar (everyone's unless they chose the old menu):
 * five buttons of the person's choosing, by default Search, Dashboard, a
 * raised green Add in the middle, Tasks and Menu (Sam, 29 Oct 2026). A
 * section opens its page, a view goes straight there, and Search, Add and
 * Menu each open their sheet above the bar.
 */
export function SeasonPhoneNav() {
  const menu = useMenu('phone')
  const match = useMenuMatch()
  const { pathname } = useLocation()
  const [open, setOpen] = useState<BarTool | null>(null)
  const close = () => setOpen(null)
  const hasSearch = menu.bar.some((s) => s.key === 'search')

  return (
    <>
      {open && (
        <>
          {/* The dimming sits under the bar; the sheet sits over it, so the raised + never covers the sheet. */}
          <div className="fixed inset-0 z-40 bg-black/20 md:hidden print:hidden" onClick={close} />
          <div
            className={cn(
              'fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 border-t border-gray-200 bg-white md:hidden print:hidden',
              open === 'menu' && 'max-h-[75vh] overflow-y-auto p-2',
              open === 'add' && 'mx-auto mb-6 max-w-xs rounded-xl border shadow-lg',
              open === 'search' && 'rounded-t-xl',
            )}
          >
            <ErrorBoundary>
              {open === 'menu' && <MoreSheet onClose={close} onSearch={hasSearch ? undefined : () => setOpen('search')} />}
              {open === 'add' && <AddSheet onClose={close} />}
              {open === 'search' && <PhoneSearchSheet onClose={close} />}
            </ErrorBoundary>
          </div>
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {menu.bar.map((slot) => {
          if (slot.kind === 'tool') {
            const Icon = TOOL_ICON[slot.key]
            const on = open === slot.key
            const toggle = () => setOpen((o) => (o === slot.key ? null : slot.key))
            // Add sits up out of the bar, bigger and green: the one button for getting something written down.
            if (slot.key === 'add') {
              return (
                <div key={slot.key} className="flex flex-1 justify-center">
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={on ? 'Close add' : 'Add'}
                    aria-expanded={on}
                    className="-mt-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg active:bg-brand-700"
                  >
                    <Plus className={cn('h-8 w-8 transition-transform', on && 'rotate-45')} />
                  </button>
                </div>
              )
            }
            return (
              <button
                key={slot.key}
                type="button"
                onClick={toggle}
                aria-expanded={on}
                className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs', on ? 'text-brand-700' : 'text-gray-500')}
              >
                <Icon className="h-5 w-5" />
                {BAR_TOOL_LABEL[slot.key]}
              </button>
            )
          }
          const Icon = slot.kind === 'section' ? slot.section.icon : slot.item.view.icon
          const label = slot.kind === 'section' ? slot.section.label : slot.item.label
          const to = slot.kind === 'section' ? sectionHref(slot.section) : slot.item.view.to
          const active = !open && slotActive(slot, match, pathname)
          return (
            <Link
              key={slot.key}
              to={to}
              onClick={close}
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
      </nav>
    </>
  )
}
