import { lazy, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Calculator, Percent, Scale, Settings2 } from 'lucide-react'
import { useTab } from '@/lib/useTab'
import { GrainBin } from '@/components/icons/GrainBin'
import { PillTabs } from '@/components/PillTabs'
import { Fold } from '@/components/Fold'
import { InfoPopover } from '@/components/InfoPopover'
import { BinAirAlerts } from '@/components/BinAirAlerts'
import { PhiPanel } from '@/components/PhiPanel'
import { MoistureGuide } from '@/pages/harvest/MoistureGuide'
import { MoistureRanges } from '@/pages/harvest/MoistureRanges'
import { MoistureTester } from '@/pages/harvest/MoistureTester'
import { moistureFormWasOpen } from '@/pages/harvest/useMoistureEntry'
import { BinSettingsDialog } from '@/pages/bins/BinSettings'
import { WeighInDialog } from '@/pages/bins/WeighIn'
import { useCropYear } from '@/lib/crop-year'
import { TabSuspense } from '@/components/TabSuspense'

// Each tab is its own chunk: the bin map and the charts load when their tab opens.
const HarvestReadiness = lazy(() => import('@/pages/harvest/HarvestReadiness').then((m) => ({ default: m.HarvestReadiness })))
const BinsPage = lazy(() => import('@/pages/BinsPage').then((m) => ({ default: m.BinsPage })))
const WeighScaleTab = lazy(() => import('@/pages/harvest/WeighScaleTab').then((m) => ({ default: m.WeighScaleTab })))
const ScaleStatsTab = lazy(() => import('@/pages/harvest/ScaleStatsTab').then((m) => ({ default: m.ScaleStatsTab })))
const HarvestReportsTab = lazy(() => import('@/pages/harvest/HarvestReportsTab').then((m) => ({ default: m.HarvestReportsTab })))
const SeedReportTab = lazy(() => import('@/pages/canola/SeedFormsTab').then((m) => ({ default: m.SeedReportTab })))
const BinTempsTab = lazy(() => import('@/pages/canola/SeedFormsTab').then((m) => ({ default: m.BinTempsTab })))

/*
 * Harvest is four views since 24 Oct 2026 (Sam, season menu step 3), each
 * with one tab bar:
 *   /harvest          Bins: Bins | Bin estimator | Moisture
 *   /weigh-scale      Weigh scale: Weigh in & tickets | Trucks & drivers
 *   /pre-harvest      Pre-harvest intervals, no tabs
 *   /harvest-reports  Harvest reports: All reports | the seed company forms
 * It was one page of seven tabs, too many for one row. The old tab names in
 * saved links (/harvest?tab=scale, stats, phi, reports) move to their view.
 */

/** Old /harvest tabs that are views of their own now. The tab name rides along; each view maps it. */
const MOVED: Record<string, string> = {
  scale: '/weigh-scale',
  stats: '/weigh-scale',
  phi: '/pre-harvest',
  reports: '/harvest-reports',
}

const BINS_TABS = [
  { key: 'bins', label: 'Bins' },
  { key: 'estimator', label: 'Bin estimator' },
  { key: 'moisture', label: 'Moisture' },
] as const
type BinsTab = (typeof BINS_TABS)[number]['key']

/**
 * The header every Harvest view shares: the bin-needs-air alerts, then the
 * view's tabs beside the big buttons.
 *
 * The alerts sit above every view rather than inside one, because they are
 * the thing that must not be missed and the view somebody is on is not up to
 * them. The weigh-in and the moisture reading are on every view too (Sam,
 * 23 Oct 2026), so the scale is one tap away wherever Harvest was left open.
 * The bushel calculator and the bins' settings belong to the bins, and stay
 * on that view.
 */
