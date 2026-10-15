import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { hasAdminAccess, hasManagerAccess, useAuth } from '@/lib/auth'
export { SETUP_LINKS } from '@/lib/setup-links'

/**
 * The link itself. `managerOnly` hides it from someone who could not change
 * the setting anyway, and says who can instead; `adminOnly` does the same for
 * the admin-only places (Farm setup).
 */
export function SetupLink({
  to,
  children,
  managerOnly = false,
  adminOnly = false,
  className = '',
}: {
  to: string
  children: React.ReactNode
  managerOnly?: boolean
  adminOnly?: boolean
  className?: string
}) {
  const { profile } = useAuth()
  if (adminOnly && !hasAdminAccess(profile?.role)) return <span className={`text-gray-400 ${className}`}>An admin can set this up.</span>
  if (managerOnly && !hasManagerAccess(profile?.role)) return <span className={`text-gray-400 ${className}`}>A manager can set this up.</span>
  return (
    <Link to={to} className={`inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800 hover:underline ${className}`}>
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}
