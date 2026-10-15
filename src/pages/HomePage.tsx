import { Link } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useTiles } from '@/lib/tiles'
import { UnconfirmedSprays } from '@/components/UnconfirmedSprays'
import { useBrand } from '@/lib/farm-setup'
import { GettingStarted } from '@/pages/GettingStarted'

/**
 * The dashboard: one tap to the screen you came for.
 *
 * It replaced a page of summary numbers, which is the right call — the numbers
 * were a reason to look at the dashboard rather than a reason to open the app,
 * and every one of them was a click away from its own screen anyway. What
 * people actually want on opening is to get somewhere, usually one screen deep
 * inside a section: the turbine, not "Irrigation".
 *
 * Two columns, because a farm phone gets used one-handed and often with a glove
 * on. The tap targets are deliberately large and the second line says what the
 * screen answers rather than repeating its name.
 */
export function HomePage() {
  const { profile } = useAuth()
  const BRAND = useBrand()
  const { visible } = useTiles()
  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {firstName ? `Hello, ${firstName}` : BRAND.farmName}
          </h1>
          <p className="text-xs text-gray-500">Jump to what you need.</p>
        </div>
        <Link
          to="/settings?section=home"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Settings2 className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      <GettingStarted />

      <UnconfirmedSprays />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-600">No shortcuts chosen yet.</p>
          <Link to="/settings?section=home" className="mt-1 inline-block text-sm font-medium text-brand-700">
            Pick some in Settings
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((t) => {
            const Icon = t.icon
            return (
              <Link
                key={t.key}
                to={t.to}
                className="flex min-h-[5.5rem] flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-colors active:bg-gray-50 hover:border-brand-600"
              >
                <Icon className="h-6 w-6 text-brand-700" />
                <div className="mt-2">
                  <p className="text-sm font-semibold leading-tight text-gray-900">{t.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{t.hint}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