function HarvestShell({
  title,
  tabs,
  flush,
  onReading,
  binTools,
  children,
}: {
  title: string
  tabs?: ReactNode
  /** The content keeps its own page padding (the bins), so the header pads itself. */
  flush?: boolean
  /** The % button: a reading on the Moisture tab. Elsewhere it goes there. */
  onReading?: () => void
  binTools?: boolean
  children: ReactNode
}) {
  const { cropYear } = useCropYear()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(false)
  const [weighing, setWeighing] = useState(false)
  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-brand-700'

  return (
    <div className={flush ? 'pt-4 md:pt-6' : 'p-4 md:p-6'}>
      <div className={flush ? 'px-4 md:px-6' : ''}>
        <h1 className="mb-3 flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <GrainBin className="h-5 w-5 text-brand-700" /> {title} {cropYear}
        </h1>

        <div>
          <BinAirAlerts />
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-3">
          {tabs}
          {/* Big icons for a finger (Sam, 22 Oct 2026). */}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setWeighing(true)} aria-label="Weigh in a load" title="Weigh in a load" className={iconBtn}>
              <Scale className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={onReading ?? (() => navigate('/harvest?tab=moisture&reading=1'))}
              aria-label="Take a moisture reading"
              title="Take a moisture reading"
              className={iconBtn}
            >
              <Percent className="h-6 w-6" />
            </button>
            {binTools && (
              <>
                <Link to="/calculator?tab=bushels" aria-label="Bushel calculator" title="Bushel calculator" className={iconBtn}>
                  <Calculator className="h-6 w-6" />
                </Link>
                <button type="button" onClick={() => setSettings(true)} aria-label="Bin settings" title="Bin settings" className={iconBtn}>
                  <Settings2 className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {settings && <BinSettingsDialog onClose={() => setSettings(false)} />}
      {weighing && <WeighInDialog cropYear={cropYear} onClose={() => setWeighing(false)} />}
      <TabSuspense>{children}</TabSuspense>
    </div>
  )
}

/**
 * Bins (/harvest): what is in each bin, the estimator, and how wet it went in.
 *
 * Storage (the bins, the estimator and the bin map) was its own section until
 * 25 Sep 2026, and at harvest it is the same job as the moisture: a load goes
 * into a bin, and its moisture says whether that bin needs air.
 *
 * Moisture was three tabs — the tester, the safe ranges and how to test —
 * and is one now: the tester, the procedure behind ⓘ, the ranges folded
 * underneath. The Calculator tab was the bushel converter, which lives on the
 * Calculator view; an old ?tab=calculator link goes there.
 */
export function HarvestPage() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  const asked = params.get('tab') ?? ''
  if (asked === 'calculator') return <Navigate to="/calculator?tab=bushels" replace />
  const to = MOVED[asked]
  if (to) {
    // Pre-harvest has no tabs to name.
    if (to === '/pre-harvest') params.delete('tab')
    const rest = params.toString()
    return <Navigate to={rest ? `${to}?${rest}` : to} replace />
  }
  return <BinsView />
}

function BinsView() {
  const { cropYear } = useCropYear()
  // What the address asked for on arrival, before the tab hook rewrites it:
  // an old "Safe ranges" or "How to test" link opens that part of Moisture.
  const [params, setParams] = useSearchParams()
  const [arrivedFor] = useState(() => params.get('tab'))
  // 'movements' was a Storage tab once; saved links to it land on the bins.
  // 'map' was the Bin map tab, now part of Bins (23 Oct 2026). 'crops' and
  // 'guide' were Moisture's ranges and procedure.
  const [tab, choose] = useTab<BinsTab>('harvest', BINS_TABS.map((t) => t.key), (a) =>
    a === 'movements' || a === 'map' ? 'bins' : a === 'crops' || a === 'guide' ? 'moisture' : undefined,
  )
  // The reading form is a pop-up on the Moisture tab, open again after a
  // reload if it was open when the phone was put down (9 Oct), or asked for
  // by the % button on another Harvest view (?reading=1).
  const [reading, setReading] = useState(() => moistureFormWasOpen() || params.get('reading') === '1')
  useEffect(() => {
    if (params.get('reading') !== '1') return
    const next = new URLSearchParams(params)
    next.delete('reading')
    setParams(next, { replace: true })
  }, [params, setParams])
  const flush = tab === 'bins' || tab === 'estimator'

  return (
    <HarvestShell
      title="Bins"
      flush={flush}
      binTools
      tabs={<PillTabs tabs={BINS_TABS} value={tab} onChange={choose} />}
      onReading={() => {
        choose('moisture')
        setReading(true)
      }}
    >
      {/* The bins keep their own page padding, so they sit where they always did. */}
      {tab === 'bins' && <BinsPage tab="bins" />}
      {tab === 'estimator' && <BinsPage tab="estimator" />}
      {tab === 'moisture' && <MoistureView arrivedFor={arrivedFor} cropYear={cropYear} reading={reading} onCloseReading={() => setReading(false)} />}
    </HarvestShell>
  )
}

const SCALE_TABS = [
  // Weigh a load in, each truck's figures, every ticket (Sam, 23 Oct 2026).
  { key: 'weigh', label: 'Weigh in & tickets' },
  // The truck forecast, and loads and kilograms by truck, trailer or driver (Sam, 23 Oct 2026).
  { key: 'trucks', label: 'Trucks & drivers' },
] as const
type ScaleTab = (typeof SCALE_TABS)[number]['key']

