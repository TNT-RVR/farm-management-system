/**
 * Settings, as four views with one tab row each (Sam, 24 Oct 2026, season
 * menu step 3). It used to be one page three levels deep: top tabs, then My
 * account's `?section=` and Farm setup's `?part=` inside them.
 *
 * Every old address still lands: `/settings?…` and `/integrations?…` are
 * turned into the new path and `?tab=` by `settingsRedirect` below. Saved
 * links, alert rows in the database, OAuth returns and other farms' installs
 * all carry the old shapes, so this map is permanent.
 */

export type SettingsView = 'account' | 'people' | 'connections' | 'farm'

export const SETTINGS_PATHS: Record<SettingsView, string> = {
  account: '/settings/account',
  people: '/settings/people',
  connections: '/settings/connections',
  farm: '/settings/farm',
}

export const ACCOUNT_TABS = ['profile', 'security', 'notifications', 'home', 'menu', 'device'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

export const PEOPLE_TABS = ['users', 'access'] as const
export type PeopleTab = (typeof PEOPLE_TABS)[number]

/**
 * Farm setup's tabs. The keys are the old `?part=` values, so old links map
 * 1:1. Connections was a part once; it has one home now, its own view.
 */
export const FARM_PARTS = [
  { key: 'overview', label: 'Overview' },
  { key: 'farm', label: 'Your farm' },
  { key: 'features', label: 'Parts of the app' },
  { key: 'customize', label: 'Fitting it to your farm' },
] as const
export type FarmTab = (typeof FARM_PARTS)[number]['key']
export const FARM_TABS: readonly FarmTab[] = FARM_PARTS.map((p) => p.key)

/** Connected apps moved under This device on 15 Oct 2026; old `apps` links go there. */
export const accountAlias = (asked: string): AccountTab | undefined => {
  const a = asked.toLowerCase()
  if (a === 'apps') return 'device'
  return (ACCOUNT_TABS as readonly string[]).includes(a) ? (a as AccountTab) : undefined
}

const lower = (v: string | null) => (v ?? '').trim().toLowerCase()
const isIn = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)

/**
 * Where an old Settings address goes now.
 *
 * `search` is the query string (with or without `?`), `hash` is kept as-is
 * (Connections opens `#keys-<group>`). `from` is 'integrations' for the old
 * /integrations route, which always meant Connections — the John Deere,
 * FieldNET and QuickBooks sign-ins still return there.
 *
 * Every parameter other than the old tab/section/part is carried across, so
 * `c=`, `field=`, `jd_connected=` and the OAuth return's own parameters reach
 * the view that reads them.
 */
export function settingsRedirect(search: string, hash = '', from: 'settings' | 'integrations' = 'settings'): string {
  const old = new URLSearchParams(search)
  const tab = lower(old.get('tab'))
  const section = lower(old.get('section'))
  const part = lower(old.get('part'))

  const rest = new URLSearchParams(old)
  rest.delete('tab')
  rest.delete('section')
  rest.delete('part')

  let view: SettingsView
  let newTab: string | undefined
  if (from === 'integrations' || tab === 'connections' || tab === 'integrations' || (tab === 'farm setup' && part === 'connections')) {
    view = 'connections'
  } else if (tab === 'users' || tab === 'access') {
    view = 'people'
    newTab = tab
  } else if (tab === 'farm setup') {
    view = 'farm'
    if (isIn(FARM_TABS, part)) newTab = part
  } else {
    // My account, a ?section= (the home screen's Edit button, the bell's
    // settings button, the header avatar), or nothing at all.
    view = 'account'
    newTab = section ? accountAlias(section) : undefined
  }

  const q = new URLSearchParams()
  if (newTab) q.set('tab', newTab)
  for (const [k, v] of rest) q.append(k, v)
  const qs = q.toString()
  return `${SETTINGS_PATHS[view]}${qs ? `?${qs}` : ''}${hash}`
}
