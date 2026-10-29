import { Navigate, useLocation } from 'react-router-dom'

/**
 * Spraying is part of Chemicals again (Sam, 29 Oct 2026).
 *
 * It was split out on 24 Oct on the argument that checking a product and
 * seeing what was sprayed lately are in-season jobs, while the registry, the
 * shed and prices are looked up year round. In use that put the label you
 * want and the check you are doing with it on two different screens, so the
 * two tabs went back.
 *
 * The route stays as a redirect: /spraying is in saved links, in the old menu
 * and on phones' home screens, and it should land on the tab it names rather
 * than on a missing page.
 */
const TABS: Record<string, string> = {
  spraycheck: 'spraycheck',
  reentry: 'reentry',
}

export function SprayingPage() {
  const { search } = useLocation()
  const asked = new URLSearchParams(search).get('tab') ?? ''
  return <Navigate to={`/chemicals?tab=${TABS[asked] ?? 'spraycheck'}`} replace />
}
