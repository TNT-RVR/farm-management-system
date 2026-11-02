import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Beaker, Bug, CalendarRange, CircleDollarSign, CalendarDays, CheckSquare, ClipboardList, Cloud, CloudHail, Eye, FileSignature, FileText, FlaskConical, Fuel, Home, Info, Landmark, ListChecks, LogOut, Map as MapIcon, PiggyBank, Repeat, Scale, SprayCan, Sprout, TestTube, Timer, Tractor, UserCircle, Users, Waves, Wheat, Wrench } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineBanner } from '@/components/OfflineBanner'
import { UpdateReadyBanner } from '@/components/UpdateReadyBanner'
import { UserAvatar } from '@/components/UserAvatar'
import { useAuth } from '@/lib/auth'
import { useBrand } from '@/lib/farm-setup'
import { cn } from '@/lib/utils'
import { usePartnerPreview, usePartnerPreviewControls } from '@/lib/partner-view'
import { isPartnerPath } from '@/lib/partner'
import { CropYearSwitcher } from './CropYearSwitcher'
import { NotificationBell } from './NotificationBell'

// bar: also on the phone's bottom bar, which has room for four; the rest are
// reached from the home tiles there. group: a heading above it in the sidebar.
const LINKS = [
  { to: '/dashboard', label: 'Home', icon: Home, bar: true },
  { to: '/fields', label: 'My fields', icon: Wheat, bar: true },
  { to: '/map', label: 'Map', icon: MapIcon, bar: true },
  { to: '/crops', label: 'Crops', icon: Sprout, bar: false },
  { to: '/scouting', label: 'Scouting', icon: Bug, bar: false },
  { to: '/fertilizer/soil?tab=tests', label: 'Soil tests', icon: TestTube, bar: false, group: 'Planting season' },
  { to: '/fertilizer/plan', label: 'Fertility plan', icon: ClipboardList, bar: false },
  { to: '/fertilizer/prices', label: 'Fertilizer prices', icon: CircleDollarSign, bar: false },
  { to: '/fertilizer/savings', label: 'Fertilizer savings', icon: PiggyBank, bar: false },
  { to: '/fertilizer/manure', label: 'Manure', icon: Beaker, bar: false },
  { to: '/plan', label: "Next year's plan", icon: CalendarRange, bar: false },
  { to: '/rotation', label: 'Crop rotation', icon: Repeat, bar: false },
  { to: '/chemicals', label: 'Chemicals', icon: FlaskConical, bar: false, group: 'Growing season' },
  { to: '/hail', label: 'Hail reports', icon: CloudHail, bar: false },
  { to: '/spray-restrictions', label: 'Spray restrictions', icon: SprayCan, bar: false },
  { to: '/irrigation', label: 'Soil moisture', icon: Waves, bar: false },
  { to: '/irrigation-info', label: 'Pivots & pumps', icon: Info, bar: false },
  { to: '/weigh-scale', label: 'Weigh scale', icon: Scale, bar: false, group: 'Harvest' },
  { to: '/pre-harvest', label: 'Pre-harvest intervals', icon: Timer, bar: false },
  { to: '/harvest-reports', label: 'Harvest reports', icon: FileText, bar: false },
  { to: '/contracts', label: 'Contracts', icon: FileSignature, bar: false },
  { to: '/field-progress', label: 'Field progress', icon: ListChecks, bar: false },
  { to: '/equipment', label: 'Equipment service', icon: Wrench, bar: false, group: 'Equipment' },
  { to: '/fuel', label: 'Fuel & trucking', icon: Fuel, bar: false },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, bar: false, group: 'Tasks & calendar' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, bar: false },
  { to: '/events', label: 'Conferences', icon: CalendarDays, bar: false },
  { to: '/grants', label: 'Grants', icon: Landmark, bar: false },
  { to: '/weather', label: 'Weather', icon: Cloud, bar: false, group: 'Tools' },
  { to: '/reports', label: 'Reports', icon: FileText, bar: false },
  { to: '/settings/people', label: 'People', icon: Users, bar: false, group: 'Your company' },
  { to: '/settings/farm', label: 'Your farm', icon: Tractor, bar: false },
  { to: '/settings/account?tab=profile', label: 'My account', icon: UserCircle, bar: true },
]

/** The links his company's preset and ticks allow, each group's heading on its first shown link. */
function shownLinks() {
  let group: string | undefined
  return LINKS.flatMap((l) => {
    if ('group' in l) group = l.group
    if (!isPartnerPath(l.to)) return []
    const heading = group
    group = undefined
    return [{ ...l, group: heading }]
  })
}

/**
 * The frame a partner sees (lib/partner.ts): home, his fields and
 * map, the crops he grows, his planting season, his account and his company. None of the staff shell's farm-wide parts — search, who's online,
 * the menus, farm setup redirects, the offline warm-up of every screen, the
 * Drive backup — since he can open none of what they lead to.
 */
export function PartnerShell() {
  const links = shownLinks()
  const { profile, signOut } = useAuth()
  const BRAND = useBrand()
  const { pathname } = useLocation()
  // An admin viewing as the partner (lib/partner-preview.ts).
  const preview = usePartnerPreview()
  const { stop } = usePartnerPreviewControls()

  const link = (to: string, bar: boolean) =>
    cn(
      bar ? 'flex flex-1 flex-col items-center justify-center gap-1 text-xs' : 'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
      pathname.startsWith(to.split('?')[0])
        ? bar
          ? 'text-brand-700'
          : 'bg-brand-50 font-medium text-brand-800'
        : bar
          ? 'text-gray-500'
          : 'text-gray-700 hover:bg-gray-50',
    )

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {preview && (
        <div className="flex shrink-0 items-center gap-2 bg-amber-500 px-4 py-1.5 text-sm text-white print:hidden">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Viewing as <span className="font-semibold">{preview.name}</span>: his fields and what his account can open. Changes you make are saved as you.
          </span>
          <button
            onClick={stop}
            className="shrink-0 rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30"
          >
            Exit
          </button>
        </div>
      )}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 print:hidden">
        <NavLink to="/dashboard" className="shrink-0 rounded-md" title="Home" aria-label="Home">
          <img src={BRAND.logo} alt={BRAND.farmName} className="h-9 w-auto" />
        </NavLink>
        <div className="ml-auto flex items-center gap-3">
          <CropYearSwitcher />
          <NotificationBell />
          {profile && !preview && (
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

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-52 shrink-0 space-y-1 border-r border-gray-200 bg-white p-3 overflow-y-auto md:block print:hidden">
          {links.map(({ to, label, icon: Icon, group }) => (
            <div key={to}>
              {group && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{group}</p>}
              <NavLink to={to} className={link(to, false)}>
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-auto pb-16 md:pb-0">
          <OfflineBanner />
          <UpdateReadyBanner />
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {links.filter((l) => l.bar).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={link(to, true)}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
