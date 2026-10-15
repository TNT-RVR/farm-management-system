import { Link, NavLink } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

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
        { to: '/fertilizer', label: 'Fertilizer' },
        { to: '/chemicals', label: 'Chemical' },
      ],
    },
    {
      key: 'irrigation',
      label: 'Irrigation',
      path: '/irrigation',
      links: [
        { to: '/irrigation', label: 'Soil moisture' },
        { to: '/turbines', label: 'Turbines' },
        { to: '/irrigation-info', label: 'General info' },
      ],
    },
    {
      key: 'soil',
      label: 'Soil',
      path: '/soil',
      links: [
        { to: '/fertilizer', label: 'Fertilizer' },
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
 * Scrolls sideways rather than wrapping: eight tabs wrap to three rows on a
 * phone, and a field page opened in a truck is mostly opened on a phone.
 */
export function FieldTabBar({ fieldId, active }: { fieldId: string; active: FieldSection }) {
  return (
    <div className="-mx-4 mt-3 overflow-x-auto px-4 md:mx-0 md:px-0 print:hidden">
      <nav className="flex w-max min-w-full gap-1 border-b border-gray-200">
        {FIELD_TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/fields/${fieldId}${t.path}`}
            end={t.path === ''}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm',
              t.key === tabFor(active)
                ? 'border-brand-700 font-semibold text-brand-800'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** "Fertilizer ↗ Chemical ↗" — the same subject for every field. */
export function FarmWideLinks({ section }: { section: FieldSection }) {
  const links = FIELD_TABS.find((t) => t.key === tabFor(section))?.links ?? []
  if (!links.length) return null
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
