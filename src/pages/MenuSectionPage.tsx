import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { MENU_SECTION_BY_KEY, filterSections, isLeaf } from '@/lib/nav-tree'
import { useMenu, useMenuDevice } from '@/lib/menu-prefs'
import { ShortcutMark } from '@/components/layout/SeasonSidebar'

/**
 * A section's own page (/menu/:section): its views under their headings, each
 * with a line saying what it is for. Where a phone bar section slot lands, and
 * where the header's section name links on a desktop.
 *
 * Shows what this person may open, less what they hid on this device. If they
 * hid the whole section but came here anyway (a link, the address bar), they
 * still get its views: they asked for this page by name.
 */
export function MenuSectionPage() {
  const { section: key = '' } = useParams()
  const menu = useMenu(useMenuDevice())
  const def = MENU_SECTION_BY_KEY.get(key)
  if (def && isLeaf(def)) return <Navigate to={def.to} replace />

  const allowed = menu.allowed.find((s) => s.key === key)
  const viewHidden = new Set([...menu.hidden].filter((k) => k !== key))
  const section = allowed && (filterSections([allowed], () => true, viewHidden)[0] ?? allowed)

  if (!def || !section) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-sm text-gray-600">
          Nothing here for you.{' '}
          <Link to="/dashboard" className="text-brand-700 underline">
            Go home
          </Link>
        </p>
      </div>
    )
  }

  const Icon = section.icon
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader title={section.label} icon={<Icon className="h-5 w-5 text-brand-700" />} />
      <div className="space-y-5">
        {section.groups.map((g) => (
          <section key={g.key}>
            {g.heading && (
              <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {g.icon && <g.icon className="h-3.5 w-3.5" />}
                {g.heading}
              </h2>
            )}
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {g.items.map((i) => {
                const VIcon = i.view.icon
                return (
                  <li key={i.view.key}>
                    <Link to={i.view.to} className="flex items-center gap-3 px-3 py-3 hover:bg-gray-50">
                      <VIcon className="h-5 w-5 shrink-0 text-brand-700" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          {i.label}
                          {i.shortcut && <ShortcutMark home={i.home} className="ml-0" />}
                        </span>
                        <span className="block text-xs text-gray-500">{i.view.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
