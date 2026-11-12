import type React from 'react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, FlaskConical, Layers } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import {
  flaggedRepeats,
  groupRepeats,
  listNames,
  listYears,
  paperLink,
  phWeighting,
  productGroups,
  repeatPaper,
  sameSeasonOverlap,
  selfOverlap,
  shortGroupName,
  timeOfDayNotes,
  type FieldSoil,
  type GroupOverlap,
  type GroupRepeat,
  type MoaPass,
  type PhWeighting,
  type SprayPaper,
  type TimeOfDayNote,
} from '@/lib/spray-groups'
import {
  useFieldMoaHistory,
  useFieldMoaUnknown,
  useFieldSoilPh,
  useProductMoa,
} from '@/lib/spray-groups-hooks'
import { cn } from '@/lib/utils'

/**
 * The four things the spray check could not say before: the same mode of
 * action season after season, the same group twice in one year under two trade
 * names, a re-crop interval read against the field's own pH, and the hour of
 * the day where it is worth percentage points.
 *
 * Every rule is in src/lib/spray-groups.ts; this draws what they return and
 * nothing else. Each line is one short sentence with the working behind ⓘ, and
 * the whole block disappears when there is nothing to say — which on most
 * products and most fields is what happens.
 */

/** One line: the icon, a sentence, and the paper behind it. */
function WarningLine({
  tone,
  icon,
  children,
  title,
  detail,
  paper,
}: {
  tone: 'red' | 'amber' | 'blue'
  icon: React.ReactNode
  children: React.ReactNode
  title: string
  detail: React.ReactNode
  paper: SprayPaper
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-1.5 px-2 py-1.5 text-sm',
        tone === 'red' ? 'bg-red-50' : tone === 'amber' ? 'bg-amber-50' : 'bg-sky-50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-sky-700',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        {children}{' '}
        <InfoPopover title={title} width={460}>
          {detail}
          <p className="mt-2">
            <Link to={paperLink(paper)} className="font-medium underline">
              {paper.cite}
            </Link>{' '}
            — open it in the research library.
          </p>
        </InfoPopover>
      </span>
    </li>
  )
}

function RepeatLine({ field, repeat, unplaced }: { field: string; repeat: GroupRepeat; unplaced: number }) {
  const paper = repeatPaper(repeat.scheme, repeat.groupCode)
  const nth = repeat.wouldBeSeason
  return (
    <WarningLine
      tone={nth >= 4 ? 'red' : 'amber'}
      icon={<Layers className="h-4 w-4" />}
      title={`Group ${repeat.groupCode} on ${field}, season by season`}
      paper={paper}
      detail={
        <>
          <p>
            {field} has had a Group {repeat.groupCode} {repeat.scheme} in {listYears(repeat.seasons)} —{' '}
            {repeat.passes} {repeat.passes === 1 ? 'pass' : 'passes'} of {listNames(repeat.products)}. Spraying{' '}
            {repeat.active.toLowerCase()} now makes it {nth} seasons of the same mode of action on this field.
          </p>
          <p className="mt-2">
            Counted in seasons rather than passes: a burn-off and an in-crop pass of one group in the same year is
            one year of that group in the rotation. Trade names are counted as the groups they contain, which is why
            four fungicides can come to one number.
          </p>
          {unplaced > 0 && (
            <p className="mt-2">
              {unplaced} {unplaced === 1 ? 'pass' : 'passes'} on this field could not be placed in any group — the
              product has no registration and no actives entered — so the real count may be higher, never lower.
            </p>
          )}
        </>
      }
    >
      <b className="text-gray-900">{field}</b>
      <span className="text-gray-700">
        : {repeat.alreadyThisSeason && 'still the '}
        {nth}
        {nth === 3 ? 'rd' : 'th'} season of Group {repeat.groupCode} ({shortGroupName(repeat.groupName)}) —{' '}
        {!repeat.alreadyThisSeason && 'already in '}
        {listYears(repeat.seasons)}.
      </span>
    </WarningLine>
  )
}

