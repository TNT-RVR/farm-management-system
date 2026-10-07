import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useFields } from '@/lib/queries'
import { cn } from '@/lib/utils'

type Row = {
  crop_year: number
  field_id: string
  acres: number | null
  /** Recorded acres for a year that happened, versus a year still being planned. */
  planned: boolean
}

/**
 * Every year this crop was grown, and where.
 *
 * Two sources, deliberately merged: crop_history holds what was actually grown
 * back to 1999, crop_plans holds what is intended for years not yet harvested.
 * Somebody asking "when did we last have canola on Moreau" wants one answer, not
 * a history table and a plan table to reconcile by hand — so the plan years are
 * shown in the same list and marked as plans.
 *
 * Rows are keyed by (year, field) rather than by the underlying id: a field
 * split between two zones of the same crop is one field growing it, not two.
 */
function useCropFieldHistory(cropId: string) {
  return useQuery({
    queryKey: ['crop-field-history', cropId],
    queryFn: async (): Promise<Row[]> => {
      const [history, plans] = await Promise.all([
        supabase.from('crop_history').select('crop_year, field_id, acres').eq('crop_id', cropId),
        supabase
          .from('crop_plans')
          .select('crop_year, field_id, planned_acres')
          .eq('crop_id', cropId),
      ])
      if (history.error) throw history.error
      if (plans.error) throw plans.error

      const seen = new Map<string, Row>()
      // History first, so a year that has both an actual and a leftover plan
      // reports the actual — what happened outranks what was intended.
      for (const h of history.data ?? []) {
        seen.set(`${h.crop_year}:${h.field_id}`, {
          crop_year: h.crop_year,
          field_id: h.field_id,
          acres: h.acres,
          planned: false,
        })
      }
      for (const p of plans.data ?? []) {
        const key = `${p.crop_year}:${p.field_id}`
        if (seen.has(key)) continue
        seen.set(key, {
          crop_year: p.crop_year,
          field_id: p.field_id,
          acres: p.planned_acres,
          planned: true,
        })
      }
      return [...seen.values()]
    },
  })
}

export function CropFieldHistory({ cropId, cropName }: { cropId: string; cropName: string }) {
  const { data: rows, isLoading } = useCropFieldHistory(cropId)
  const { data: fields } = useFields()

  const fieldName = useMemo(() => {
    const m = new Map((fields ?? []).map((f) => [f.id, f.name]))
    // A field deleted since is still part of the record; naming it by a stub is
    // better than dropping the year it was grown.
    return (id: string) => m.get(id) ?? 'Field no longer listed'
  }, [fields])

  const years = useMemo(() => {
    const byYear = new Map<number, Row[]>()
    for (const r of rows ?? []) {
      const list = byYear.get(r.crop_year) ?? []
      list.push(r)
      byYear.set(r.crop_year, list)
    }
    return [...byYear.entries()]
      .map(([year, list]) => ({
        year,
        planned: list.every((r) => r.planned),
        acres: list.reduce((s, r) => s + (r.acres ?? 0), 0),
        fields: [...list].sort((a, b) =>
          fieldName(a.field_id).localeCompare(fieldName(b.field_id)),
        ),
      }))
      .sort((a, b) => b.year - a.year) // newest first: recent years are the ones asked about
  }, [rows, fieldName])

  const totalAcres = years.reduce((s, y) => s + y.acres, 0)

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Where {cropName} has been grown</h2>
        {years.length > 0 && (
          <p className="text-xs text-gray-500">
            {years.length} {years.length === 1 ? 'year' : 'years'} · {years[years.length - 1].year}–
            {years[0].year} · {Math.round(totalAcres).toLocaleString()} acres in total
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="px-4 py-3 text-sm text-gray-500">Loading…</p>
      ) : years.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">
          No record of this crop being grown, planned or past.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {years.map((y) => (
            <li key={y.year} className="flex gap-3 px-4 py-2.5 text-sm">
              <span className="w-20 shrink-0 pt-0.5">
                <span className="font-semibold tabular-nums text-gray-900">{y.year}</span>
                {y.planned && (
                  <span className="ml-1 rounded bg-brand-50 px-1 py-0.5 text-[10px] font-medium uppercase text-brand-700">
                    plan
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                {y.fields.map((f, i) => (
                  <span key={`${f.field_id}-${i}`} className="text-gray-700">
                    <Link
                      to={`/fields/${f.field_id}`}
                      className={cn(
                        'hover:underline',
                        f.planned ? 'text-brand-700' : 'text-gray-900',
                      )}
                    >
                      {fieldName(f.field_id)}
                    </Link>
                    {f.acres ? (
                      <span className="text-xs text-gray-500"> {Math.round(f.acres)} ac</span>
                    ) : null}
                    {i < y.fields.length - 1 ? <span className="text-gray-300"> ·</span> : null}
                  </span>
                ))}
              </span>
              <span className="ml-auto shrink-0 pt-0.5 text-xs tabular-nums text-gray-500">
                {Math.round(y.acres).toLocaleString()} ac
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
