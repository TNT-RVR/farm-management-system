import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, CircleHelp, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  byField,
  describeWait,
  effectiveReentryHours,
  RECENT_DAYS,
  type AppliedEvent,
  type CropInterval,
  type FieldReentry,
} from '@/lib/reentry'
import { cn } from '@/lib/utils'

/**
 * What was sprayed lately, and whether it is safe to be in the crop.
 *
 * Joins three things the app already had and never put together: which field
 * was sprayed, when the sprayer left it, and what the label says about going
 * back in.
 *
 * An unread label reports as UNKNOWN, never as clear. Most products here have
 * no label read yet, and a green tick against one of them would be a safety
 * assurance nobody actually made.
 */
export function useRecentApplications() {
  return useQuery({
    queryKey: ['reentry_applications'],
    queryFn: async (): Promise<AppliedEvent[]> => {
      const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()

      const { data: apps, error } = await supabase
        .from('product_applications')
        .select('field_id, field_name, applied_at, applied_name, product_id, operation_id')
        .gte('applied_at', since)
        .order('applied_at', { ascending: false })
      if (error) throw error
      if (!apps?.length) return []

      // The interval lives on the label, which is reached through the product's
      // PMRA registration. Two small lookups rather than a view, because most
      // products have neither and the join would hide how many.
      const ids = [...new Set(apps.map((a) => a.product_id).filter(Boolean))] as string[]
      const { data: products } = ids.length
        ? await supabase.from('jd_products').select('id, pmra_registration').in('id', ids)
        : { data: [] }

      const regByProduct = new Map(
        (products ?? [])
          .filter((p) => p.pmra_registration)
          .map((p) => [p.id, p.pmra_registration as string]),
      )
      const regs = [...new Set(regByProduct.values())]
      const { data: labels } = regs.length
        ? await supabase
            .from('chemical_labels')
            .select('registration_number, reentry_hours, reentry_field_hours, reentry_note')
            .in('registration_number', regs)
        : { data: [] }

      const labelByReg = new Map((labels ?? []).map((l) => [l.registration_number, l]))

      // Per-crop intervals, for the labels that state them that way. Lorox L is
      // a seven-crop table and one number for the product is wrong for nearly
      // every crop on it.
      const { data: cropRows } = regs.length
        ? await supabase
            .from('chemical_label_crops')
            .select('registration_number, crop, reentry_hours, reentry_field_hours')
            .in('registration_number', regs)
            .or('reentry_hours.not.is.null,reentry_field_hours.not.is.null')
        : { data: [] }
      const cropsByReg = new Map<string, CropInterval[]>()
      for (const c of cropRows ?? []) {
        const list = cropsByReg.get(c.registration_number) ?? []
        list.push({
          crop: c.crop,
          reentryHours: c.reentry_hours,
          reentryFieldHours: c.reentry_field_hours,
        })
        cropsByReg.set(c.registration_number, list)
      }

      // Which crop was in the field. It rides on the Deere operation, not on
      // the application, so it is one more lookup — and a missing one only
      // means the per-crop intervals go unused, never that a field reads clear.
      const opIds = [...new Set(apps.map((a) => a.operation_id).filter(Boolean))] as string[]
      const { data: ops } = opIds.length
        ? await supabase
            .from('jd_field_operations')
            .select('id, treated_crop')
            .in('id', opIds)
        : { data: [] }
      const cropByOp = new Map((ops ?? []).map((o) => [o.id, o.treated_crop]))

      return apps.map((a) => {
        const reg = a.product_id ? regByProduct.get(a.product_id) : undefined
        const label = reg ? labelByReg.get(reg) : undefined
        return {
          fieldId: a.field_id,
          fieldName: a.field_name,
          appliedAt: a.applied_at as string,
          productName: a.applied_name,
          reentryHours: label?.reentry_hours ?? null,
          reentryFieldHours: label?.reentry_field_hours ?? null,
          reentryNote: label?.reentry_note ?? null,
          crop: a.operation_id ? (cropByOp.get(a.operation_id) ?? null) : null,
          cropIntervals: reg ? (cropsByReg.get(reg) ?? []) : [],
        }
      })
    },
    // Short, because the answer changes with the clock and the whole point is
    // that it is right when somebody is standing at the gate.
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  })
}

