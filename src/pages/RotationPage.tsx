import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { RotationPlanner } from '@/pages/plan/RotationPlanner'

/**
 * Rotation, on its own.
 *
 * It was a tab beside Plan and Budget, which put "what follows what over four
 * years" next to "what does this year cost" — two questions asked months apart
 * by different people. It sits under Crops now with its own address.
 */
export function RotationPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-3 text-lg font-semibold text-gray-900">Rotation · {cropYear}</h1>
      <RotationPlanner isManager={hasManagerAccess(profile?.role)} />
    </div>
  )
}
