import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { asInches, buildFieldSeason, hasSeasonFacts, type FieldSeasonArea } from '@/lib/field-season'
import { useFieldSeasonWater } from '@/lib/field-season-data'
import { useHarvestEstimates } from '@/lib/harvest-estimate-data'
import { useCropPlans, useCrops, useFieldHistory } from '@/lib/queries'
import { shortDate } from '@/lib/harvest-estimate'
import { fieldSectionPath } from '@/pages/field/FieldTabs'
import { cn } from '@/lib/utils'

const dash = '—'

/** A figure with thousands in it; one decimal for a per-acre yield. */
const num = (v: number | null, digits = 0) =>
  v == null ? dash : v.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })

const day = (iso: string | null) => (iso ? shortDate(iso) : dash)

type Fact = { label: string; value: string; note?: string | null; to?: string }

/**
 * How the field's year went, above everything that explains it.
 *
 * The page is tabbed, so the figures that say whether a season went well were
 * spread over four of them — dates on this tab, water under Irrigation, yield
 * and dockage under History. Each still lives where it lived; this is the one
 * glance, and every line of it links to the tab that owns it.
 */
export function FieldSeasonSummary({
  fieldId,
  cropYear,
  boundaryAcres,
}: {
  fieldId: string
  cropYear: number
  boundaryAcres: number | null
}) {
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: history } = useFieldHistory(fieldId)
  const { data: estimates } = useHarvestEstimates(cropYear)
  const { data: water } = useFieldSeasonWater(fieldId, cropYear)

  const season = buildFieldSeason({
    year: cropYear,
    plans: (plans ?? []).filter((p) => p.field_id === fieldId),
    history: (history ?? []) as Parameters<typeof buildFieldSeason>[0]['history'],
    estimates: (estimates ?? [])
      .filter((e) => e.fieldId === fieldId)
      .map((e) => ({ cropId: e.cropId, seeded: e.seeded, harvestedOn: e.harvestedOn, harvestedFrom: e.harvestedFrom })),
    cropName: (id) => crops?.find((c) => c.id === id)?.name ?? '…',
    water: water ?? { events: [], balance: null },
    boundaryAcres,
  })

  // Nothing was grown and no water went on: an empty card says less than no
  // card, and a field is opened in winter as often as in July.
  if (!hasSeasonFacts(season)) return null

  // Left out entirely on a field with no record of either, rather than shown
  // as two dashes: dryland has no pivot to have run, and "—" beside "Water on"
  // reads as a figure somebody forgot to enter.
  const waterFacts: Fact[] = []
  const toIrrigation = fieldSectionPath(fieldId, 'irrigation')
  if (season.irrigationMm != null) {
    waterFacts.push({
      label: 'Water on',
      value: `${num(season.irrigationMm)} mm`,
      note: `${asInches(season.irrigationMm)}″ over ${season.irrigationDays} day${season.irrigationDays === 1 ? '' : 's'}`,
      to: toIrrigation,
    })
  }
  if (season.rainMm != null) {
    waterFacts.push({
      label: 'Rain',
      value: `${num(season.rainMm)} mm`,
      note: `${asInches(season.rainMm)}″`,
      to: toIrrigation,
    })
  }
  if (season.stressDays != null && season.stressDays > 0) {
    waterFacts.push({
      label: 'Short of water',
      value: `${season.stressDays} day${season.stressDays === 1 ? '' : 's'}`,
      to: toIrrigation,
    })
  }

  const split = season.areas.length > 1

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <ClipboardList className="h-4 w-4 text-brand-700" /> {cropYear} season
        </h3>
        <Link
          to={`/reports?open=season-wrap-up&field=${encodeURIComponent(fieldId)}&year=${cropYear}`}
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          Wrap-up report →
        </Link>
      </div>

      <div className="space-y-3 p-4">
        {season.areas.map((a) => (
          <div key={a.cropId}>
            {split && (
              <p className="mb-1.5 text-xs font-semibold text-gray-700">
                {a.crop}
                {a.variety && <span className="font-normal text-gray-500"> · {a.variety}</span>}
              </p>
            )}
            <Facts facts={cropFacts(a, fieldId, split)} />
          </div>
        ))}
        {waterFacts.length > 0 && <Facts facts={waterFacts} />}
      </div>
    </div>
  )
}

/** The crop's own line of the year. The crop name is the heading on a split field. */
function cropFacts(a: FieldSeasonArea, fieldId: string, split: boolean): Fact[] {
  const unit = a.unit ?? ''
  const facts: Fact[] = []
  if (!split) {
    // No link: the crop's own card is a few inches further down this page.
    facts.push({ label: 'Crop', value: a.crop, note: a.variety })
  }
  facts.push({ label: 'Acres', value: num(a.acres, 1) })
  facts.push({ label: 'Seeded', value: day(a.seeded), to: fieldSectionPath(fieldId, 'irrigation') })
  facts.push({
    label: 'Harvested',
    value: day(a.harvested),
    note: a.harvested ? a.harvestedFrom : 'not off yet',
    to: fieldSectionPath(fieldId, 'work'),
  })
  facts.push({
    label: 'Yield',
    value: a.yieldPerAcre == null ? dash : `${num(a.yieldPerAcre, 1)} ${unit}/ac`.trim(),
    note: a.yieldTotal == null ? null : `${num(a.yieldTotal)} ${unit}`.trim(),
    to: fieldSectionPath(fieldId, 'history'),
  })
  // Only where the plant actually took something out. A dash under "Dockage"
  // reads as none, and none is a claim this field has not made.
  if (a.dockage != null) {
    facts.push({
      label: 'Dockage',
      value: `${a.dockage}%`,
      note: a.cleanPerAcre == null ? null : `${num(a.cleanPerAcre, 1)} ${unit}/ac clean`.trim(),
      to: fieldSectionPath(fieldId, 'history'),
    })
  }
  return facts
}

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label}>
          <dt className="text-xs text-gray-500">{f.label}</dt>
          <dd className={cn('font-medium', f.value === dash ? 'text-gray-400' : 'text-gray-900')}>
            {f.to && f.value !== dash ? (
              <Link to={f.to} className="hover:underline">
                {f.value}
              </Link>
            ) : (
              f.value
            )}
          </dd>
          {f.note && <dd className="text-xs text-gray-500">{f.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
