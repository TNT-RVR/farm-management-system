import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { UpdateReadyBanner } from '@/components/UpdateReadyBanner'
import { InstallBanner } from '@/components/InstallBanner'
import { useAutoOfflineSave } from '@/lib/offline-auto'
import { useAppBadge } from '@/lib/useAppBadge'
import { ChevronLeft, ChevronRight, LogOut, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePushSync } from '@/lib/push'
import { SeasonRail, SeasonSidebar } from './SeasonSidebar'
import { SeasonPhoneNav } from './SeasonPhoneNav'
import { PhoneSearchSheet } from './PhoneSearchSheet'
import { useTrackViewUsage } from '@/lib/view-usage'
import { MenuTrail, useHasTrail } from './MenuTrail'
import { CropYearSwitcher } from './CropYearSwitcher'
import { NotificationBell } from './NotificationBell'
import { AvatarStack, UserAvatar } from '@/components/UserAvatar'
import { useOnlineUsers } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { useApplyFarmSetup, useBrand, useFirstRunRedirect } from '@/lib/farm-setup'
import { DriveBackupScheduler } from '@/components/DriveBackupScheduler'
// The partner's frame
import { usePartnerView } from '@/lib/partner-view'
import { PartnerShell } from './PartnerShell'
import { PageSkeleton } from '@/components/Skeleton'
import { SectionGate } from '@/components/ProtectedRoute'

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
  // A partner gets his own small frame
  // (lib/partner.ts), as does an admin viewing as one (lib/partner-preview.ts).
  if (usePartnerView()) return <PartnerShell />
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
  const trail = useHasTrail()
  const [sidebarHidden, toggleSidebar] = useSidebarHidden()
  /** The section whose icon was clicked on the narrow bar, to open as the menu widens. */
  const [openFirst, setOpenFirst] = useState<string | null>(null)
  const expand = (section?: string) => {
    setOpenFirst(section ?? null)
    toggleSidebar()
  }

  return (
    <div className="flex h-full bg-gray-50">
      {/* The Google Drive backup of every report, for the owners and the accountant; renders nothing. */}
      <DriveBackupScheduler />
      {/* Desktop sidebar, full height with the farm's logo at its top (Sam,
          29 Oct 2026). The tab halfway down its right edge narrows it to a bar
          of icons (Sam, 30 Oct 2026); a click anywhere on that bar widens it again. */}
      {sidebarHidden && (
        <aside
          onClick={() => expand()}
          title="Show menu"
          className="relative hidden w-14 shrink-0 cursor-pointer flex-col border-r border-gray-200 bg-white md:flex print:hidden"
        >
          <div className="flex h-14 shrink-0 items-center justify-center">
            <NavLink to="/" title="Home" onClick={(e) => e.stopPropagation()}>
              <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto" />
            </NavLink>
          </div>
          <span
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-1/2 rounded-full border border-gray-200 bg-white p-1 text-gray-400 shadow-sm hover:text-gray-700"
            aria-hidden="true"
          >
            <ChevronRight className="h-4 w-4" />
          </span>
          <nav className="min-h-0 flex-1 overflow-y-auto py-3" aria-label="Menu">
            <ErrorBoundary>
              <SeasonRail onExpand={expand} />
            </ErrorBoundary>
          </nav>
          <button type="button" className="sr-only" onClick={() => expand()}>
            Show menu
          </button>
        </aside>
      )}
      {!sidebarHidden && (
        <aside className="relative hidden w-60 shrink-0 flex-col border-r border-gray-200 bg-white md:flex print:hidden">
          <div className="flex h-14 shrink-0 items-center px-3">
            <NavLink to="/" title="Home" className="flex min-w-0 flex-1 items-center gap-3">
              <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto shrink-0" />
            </NavLink>
          </div>
          <button
            onClick={toggleSidebar}
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-1/2 rounded-full border border-gray-200 bg-white p-1 text-gray-400 shadow-sm hover:text-gray-700"
            aria-label="Narrow the menu"
            title="Narrow the menu"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <nav className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* Boundaried like the page is. The navigation sits outside the
                routed content, so a bug in it used to take the whole screen
                white rather than one panel — which is both worse to look at and
                worse to diagnose, since the address bar still says you are on a
                page that renders fine. */}
            <ErrorBoundary>
              <SeasonSidebar openFirst={openFirst} />
            </ErrorBoundary>
          </nav>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 print:hidden">
          {/* The logo lives in the sidebar on a desktop (wide or narrow); on a phone it is here. On a phone the trail's back arrow takes its place.
              Wherever it is, it goes home, as the logo on a website does (Sam, 29 Oct 2026). */}
          <NavLink
            to="/dashboard"
            title="Home"
            aria-label="Home"
            className={cn('shrink-0 rounded-md md:hidden', trail && 'hidden')}
          >
            <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto" />
          </NavLink>
          <MenuTrail />
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
              <Suspense fallback={<PageSkeleton />}>
                {/* A switched-off or closed-off section says so here, inside the frame. */}
                <SectionGate>
                  <Outlet />
                </SectionGate>
              </Suspense>
            </ErrorBoundary>
          </main>
      </div>

      <SeasonPhoneNav />

      {findOpen && <SearchDialog onClose={closeFind} />}

    </div>
  )
}
