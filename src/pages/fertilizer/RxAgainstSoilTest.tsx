import { useMemo } from 'react'
import { Scale } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HelpNote } from '@/components/HelpNote'
import type { FieldRequirement } from '@/lib/fertilizer-plan'
import { usePrescriptions } from '@/lib/fertility-rx'
import { n0, n1Fixed as n1 } from '@/lib/format'
import type { useGuideSoil } from '@/lib/nutrient-guide-query'
import { rxAgainstSoilTest } from '@/lib/rx-check'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import { CardList, RowCard, type Fact } from '@/components/RowCards'
import { GuideRate } from './GuideRate'

const LB_PER_TONNE = 2204.62
/** A gap under this many lb an acre is rounding between two sheets, not a disagreement. */
const MATERIAL = 10

/**
 * The agronomist's prescription beside the farm's own soil test and Alberta's
 * published rate, so an Rx asking for more than the soil supports is something
 * to question before it is ordered. The soil test stays the need.
 */
export function RxAgainstSoilTest({
  cropYear,
  requirements,
  planCrops,
  guideSoils,
}: {
  cropYear: number
  requirements: FieldRequirement[]
  planCrops: Map<string, string[]>
  guideSoils: ReturnType<typeof useGuideSoil>['data']
}) {
  const { data: rx } = usePrescriptions(cropYear)
  const rows = useMemo(() => rxAgainstSoilTest(rx ?? [], requirements, planCrops), [rx, requirements, planCrops])
  if (!rows.length) return null

  const compared = rows.filter((r) => r.nGap != null)
  const higher = compared.filter((r) => r.nGap! >= MATERIAL)
  // Extra N over the farm, as urea, where the Rx runs past the soil test.
  const extraLbN = higher.reduce((s, r) => s + r.nGap! * (r.acres ?? 0), 0)
  const extraUrea = extraLbN / 0.46 / LB_PER_TONNE

  // Each row's figures once, for the phone card and the table cell alike.
  const shaped = rows.map((r) => {
    const g = guideSoils?.get(r.fieldId)
    const crops = r.rxCrop && r.testCrop && r.rxCrop !== r.testCrop ? `${r.rxCrop} (test: ${r.testCrop})` : (r.rxCrop ?? r.testCrop ?? '—')
    const testN = r.test ? n0(r.test.n) : <span className="text-xs text-amber-700">no soil test</span>
    const guide = g ? <GuideRate crop={g.crop} nutrient="N" soil={g.soil} /> : <span className="text-gray-300">—</span>
    const gap = r.nGap == null ? '—' : `${r.nGap > 0 ? '+' : ''}${n0(r.nGap)}`
    const gapClass = r.nGap != null && r.nGap >= MATERIAL ? 'text-amber-800' : 'text-gray-500'
    const p = `${n0(r.rx.p2o5)} / ${r.test ? n0(r.test.p2o5) : '—'}`
    const k = `${n0(r.rx.k2o)} / ${r.test ? n0(r.test.k2o) : '—'}`
    const facts: Fact[] = [
      { label: 'Rx N', node: <span className="tabular-nums">{n0(r.rx.n)}</span> },
      { label: 'Soil test N', node: <span className="tabular-nums">{testN}</span> },
      { label: 'Alberta guide', node: g ? guide : null },
      { label: 'Rx over test', node: r.nGap == null ? null : <span className={cn('font-semibold tabular-nums', gapClass)}>{gap}</span> },
      { label: 'P₂O₅ Rx / test', node: <span className="tabular-nums">{p}</span> },
      { label: 'K₂O Rx / test', node: <span className="tabular-nums">{k}</span> },
    ]
    return { r, crops, testN, guide, gap, gapClass, p, k, facts }
  })

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex items-center gap-1.5', CARD_HEAD)}>
        <Scale className="h-4 w-4 text-white" />
        <h3 className="font-medium">Agronomist&rsquo;s prescription against the soil test · {cropYear}</h3>
      </div>
      {compared.length > 0 && (
        <p className={cn('px-3 py-2 text-sm', higher.length ? 'bg-amber-50 text-amber-900' : 'text-gray-700')}>
          {higher.length ? (
            <>
              The prescription asks for more N than the soil test on <b>{higher.length}</b> of {compared.length} fields:
              about <b>{n0(extraLbN)} lb N</b>, or <b>{n1(extraUrea)} t of urea</b>, more than the soil supports.
            </>
          ) : (
            <>The prescriptions are within {MATERIAL} lb N an acre of the soil test on every field that has both.</>
          )}
        </p>
      )}
      {/* One field a card on a phone (design review, Nov 2026). */}
      <CardList>
        {shaped.map(({ r, crops, facts }) => (
          <RowCard
            key={r.fieldId}
            heading={
              <span className="flex flex-wrap items-baseline gap-x-2">
                {r.fieldName}
                <span className="text-xs font-normal text-gray-500">{crops}</span>
              </span>
            }
            facts={facts}
          />
        ))}
      </CardList>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TABLE_TH}>Field</th>
              <th className={TABLE_TH} style={{ width: '16%' }}>Crop</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '10%' }}>Rx N</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '11%' }}>Soil test N</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '12%' }}>Alberta guide</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '11%' }}>Rx over test</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '14%' }}>P₂O₅ Rx / test</th>
              <th className={cn(TABLE_TH, 'text-right')} style={{ width: '14%' }}>K₂O Rx / test</th>
            </tr>
          </thead>
          <tbody>
            {shaped.map(({ r, crops, testN, guide, gap, gapClass, p, k }) => (
              <tr key={r.fieldId} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-1.5 font-medium text-gray-900">{r.fieldName}</td>
                <td className="px-3 py-1.5 text-xs text-gray-600">{crops}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.rx.n)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{testN}</td>
                <td className="px-3 py-1.5 text-right">{guide}</td>
                <td className={cn('px-3 py-1.5 text-right font-semibold tabular-nums', gapClass)}>{gap}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{p}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{k}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HelpNote className="px-3 py-2" summary="lb of actual nutrient an acre. The soil test is the need; the Rx is shown to question." title="How this is compared">
        Rx figures are the prescription&rsquo;s zones averaged by their acres. Soil test figures are the
        programme written from this field&rsquo;s own soil test, the one the totals below are built from.
        Alberta guide is the province&rsquo;s published rate for the same soil test, where a sheet exists for
        the crop. The totals and the booking advice use the soil test, never the prescription, so a field
        the Rx covers with no soil test is left out of them rather than taken on the Rx&rsquo;s word. Each
        prescription is on <Link to="/fertilizer/plan?tab=rx" className="underline">Prescriptions</Link>.
      </HelpNote>
    </div>
  )
}
