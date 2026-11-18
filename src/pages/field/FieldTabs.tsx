import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Settings } from 'lucide-react'
import { PILL_ON, PillNavTabs } from '@/components/PillTabs'
import { cn } from '@/lib/utils'
import { usePartnerView, usePartnerYears } from '@/lib/partner-view'
import { canSeeFinances, useAuth } from '@/lib/auth'

/**
 * One field, in sections rather than one long scroll.
 *
 * The field page had grown to eighteen cards — boundary, tenure, soil, pivots,
 * FieldNET, soil tests, inputs, moisture, operations, three notes editors,
 * files, crop, crop history and the audit trail — and answering "who rents
 * this" meant scrolling past everything about the pivot. Each of those is a
 * different question asked on a different day, so each gets a tab.
 *
 * URLs, not component state: a section of a field is a place somebody links to,
 * comes back to, and opens on a phone from a text message. It also means the
 * two sections that were already their own pages (work, activity) are tabs
 * without being moved.
 */
export type FieldSection =
  | 'overview'
  | 'work'
  | 'inputs'
  | 'irrigation'
  | 'soil'
  | 'history'
  | 'notes'
  | 'scouting'
  | 'scout-reports'
  | 'money'
  | 'settings'

/**
 * Where the same information lives for the whole farm.
 *
 * Every section of a field is a slice of a page that exists farm-wide, and the
 * way anybody actually works is "this field's fertiliser… now show me all of
 * it". Without these, getting from a field to the fertiliser page means the
 * sidebar and two guesses.
 */
export type FarmWideLink = { to: string; label: string }

/**
 * Six tabs at most (Sam, 24 Oct 2026: "One tab bar, six tabs at most, one
 * row, no scrolling"). The field page had grown to ten, so on a phone seven of
 * them sat behind the ▾ and Scout reports was only found by people who already
 * knew it was there. Sections that answer the same question now share a tab,
 * one under the other: what was put on the field (work, inputs), what the
 * water has to work with (irrigation, soil), and what was seen in the crop
 * (our scouting, the seed company's prescouts). Settings is the ⚙ at the end
 * of the bar — it is set up once, not read daily.
 *
 * Every section keeps its own address, so a link to /soil or /scout-reports
 * opens its tab at that section.
 */
export type FieldTab = {
  key: FieldSection
  label: string
  path: string
  /** The sections this tab shows, first one first. */
  sections: FieldSection[]
  links: FarmWideLink[]
}

export const FIELD_TABS: FieldTab[] = [
  {
    key: 'overview',
    label: 'Overview',
    path: '',
    // Field notes and files sit at the foot of Overview.
    sections: ['overview', 'notes'],
    links: [
      { to: '/map', label: 'Map' },
      { to: '/plan', label: 'Crop plan' },
      { to: '/hail', label: 'Hail reports' },
    ],
  },
  {
    key: 'work',
    label: 'Work & inputs',
    path: '/work',
    // Inputs is the products off the same sprayer passes, totalled.
    sections: ['work', 'inputs'],
    links: [
      { to: '/field-progress', label: 'Field progress' },
      { to: '/harvest', label: 'Harvest' },
      { to: '/fertilizer/plan', label: 'Fertility plan' },
      { to: '/chemicals', label: 'Chemical' },
    ],
  },
  {
    key: 'irrigation',
    label: 'Water & soil',
    path: '/irrigation',
    sections: ['irrigation', 'soil'],
    links: [
      { to: '/irrigation', label: 'Soil moisture' },
      { to: '/fertilizer/soil', label: 'Soil tests' },
      { to: '/irrigation-info', label: 'General info' },
    ],
  },
  {
    key: 'scouting',
    label: 'Scouting',
    path: '/scouting',
    // Our scouting, then the seed companies' own prescouts: theirs decide what
    // may be planted here next year, and are read as a run of years.
    sections: ['scouting', 'scout-reports'],
    links: [
      { to: '/scouting', label: 'Scouting map' },
      { to: '/scout-reports', label: 'All scout reports' },
      { to: '/rotation', label: 'Rotation' },
    ],
  },
  {
    key: 'history',
    label: 'History',
    path: '/history',
    sections: ['history'],
    links: [
      { to: '/rotation', label: 'Rotation' },
      { to: '/plan', label: 'Financials' },
    ],
  },
  // Owners and whoever has finance access, nobody else: FINANCE_SECTIONS
  // keeps it off the bar and the page redirects anyone who types the
  // address. That pair IS the gate on this view -- the database's own
  // can_see_finances() covers the fixed costs, crop_inputs and the
  // QuickBooks tables, but product_purchases and crop_prices are readable
  // by any active user by design, so do not treat RLS as a second lock on
  // everything shown here.
  {
    key: 'money',
    label: 'Cost & revenue',
    path: '/money',
    sections: ['money'],
    links: [
      { to: '/plan', label: 'Financials' },
      { to: '/map?tab=profit', label: 'Profit / Loss' },
    ],
  },
]

