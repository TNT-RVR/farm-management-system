import { Link } from 'react-router-dom'
import { MoistureTestNote } from '@/pages/harvest/SampleCondition'
import { useQuery } from '@tanstack/react-query'
import { Droplet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { useBins } from '@/lib/bins'
import { useMoistureTests } from '@/lib/moisture-queries'
import { GRADE_STYLE, gradeLabel, type Grade } from '@/lib/moisture'
import { cn } from '@/lib/utils'
import { DryDownCard } from '@/components/DryDownCard'

type HarvestMoisture = {
  field_id: string
  crop_year: number
  tests: number
  avg_pct: number
  max_pct: number
  min_pct: number
  last_tested_at: string
  any_above_dry: boolean
  harvest_recorded: boolean
}

function useFieldHarvestMoisture(fieldId: string, cropYear: number) {
  return useQuery({
    queryKey: ['field_harvest_moisture', fieldId, cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_harvest_moisture')
        .select('*')
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as HarvestMoisture | null
    },
  })
}

/**
 * What this field went in at.
 *
 * The samples are taken at the shop against whatever came off that hour; the
 * question afterwards is about the field, which is why the summary sits on the
 * field rather than only in the list of readings.
 *
 * BOTH ENDS, never just the average. A field averaging 15.8 with one sample at
 * 19.4 is not a 15.8 field — the wet corner went in the same bin as the rest of
 * it, and quoting only the mean is how a bin gets left alone.
 */
export function FieldMoistureCard({ fieldId }: { fieldId: string }) {
  const { cropYear } = useCropYear()
  const { data: summary } = useFieldHarvestMoisture(fieldId, cropYear)
  const { data: allTests } = useMoistureTests(cropYear)
  const { data: bins } = useBins()

  const tests = (allTests ?? []).filter((t) => t.field_id === fieldId)
  // No tests yet, but the prediction may still have something to say (a
  // Reglone pass waiting on its first sample). It hides itself otherwise.
  if (!summary && !tests.length) return <DryDownCard fieldId={fieldId} cropYear={cropYear} />

  const spread = summary && summary.max_pct !== summary.min_pct

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Droplet className="h-4 w-4 text-gray-400" /> Harvest moisture {cropYear}
        </h3>
        <Link to="/harvest" className="text-xs text-gray-500 underline hover:text-brand-700">
          Test another sample
        </Link>
      </div>

      {summary && (
        <p className="mt-1.5 text-sm text-gray-800">
          <span className="text-lg font-semibold tabular-nums">
            {Number(summary.avg_pct).toFixed(1)}%
          </span>{' '}
          across {summary.tests} {summary.tests === 1 ? 'test' : 'tests'}
          {spread && (
            <span className="text-gray-600">
              {' '}
              — {Number(summary.min_pct).toFixed(1)} to{' '}
              <span className={cn(summary.any_above_dry && 'font-semibold text-amber-800')}>
                {Number(summary.max_pct).toFixed(1)}%
              </span>
            </span>
          )}
          {'. '}
          {summary.harvest_recorded ? (
            <span className="text-gray-600">Harvest is recorded.</span>
          ) : (
            // Worth saying: the bin-needs-air alert waits on this, so a field
            // that is plainly finished but has no record yet is not a bug.
            <span className="text-gray-500">No harvest operation recorded yet.</span>
          )}
        </p>
      )}

      <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
        {tests.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            <span className="w-20 shrink-0 text-xs text-gray-500">
              {new Date(t.tested_at).toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })}
            </span>
            <span className="font-medium tabular-nums text-gray-900">
              {Number(t.moisture_pct).toFixed(1)}%
            </span>
            {t.grade && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
                  GRADE_STYLE[t.grade as Grade],
                )}
              >
                {gradeLabel(t.grade as Grade)}
              </span>
            )}
            {t.bin_id && (
              <span className="text-xs text-gray-500">
                → {bins?.find((b) => b.id === t.bin_id)?.name ?? 'a bin'}
              </span>
            )}
            <MoistureTestNote test={t} />
          </li>
        ))}
      </ul>

      <DryDownCard fieldId={fieldId} cropYear={cropYear} />
    </div>
  )
}
