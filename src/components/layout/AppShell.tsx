import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { useAutoOfflineSave } from '@/lib/offline-auto'
import { useAppBadge } from '@/lib/useAppBadge'
import { Bell, LogOut, MoreHorizontal, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { usePushSync } from '@/lib/push'
import { MOBILE_BAR_COUNT, useNavLayout } from '@/lib/nav'
import { useNotifications, useNotificationsRealtime } from '@/lib/notifications'
import { SidebarNav } from './SidebarNav'
import { CropYearSwitcher } from './CropYearSwitcher'
import { TvControl } from './TvControl'
import { cn } from '@/lib/utils'
import { useApplyFarmSetup, useBrand, useFirstRunRedirect } from '@/lib/farm-setup'
import { DriveBackupScheduler } from '@/components/DriveBackupScheduler'

function NotificationBell() {
  useNotificationsRealtime()
  const { data: notifications } = useNotifications()
  const unread = notifications?.filter((n) => !n.read_at).length ?? 0
  return (
    <NavLink
      to="/notifications"
      className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100"
      aria-label={`Alerts${unread ? ` (${unread} unread)` : ''}`}
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </NavLink>
  )
}

/** Ctrl+K (⌘K), or / when not typing in a box, opens the search from anywhere. */
function useSearchShortcut() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault()
        navigate('/search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function AppShell() {
  useSearchShortcut()
  // Tops up the offline records in the background; see lib/offline-auto.ts.
  useAutoOfflineSave()
  // Unread count on the installed app's icon.
  useAppBadge()
  const { profile, signOut } = useAuth()
  // The farm's own name and logo (Farm setup), and its farm-wide settings applied.
  const BRAND = useBrand()
  useApplyFarmSetup()
  useFirstRunRedirect()
  // Every open re-saves this device's push subscription, so notifications
  // cannot quietly stop because the server lost track of the phone.
  usePushSync(profile?.id)
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  /** Which bottom-bar group is showing its children, if any. */
  const [groupOpen, setGroupOpen] = useState<string | null>(null)
  const { visible } = useNavLayout()
  // Bottom bar shows the first few visible items in the user's order; the rest
  // (and any hidden views) live under More, which is also where you customize.
  const mobileBar = visible.slice(0, MOBILE_BAR_COUNT)

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* The Google Drive backup of every report, for the owners and the accountant; renders nothing. */}
      <DriveBackupScheduler />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 print:hidden">
        <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto" />
        <div className="ml-auto flex items-center gap-3">
          <NavLink
            to="/search"
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Search"
            title="Search pages, reports and records (Ctrl+K)"
          >
            <Search className="h-4 w-4" />
          </NavLink>
          <CropYearSwitcher />
          <TvControl />
          <NotificationBell />
          <span className="hidden text-sm text-gray-600 md:inline">{profile?.full_name}</span>
          <button
            onClick={() => void signOut()}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar — drag to reorder, drag to More (or the eye) to hide. */}
        <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3 md:block print:hidden">
          {/* Boundaried like the page is. The navigation sits outside the
              routed content, so a bug in it used to take the whole screen
              white rather than one panel — which is both worse to look at and
              worse to diagnose, since the address bar still says you are on a
              page that renders fine. */}
          <ErrorBoundary>
            <SidebarNav />
          </ErrorBoundary>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto pb-16 md:pb-0">
          <OfflineBanner />
          <ErrorBoundary key={pathname}>
            {/* Pages load on first open (App.tsx); the shell stays put meanwhile. */}
            <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Mobile "More" sheet — the full, customizable menu */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden print:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto border-t border-gray-200 bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2 pb-1 pt-1 text-[11px] text-gray-400">
              Drag to reorder · tap the eye to hide
            </p>
            <ErrorBoundary>
              <SidebarNav variant="sheet" onNavigate={() => setMoreOpen(false)} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* A group's children, above the bar. Deliberately not a full-screen
          sheet: the page underneath is the thing being kept, and covering it
          would undo the reason the parent does not navigate. */}
      {groupOpen && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 md:hidden print:hidden">
          <div className="mx-2 mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {(visible.find((i) => i.to === groupOpen)?.children ?? []).map((c) => {
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
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
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
    </div>
  )
}
