import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { SavingsProvider, ToolFocusProvider, type ToolFocus } from './context'
import { SavingsTool } from './tools'

/**
 * The body of SavingsHere: the tools' records for the crop year, and the
 * cards. A `?tool=<n>` naming one of them opens it and brings it into view, as
 * it does on the Savings tab, so the links Savings keeps land on the card.
 */
export function HereBody({ ids }: { ids: readonly number[] }) {
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [params] = useSearchParams()
  const toolParam = params.get('tool')
  const [seenTool, setSeenTool] = useState<string | null>(null)
  const [focus, setFocus] = useState<ToolFocus>(null)
  if (toolParam !== seenTool) {
    setSeenTool(toolParam)
    const n = Number(toolParam)
    if (toolParam && ids.includes(n)) setFocus({ n, seq: (focus?.seq ?? 0) + 1 })
  }
  return (
    <SavingsProvider cropYear={cropYear}>
      <ToolFocusProvider focus={focus}>
        <div className="space-y-2">
          {ids.map((id) => (
            <SavingsTool key={id} id={id} isManager={isManager} />
          ))}
        </div>
      </ToolFocusProvider>
    </SavingsProvider>
  )
}