function OverlapLine({ field, overlap }: { field: string; overlap: GroupOverlap }) {
  const paper =
    overlap.scheme === 'fungicide' && overlap.groupCode === '7'
      ? repeatPaper('fungicide', '7')
      : repeatPaper(overlap.scheme, overlap.groupCode)
  const names = listNames(overlap.already.map((a) => a.product))
  return (
    <WarningLine
      tone="amber"
      icon={<FlaskConical className="h-4 w-4" />}
      title={`Group ${overlap.groupCode} twice on ${field} in ${overlap.season}`}
      paper={paper}
      detail={
        <>
          <p>
            Already on {field} this season:{' '}
            {overlap.already.map((a, i) => (
              <span key={a.product}>
                {i > 0 && '; '}
                <b>{a.product}</b> ({a.active}) on {a.appliedOn}
              </span>
            ))}
            . The product in the tank carries {overlap.active}, which is the same group.
          </p>
          <p className="mt-2">
            Two trade names, one mode of action. Where this matters most is Group 7: boscalid, fluopyram and
            fluxapyroxad come as Cotegra, Proline Gold, Priaxor, Prosaro Pro and Delaro Complete, and in the Michigan
            survey behind this 26 per cent of 1,610 isolates were resistant to all three at once — the fully
            resistant ones had evolved straight from sensitive isolates, not from the boscalid-resistant ones.
          </p>
        </>
      }
    >
      <b className="text-gray-900">{field}</b>
      <span className="text-gray-700">
        : {names} already went on in {overlap.season} — also Group {overlap.groupCode}.
      </span>
    </WarningLine>
  )
}

function PhLine({ field, weighting }: { field: string; weighting: PhWeighting }) {
  const { ph, omPct, level, lowOm, soilYear, actives, phMax, paper } = weighting
  return (
    <WarningLine
      tone={level === 'high' ? 'amber' : 'blue'}
      icon={<AlertTriangle className="h-4 w-4" />}
      title={`The re-crop interval on ${field}'s own ground`}
      paper={paper}
      detail={
        <>
          <p>
            {field} tested pH {ph}
            {phMax != null && phMax > ph ? ` (up to ${phMax} at one site)` : ''}
            {omPct != null ? ` with ${omPct} per cent organic matter` : ''}, on the {soilYear} soil test.
          </p>
          <p className="mt-2">
            The label prints one re-cropping interval for every soil in Canada, and for weak acids like{' '}
            {listNames(actives)} that number is the average. Injury from metribuzin to a following crop is more of a
            concern at pH 7.5 or higher; sulfonylurea half-lives run from weeks in acidic soil to years under
            alkaline conditions. Alkaline ground holds less of a weak acid adsorbed and leaves more of it dissolved
            in the soil solution, which is where the next crop&rsquo;s roots meet it.
            {lowOm && ' Under two per cent organic matter, there is little holding it there either.'}
          </p>
          <p className="mt-2">
            So the interval above is the optimistic end of the range for this field. What the prairie work does
            instead of trusting the number is grow a bioassay — sugar beet for flucarbazone and sulfentrazone — on
            soil from the field itself.
          </p>
        </>
      }
    >
      <b className="text-gray-900">{field}</b>
      <span className="text-gray-700">
        : pH {ph}
        {lowOm && omPct != null ? ` and ${omPct} % organic matter` : ''}, so take{' '}
        {listNames(actives)}&rsquo;s re-crop interval as the optimistic end.
      </span>
    </WarningLine>
  )
}

function TimeOfDayLine({ note }: { note: TimeOfDayNote }) {
  return (
    <WarningLine
      tone="blue"
      icon={<Clock className="h-4 w-4" />}
      title="Time of day, and what it is worth"
      paper={note.paper}
      detail={
        <>
          <p>{note.text}</p>
          <p className="mt-2">
            Glufosinate works by shutting down glutamine synthetase, and it does so irreversibly — but the plant can
            rebuild the enzyme. Sprayed in the dark the enzyme is scarcer to begin with and the plant has the night
            to make more, so it recovers and regrows. Sprayed under intense light there is nothing left to recover
            with. In the trial, 82 per cent mean control at midday against 65 per cent at dusk, median 100 against
            68, at the same 140 g/ha 21 days after application.
          </p>
          <p className="mt-2">
            This is the only product here with a time-of-day note, because it is the only one the library can put a
            number on. Plenty of labels talk about heat and humidity; that is not the same kind of fact.
          </p>
        </>
      }
    >
      <span className="text-gray-700">
        Spray {note.active} in the middle of the day — 82 % control at midday against 65 % at dusk.
      </span>
    </WarningLine>
  )
}