const STYLE = {
  restricted: {
    box: 'border-red-300 bg-red-50 text-red-900',
    icon: AlertTriangle,
    iconClass: 'text-red-600',
  },
  unknown: {
    box: 'border-amber-300 bg-amber-50 text-amber-900',
    icon: CircleHelp,
    iconClass: 'text-amber-600',
  },
  clear: {
    box: 'border-gray-200 bg-white text-gray-700',
    icon: ShieldCheck,
    iconClass: 'text-green-600',
  },
} as const

function headline(f: FieldReentry): string {
  if (f.state === 'restricted')
    return `Do not enter — ${describeWait(f.status.hoursLeft)} left on ${f.worst?.productName}`
  if (f.state === 'unknown')
    return `Sprayed recently — no re-entry interval on file for ${f.worst?.productName}`
  return 'Sprayed recently — re-entry intervals have passed'
}

/** The banner for one field, on its own page. Renders nothing when nothing was sprayed. */
export function ReentryWarning({ fieldId }: { fieldId: string }) {
  const { data } = useRecentApplications()
  const entry = byField(data ?? []).find((f) => f.fieldId === fieldId)
  if (!entry) return null

  const style = STYLE[entry.state]
  const Icon = style.icon

  return (
    <div className={cn('rounded-lg border px-3 py-2.5', style.box)}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} />
        {headline(entry)}
      </p>
      <ul className="mt-1 space-y-0.5 pl-6 text-xs">
        {entry.events.map((e, i) => (
          <li key={`${e.productName}-${i}`}>
            {e.productName} · {new Date(e.appliedAt).toLocaleString('en-CA', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {effectiveReentryHours(e) == null ? (
              <span className="opacity-70"> · no label read</span>
            ) : e.status.state === 'restricted' ? (
              <span className="font-medium">
                {' '}
                · clear at{' '}
                {e.status.clearAt?.toLocaleString('en-CA', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            ) : (
              <span className="opacity-70"> · {effectiveReentryHours(e)} h interval passed</span>
            )}
            {/* The interval above governs field work. Where the label sets a
                longer one for some other task, say so here rather than let the
                shorter number stand as the whole answer — the exception is
                moved out of the way, not hidden. */}
            {e.reentryFieldHours != null &&
              e.reentryHours != null &&
              e.reentryHours !== e.reentryFieldHours && (
                <span className="block pl-3 opacity-70">
                  Label also states {e.reentryHours} h — {e.reentryNote}
                </span>
              )}
          </li>
        ))}
      </ul>
      {entry.state === 'unknown' && (
        <p className="mt-1 pl-6 text-xs">
          Unknown is not the same as safe.{' '}
          <Link to="/chemicals" className="underline">
            Read the label
          </Link>{' '}
          to get the interval on file.
        </p>
      )}
    </div>
  )
}

/** Every field with something sprayed on it lately, worst first. */
export function ReentryPanel() {
  const { data, isLoading } = useRecentApplications()
  const fields = byField(data ?? [])

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (!fields.length)
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500">
        Nothing sprayed in the last {RECENT_DAYS} days.
      </p>
    )

  return (
    <ul className="space-y-2">
      {fields.map((f) => {
        const style = STYLE[f.state]
        const Icon = style.icon
        return (
          <li key={f.fieldId} className={cn('rounded-lg border px-3 py-2.5', style.box)}>
            <div className="flex items-start gap-2">
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} />
              <div className="min-w-0 flex-1">
                <Link to={`/fields/${f.fieldId}`} className="font-semibold hover:underline">
                  {f.fieldName}
                </Link>
                <p className="text-xs">{headline(f)}</p>
              </div>
              {f.state === 'restricted' && (
                <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  {describeWait(f.status.hoursLeft)}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
