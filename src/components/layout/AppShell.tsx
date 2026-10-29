import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { UpdateReadyBanner } from '@/components/UpdateReadyBanner'
import { InstallBanner } from '@/components/InstallBanner'
import { useAutoOfflineSave } from '@/lib/offline-auto'
import { useAppBadge } from '@/lib/useAppBadge'
import { ChevronLeft, ChevronRight, LogOut, MoreHorizontal, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePushSync } from '@/lib/push'
import { MOBILE_BAR_COUNT, isViewDenied, useNavLayout } from '@/lib/nav'
import { useMenuEnabled } from '@/lib/menu-prefs'
import { SidebarNav } from './SidebarNav'
import { SeasonSidebar } from './SeasonSidebar'
import { SeasonPhoneNav } from './SeasonPhoneNav'
import { PhoneSearchSheet } from './PhoneSearchSheet'
import { useTrackViewUsage } from '@/lib/view-usage'
import { MenuTrail, useHasTrail } from './MenuTrail'
import { CropYearSwitcher } from './CropYearSwitcher'
import { NotificationBell } from './NotificationBell'
import { AvatarStack, UserAvatar } from '@/components/UserAvatar'
import { useOnlineUsers } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { isPathOff, useApplyFarmSetup, useBrand, useDisabledPaths, useFirstRunRedirect } from '@/lib/farm-setup'
import { DriveBackupScheduler } from '@/components/DriveBackupScheduler'

/** Ctrl+K (⌘K), or / when not typing in a box, opens the search from anywhere. */
function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

/** The search window on a computer: the header's search icon, Ctrl+K or /. Escape or a click outside closes it. */
function SearchDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/40 px-4 pt-[12vh] print:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Search"
        className="mx-auto max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <ErrorBoundary>
          <PhoneSearchSheet variant="dialog" onClose={onClose} />
        </ErrorBoundary>
      </div>
    </div>
  )
}

const SIDEBAR_KEY = 'rvr.sidebar-hidden'

/** The desktop sidebar tucked away to the left, remembered on this device. */
function useSidebarHidden() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setHidden((h) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, h ? '0' : '1')
      } catch {
        // Private window: it just won't be remembered.
      }
      return !h
    })
  return [hidden, toggle] as const
}

export function AppShell() {
  return <StaffShell />
}

