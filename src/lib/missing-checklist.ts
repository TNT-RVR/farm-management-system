import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { hasManagerAccess, isOwner, useAuth } from './auth'
import { useVisibleReports } from './reports/visible'
import { loadMissingData, missingChecklist, missingItems, type ChecklistLine, type MissingItem } from './reports/missing'

/**
 * The "what's missing" checklist, live: every check in reports/missing.ts
 * run over one read of the database, one line per check. Shared by the
 * Monday meeting's card and the /missing page.
 *
 * Every line is filled in by a manager (the tables behind them are
 * manager-written), so `canFix` is false for anyone else, who sees the
 * list without links. Pages switched off or closed to the person are left out.
 */
export function useMissingChecklist(cropYear: number) {
  const { profile } = useAuth()
  const owner = isOwner(profile)
  const manager = hasManagerAccess(profile?.role)
  const { viewOff } = useVisibleReports()
  const q = useQuery({
    // Versioned: persisted offline, so a change of shape must not restore an old copy.
    queryKey: ['missing-checklist', cropYear, owner, manager, 'v1'],
    enabled: Boolean(profile),
    // Short: a line filled in should drop off when the person comes back.
    staleTime: 60_000,
    queryFn: async (): Promise<MissingItem[]> => {
      const data = await loadMissingData(supabase as unknown as SupabaseClient, cropYear, owner, { isManager: manager })
      return missingItems(data, { isOwner: owner })
    },
  })
  const lines: ChecklistLine[] = useMemo(() => missingChecklist((q.data ?? []).filter((i) => !viewOff(i.path))), [q.data, viewOff])
  return { lines, total: lines.length, canFix: manager, isLoading: q.isLoading, error: (q.error as Error | null) ?? null }
}
