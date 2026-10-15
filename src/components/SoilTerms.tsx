import { InfoPopover } from '@/components/InfoPopover'
import { TEXTURE, type SoilHorizon } from '@/lib/soil-landscape'
import { SOIL_COLUMN_HELP, parseHorizon } from '@/lib/soil-glossary'

const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/** The info button beside a column heading. */
export function SoilTermInfo({ term }: { term: keyof typeof SOIL_COLUMN_HELP | string }) {
  const help = SOIL_COLUMN_HELP[term]
  if (!help) return null
  return (
    <InfoPopover title={help.title} width={380} className="ml-0.5">
      <p>{help.text}</p>
    </InfoPopover>
  )
}

/**
 * A horizon code, with what it means behind the button.
 *
 * Composed from the code rather than looked up, so a horizon nobody has seen on
 * this farm yet still explains itself. "Bnt" is not in any list here; it comes
 * out as subsoil, sodic, with clay moved into it.
 */
export function HorizonInfo({ code }: { code: string | null }) {
  const parts = parseHorizon(code)
  if (!code) return <span className="text-gray-400">—</span>
  if (!parts?.master) return <span className="font-medium text-gray-900">{code}</span>
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-gray-900">{code}</span>
      <InfoPopover title={`${code} — what it means`} width={380} className="ml-0.5">
        <p>
          <b>{parts.master.letter}</b> — {parts.master.name.toLowerCase()}. {parts.master.text}
        </p>
        {parts.transitionTo && (
          <p>
            <b>{parts.transitionTo.letter}</b> — a layer grading into{' '}
            {parts.transitionTo.name.toLowerCase()}, with something of both above and below it.
          </p>
        )}
        {parts.suffixes.map((s) => (
          <p key={s.letter}>
            <b>{s.letter}</b> — {s.name}. {s.text}
          </p>
        ))}
      </InfoPopover>
    </span>
  )
}

/**
 * The profile table, with every heading and every code explained.
 *
 * One table rather than two, because it appears on the field page, in the map
 * popup and on the sampling tab, and three copies would answer the same
 * question three slightly different ways.
 */
export function HorizonTable({
  horizons,
  compact = false,
}: {
  horizons: SoilHorizon[]
  compact?: boolean
}) {
  if (horizons.length === 0) {
    return <p className="text-xs text-gray-500">No horizon data for this soil.</p>
  }
  const columns: { key: string; label: string; right?: boolean; hideCompact?: boolean }[] = [
    { key: 'horizon', label: 'Horizon' },
    { key: 'depth', label: 'Depth' },
    { key: 'texture', label: 'Texture' },
    { key: 'clay', label: 'Clay %', right: true },
    { key: 'organicCarbon', label: 'OC %', right: true, hideCompact: true },
    { key: 'ph', label: 'pH', right: true },
    { key: 'ec', label: 'EC', right: true },
    { key: 'cec', label: 'CEC', right: true, hideCompact: true },
    { key: 'caco3', label: 'CaCO₃', right: true, hideCompact: true },
  ]
  const shown = columns.filter((c) => !(compact && c.hideCompact))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            {shown.map((c) => (
              <th
                key={c.key}
                className={`py-1 pr-2 font-medium ${c.right ? 'text-right' : ''}`}
              >
                <span className="inline-flex items-center">
                  {c.label}
                  <SoilTermInfo term={c.key} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {horizons.map((h, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              <td className="py-1 pr-2">
                <HorizonInfo code={h.horizon} />
              </td>
              <td className="py-1 pr-2 text-gray-600">
                {h.top != null && h.bottom != null ? `${h.top}–${h.bottom} cm` : '—'}
              </td>
              <td className="py-1 pr-2 text-gray-600">
                {h.texture ? (TEXTURE[h.texture] ?? h.texture) : '—'}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{n1(h.clay)}</td>
              {!compact && <td className="py-1 pr-2 text-right tabular-nums">{n1(h.organicCarbon)}</td>}
              <td className="py-1 pr-2 text-right tabular-nums">{n1(h.ph)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{n1(h.ec)}</td>
              {!compact && <td className="py-1 pr-2 text-right tabular-nums">{n1(h.cec)}</td>}
              {!compact && <td className="py-1 pr-2 text-right tabular-nums">{n1(h.caco3)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
