import { useQuery } from '@tanstack/react-query'
import { InfoPopover } from '@/components/InfoPopover'
import { cleanBreakout, cropFallbackDockage, type BreakoutSide } from '@/lib/clean-breakout'
import { scaleTicketsQuery } from '@/lib/scale-tickets'
import { useCrops } from '@/lib/queries'
import type { BinLoad } from '@/lib/bin-loads'
import { cn } from '@/lib/utils'

const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: digits })

/**
 * What a field's season looks like split into grain that has been through the
 * plant and grain still in a bin (Sam, 16 Nov 2026).
 *
 * It appears only where the field's single dockage figure cannot be right:
 * part of the field delivered and part still stored, or a load whose only
 * weight is the clean one. Everywhere else the pair on the yield row below
 * already says it, and a second table would just be in the way.
 */
export function CleanSplit({
  loads,
  cropId,
  cropYear,
  tone,
}: {
  /** This field's finished loads for the season. */
  loads: BinLoad[]
  cropId: string | null
  cropYear: number
  tone: 'green' | 'amber'
}) {
  const { data: crops } = useCrops()
  const { data: tickets } = useQuery(scaleTicketsQuery(cropYear))
  const estimate = (crops ?? []).find((c) => c.id === cropId)?.est_cleanout_pct ?? null

  const dockageOf = new Map<string, number | null>()
  for (const t of tickets ?? []) if (t.bin_load_id) dockageOf.set(t.bin_load_id, t.dockage_pct ?? null)

  const fallback = cropFallbackDockage(
    (tickets ?? []).map((t) => ({ crop_id: t.crop_id, crop_year: t.crop_year, dockage_pct: t.dockage_pct })),
    cropId,
    cropYear,
    estimate,
  )
  const b = cleanBreakout(
    loads.map((l) => ({
      net_kg: l.net_kg,
      bushels: l.bushels,
      weight_cleaned: l.weight_cleaned,
      delivery_site_id: l.delivery_site_id,
      dockage_pct: dockageOf.get(l.id) ?? null,
    })),
    fallback,
  )

  const anyCleanedWeight = loads.some((l) => l.weight_cleaned)
  if (!b.mixed && !anyCleanedWeight) return null

  const text = tone === 'green' ? 'text-green-900' : 'text-amber-900'
  const row = (label: string, s: BreakoutSide, strong = false) => (
    <tr className={cn(strong && 'border-t border-gray-200 font-semibold')}>
      <td className="px-2 py-1 text-gray-700">{label}</td>
      <td className="px-2 py-1 text-right tabular-nums text-gray-500">{s.loads || '—'}</td>
      <td className="px-2 py-1 text-right tabular-nums text-gray-900">
        {num(s.fieldRunKg)} kg
        {!s.fieldRunMeasured && <span className="ml-1 font-normal text-amber-700">est</span>}
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-gray-900">
        {num(s.cleanKg)}
        {s.cleanKg == null ? '' : ' kg'}
        {s.cleanKg != null && !s.measured && <span className="ml-1 font-normal text-amber-700">est</span>}
      </td>
    </tr>
  )

  return (
    <div className="mt-2 rounded-md bg-white p-1">
      {/* A div, not a p: the popover's panel is a sibling of its button and
      holds paragraphs of its own, which a p may not contain. */}
      <div className={cn('flex items-center gap-1 px-1 text-xs font-semibold', text)}>
        Cleaned and not
        <InfoPopover title="Cleaned and not">
          <p>
            Grain comes off the field with its dockage still in it. The plant takes that out, so the two kinds of weight
            do not add up and this field has both.
          </p>
          <p className="mt-2">
            A load that went to the plant counts at the dockage on its own receipt. One still in a bin counts at{' '}
            {b.fallbackPct == null ? "no figure at all, because none is known for this crop yet" : `${b.fallbackPct}%, this crop's average`}
            , which is why it is marked <strong>est</strong> — a guess with history behind it, not a measurement.
          </p>
          <p className="mt-2">
            Where the only weight for a load is the clean one, the field-run figure beside it is worked back from the
            dockage. That is the figure the yield below is built from.
          </p>
        </InfoPopover>
      </div>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-400">
            <th className="px-2 py-0.5 text-left font-medium">Where</th>
            <th className="px-2 py-0.5 text-right font-medium">Loads</th>
            <th className="px-2 py-0.5 text-right font-medium">Field-run</th>
            <th className="px-2 py-0.5 text-right font-medium">Clean</th>
          </tr>
        </thead>
        <tbody>
          {row('Through the plant', b.plant)}
          {row('Still in the bin', b.stored)}
          {row('Off the field', b.total, true)}
        </tbody>
      </table>
    </div>
  )
}
