import type React from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasAdminAccess, hasManagerAccess, useAuth } from '@/lib/auth'
import { useFarmSetup, useFeature } from '@/lib/farm-setup'
import { useCropYear } from '@/lib/crop-year'
import { useRanches } from '@/lib/ranches'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'getting-started:dismissed'

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** How many rows a table has, without fetching them. */
function useRowCount(table: 'fields' | 'crops' | 'crop_plans', cropYear?: number) {
  return useQuery({
    queryKey: ['getting-started-count', table, cropYear ?? null],
    queryFn: async () => {
      const { count, error } =
        table === 'crop_plans' && cropYear
          ? await supabase.from('crop_plans').select('id', { count: 'exact', head: true }).eq('crop_year', cropYear)
          : await supabase.from(table).select('id', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    },
  })
}

/**
 * First steps for a farm installed with an empty database.
 *
 * Only while the farm is new — no fields or no crops — so the farm this app
 * was built on, which has both, never sees it. It waits for both counts before
 * deciding, so an existing farm doesn't get a flash of it on a slow load.
 * Managers only: nobody else can do the steps. Dismissed per device, because
 * the person who set the farm up may not want it on the shop computer too.
 */
export function GettingStarted() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const fields = useRowCount('fields')
  const crops = useRowCount('crops')
  const plans = useRowCount('crop_plans', cropYear)
  const setup = useFarmSetup()
  const { data: ranches } = useRanches()
  const cattleOn = useFeature('cattle')
  const [dismissed, setDismissed] = useState(readDismissed)

  if (!isManager || dismissed) return null
  if (fields.data === undefined || crops.data === undefined) return null
  if (fields.data > 0 && crops.data > 0) return null

  const steps: { done: boolean; to: string; label: string; note?: React.ReactNode }[] = [
    // Farm setup is an admin's tab; a manager sent there would land on My account.
    ...(hasAdminAccess(profile?.role) ? [{ done: Boolean(setup.data), to: '/settings?tab=Farm%20setup', label: 'Farm setup' }] : []),
    { done: crops.data > 0, to: '/crops', label: 'Add your crops' },
    {
      done: fields.data > 0,
      to: '/fields',
      label: 'Add or import fields',
      note: (
        <>
          {' '}— shapefile or KML via{' '}
          <Link to="/fields/import" className="text-brand-700 hover:underline">
            Import boundaries
          </Link>
          , or <SetupLink to={SETUP_LINKS.integration('deere')}>connect John Deere</SetupLink>
        </>
      ),
    },
    { done: (plans.data ?? 0) > 0, to: '/plan', label: `Plan ${cropYear}'s crops` },
  ]
  if (cattleOn) steps.push({ done: (ranches?.length ?? 0) > 0, to: '/cattle', label: 'Add a ranch' })

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Blocked storage: hidden for this visit only.
    }
  }

  return (
    <section className="mb-3 rounded-lg border border-brand-200 bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Getting started</h2>
        <button onClick={dismiss} aria-label="Hide getting started" className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="space-y-1">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-sm">
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                s.done ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300',
              )}
            >
              {s.done && <Check className="h-3 w-3" />}
            </span>
            <span className={cn('min-w-0', s.done && 'text-gray-400')}>
              <Link to={s.to} className={cn('font-medium hover:underline', s.done ? 'text-gray-500' : 'text-brand-700')}>
                {s.label}
              </Link>
              {s.note && <span className="text-xs text-gray-500">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
