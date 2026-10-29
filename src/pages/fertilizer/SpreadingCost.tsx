import { Link } from 'react-router-dom'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useBasics } from '@/lib/hauling-data'
import { SpreadingTab } from '@/pages/hauling/SpreadingTab'

/**
 * Fertility plan › Spreading: what spreading our own dry fertilizer costs an
 * acre against custom. It was half of Fuel & trucking's "Spreading & silage"
 * tab until 26 Oct 2026; it sits with the fertilizer now, and /fuel?tab=spreading
 * comes here. The diesel and the wage it is costed at have one home, Fuel &
 * trucking, so they are read here and linked to, not edited.
 */
export function SpreadingCost() {
  const { profile } = useAuth()
  const b = useBasics()
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Costed at ${b.dieselPerL.toFixed(2)}/L diesel and ${b.wage.toFixed(2)}/h for the operator —{' '}
        <Link to="/fuel?tab=trucking" className="font-medium text-brand-700 hover:underline">
          set on Fuel &amp; trucking
        </Link>
        .
      </p>
      <SpreadingTab isManager={hasManagerAccess(profile?.role)} />
    </div>
  )
}