function StaffShell() {
  const [findOpen, setFindOpen] = useState(false)
  const openFind = useCallback(() => setFindOpen(true), [])
  const closeFind = useCallback(() => setFindOpen(false), [])
  useSearchShortcut(openFind)
  // Tops up the offline records in the background; see lib/offline-auto.ts.
  useAutoOfflineSave()
  // Unread count on the installed app's icon.
  useAppBadge()
  // Most used views, for the phone's search sheet.
  useTrackViewUsage()
  const { profile, signOut } = useAuth()
  const online = useOnlineUsers()
  // The farm's own name and logo (Farm setup), and its farm-wide settings applied.
  const BRAND = useBrand()
  useApplyFarmSetup()
  useFirstRunRedirect()
  // Every open re-saves this device's push subscription, so notifications
  // cannot quietly stop because the server lost track of the phone.
  usePushSync(profile?.id)
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  /** Which bottom-bar group is showing its children, if any. */
  const [groupOpen, setGroupOpen] = useState<string | null>(null)
  const { visible } = useNavLayout()
  // Bottom bar shows the first few visible items in the user's order; the rest
  // (and any hidden views) live under More, which is also where you customize.
  const mobileBar = visible.slice(0, MOBILE_BAR_COUNT)
  // The children of the open group, less any an admin closed off or the farm
  // switched off, as the sidebar already does. This list used to show them
  // all, so a crew member's phone offered pages that then refused to open.
  const off = useDisabledPaths()
  const groupKids = (visible.find((i) => i.to === groupOpen)?.children ?? []).filter(
    (c) => !isViewDenied(profile, c.to.split('?')[0]) && !isPathOff(off, c.to),
  )
  // The season menu, everyone's menu since 26 Oct 2026 (Sam). Someone who
  // picked "Use the old menu" (Settings → My account → Menu) gets everything
  // below exactly as it was, until the old menu is retired.
  const seasonMenu = useMenuEnabled()
  const trail = useHasTrail() && seasonMenu
  const [sidebarHidden, toggleSidebar] = useSidebarHidden()

  return (
    <div className="flex h-full bg-gray-50">
      {/* The Google Drive backup of every report, for the owners and the accountant; renders nothing. */}
      <DriveBackupScheduler />
      {/* Desktop sidebar, full height with the farm's logo at its top (Sam,
          29 Oct 2026). The tab halfway down its right edge tucks it away to
          the left; hidden, the same tab sits on the screen's left edge. */}
      {!sidebarHidden && (
        <aside className={cn('relative hidden shrink-0 flex-col border-r border-gray-200 bg-white md:flex print:hidden', seasonMenu ? 'w-60' : 'w-52')}>
          <div className="flex h-14 shrink-0 items-center px-3">
            <NavLink to="/" title="Home" className="flex min-w-0 flex-1 items-center gap-3">
              <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto shrink-0" />
            </NavLink>
          </div>
          <button
            onClick={toggleSidebar}
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-1/2 rounded-full border border-gray-200 bg-white p-1 text-gray-400 shadow-sm hover:text-gray-700"
            aria-label="Hide menu"
            title="Hide menu"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* Drag to reorder, drag to More (or the eye) to hide. A little wider for the season menu: "Harvest season" and "Tasks & calendar" were cut off at the old width. */}
          <nav className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* Boundaried like the page is. The navigation sits outside the
                routed content, so a bug in it used to take the whole screen
                white rather than one panel — which is both worse to look at and
                worse to diagnose, since the address bar still says you are on a
                page that renders fine. */}
            <ErrorBoundary>
              {seasonMenu ? <SeasonSidebar /> : <SidebarNav />}
            </ErrorBoundary>
          </nav>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 print:hidden">
          {sidebarHidden && (
            <button
              onClick={toggleSidebar}
              className="fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-r-full border border-l-0 border-gray-200 bg-white py-1 pl-0.5 pr-1 text-gray-400 shadow-sm hover:text-gray-700 md:block print:hidden"
              aria-label="Show menu"
              title="Show menu"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          {/* The logo lives in the sidebar on a desktop; on a phone, or with the
              sidebar hidden, it is here. On a phone the trail's back arrow takes its place.
              Wherever it is, it goes home, as the logo on a website does (Sam, 29 Oct 2026). */}
          <NavLink
            to="/dashboard"
            title="Home"
            aria-label="Home"
            className={cn('shrink-0 rounded-md', trail && 'hidden', sidebarHidden ? 'md:block' : 'md:hidden')}
          >
            <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto" />
          </NavLink>
          {seasonMenu && <MenuTrail />}
          <div className="ml-auto flex items-center gap-3">
            {/* A phone searches from the bottom bar instead (Sam, 29 Oct 2026). */}
            <button
              type="button"
              onClick={openFind}
              className="hidden rounded-md p-2 text-gray-500 hover:bg-gray-100 md:block"
              aria-label="Search"
              title="Search views and records, or ask a question (Ctrl+K)"
            >
              <Search className="h-4 w-4" />
            </button>
            <CropYearSwitcher />
            <NotificationBell />
            {online.length > 0 && (
              <span className="flex items-center" title={`Also in the app now: ${online.map((p) => p.full_name).join(', ')}`}>
                <AvatarStack people={online} max={4} size="sm" />
              </span>
            )}
            {profile && (
              <NavLink to="/settings/account?tab=profile" className="flex items-center gap-2 rounded-full" title="Your account and picture">
                <UserAvatar person={profile} size="sm" />
                <span className="hidden text-sm text-gray-600 md:inline">{profile.full_name}</span>
              </NavLink>
            )}
            <button
              onClick={() => void signOut()}
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

          <main className="min-h-0 min-w-0 flex-1 overflow-auto pb-16 md:pb-0">
            <OfflineBanner />
            <UpdateReadyBanner />
            <InstallBanner />
            <ErrorBoundary key={pathname}>
              {/* Pages load on first open (App.tsx); the shell stays put meanwhile. */}
              <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
      </div>

      {seasonMenu && <SeasonPhoneNav />}

      {findOpen && <SearchDialog onClose={closeFind} />}

      {!seasonMenu && searchOpen && (
        <div className="fixed inset-0 z-40 bg-black/20 md:hidden print:hidden" onClick={() => setSearchOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] rounded-t-xl border-t border-gray-200 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <ErrorBoundary>
              <PhoneSearchSheet onClose={() => setSearchOpen(false)} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* Mobile "More" sheet — the full, customizable menu */}
      {!seasonMenu && moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden print:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto border-t border-gray-200 bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ErrorBoundary>
              <SidebarNav variant="sheet" onNavigate={() => setMoreOpen(false)} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* A group's children, above the bar. Deliberately not a full-screen
          sheet: the page underneath is the thing being kept, and covering it
          would undo the reason the parent does not navigate. */}
      {!seasonMenu && groupOpen && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 md:hidden print:hidden">
          <div className="mx-2 mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {groupKids.map((c) => {
              const CIcon = c.icon
              return (
                <NavLink
                  key={c.to}
                  to={c.to}
                  onClick={() => setGroupOpen(null)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 border-b border-gray-100 px-3 py-3 text-sm last:border-0',
                      isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-gray-700',
                    )
                  }
                >
                  <CIcon className="h-4 w-4 shrink-0" />
                  {c.label}
                </NavLink>
              )
            })}
          </div>
        </div>
      )}

      {/* Mobile bottom bar */}
      {!seasonMenu && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
          <button
            onClick={() => {
              setMoreOpen(false)
              setGroupOpen(null)
              setSearchOpen((o) => !o)
            }}
            className={cn('flex flex-1 flex-col items-center justify-center gap-1 text-xs', searchOpen ? 'text-brand-700' : 'text-gray-500')}
          >
            <Search className="h-5 w-5" />
            Search
          </button>
          {mobileBar.map((item) => {
            const { to, label, icon: Icon, children } = item
            // A parent with children opens the two above the bar rather than
            // navigating, same as the sidebar: whatever you were reading stays
            // on screen.
            if (children?.length) {
              const active = children.some((c) => pathname.startsWith(c.to))
              return (
                <button
                  key={to}
                  onClick={() => {
                    setMoreOpen(false)
                    setGroupOpen((g) => (g === to ? null : to))
                  }}
                  className={cn(
                    'flex flex-1 flex-col items-center justify-center gap-1 text-xs',
                    active || groupOpen === to ? 'text-brand-700' : 'text-gray-500',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              )
            }
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => {
                  setMoreOpen(false)
                  setGroupOpen(null)
                }}
                className={({ isActive }) =>
                  cn(
                    'flex flex-1 flex-col items-center justify-center gap-1 text-xs',
                    isActive ? 'text-brand-700' : 'text-gray-500',
                  )
                }
              >
                <Icon className="h-5 w-5" />
                {label}
              </NavLink>
            )
          })}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-xs',
              moreOpen ? 'text-brand-700' : 'text-gray-500',
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </nav>
      )}
    </div>
  )
}