export function SprayWarnings({
  productId,
  sprayOn,
  fieldIds,
  fieldName,
}: {
  productId: string
  /** The day it is going on, as yyyy-mm-dd: its year is the season counted. */
  sprayOn: string
  fieldIds: string[]
  fieldName: (id: string) => string
}) {
  const { data: moa } = useProductMoa()
  const { data: history } = useFieldMoaHistory()
  const { data: unknown } = useFieldMoaUnknown()
  const { data: soil } = useFieldSoilPh()

  const season = Number(sprayOn.slice(0, 4))
  const groups = useMemo(() => productGroups(moa ?? [], productId), [moa, productId])
  const self = useMemo(() => selfOverlap(moa ?? [], productId), [moa, productId])
  const times = useMemo(() => timeOfDayNotes(groups), [groups])

  const perField = useMemo(() => {
    if (!groups.length || !Number.isFinite(season)) return []
    const passes: MoaPass[] = history ?? []
    return fieldIds.map((fieldId) => ({
      fieldId,
      repeats: flaggedRepeats(groupRepeats(passes, { fieldId, groups, season })),
      overlaps: sameSeasonOverlap(passes, { fieldId, groups, season, productId }),
      ph: phWeighting(groups, (soil as Map<string, FieldSoil> | undefined)?.get(fieldId)),
      unplaced: (unknown ?? []).filter((u) => u.field_id === fieldId).reduce((n, u) => n + Number(u.passes), 0),
    }))
  }, [groups, history, soil, unknown, fieldIds, season, productId])

  const lines = perField.reduce((n, f) => n + f.repeats.length + f.overlaps.length + (f.ph ? 1 : 0), 0)
  if (!times.length && !self.length && lines === 0) return null

  return (
    <ul className="mt-2 divide-y divide-white/60 overflow-hidden rounded border border-gray-200">
      {times.map((t) => (
        <TimeOfDayLine key={t.active} note={t} />
      ))}
      {self.map((g) => (
        <WarningLine
          key={`self-${g.scheme}-${g.group_code}`}
          tone="amber"
          icon={<FlaskConical className="h-4 w-4" />}
          title={`${g.product_name} carries Group ${g.group_code} twice`}
          paper={repeatPaper(g.scheme, g.group_code)}
          detail={
            <p>
              {g.product_name} contains {g.active.toLowerCase()}, and they are both Group {g.group_code} —{' '}
              {g.group_name}. A mix of two actives from one group is one mode of action, not two, so it does not
              count as a partner for resistance management.
            </p>
          }
        >
          <span className="text-gray-700">
            {g.product_name}&rsquo;s {g.active.toLowerCase()} are both Group {g.group_code} — one mode of action, not
            two.
          </span>
        </WarningLine>
      ))}
      {/* Flat, so every warning is a direct <li> of the one list however many
      fields are ticked. */}
      {perField.flatMap((f) => [
        ...f.repeats.map((r) => (
          <RepeatLine
            key={`${f.fieldId}-rep-${r.scheme}-${r.groupCode}`}
            field={fieldName(f.fieldId)}
            repeat={r}
            unplaced={f.unplaced}
          />
        )),
        ...f.overlaps.map((o) => (
          <OverlapLine
            key={`${f.fieldId}-ovl-${o.scheme}-${o.groupCode}`}
            field={fieldName(f.fieldId)}
            overlap={o}
          />
        )),
        ...(f.ph ? [<PhLine key={`${f.fieldId}-ph`} field={fieldName(f.fieldId)} weighting={f.ph} />] : []),
      ])}
    </ul>
  )
}