/** Every section's own address under /fields/<id>. */
const SECTION_PATH: Record<FieldSection, string> = {
  overview: '',
  notes: '/notes',
  work: '/work',
  inputs: '/inputs',
  irrigation: '/irrigation',
  soil: '/soil',
  scouting: '/scouting',
  'scout-reports': '/scout-reports',
  history: '/history',
  money: '/money',
  settings: '/settings',
}

/**
 * Where a section that is not the first on its tab starts, so its own address
 * can scroll there. The ids are on the pages.
 */
export const SECTION_ANCHOR: Partial<Record<FieldSection, string>> = {
  notes: 'field-notes',
  inputs: 'field-inputs',
  soil: 'field-soil',
  'scout-reports': 'field-scout-reports',
}

const SETTINGS_LINKS: FarmWideLink[] = [{ to: '/fields', label: 'All fields' }]

/**
 * Sections only somebody with finance access may open.
 *
 * Listed here rather than checked at each of the three places that need it
 * (the bar, the page's redirect, the test), so adding a money screen cannot
 * leave one of them behind.
 */
export const FINANCE_SECTIONS: readonly FieldSection[] = ['money']

export const isFinanceSection = (s: FieldSection) => FINANCE_SECTIONS.includes(s)

export const fieldSectionPath = (fieldId: string, section: FieldSection) =>
  `/fields/${fieldId}${SECTION_PATH[section]}`

/** The tab that shows a section; Settings is on none of them (it is the ⚙). */
export const tabFor = (section: FieldSection): FieldTab | undefined =>
  FIELD_TABS.find((t) => t.sections.includes(section))

/**
 * The bar itself.
 *
 * The shared one-row bar (Sam, 24 Oct 2026: "one row, no scrolling"): the
 * tabs that fit, and a ▾ holding the rest. The section in the URL picks the tab
 * rather than a route match, because /soil opens on Water & soil.
 */
export function FieldTabBar({ fieldId, active }: { fieldId: string; active: FieldSection }) {
  const base = `/fields/${fieldId}`
  // A partner records on our field but does not set it up; his
  // company's own fields he does.
  const { partner, own } = usePartnerYears(fieldId)
  // What a field cost and made is the owners' and the accountant's. A partner
  // never sees it on his own field either: his share is his deal, not our books.
  const { profile } = useAuth()
  const money = canSeeFinances(profile) && !partner
  const tabs = FIELD_TABS.filter((t) => !(isFinanceSection(t.key) && !money)).map((t) => ({
    to: base + t.path,
    label: t.label,
    end: t.path === '',
  }))
  const on = tabFor(active)
  const settingsOpen = !(partner && !own)
  const onSettings = active === 'settings'
  return (
    <nav className="mt-3 flex items-center gap-1 print:hidden">
      <div className="min-w-0 flex-1">
        {/* On Settings no tab is lit — the ⚙ is. Passing an address no tab
            has stops the bar guessing one from the route. */}
        <PillNavTabs tabs={tabs} activeTo={on ? base + on.path : `${base}/settings`} />
      </div>
      {settingsOpen && (
        <Link
          to={fieldSectionPath(fieldId, 'settings')}
          aria-label="Field settings"
          title="Field settings: name, lease, boundary"
          aria-current={onSettings ? 'page' : undefined}
          className={cn(
            "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']",
            onSettings ? PILL_ON : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
          )}
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}
    </nav>
  )
}

/**
 * Opening a section's own address scrolls to it when it is not the first on
 * its tab — again once the lazy cards above it have arrived, unless the reader
 * has started scrolling themselves.
 */
export function useScrollToSection(section: FieldSection, ready: boolean) {
  useEffect(() => {
    const id = SECTION_ANCHOR[section]
    if (!id || !ready) return
    let moved = false
    const stop = () => {
      moved = true
    }
    const go = () => {
      if (!moved) document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }
    go()
    const timers = [300, 1000].map((ms) => window.setTimeout(go, ms))
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', stop)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [section, ready])
}

/** "Fertilizer ↗ Chemical ↗" — the same subject for every field. */
export function FarmWideLinks({ section }: { section: FieldSection }) {
  const links = section === 'settings' ? SETTINGS_LINKS : (tabFor(section)?.links ?? [])
  // The whole farm is not a partner's to open.
  const partner = usePartnerView()
  if (!links.length || partner) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 print:hidden">
      <span className="text-xs text-gray-400">Whole farm:</span>
      {links.map((l) => (
        <Link
          key={l.to + l.label}
          to={l.to}
          className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
        >
          {l.label}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      ))}
    </div>
  )
}
