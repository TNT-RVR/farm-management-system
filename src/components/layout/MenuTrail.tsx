import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { isLeaf, sectionHref, type MenuMatch } from '@/lib/nav-tree'
import { useMenuMatch } from '@/lib/menu-prefs'

/**
 * "Section › View" in the header, for the season menu.
 *
 * With views now listed in more than one section, the menu alone no longer
 * says where you are, so the header does. A shortcut names its home section,
 * the one place the view belongs. On a phone it shrinks to a back arrow to the
 * section's page and the section's name: the page's own title already says
 * which view it is.
 *
 * Renders nothing where the menu has nothing to say (Home, a notification).
 */
export function MenuTrail() {
  const match = useMenuMatch()
  const { pathname } = useLocation()
  if (!showsTrail(match)) return null
  const onSectionPage = pathname.startsWith('/menu/')
  const sectionTo = sectionHref(match.section)

  return (
    <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1 text-sm">
      {/* Phone */}
      <span className="flex min-w-0 items-center gap-1 md:hidden">
        {!onSectionPage && (
          <Link to={sectionTo} className="-ml-1 rounded-md p-1.5 text-gray-500 hover:bg-gray-100" aria-label={`Back to ${match.section.label}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <span className="truncate font-medium text-gray-800">{match.section.label}</span>
      </span>
      {/* Desktop */}
      <span className="hidden min-w-0 items-center gap-1 md:flex">
        {onSectionPage || !match.item ? (
          <span className="truncate font-medium text-gray-800">{match.section.label}</span>
        ) : (
          <>
            <Link to={sectionTo} className="truncate text-gray-500 hover:text-brand-700 hover:underline">
              {match.section.label}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span className="truncate font-medium text-gray-800">{match.item.view.label}</span>
          </>
        )}
      </span>
    </nav>
  )
}

/** A leaf section (Home, Map) is its own page: nothing to add. */
const showsTrail = (match: MenuMatch | null): match is MenuMatch => !!match && !isLeaf(match.section)

/** Will MenuTrail draw anything here? The header hides the logo on a phone when it does. */
export function useHasTrail(): boolean {
  return showsTrail(useMenuMatch())
}
