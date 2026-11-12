import { Link } from 'react-router-dom'
import { InfoPopover } from '@/components/InfoPopover'
import { guideRate, guideTablesFor, isGuideAnswer, type GuideCrop, type GuideSoil } from '@/lib/nutrient-guide'
import { n0 } from '@/lib/format'

/**
 * What the province's own rate table says, beside what the lab recommended.
 *
 * The lab's programme is a number with nothing behind it on screen. This is the
 * published Alberta rate for the same crop at the same soil test, so the two
 * can disagree in public. Where there is no answer it says which answer is
 * missing — an empty cell would read as agreement.
 */

/** Where the library opens on the sheet a rate came from. */
const sheetLink = (paper: string) =>
  `/research?tab=search&q=${encodeURIComponent(paper)}`

const BASIS_LABEL: Record<string, string> = {
  'n-lb-0-12': 'soil nitrate, 0 to 12 inches',
  'n-lb-0-24': 'soil nitrate, 0 to 24 inches',
  'p-lb-0-6': 'soil P, 0 to 6 inches',
  'k-lb-0-6': 'soil K, 0 to 6 inches',
  's-lb-0-12': 'sulphate-S, 0 to 12 inches',
  'zn-ppm-0-6': 'DTPA zinc, 0 to 6 inches',
}

export function GuideRate({
  crop,
  nutrient,
  soil,
}: {
  crop: GuideCrop | null
  nutrient: string
  soil: GuideSoil
}) {
  const got = guideRate(crop, nutrient, soil)

  if (!isGuideAnswer(got)) {
    const text =
      got.why === 'no table' ? '—'
      : got.why === 'no sample' ? 'no sample'
      : 'off the table'
    const title =
      got.why === 'no table' ? 'No Alberta sheet for this crop and nutrient'
      : got.why === 'no sample' ? `Needs ${BASIS_LABEL[got.basis] ?? got.basis}`
      : `${n0(got.soil)} lb/ac is past the end of ${got.table.table} in ${got.table.paper}`
    return (
      <span className="text-gray-400" title={title}>
        {text}
      </span>
    )
  }

  const tables = crop ? guideTablesFor(crop, nutrient) : []
  return (
    <span className="inline-flex items-center gap-1">
      <b className="tabular-nums text-gray-900">
        {got.rate}
        {got.rateTo != null ? `–${got.rateTo}` : ''}
      </b>
      <InfoPopover title={`${got.table.paper} · ${got.table.table}`} width={420}>
        <p>
          At {n0(got.soil)} lb/ac of {BASIS_LABEL[got.table.basis] ?? got.table.basis}, Agdex{' '}
          {got.table.agdex} recommends{' '}
          <b>
            {got.rate}
            {got.rateTo != null ? ` to ${got.rateTo}` : ''} lb/ac
          </b>{' '}
          of {got.table.nutrient} ({got.table.variant.toLowerCase()}).
        </p>
        {got.table.note && <p className="mt-1.5">{got.table.note}</p>}
        <p className="mt-1.5 text-gray-500">
          The table is read against {got.table.method}.
          {got.table.nutrient === 'P2O5' &&
            ' Our lab reports sodium-bicarbonate P, which is a different extractant, so treat this rate as indicative rather than the same measurement.'}
        </p>
        {tables.length > 1 && (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-0.5 pr-2 font-medium">Soil test</th>
                {tables.map((t) => (
                  <th key={t.variant} className="py-0.5 pr-2 font-medium">
                    {t.variant}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tables[0].bands.map((b, i) => (
                // Highlighted by edge rather than by identity: the row comes
                // from the first variant's bands and the answer from the main
                // one, which are different objects with the same edges.
                <tr key={b.from} className={b.from === got.band.from ? 'bg-emerald-50 font-medium' : ''}>
                  <td className="py-0.5 pr-2 tabular-nums">
                    {b.to == null ? `over ${b.from}` : `${b.from}–${b.to}`}
                  </td>
                  {tables.map((t) => (
                    <td key={t.variant} className="py-0.5 pr-2 tabular-nums">
                      {t.bands[i]?.rate ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2">
          <Link to={sheetLink(got.table.paper)} className="font-medium underline">
            Open the sheet in the research library
          </Link>
        </p>
      </InfoPopover>
    </span>
  )
}
