import { Link } from 'react-router-dom'
import { SettingsButton } from '@/components/SettingsButton'
import { useAuth } from '@/lib/auth'
import { useTiles } from '@/lib/tiles'
import { UnconfirmedSprays } from '@/components/UnconfirmedSprays'
import { useBrand } from '@/lib/farm-setup'
import { GettingStarted } from '@/pages/GettingStarted'
import { Page } from '@/components/Page'
import { TileStat } from '@/components/TileStat'

/**
 * The dashboard: one tap to the screen you came for.
 *
 * It replaced a page of summary numbers, which is the right call — the numbers
 * were a reason to look at the dashboard rather than a reason to open the app,
 * and every one of them was a click away from its own screen anyway. What
 * people actually want on opening is to get somewhere, usually one screen deep
 * inside a section: the turbine, not "Irrigation".
 *
 * Three across on a phone, with the second line (what the screen answers) only
 * from `sm` up (design review item 7, Sam's go-ahead 24 Nov 2026). It was two
 * across with the hint showing, for one-handed, gloved use — which left four
 * tiles above the fold. A third-of-a-phone tile is still about 110 × 80 px,
 * well past the 44 px touch floor, and on a phone the icon and name are enough:
 * these are tiles the person picked.
 *
 * A few tiles carry a live number (components/TileStat): late tasks, unread
 * notifications, gaps in the records, pivots watering. Only those, only when
 * not zero — see the note there on why this is not the old page of numbers.
 */
export function HomePage() {
  const { profile } = useAuth()
  const BRAND = useBrand()
  const { visible } = useTiles()
  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <Page
      title={firstName ? `Hello, ${firstName}` : BRAND.farmName}
      showTitle
      actions={<SettingsButton to="/settings/account?tab=home" label="Which tiles show" />}
    >
      <GettingStarted />

      <UnconfirmedSprays />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-600">No shortcuts chosen yet.</p>
          <Link to="/settings/account?tab=home" className="mt-1 inline-block text-sm font-medium text-brand-700">
            Pick some in Settings
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-4">
          {visible.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.key}
                to={t.to}
                className="flex min-h-[5rem] flex-col justify-between rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm transition-colors active:bg-gray-50 hover:border-brand-600 sm:min-h-[5.5rem] sm:p-3"
              >
                <div className="flex items-start justify-between gap-1">
                  <Icon className="h-6 w-6 shrink-0 text-brand-700" />
                  <TileStat tileKey={t.key} />
                </div>
                <div className="mt-2">
                  <p className="text-sm font-semibold leading-tight text-gray-900">{t.label}</p>
                  <p className="mt-0.5 hidden text-xs leading-snug text-gray-500 sm:block">{t.hint}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Page>
  )
}
