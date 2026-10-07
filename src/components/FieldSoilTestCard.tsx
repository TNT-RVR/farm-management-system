import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ExternalLink, Sprout } from 'lucide-react'
import { RatingLegendInfo } from '@/components/RatingLegendInfo'
import { profileTotals, topsoilAverage, useFieldSoilReports } from '@/lib/soilTests'
import { rateProfileValue, rateValue, SOIL_HELP } from '@/lib/soil-help'
import { ColumnHelp } from '@/components/ColumnHelp'
import { cn } from '@/lib/utils'

const RATING_CLASS: Record<string, string> = {
  low: 'text-red-700',
  marginal: 'text-amber-700',
  ok: 'text-gray-900',
  high: 'text-sky-700',
}

const RATING_WORD: Record<string, string> = {
  low: 'low',
  marginal: 'marginal',
  ok: 'adequate',
  high: 'high',
}

function Stat({
  label,
  value,
  unit,
  helpKey,
  rating,
}: {
  label: string
  value: number | null
  unit?: string
  helpKey?: string
  rating?: string | null
}) {
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-2">
      <p className="flex items-center text-[11px] font-medium text-gray-500">
        {label}
        {helpKey && SOIL_HELP[helpKey] && <ColumnHelp help={SOIL_HELP[helpKey]} />}
      </p>
      <p className={cn('text-sm font-bold tabular-nums', rating ? RATING_CLASS[rating] : 'text-gray-900')}>
        {value == null ? '—' : Math.round(value * 100) / 100}
        {value != null && unit && <span className="ml-0.5 text-[10px] font-normal text-gray-400">{unit}</span>}
      </p>
      {rating && <p className={cn('text-[10px]', RATING_CLASS[rating])}>{RATING_WORD[rating]}</p>}
    </div>
  )
}

type Report = ReturnType<typeof useFieldSoilReports>['data'] extends (infer R)[] | undefined ? R : never

/**
 * The soil tests at a glance, on the field page, one fold per year.
 *
 * Deliberately the headline numbers only — the whole panel is several dozen
 * columns, and repeating it here would make the field page a second Fertilizer
 * screen rather than a summary that says whether anything needs attention.
 * The newest year opens; older years sit as one line each until asked for.
 */
export function FieldSoilTestCard({ fieldId }: { fieldId: string }) {
  const { data: reports, isLoading } = useFieldSoilReports(fieldId)
  if (isLoading || !reports || reports.length === 0) return null

  // One fold per year. A field sampled in halves (East Ranch) has two reports
  // for the year; both sit in the same fold rather than being averaged, because
  // the halves are why they were sampled separately in the first place.
  const years = [...new Set(reports.map((r) => r.crop_year))]

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Sprout className="h-4 w-4" /> Soil tests
          <span className="font-normal text-gray-400">
            · {years.length} year{years.length === 1 ? '' : 's'}
          </span>
        </h3>
        <Link
          to={`/fertilizer?tab=Soil+Sampling&field=${fieldId}`}
          className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          Full results <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-2 space-y-2">
        {years.map((year, i) => (
          <YearFold
            key={year}
            year={year}
            reports={reports.filter((r) => r.crop_year === year)}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    </div>
  )
}

function YearFold({
  year,
  reports,
  defaultOpen,
}: {
  year: number
  reports: Report[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const first = reports[0]
  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')}
          />
          <span className="text-sm font-semibold text-gray-800">{year}</span>
          {!open && (
            <span className="truncate text-xs text-gray-500">
              {first.crop_label ? `tested for ${first.crop_label}` : 'crop not stated'}
              {first.lab ? ` · ${first.lab}` : ''}
              {reports.length > 1 ? ` · ${reports.length} reports` : ''}
            </span>
          )}
        </button>
        <RatingLegendInfo classes={RATING_CLASS} compact />
      </div>
      {open &&
        reports.map((r) => {
        const totals = profileTotals(r.samples)
        const p = topsoilAverage(r.samples, 'p_bicarb_ppm')
        const k = topsoilAverage(r.samples, 'k_ppm')
        const om = topsoilAverage(r.samples, 'om_pct')
        const ph = topsoilAverage(r.samples, 'ph')
        const na = topsoilAverage(r.samples, 'base_na_pct')
        return (
          <div key={r.id} className="border-t border-gray-100 px-2.5 pb-2.5 pt-2">
            <p className="text-xs text-gray-500">
              {r.part_label ? `${r.part_label} · ` : ''}
              {r.crop_label ? `tested for ${r.crop_label}` : 'crop not stated'}
              {r.lab ? ` · ${r.lab}` : ''}
              {r.report_date ? ` · ${r.report_date}` : ''}
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
              {/* Summed down the profile, not the topsoil core: nitrate and
                  sulphate move with water and the rate is set from the total. */}
              <Stat
                label="Nitrate 0–24″"
                value={totals.avgNo3nLbAc}
                unit="lb/ac"
                helpKey="no3n_lb_ac"
                rating={rateProfileValue('no3n_lb_ac', totals.avgNo3nLbAc)}
              />
              <Stat
                label="Sulphate 0–6″"
                value={totals.so4sTopPpm}
                unit="ppm"
                helpKey="so4s_ppm"
                rating={rateValue('so4s_ppm', totals.so4sTopPpm)}
              />
              <Stat
                label="P (Olsen)"
                value={p}
                unit="ppm"
                helpKey="p_bicarb_ppm"
                rating={rateValue('p_bicarb_ppm', p)}
              />
              <Stat label="K" value={k} unit="ppm" helpKey="k_ppm" rating={rateValue('k_ppm', k)} />
              <Stat
                label="Organic matter"
                value={om}
                unit="%"
                helpKey="om_pct"
                rating={rateValue('om_pct', om)}
              />
              <Stat label="pH" value={ph} helpKey="ph" />
              <Stat
                label="Sodium"
                value={na}
                unit="%"
                helpKey="base_na_pct"
                rating={rateValue('base_na_pct', na)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
