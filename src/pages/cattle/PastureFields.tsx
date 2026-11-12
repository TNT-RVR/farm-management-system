import { Link } from 'react-router-dom'
import { InfoPopover } from '@/components/InfoPopover'
import { shortDay, type FieldForage } from '@/lib/field-residue'
import { audsFromLb, type PastureCalc } from '@/lib/grazing'
import { n0 } from '@/lib/format'
import { cn } from '@/lib/utils'

/** The field's name as people say it: "Field 0", but "9-Maple Flat" as is. */
const fieldLabel = (name: string) => (/^\d+$/.test(name) ? `Field ${name}` : name)

function FieldChip({ f }: { f: FieldForage }) {
  const counted = f.lb > 0
  const title = [
    `${n0(f.acres)} ac inside the fence`,
    f.cropName ? `crop: ${f.cropName}` : null,
    f.harvestOn ? `harvest ${shortDay(f.harvestOn)}${f.harvestSource === 'deere' ? ' (Deere — not marked finished)' : ''}` : null,
    f.kind === 'potato' && !f.harvestOn ? 'dug date not recorded — taken as 15 Oct' : null,
    f.tilledOn ? `tilled ${shortDay(f.tilledOn)}` : null,
    counted ? `${n0(f.lbPerAc)} lb/ac grazeable · ${n0(audsFromLb(f.lb))} AUDs` : null,
    f.tdnPct != null ? `feed value ${f.tdnPct}% energy (TDN), ${f.cpPct}% protein` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span title={title} className={cn(counted ? 'text-gray-700' : 'text-gray-400')}>
      <Link to={`/fields/${f.fieldId}`} className="font-medium hover:underline">
        {fieldLabel(f.fieldName)}
      </Link>{' '}
      {counted ? (
        <>
          {f.what} {n0(f.acres)} ac
          {f.status === 'stubble' && f.availableFrom && ` (from ${shortDay(f.availableFrom)}${f.kind === 'potato' && !f.harvestOn ? ', dug date assumed' : ''})`}
          <span className="font-medium tabular-nums"> · {n0(audsFromLb(f.lb))} AUDs</span>
          {f.tdnPct != null && <span className="text-gray-400"> · {f.tdnPct}% energy (TDN)</span>}
        </>
      ) : (
        f.note
      )}
    </span>
  )
}

/**
 * One line under a pasture: native grass, then each crop field inside the
 * fence and what it gives for the dates counted ("Field 0 corn stubble 74 ac
 * (from 26 Oct) · Field 2 potatoes — no grazing").
 */
export function PastureFieldsLine({ p, className }: { p: PastureCalc; className?: string }) {
  if (!p.fieldsLinked) {
    if (!(p.irrigated_ac > 0)) return null
    return (
      <p className={cn('text-[11px] text-amber-700', className)}>
        Native {n0(p.nativeGrassAc)} ac · {n0(p.nativeAuds)} AUDs · irrigated {n0(p.grazeable_irrigated_ac)} ac typed by hand ·{' '}
        {n0(p.fieldAuds)} AUDs (no field mapped inside this pasture)
      </p>
    )
  }
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]', className)}>
      <span className="text-gray-600">
        Native {n0(p.nativeGrassAc)} ac · <span className="font-medium tabular-nums text-gray-700">{n0(p.nativeAuds)} AUDs</span>
      </span>
      {p.fields.map((f) => (
        <span key={f.fieldId + (f.cropName ?? '')} className="flex items-center gap-x-1.5">
          <span className="text-gray-300">·</span>
          <FieldChip f={f} />
        </span>
      ))}
      <FieldsInfo window={p.window} />
    </p>
  )
}

function FieldsInfo({ window }: { window: PastureCalc['window'] }) {
  return (
    <InfoPopover title="Crop fields inside the pasture">
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
        day, so the native grass and the fields add up to the pasture&apos;s own figure. Hover a field for its acres,
        harvest date and feed value.
      </p>
    </InfoPopover>
  )
}
