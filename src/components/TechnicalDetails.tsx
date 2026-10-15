import type React from 'react'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { Fold } from '@/components/Fold'

/**
 * Diagnostics, for admins only, folded.
 *
 * API explorers, raw error logs, build hashes, script paths, sync row counts
 * and the like were drawn for everyone. They are for whoever maintains the
 * app, and to anyone else they are noise that makes a screen look broken.
 * Admins still get every word of it, one tap away.
 */
export function TechnicalDetails({
  title = 'Technical details',
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const { profile } = useAuth()
  if (!hasAdminAccess(profile?.role)) return null
  return (
    <Fold title={title} className={className}>
      <div className="space-y-2 text-xs text-gray-600">{children}</div>
    </Fold>
  )
}

/** Renders its children only for admins, without a fold. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()
  return hasAdminAccess(profile?.role) ? <>{children}</> : null
}
