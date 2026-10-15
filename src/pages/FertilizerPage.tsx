import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTab } from '@/lib/useTab'
import { SavingsTab } from '@/pages/fertilizer/savings/SavingsTab'
import { IciTab } from '@/pages/fertilizer/IciTab'
import { CheckCircle2, ChevronRight, Loader2, RefreshCw, Sparkles, Sprout, Upload } from 'lucide-react'
import { Select } from '@/components/Select'
import { EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { ColumnHelp } from '@/components/ColumnHelp'
import { useFields } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import {
  profileTotals,
  useAssessmentSweep,
  useAssessmentSweepStatus,
  useAssessmentsPending,
  useFieldSoilReports,
  useGenerateAssessment,
  useSoilTestCoverage,
  useDeleteSoilReport,
  useDeleteSoilSample,
  useUpdateSoilReport,
  useUpdateSoilSample,
  type SoilReport,
  type SoilSampleRow,
} from '@/lib/soilTests'
import {
  rateDepthScaled,
  rateProfileValue,
  rateValue,
  SOIL_COLUMNS,
  SOIL_HELP,
  SOIL_MICRO_COLUMNS,
} from '@/lib/soil-help'
import { RatingLegendInfo } from '@/components/RatingLegendInfo'
import { PillTabs } from '@/components/PillTabs'
import { YieldZones } from '@/pages/fertilizer/YieldZones'
import { cn } from '@/lib/utils'
import { NutrientHistory } from '@/pages/fertilizer/NutrientHistory'
import { MarketTab } from '@/pages/fertilizer/MarketTab'
import { Requirements } from '@/pages/fertilizer/Requirements'
import { FieldSoilSurvey } from '@/components/FieldSoilSurvey'
import { Prescriptions } from '@/pages/fertilizer/Prescriptions'
import { BlendsTab } from '@/pages/fertilizer/BlendsTab'
import { Manure } from '@/pages/fertilizer/Manure'
import { useCropYear } from '@/lib/crop-year'
import { SamplingMap } from '@/pages/fertilizer/SamplingMap'
import { TissueTests } from '@/pages/fertilizer/TissueTests'
import { ProductPrices } from '@/components/ProductPrices'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { IciPrices } from '@/pages/fertilizer/IciPrices'
import { HelpNote } from '@/components/HelpNote'
import { AdminOnly } from '@/components/TechnicalDetails'
import { useFarmSettings, useFeature } from '@/lib/farm-setup'

// Opened a few times a year, so it is not in the page's own bundle.
const SoilTestImport = lazy(() =>
  import('@/pages/fertilizer/SoilTestImport').then((m) => ({ default: m.SoilTestImport })),
)

/**
 * Thirteen tabs in a row were a wall of words to find one thing in, so they
 * are five groups now, each with its views as a second row of pills.
 *
 * The URL still carries the VIEW, under the names it always had — `?tab=Soil
 * Sampling`, `?tab=Market` — so every tile, notification and saved link lands
 * where it did. The group is worked out from the view. A group's own name
 * (`?tab=Prices`) is accepted too and opens the view last used in it.
 */
const GROUPS = [
  {
    key: 'Soil',
    views: [
      { key: 'Soil Sampling', label: 'Soil tests' },
      { key: 'Sampling Map', label: 'Sampling map' },
      { key: 'Nutrient History', label: 'Nutrient history' },
      { key: 'Tissue Tests', label: 'Tissue tests' },
    ],
  },
  {
    key: 'Plan',
    views: [
      { key: 'Requirements', label: 'Requirements' },
      { key: 'Productivity Zones', label: 'Productivity zones' },
      { key: 'Prescriptions', label: 'Prescriptions' },
      { key: 'Blends', label: 'Blends' },
    ],
  },
  {
    key: 'Prices',
    views: [
      { key: 'Pricing', label: 'Pricing' },
      { key: 'Market', label: 'Market' },
      // Key stays 'ICI' so `?tab=ICI` links keep working; the label is the
      // farm's own retailer, and the view is hidden with retailer invoices off.
      { key: 'ICI', label: 'ICI' },
    ],
  },
  { key: 'Manure', views: [{ key: 'Manure', label: 'Manure' }] },
  { key: 'Savings', views: [{ key: 'Savings', label: 'Savings' }] },
] as const

type Group = (typeof GROUPS)[number]
type Tab = Group['views'][number]['key']
const TABS = GROUPS.flatMap((g) => g.views.map((v) => v.key)) as Tab[]
const groupOf = (t: Tab): Group => GROUPS.find((g) => g.views.some((v) => v.key === t))!

/** The view a group opens on: the one last used in it, else its first. */
function lastViewIn(group: Group): Tab {
  try {
    const saved = localStorage.getItem(`fertilizer-view:${group.key}`)
    if (saved && group.views.some((v) => v.key === saved)) return saved as Tab
  } catch {
    /* private window */
  }
  return group.views[0].key
}
function rememberView(t: Tab) {
  try {
    localStorage.setItem(`fertilizer-view:${groupOf(t).key}`, t)
  } catch {
    /* private window */
  }
}

const RATING_CLASS: Record<string, string> = {
  low: 'bg-red-50 text-red-800',
  marginal: 'bg-amber-50 text-amber-800',
  ok: '',
  high: 'bg-sky-50 text-sky-800',
}

// Precision by size: 412 ppm of potassium does not need ".37", but 0.42 dS/m
// of salt and 0.8 ppm of zinc need their decimals. Display only — the ratings
// are worked out on the stored value.
const fmt = (v: unknown) => {
  if (v == null) return '—'
  if (typeof v !== 'number') return String(v)
  const a = Math.abs(v)
  const places = a >= 100 ? 0 : a >= 10 ? 1 : 2
  const f = 10 ** places
  return String(Math.round(v * f) / f)
}

function Cell({ col, s }: { col: string; s: SoilSampleRow }) {
  if (col === 'sample') return <>{s.sample_code}</>
  if (col === 'depth') return <>{s.depth_label ?? '—'}</>
  const raw = (s as unknown as Record<string, number | null>)[col]
  // Only the topsoil core is rated. A subsoil figure is not low or high in the
  // same sense — most of these tests are not even run at depth, and colouring a
  // structural zero red would read as a problem that is not there.
  // Nitrate is judged against its share of the 0-24in profile, so both depths
  // get a colour; everything else is rated on the topsoil only.
  const rating =
    rateDepthScaled(col, raw, s.depth_top_in, s.depth_bottom_in) ??
    (s.depth_top_in === 0 ? rateValue(col, raw) : null)
  return (
    <span className={cn('rounded px-1 tabular-nums', rating && RATING_CLASS[rating])}>
      {fmt(raw)}
    </span>
  )
}

function SampleTable({
  samples,
  columns,
  note,
  columnNotes,
  onOpen,
}: {
  samples: SoilSampleRow[]
  columns: { key: string; label: string; unit?: string }[]
  note?: string
  columnNotes?: Record<string, { summary?: string; priorCrop?: string; nextCrop?: string }>
  /** A manager clicks a sample to correct its numbers (Sam, 7 Oct 2026). */
  onOpen?: (s: SoilSampleRow) => void
}) {
  // The popover sits on a heading, not a cell, so the figure it highlights is
  // the field's own — the topsoil average across this report's sites. Nitrate
  // and sulphate are summed down the profile instead, because that is the
  // number their bands are written against.
  const headerValue = (key: string): number | null => {
    const rows = key === 'no3n_lb_ac' ? samples : samples.filter((x) => x.depth_top_in === 0)
    if (key === 'no3n_lb_ac') {
      const t = profileTotals(samples)
      return t.avgNo3nLbAc
    }
    if (key === 'so4s_ppm') return profileTotals(samples).so4sTopPpm
    const vals = rows
      .map((x) => (x as unknown as Record<string, number | null>)[key])
      .filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null
  }
  const anyValue = (key: string) =>
    samples.some((s) => (s as unknown as Record<string, unknown>)[key] != null)
  // A column the lab never returned is dropped rather than shown as a wall of
  // dashes — 2024 has no micronutrient panel at all.
  const shown = columns.filter((c) => ['sample', 'depth'].includes(c.key) || anyValue(c.key))
  if (shown.length <= 2) {
    return <p className="px-3 py-3 text-xs text-gray-400">{note ?? 'Not reported on this test.'}</p>
  }
  return (
    <div>
      {/* table-fixed with no horizontal scroll: the whole panel has to be
          readable at a glance, and a table you scroll sideways hides half the
          nutrients behind an interaction nobody performs while comparing. The
          headings wrap and the type is small to pay for it. */}
      {/* Scrolls sideways on a phone: the last column's help icon sat six
          pixels past the edge and put a horizontal scroll on the whole page. */}
      <div className="overflow-x-auto">
      <table className="w-full table-fixed text-[11px]">
        <colgroup>
          {shown.map((c) => (
            <col
              key={c.key}
              // The two label columns need real room; every other cell is a
              // short number and can share what is left evenly.
              style={{ width: c.key === 'sample' ? '7%' : c.key === 'depth' ? '8%' : undefined }}
            />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 text-left align-bottom text-[10px] uppercase tracking-tight text-gray-500">
            {shown.map((c) => (
              <th key={c.key} className="px-1 py-1.5 font-medium leading-tight">
                <span className="inline-flex items-baseline">
                  <span className="break-words">{c.label}</span>
                  {SOIL_HELP[c.key] && (
                    <ColumnHelp
                      help={SOIL_HELP[c.key]}
                      value={headerValue(c.key)}
                      valueLabel={(() => {
                        const v = headerValue(c.key)
                        if (v == null) return undefined
                        const rounded = Math.round(v * 100) / 100
                        const scope =
                          c.key === 'no3n_lb_ac' ? '0–24″ site average' : 'topsoil average'
                        return `${rounded}${c.unit ? ` ${c.unit}` : ''} — ${scope}`
                      })()}
                      note={columnNotes?.[c.key]}
                    />
                  )}
                </span>
                {c.unit && (
                  <span className="block font-normal normal-case tracking-normal text-gray-400">
                    {c.unit}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => (
            <tr
              key={s.id}
              onClick={onOpen ? rowClick(() => onOpen(s)) : undefined}
              title={onOpen ? 'Click to edit this sample' : undefined}
              className={cn(
                'border-b border-gray-100 last:border-0',
                s.depth_top_in !== 0 && 'bg-gray-50/60 text-gray-600',
                onOpen && 'cursor-pointer hover:bg-brand-50/40',
              )}
            >
              {shown.map((c) => (
                <td key={c.key} className="px-1 py-1.5">
                  <Cell col={c.key} s={s} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {note && (
        <p className="border-t border-gray-100 px-1 py-1.5 text-[11px] text-gray-400">{note}</p>
      )}
    </div>
  )
}

const SAMPLE_VALUE_FIELDS: EditField[] = [...SOIL_COLUMNS.filter((c) => c.key !== 'sample' && c.key !== 'depth'), ...SOIL_MICRO_COLUMNS].map((c) => ({
  key: c.key,
  label: c.unit ? `${c.label} (${c.unit})` : c.label,
  kind: 'number' as const,
}))

const SAMPLE_FIELDS: EditField[] = [
  { key: 'sample_code', label: 'Sample', kind: 'text', required: true, hint: '1A topsoil, 1B subsoil, per site' },
  { key: 'depth_label', label: 'Depth label', kind: 'text', placeholder: '0-6' },
  { key: 'depth_top_in', label: 'Top (in)', kind: 'number', int: true },
  { key: 'depth_bottom_in', label: 'Bottom (in)', kind: 'number', int: true },
  ...SAMPLE_VALUE_FIELDS,
]

function reportFields(fieldOptions: { value: string; label: string }[]): EditField[] {
  return [
    { key: 'field_id', label: 'Field', kind: 'select', required: true, options: fieldOptions },
    { key: 'crop_year', label: 'Crop year', kind: 'number', int: true, required: true },
    { key: 'part_label', label: 'Part of the field', kind: 'text', placeholder: 'East Half', hint: 'Blank for the whole field' },
    { key: 'crop_label', label: 'Tested for (crop)', kind: 'text' },
    { key: 'lab', label: 'Lab', kind: 'text' },
    { key: 'report_date', label: 'Reported', kind: 'date' },
    { key: 'report_ref', label: 'Lab reference', kind: 'text' },
  ]
}

function ReportCard({
  report,
  defaultOpen = true,
  canEdit = false,
  fieldOptions = [],
}: {
  report: SoilReport
  defaultOpen?: boolean
  canEdit?: boolean
  fieldOptions?: { value: string; label: string }[]
}) {
  // The newest year opens; older ones sit closed until asked for, so a field
  // with six years of tests is a list of six lines, not six tables.
  const [open, setOpen] = useState(defaultOpen)
  // Sam, 7 Oct 2026: a report's header and each sample can be corrected, and
  // a wrong report deleted whole.
  const [editingReport, setEditingReport] = useState(false)
  const [editingSample, setEditingSample] = useState<SoilSampleRow | null>(null)
  const updReport = useUpdateSoilReport()
  const delReport = useDeleteSoilReport()
  const updSample = useUpdateSoilSample()
  const delSample = useDeleteSoilSample()
  const openSample = canEdit ? setEditingSample : undefined
  const reportName = `${report.crop_year}${report.part_label ? ` ${report.part_label}` : ''}`
  const totals = useMemo(() => profileTotals(report.samples), [report.samples])
  const micro = report.samples.filter((s) => s.depth_top_in === 0)
  // Generated per report, one call producing every column's note, rather than
  // a call per column — thirty separate requests for one page of numbers.
  // Defensive on read too: rows written before the generator coerced a
  // double-encoded payload are still a JSON string in the column.
  const columnNotes = useMemo(() => {
    const raw = report.assessment?.column_notes
    if (raw && typeof raw === 'object') {
      return raw as Record<string, { summary?: string; priorCrop?: string; nextCrop?: string }>
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<
          string,
          { summary?: string; priorCrop?: string; nextCrop?: string }
        >
      } catch {
        return undefined
      }
    }
    return undefined
  }, [report.assessment?.column_notes])

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex flex-wrap items-center gap-2 px-3 py-2', open && 'border-b border-gray-200')}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')}
          />
          <span>
          <h3 className="text-sm font-semibold text-gray-900">
            {report.crop_year}
            {report.part_label && (
              <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                {report.part_label}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500">
            {report.crop_label ? `Tested for ${report.crop_label}` : 'Crop not stated'}
            {report.lab ? ` · ${report.lab}` : ''}
            {report.report_date ? ` · reported ${report.report_date}` : ''}
          </p>
          </span>
        </button>
        {report.report_ref && (
          <AdminOnly>
            <p className="text-[11px] text-gray-400">{report.report_ref}</p>
          </AdminOnly>
        )}
        <RatingLegendInfo classes={RATING_CLASS} />
        {canEdit && <EditButton onClick={() => setEditingReport(true)} />}
      </div>
      {editingReport && (
        <RecordEditModal
          title={`Soil test ${reportName}`}
          fields={reportFields(fieldOptions)}
          row={report}
          saving={updReport.isPending || delReport.isPending}
          error={(updReport.error ?? delReport.error)?.message ?? null}
          onClose={() => {
            updReport.reset()
            delReport.reset()
            setEditingReport(false)
          }}
          onSave={(v) =>
            updReport.mutateAsync({
              id: report.id,
              patch: {
                field_id: String(v.field_id),
                crop_year: Number(v.crop_year),
                part_label: (v.part_label as string | null) ?? '',
                crop_label: (v.crop_label as string | null) ?? null,
                lab: (v.lab as string | null) ?? null,
                report_date: (v.report_date as string | null) ?? null,
                report_ref: (v.report_ref as string | null) ?? null,
              },
            })
          }
          onDelete={() => delReport.mutateAsync(report.id)}
          deleteConfirm={`Delete the whole ${reportName} soil test? This also removes its ${report.samples.length} sample${report.samples.length === 1 ? '' : 's'}${report.assessment ? ' and its written assessment' : ''}.`}
        />
      )}
      {editingSample && (
        <RecordEditModal
          title={`Sample ${editingSample.sample_code} · ${reportName}`}
          fields={SAMPLE_FIELDS}
          row={editingSample}
          saving={updSample.isPending || delSample.isPending}
          error={(updSample.error ?? delSample.error)?.message ?? null}
          onClose={() => {
            updSample.reset()
            delSample.reset()
            setEditingSample(null)
          }}
          onSave={(v) => updSample.mutateAsync({ id: editingSample.id, patch: v })}
          onDelete={() => delSample.mutateAsync(editingSample.id)}
          deleteConfirm={`Delete sample ${editingSample.sample_code} from the ${reportName} test?`}
        />
      )}
      {open && (
      <>

      {/* The two mobile nutrients, summed down the profile rather than read off
          the topsoil core, because that is the number a rate is set from. */}
      {/* Nitrate and sulphate are rated HERE rather than in the table: their
          bands describe the whole profile, and this is the only place that
          figure appears. Colouring a single core against them would give a
          correct number a wrong verdict. */}
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-100 px-3 py-2 text-xs">
        <span className="flex items-center gap-1 text-gray-600">
          Nitrate 0–24″:
          <b
            className={cn(
              'rounded px-1 tabular-nums',
              rateProfileValue('no3n_lb_ac', totals.avgNo3nLbAc)
                ? RATING_CLASS[rateProfileValue('no3n_lb_ac', totals.avgNo3nLbAc)!]
                : 'text-gray-900',
            )}
          >
            {totals.avgNo3nLbAc == null ? '—' : `${Math.round(totals.avgNo3nLbAc)} lb/ac`}
          </b>
          <span className="text-gray-400">(site average)</span>
          <ColumnHelp
            help={SOIL_HELP.no3n_lb_ac}
            value={totals.avgNo3nLbAc}
            valueLabel={
              totals.avgNo3nLbAc == null
                ? undefined
                : `${Math.round(totals.avgNo3nLbAc)} lb/ac — 0–24″ site average`
            }
            note={columnNotes?.no3n_lb_ac}
          />
        </span>
        <span className="flex items-center gap-1 text-gray-600">
          Sulphate:
          <b
            className={cn(
              'rounded px-1 tabular-nums',
              rateValue('so4s_ppm', totals.so4sTopPpm)
                ? RATING_CLASS[rateValue('so4s_ppm', totals.so4sTopPpm)!]
                : 'text-gray-900',
            )}
          >
            {totals.so4sTopPpm == null ? '—' : `${Math.round(totals.so4sTopPpm)} ppm`}
          </b>
          <span className="text-gray-400">0–6″</span>
          <b
            className={cn(
              'rounded px-1 tabular-nums',
              rateValue('so4s_ppm', totals.so4sSubPpm)
                ? RATING_CLASS[rateValue('so4s_ppm', totals.so4sSubPpm)!]
                : 'text-gray-900',
            )}
          >
            {totals.so4sSubPpm == null ? '—' : `${Math.round(totals.so4sSubPpm)} ppm`}
          </b>
          <span className="text-gray-400">6–24″</span>
          <ColumnHelp
            help={SOIL_HELP.so4s_ppm}
            value={totals.so4sTopPpm}
            valueLabel={
              totals.so4sTopPpm == null
                ? undefined
                : `${Math.round(totals.so4sTopPpm)} ppm — topsoil average`
            }
            note={columnNotes?.so4s_ppm}
          />
        </span>
      </div>

      <SampleTable samples={report.samples} columns={SOIL_COLUMNS} columnNotes={columnNotes} onOpen={openSample} />

      <div className="border-t border-gray-200">
        <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Micronutrients &amp; salts — topsoil only
        </p>
        <SampleTable
          samples={micro}
          onOpen={openSample}
          columnNotes={columnNotes}
          columns={[{ key: 'sample', label: 'Sample' }, ...SOIL_MICRO_COLUMNS]}
          note="Not reported on this test. The 2024 lab used a different panel, and micronutrients are not run on subsoil cores."
        />
      </div>

      <Assessment report={report} />
      </>
      )}
    </div>
  )
}

/**
 * What the highlighting means. Colour with no key is a guessing game, and these
 * numbers get read by people who did not choose the bands.
 */
type RecItem = {
  nutrient?: string
  product?: string
  lb_per_ac?: number
  product_lb_per_ac?: number
  timing?: string
  note?: string
}

/**
 * The generated write-up and programme for one report.
 *
 * It reasons from this field's numbers and its rotation rather than restating
 * the lab's own recommendation, which is printed on the report a few lines up —
 * two versions of the same advice side by side would just raise the question of
 * which to follow.
 */
function Assessment({ report }: { report: SoilReport }) {
  const generate = useGenerateAssessment()
  const qc = useQueryClient()
  const a = report.assessment
  const recs = (a?.recommendation ?? []) as RecItem[]

  // The generator is a background function: it answers the moment it accepts
  // the job and finishes minutes later. Rather than telling somebody to reload,
  // poll until the row changes and let it appear on its own.
  const [waiting, setWaiting] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  // What was there when we asked, so a REgenerate is recognised as done by its
  // timestamp moving rather than by an assessment merely existing.
  const startedFrom = useRef<string | null>(null)

  useEffect(() => {
    if (!waiting) return
    const began = Date.now()
    const id = setInterval(() => {
      // Give up after four minutes rather than polling for the rest of the
      // session; the write either landed or the run failed server-side.
      if (Date.now() - began > 4 * 60_000) {
        setWaiting(false)
        return
      }
      void qc.invalidateQueries({ queryKey: ['soil_test_reports'] })
    }, 4000)
    return () => clearInterval(id)
  }, [waiting, qc])

  useEffect(() => {
    if (!waiting) return
    const stamp = a?.generated_at ?? null
    if (stamp && stamp !== startedFrom.current) {
      setWaiting(false)
      setJustFinished(true)
    }
  }, [a?.generated_at, waiting])

  const start = () => {
    startedFrom.current = a?.generated_at ?? null
    setJustFinished(false)
    setWaiting(true)
    generate.mutate(report.id, {
      onError: () => setWaiting(false),
    })
  }

  return (
    <div className="border-t border-gray-200 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <Sparkles className="h-3.5 w-3.5" /> Agronomic assessment
          {a?.crop_label && <span className="normal-case text-gray-400">for {a.crop_label}</span>}
        </h4>
        <div className="flex items-center gap-2">
          {justFinished && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </span>
          )}
          <button
            onClick={start}
            disabled={generate.isPending || waiting}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {waiting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {waiting ? 'Writing…' : a ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {waiting && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md bg-brand-50 px-2 py-1.5 text-[11px] text-brand-900">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>
            Reading this field against the crop coming next. It takes a minute or two and will fill
            itself in — no need to reload.
          </span>
        </div>
      )}
      {generate.isError && (
        <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {(generate.error as Error).message}
        </p>
      )}

      {!a ? (
        <HelpNote className="mt-1.5 text-xs" summary="Not generated yet." title="What the assessment is">
          It reads this field&rsquo;s numbers against the crop coming next and the one that came off
          last year.
        </HelpNote>
      ) : (
        <>
          {recs.length > 0 && (
            <table className="mt-2 w-full table-fixed text-[11px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-1 py-1 font-medium" style={{ width: '12%' }}>
                    Nutrient
                  </th>
                  <th className="px-1 py-1 font-medium" style={{ width: '24%' }}>
                    Product
                  </th>
                  <th className="px-1 py-1 text-right font-medium" style={{ width: '13%' }}>
                    lb/ac actual
                  </th>
                  <th className="px-1 py-1 text-right font-medium" style={{ width: '13%' }}>
                    lb/ac product
                  </th>
                  <th className="px-1 py-1 font-medium">Timing &amp; why</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-1 py-1 font-semibold text-gray-900">{r.nutrient ?? '—'}</td>
                    <td className="px-1 py-1 text-gray-700">{r.product ?? '—'}</td>
                    <td className="px-1 py-1 text-right tabular-nums text-gray-900">
                      {r.lb_per_ac ?? '—'}
                    </td>
                    <td className="px-1 py-1 text-right tabular-nums text-gray-600">
                      {r.product_lb_per_ac ?? '—'}
                    </td>
                    <td className="px-1 py-1 leading-relaxed text-gray-600">
                      {r.timing ? (
                        <span className="font-medium text-gray-700">{r.timing}. </span>
                      ) : null}
                      {r.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* The lab's own numbers stay visible above, so this is deliberately
              marked as a second opinion rather than presented as the answer. */}
          <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
            {a.assessment_md}
          </div>
          <HelpNote
            className="mt-1.5 text-[10px]"
            summary={
              <>
                AI second opinion · check rates · {a.generated_at?.slice(0, 10)}
                {a.model && <AdminOnly> · {a.model}</AdminOnly>}
              </>
            }
            title="About this assessment"
          >
            A second read against the lab&rsquo;s own recommendation, not a replacement for it.
            Check rates before ordering.
          </HelpNote>
        </>
      )}
    </div>
  )
}

/**
 * How many write-ups are still outstanding, and a way to run them all.
 *
 * Assessments are written ahead of time by an hourly sweep so that opening a
 * report shows one immediately rather than a spinner. This is the manual push
 * for when you would rather not wait for the hour, and the honest read of how
 * far behind it is.
 */
function SweepBanner() {
  const { data: pending } = useAssessmentsPending()
  const { data: status } = useAssessmentSweepStatus()
  const sweep = useAssessmentSweep()
  const refused = status?.detail?.startsWith('REFUSED')
  if (pending == null) return null

  // Nothing pending is not news. The banner exists to say when the write-ups
  // are behind; saying so every other time is a line of text that is only ever
  // read once and then scrolled past.
  if (pending === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <HelpNote
        className="text-xs text-amber-900"
        summary={
          <>
            <b>{pending}</b> report{pending === 1 ? '' : 's'} still to be written up.
          </>
        }
        title="Why reports wait"
      >
        They are produced on a schedule so the page never waits on one — this runs them now instead.
      </HelpNote>
      <button
        onClick={() => sweep.mutate()}
        disabled={sweep.isPending}
        className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        {sweep.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {sweep.isPending ? 'Started…' : 'Write them all'}
      </button>
      {sweep.isError && (
        <p className="w-full text-[11px] text-red-700">{(sweep.error as Error).message}</p>
      )}
      {refused && (
        <p className="w-full text-[11px] text-red-700">
          Last run was refused — writing assessments needs an active manager account. Ask an admin
          to raise your role, or have a manager press this.
        </p>
      )}
      {/* The job's own status line is for whoever maintains it. */}
      {!refused && status?.detail && !sweep.isPending && (
        <AdminOnly>
          <p className="w-full text-[11px] text-amber-800">Last run: {status.detail}</p>
        </AdminOnly>
      )}
    </div>
  )
}

function SoilSampling({
  fieldId,
  setFieldId,
  canEdit,
}: {
  fieldId: string
  setFieldId: (v: string) => void
  canEdit: boolean
}) {
  const [importing, setImporting] = useState(false)
  const { data: fields } = useFields()
  const { data: coverage } = useSoilTestCoverage()
  // Active fields, plus any archived one that still has a test on file. A field
  // retired this year keeps its history, and hiding it would make the data
  // unreachable the moment it stopped being farmed — which is exactly when
  // somebody goes looking for what it used to do.
  const options = useMemo(() => {
    const tested = new Set((coverage ?? []).map((c) => c.field_id))
    return (fields ?? [])
      .filter((f) => f.active || tested.has(f.id))
      .map((f) => ({ value: f.id, label: f.active ? f.name : `${f.name} (archived)` }))
  }, [fields, coverage])
  const selected = fieldId || options[0]?.value || ''
  const { data: reports, isLoading } = useFieldSoilReports(selected || undefined)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={selected}
          onChange={setFieldId}
          ariaLabel="Field"
          className="w-full sm:w-64"
          options={options}
        />
        {canEdit && (
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" /> Upload lab results (CSV)
          </button>
        )}
      </div>
      {importing && (
        <Suspense fallback={null}>
          <SoilTestImport onClose={() => setImporting(false)} />
        </Suspense>
      )}

      {/* The ground the cores came out of, above the cores. A field that reads
          two ways between sample sites is usually a field that spans two soils,
          and there has been nothing on screen to say so. */}
      <FieldSoilSurvey fieldId={selected || null} className="mb-4" />

      <SweepBanner />

      {isLoading ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading…</p>
      ) : !reports || reports.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-300 py-16 text-center text-sm text-gray-400">
          No soil tests on file for this field.
          {canEdit && (
            <button
              onClick={() => setImporting(true)}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <Upload className="h-4 w-4" /> Upload lab results (CSV)
            </button>
          )}
        </div>
      ) : (
        reports.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            defaultOpen={r.crop_year === reports[0].crop_year}
            canEdit={canEdit}
            fieldOptions={options}
          />
        ))
      )}
    </div>
  )
}

export function FertilizerPage() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  // In the URL and remembered: the nav link carries no tab, and before this a
  // trip away and back always landed on Soil Sampling. A group's name in the
  // URL opens that group's last view.
  const { retailerName } = useFarmSettings()
  const retailerOn = useFeature('retailer_invoices')
  const [asked, setTab] = useTab<Tab>('fertilizer', TABS, TABS[0], (asked) => {
    const g = GROUPS.find((x) => x.key.toLowerCase() === asked.toLowerCase())
    return g ? lastViewIn(g) : undefined
  })
  // The retailer view is hidden when the farm has switched retailer invoices
  // off; a link to it lands on its group's first view instead.
  const viewShown = (key: Tab) => key !== 'ICI' || retailerOn
  const tab: Tab = viewShown(asked) ? asked : groupOf(asked).views[0].key
  // Whatever view is on screen — picked here or arrived at by a link — is the
  // one its group reopens on.
  useEffect(() => rememberView(tab), [tab])
  const group = groupOf(tab)
  const views = group.views.filter((v) => viewShown(v.key))
  const [fieldId, setFieldId] = useState(params.get('field') ?? '')
  const { cropYear } = useCropYear()

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="border-b border-gray-200 bg-white px-4 md:px-6">
        <div className="flex items-center gap-2 py-3">
          <Sprout className="h-5 w-5 text-brand-700" />
          <h1 className="text-lg font-semibold text-gray-900">Fertilizer</h1>
        </div>
        <PillTabs
          tabs={GROUPS.map((g) => ({ key: g.key, label: g.key }))}
          value={group.key}
          onChange={(k) => setTab(lastViewIn(GROUPS.find((g) => g.key === k)!))}
          className="border-b-0 pb-2"
        />
        {views.length > 1 && (
          <PillTabs
            tabs={views.map((v) => ({ key: v.key, label: v.key === 'ICI' ? retailerName : v.label }))}
            value={tab}
            onChange={setTab}
            className="border-b-0 border-t border-gray-100 pt-2"
          />
        )}
      </div>

      <div className="p-4 md:p-6">
        {tab === 'Soil Sampling' ? (
          <SoilSampling
            fieldId={fieldId}
            setFieldId={setFieldId}
            canEdit={hasManagerAccess(profile?.role)}
          />
        ) : tab === 'Sampling Map' ? (
          <SamplingMap
            fieldId={fieldId || null}
            setFieldId={(id) => setFieldId(id ?? '')}
            cropYear={cropYear}
            canEdit={hasManagerAccess(profile?.role)}
          />
        ) : tab === 'Tissue Tests' ? (
          <TissueTests cropYear={cropYear} canEdit={hasManagerAccess(profile?.role)} />
        ) : tab === 'Pricing' ? (
          // What the retailer charges, then the full price book. Its cards lived
          // on Market, which made the farm's own prices a three-tab hunt;
          // Market is the market now and this is what we pay.
          <div className="space-y-4">
            {retailerOn && <IciPrices isManager={hasManagerAccess(profile?.role)} />}
            <ProductPrices category="fertilizer" />
          </div>
        ) : tab === 'Nutrient History' ? (
          <NutrientHistory fieldId={fieldId} setFieldId={setFieldId} />
        ) : tab === 'Market' ? (
          <MarketTab isManager={hasManagerAccess(profile?.role)} />
        ) : tab === 'Requirements' ? (
          <Requirements />
        ) : tab === 'Productivity Zones' ? (
          <YieldZones />
        ) : tab === 'Prescriptions' ? (
          <Prescriptions />
        ) : tab === 'Blends' ? (
          <BlendsTab />
        ) : tab === 'Savings' ? (
          <SavingsTab isManager={hasManagerAccess(profile?.role)} />
        ) : tab === 'ICI' ? (
          <IciTab isManager={hasManagerAccess(profile?.role)} />
        ) : (
          <Manure isManager={hasManagerAccess(profile?.role)} />
        )}
      </div>
    </div>
  )
}

export default FertilizerPage