/** Weigh scale (/weigh-scale). 'scale' and 'stats' were these as Harvest tabs. */
export function WeighScalePage() {
  const { cropYear } = useCropYear()
  const [tab, choose] = useTab<ScaleTab>('weigh-scale', SCALE_TABS.map((t) => t.key), (a) =>
    a === 'scale' ? 'weigh' : a === 'stats' ? 'trucks' : undefined,
  )
  return (
    <HarvestShell title="Weigh scale" tabs={<PillTabs tabs={SCALE_TABS} value={tab} onChange={choose} />}>
      {tab === 'weigh' ? <WeighScaleTab cropYear={cropYear} /> : <ScaleStatsTab cropYear={cropYear} />}
    </HarvestShell>
  )
}

/** Pre-harvest intervals (/pre-harvest): its own view, not a panel over every tab (Sam, 23 Oct 2026). */
export function PreHarvestPage() {
  const { cropYear } = useCropYear()
  return (
    <HarvestShell title="Pre-harvest intervals">
      <PhiPanel cropYear={cropYear} flat emptyText={`No spray in ${cropYear} has a pre-harvest interval still to run.`} />
    </HarvestShell>
  )
}

const REPORT_TABS = [
  { key: 'all', label: 'All reports' },
  { key: 'seed-report', label: 'Seed report' },
  { key: 'bin-temps', label: 'Seed bin temperatures' },
] as const
type ReportTab = (typeof REPORT_TABS)[number]['key']

/**
 * Harvest reports (/harvest-reports): every harvest download, then the seed
 * company's two forms (Sam, 24 Oct 2026). The forms were tabs of Canola
 * reports; they are filled in at and after harvest, from the bins and the
 * scale, so they sit with the harvest. Which company's pages they print on
 * is the forms' own business (seed-forms/styles.ts): the farm's own copy has
 * its seed company's scanned pages, any other farm the generic form.
 *
 * Old links: /harvest?tab=reports arrives here as ?tab=reports, and
 * /canola-reports?tab=seed-report|bin-temps|seed-forms with their field and
 * year.
 */
export function HarvestReportsPage() {
  const { cropYear } = useCropYear()
  const [tab, choose] = useTab<ReportTab>('harvest-reports', REPORT_TABS.map((t) => t.key), (a) =>
    a === 'reports' ? 'all' : a === 'seed-forms' ? 'seed-report' : undefined,
  )
  return (
    <HarvestShell title="Harvest reports" tabs={<PillTabs tabs={REPORT_TABS} value={tab} onChange={choose} />}>
      <div className="mt-3">{tab === 'all' ? <HarvestReportsTab cropYear={cropYear} /> : tab === 'seed-report' ? <SeedReportTab /> : <BinTempsTab />}</div>
    </HarvestShell>
  )
}

/**
 * The tester, how to use it, and what is safe to bin.
 *
 * The procedure is behind ⓘ because whoever is at the meter has usually done
 * it before; an old "How to test" link opens it full width above the tester
 * instead, since that is what the link was for.
 */
function MoistureView({
  arrivedFor,
  cropYear,
  reading,
  onCloseReading,
}: {
  arrivedFor: string | null
  cropYear: number
  /** The reading form, opened by the % button in the header. */
  reading: boolean
  onCloseReading: () => void
}) {
  const guideFirst = arrivedFor === 'guide'
  const rangesOpen = arrivedFor === 'crops'
  return (
    <div className="space-y-4">
      {guideFirst && (
        <Fold title="How to test — Dimo’s Model 919" defaultOpen>
          <MoistureGuide />
        </Fold>
      )}
      {/* When each field will be dry: first on the tab, so it is found without looking. */}
      <HarvestReadiness cropYear={cropYear} />
      <MoistureTester
        formOpen={reading}
        onCloseForm={onCloseReading}
        aside={
          !guideFirst && (
            <InfoPopover title="Taking a moisture reading — Dimo’s Model 919" label="How to test" width={480}>
              <MoistureGuide compact />
            </InfoPopover>
          )
        }
      />
      {/* Opened by an old "Safe ranges" link; otherwise remembered per device. */}
      <Fold
        key={rangesOpen ? 'asked' : 'kept'}
        title="Safe moisture to harvest at"
        summary="by crop"
        defaultOpen={rangesOpen}
        storageKey={rangesOpen ? undefined : 'harvest-moisture-ranges'}
      >
        <MoistureRanges />
      </Fold>
    </div>
  )
}

/**
 * /bins was Storage. Its tabs went to Harvest under the same names, so the
 * address keeps everything it asked for (?tab=, and ?weigh=1 from the
 * home-screen tile) and only the path changes; /harvest sends on any tab that
 * is a view of its own now.
 */
export function BinsRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (!params.get('tab') || params.get('tab') === 'movements') params.set('tab', 'bins')
  return <Navigate to={`/harvest?${params.toString()}`} replace />
}
