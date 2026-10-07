import { Link } from 'react-router-dom'
import { Ban, CircleHelp, FileText } from 'lucide-react'
import { openChemicalLabel } from '@/lib/chemicals'
import { activeRestrictions, blocking, fmtDay, headlineFor, restrictionText, untilWord, type Restriction } from '@/lib/grazing-restrictions'
import { useGrazingPicture } from '@/lib/grazing-restrictions-hooks'

/**
 * Grazing and feeding restrictions after a spray, on screen: the lines for one
 * field or pasture, the banner on a field's page, and the one on the cattle
 * map. Every line carries the label's own words and a button for the label —
 * looked up at the click, because PMRA renumbers its documents.
 */

/** Each product's restrictions, with its label. */
export function RestrictionLines({ restrictions }: { restrictions: Restriction[] }) {
  // One block per product per spray day.
  const groups = new Map<string, Restriction[]>()
  for (const r of restrictions) groups.set(`${r.registration}|${r.appliedOn}`, [...(groups.get(`${r.registration}|${r.appliedOn}`) ?? []), r])
  return (
    <ul className="space-y-2">
      {[...groups.values()].map((rs) => {
        const r0 = rs[0]
        const quotes = [...new Set(rs.map((r) => r.quote).filter(Boolean))] as string[]
        return (
          <li key={`${r0.registration}|${r0.appliedOn}`} className="text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-semibold">
                {r0.product} <span className="font-normal opacity-70">· Reg. {r0.registration} · sprayed {fmtDay(r0.appliedOn)}</span>
              </span>
              <button type="button" onClick={() => openChemicalLabel(r0.registration)} className="inline-flex items-center gap-1 underline">
                <FileText className="h-3 w-3" /> Open the label
              </button>
            </div>
            <ul className="mt-0.5 space-y-0.5 pl-3">
              {rs.map((r) => (
                <li key={r.kind}>
                  {restrictionText(r)}
                  {r.condition && <span className="opacity-70"> · when {r.condition}</span>}
                </li>
              ))}
            </ul>
            {quotes.map((q) => (
              <p key={q} className="mt-0.5 pl-3 italic opacity-80">
                “{q}”
              </p>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The banner on a field's page, above the tabs: a grazing restriction is not
 * something anybody should have to be on the right tab to find. Nothing when
 * the field has none.
 */
export function FieldGrazingRestriction({ fieldId }: { fieldId: string }) {
  const { picture, today } = useGrazingPicture()
  const place = picture?.places.find((p) => p.kind === 'field' && p.id === fieldId)
  if (!place) return null
  const active = activeRestrictions(place.restrictions, today)
  const head = headlineFor(place, today)
  const unread = picture!.unread.filter((u) => u.places.includes(place.name))
  const clashes = picture!.clashes.filter((c) => c.place === place && c.restriction.until! > today)
  if (!head && !unread.length) return null
  return (
    <div className={head ? 'rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-red-900' : 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900'}>
      {head ? (
        <>
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> Grazing / feeding restricted — {head}
          </p>
          {(place.eaten.length > 0 || place.inPastures.length > 0) && (
            <p className="mt-0.5 pl-6 text-xs">
              Livestock reach it: {[...place.eaten, ...place.inPastures.map((p) => `inside ${p.name}'s fence`)].join('; ')}.
            </p>
          )}
          {clashes.map((c) => (
            <p key={c.key} className="mt-0.5 pl-6 text-xs font-semibold">
              {c.grazing.kind === 'stubble'
                ? `Stubble grazing "${c.grazing.name}" is planned from ${fmtDay(c.grazing.start)} — too soon.`
                : `Cattle in ${c.grazing.name} from ${fmtDay(c.grazing.start)}${c.grazing.end ? ` to ${fmtDay(c.grazing.end)}` : ' (still there)'} — inside the restriction.`}
            </p>
          ))}
          <div className="mt-2 pl-6">
            <RestrictionLines restrictions={active} />
          </div>
          <p className="mt-1 pl-6 text-[11px] opacity-70">
            Read off each label by the app; the label is the law. All fields and pastures:{' '}
            <Link to="/grazing-restrictions" className="underline">
              Grazing restrictions
            </Link>
            .
          </p>
        </>
      ) : null}
      {unread.length > 0 && (
        <p className={head ? 'mt-1 pl-6 text-xs' : 'flex items-start gap-2 text-xs'}>
          {!head && <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
          <span>
            Grazing not known yet for {unread.map((u) => u.product).join(', ')} — the label{unread.length === 1 ? ' has' : 's have'} not been read for grazing. Unknown is not the same as safe.
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * On the cattle map: cattle inside a restriction now, and the pastures (or
 * crop fields inside a pasture's fence) that are off limits. Nothing when
 * there is none.
 */
export function GrazingRestrictionBanner() {
  const { picture, today } = useGrazingPicture()
  if (!picture) return null
  const clashes = picture.clashes.filter((c) => c.restriction.until! > today && (c.grazing.end == null || c.grazing.end >= today))
  const off = picture.places.filter((p) => (p.kind === 'pasture' || p.inPastures.length > 0) && blocking(p.restrictions, today).length)
  if (!clashes.length && !off.length) return null
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-900">
      <p className="flex items-start gap-2 font-semibold">
        <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        {clashes.length ? 'Cattle on (or planned for) sprayed ground' : 'Sprayed ground inside the pastures'}
      </p>
      <ul className="mt-1 space-y-0.5 pl-6 text-xs">
        {clashes.map((c) => (
          <li key={c.key} className="font-semibold">
            {c.grazing.kind === 'stubble' ? `Stubble grazing on ${c.place.name} from ${fmtDay(c.grazing.start)}` : `Cattle in ${c.grazing.name}${c.via ? ` (takes in ${c.place.name})` : ''}`} — {c.restriction.product}: no grazing until{' '}
            {untilWord([c.restriction])}
          </li>
        ))}
        {off.map((p) => (
          <li key={`${p.kind}:${p.id}`}>
            {p.kind === 'pasture' ? p.name : `${p.name} (inside ${p.inPastures.map((x) => x.name).join(', ')})`} — {headlineFor(p, today)}
          </li>
        ))}
      </ul>
      <Link to="/grazing-restrictions" className="mt-1 inline-block pl-6 text-xs underline">
        Grazing restrictions — products and labels
      </Link>
    </div>
  )
}
