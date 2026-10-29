import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { PillNavTabs } from '@/components/PillTabs'
import { usePartnerView, usePartnerYears } from '@/lib/partner-view'

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

export const FIELD_TABS: { key: FieldSection; label: string; path: string; links: FarmWideLink[] }[] =
  [
    {
      key: 'overview',
      label: 'Overview',
      path: '',
      links: [
        { to: '/map', label: 'Map' },
        { to: '/plan', label: 'Crop plan' },
        { to: '/hail', label: 'Hail reports' },
      ],
    },
    {
      key: 'work',
      label: 'Work this year',
      path: '/work',
      links: [
        { to: '/field-progress', label: 'Field progress' },
        { to: '/harvest', label: 'Harvest' },
      ],
    },
    {
      key: 'inputs',
      label: 'Inputs',
      path: '/inputs',
      links: [
        { to: '/fertilizer/plan', label: 'Fertility plan' },
        { to: '/chemicals', label: 'Chemical' },
      ],
    },
    {
      key: 'irrigation',
      label: 'Irrigation',
      path: '/irrigation',
      links: [
        { to: '/irrigation', label: 'Soil moisture' },
        { to: '/irrigation-info', label: 'General info' },
      ],
    },
    {
      key: 'soil',
      label: 'Soil',
      path: '/soil',
      links: [
        { to: '/fertilizer/soil', label: 'Soil tests' },
      ],
    },
    {
      key: 'history',
      label: 'History',
      path: '/history',
      links: [
        { to: '/rotation', label: 'Rotation' },
        { to: '/plan', label: 'Financials' },
      ],
    },
    // No Notes tab: field notes and files sit at the foot of Overview. The
    // /notes address still works — it opens Overview at the notes — and
    // 'notes' stays a FieldSection so the route and old links keep their type.
    { key: 'scouting', label: 'Scouting', path: '/scouting', links: [{ to: '/scouting', label: 'Scouting map' }] },
    {
      key: 'settings',
      label: 'Settings',
      path: '/settings',
      links: [{ to: '/fields', label: 'All fields' }],
    },
  ]

export const fieldSectionPath = (fieldId: string, section: FieldSection) =>
  section === 'notes'
    ? `/fields/${fieldId}/notes`
    : `/fields/${fieldId}${FIELD_TABS.find((t) => t.key === section)?.path ?? ''}`

/** The tab that shows a section — Notes is part of Overview. */
export const tabFor = (section: FieldSection): FieldSection => (section === 'notes' ? 'overview' : section)

/**
 * The bar itself.
 *
 * The shared one-row bar (Sam, 24 Oct 2026: "one row, no scrolling"): eight
 * tabs on a phone are the first few and a ▾ holding the rest, where it used to
 * scroll sideways. The section in the URL picks the tab rather than a route
 * match, because /notes opens on Overview.
 */
export function FieldTabBar({ fieldId, active }: { fieldId: string; active: FieldSection }) {
  const base = `/fields/${fieldId}`
  // A crop-share partner records on our field but does not set it up; his
  // company's own fields he does.
  const { partner, own } = usePartnerYears(fieldId)
  const tabs = FIELD_TABS.filter((t) => !(partner && !own && t.key === 'settings')).map((t) => ({ to: base + t.path, label: t.label, end: t.path === '' }))
  const on = FIELD_TABS.find((t) => t.key === tabFor(active))
  return (
    <nav className="mt-3 print:hidden">
      <PillNavTabs tabs={tabs} activeTo={on ? base + on.path : undefined} />
    </nav>
  )
}

/** "Fertilizer ↗ Chemical ↗" — the same subject for every field. */
export function FarmWideLinks({ section }: { section: FieldSection }) {
  const links = FIELD_TABS.find((t) => t.key === tabFor(section))?.links ?? []
  // The whole farm is not a crop-share partner's to open.
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
