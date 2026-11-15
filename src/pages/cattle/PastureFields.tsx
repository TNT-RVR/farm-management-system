import { Link } from 'react-router-dom'
import { InfoPopover } from '@/components/InfoPopover'
import { shortDay, type FieldForage } from '@/lib/field-residue'
import { AU_INTAKE_LB_PER_DAY, audsFromLb, type PastureCalc } from '@/lib/grazing'
import { n0 } from '@/lib/format'
import { cn } from '@/lib/utils'

/** The field's name as people say it: "Field 0", but "9-Maple Flat" as is. */
const fieldLabel = (name: string) => (/^\d+$/.test(name) ? `Field ${name}` : name)

/** What this field is giving, and anything about the dates worth saying. */
function fieldWhat(f: FieldForage) {
  if (f.lb <= 0) return f.note
  const from =
    f.status === 'stubble' && f.availableFrom
      ? ` from ${shortDay(f.availableFrom)}${f.kind === 'potato' && !f.harvestOn ? ', dug date assumed' : ''}`
      : ''
  return `${f.what}${from}`
}

type Line = {
  key: string
  /** The name cell: a link for a field, plain words for the grass. */
  label: React.ReactNode
  what: string | null
  acres: number
  lb: number
  /** Acres that are inside the fence but give nothing, so are not grazeable. */
  uncounted?: boolean
  tdnPct?: number | null
}

/**
 * What a pasture's feed is made of, under the row it belongs to.
 *
 * This replaces a grey sentence that ran the native grass and every field
 * together in one line — "Native 611 ac · 2,314 AUDs · Field 0 corn stubble
 * 74 ac (from 26 Oct) · 318 AUDs" — so the question people actually had,
 * which of this paddock's pounds are grass and which are somebody's stubble,
 * had to be added up by eye off the end of a sentence. One line each, the
 * same two feed columns as the table above, and they total to the pasture's
 * own row.
 */
export function PastureFeedBreakdown({ p }: { p: PastureCalc }) {
  const lines: Line[] = [
    {
      key: 'native',
      label: <span className="font-medium text-gray-700">Native grass</span>,
      what: 'the pasture less its non-grazeable acres and the fields',
      acres: p.nativeGrassAc,
      lb: p.nativeLbs,
    },
  ]
  if (p.fieldsLinked) {
    for (const f of p.fields) {
      lines.push({
        key: f.fieldId + (f.cropName ?? ''),
        label: (
          <Link to={`/fields/${f.fieldId}`} className="font-medium text-gray-700 hover:underline">
            {fieldLabel(f.fieldName)}
          </Link>
        ),
        what: fieldWhat(f),
        acres: f.acres,
        lb: f.lb,
        uncounted: f.lb <= 0,
        tdnPct: f.tdnPct,
      })
    }
  } else if (p.irrigated_ac > 0) {
    lines.push({
      key: 'irrigated',
      label: <span className="font-medium text-gray-700">Irrigated grass</span>,
      what: 'typed by hand — no crop field is mapped inside this fence',
      acres: p.grazeable_irrigated_ac,
      lb: p.fieldLbs,
    })
  }

  return (
    <div className="max-w-3xl">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-gray-400">
            <th className="py-1 pr-2 text-left font-medium">Where the feed comes from</th>
            <th className="px-2 py-1 text-right font-medium">Acres</th>
            <th className="px-2 py-1 text-right font-medium">Feed lb/ac</th>
            <th className="px-2 py-1 text-right font-medium">Total feed lb</th>
            <th className="px-2 py-1 text-right font-medium">AUDs</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className={cn('border-t border-gray-200', l.uncounted && 'text-gray-400')}>
              <td className="py-1 pr-2">
                {l.label}
                {l.what && <span className="text-gray-500"> — {l.what}</span>}
                {l.tdnPct != null && <span className="text-gray-400"> · {l.tdnPct}% energy (TDN)</span>}
              </td>
              {/* Acres inside the fence that grow nothing a cow can eat are
                  shown, but struck through: they are not in the grazeable
                  total, and a bare number here read as though they were. */}
              <td className={cn('px-2 py-1 text-right tabular-nums', l.uncounted && 'line-through')}>{n0(l.acres)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{l.acres > 0 && l.lb > 0 ? n0(l.lb / l.acres) : '—'}</td>
              <td className="px-2 py-1 text-right tabular-nums">{l.lb > 0 ? n0(l.lb) : '—'}</td>
              {/* Intake, not the AUM's waste-inclusive figure: these pounds
                  come out of field-residue.ts already net of trampling, so
                  charging them the waste share again would double it. */}
              <td className="px-2 py-1 text-right tabular-nums">{l.lb > 0 ? n0(audsFromLb(l.lb, AU_INTAKE_LB_PER_DAY)) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 font-semibold text-gray-700">
            <td className="py-1 pr-2">This pasture</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.totalGrazeableAc)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.foragePerAcreUtil)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.totalLbs)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n0(p.auds)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-gray-400">
        <FieldsInfo window={p.window} />
      </p>
    </div>
  )
}

function FieldsInfo({ window }: { window: PastureCalc['window'] }) {
  return (
    <InfoPopover title="Crop fields inside the pasture" label="How these are counted">
      <p>
        Pivots inside a pasture are counted from the farming side, not as grass. A growing crop gives nothing (cattle are
        kept off). After harvest each crop leaves its own stubble: corn about 8 lb a bushel (the Feed tab&apos;s figure,
        falling with weather after a month), beans, canola and cereal a few hundred lb/ac of poor feed, potatoes and silage
        nothing. Disked or cultivated after harvest, or inside a spray&apos;s no-grazing window: nothing.
      </p>
      <p className="mt-2">
        Counted for {window ? `${shortDay(window.from)} – ${shortDay(window.to)}` : 'the season'}. Native grass is the
        pasture less its non-grazeable acres and the fields&apos; acres. A field with stubble grazing set up on the Feed tab
        is counted there instead. A field&apos;s AUDs are its grazeable pounds ÷ 26, the pounds one animal unit eats in a
        day, so the native grass and the fields add up to the pasture&apos;s own figure.
      </p>
    </InfoPopover>
  )
}
