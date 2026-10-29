import { Navigate, useLocation } from 'react-router-dom'
import { settingsRedirect } from '@/lib/settings-routes'

/**
 * /settings and /integrations: old addresses, sent on to the Settings view and
 * tab they meant (Sam, 24 Oct 2026). Eager and tiny, so an old link does not
 * wait on the Settings chunk just to be told where to go.
 */
export function SettingsRedirect({ from = 'settings' }: { from?: 'settings' | 'integrations' }) {
  const { search, hash } = useLocation()
  return <Navigate to={settingsRedirect(search, hash, from)} replace />
}
