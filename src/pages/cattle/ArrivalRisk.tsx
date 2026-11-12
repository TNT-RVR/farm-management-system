import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Stethoscope } from 'lucide-react'
import { Card } from '@/components/Card'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { useArrivalMutations, useArrivals, useArrivalWeather, type ArrivalWithLines } from '@/lib/cattle-papers-data'
import {
  arrivalRisk,
  AUCTION_SHARE_PCT,
  BRD_SOURCES,
  BRD_WINDOW_DAYS,
  HIGH_RISK_SHARE_PCT,
  SOURCE_LABEL,
  SOURCE_OPTIONS,
  WINDOW_ACTIONS,
  type RiskFactor,
  type SourceKind,
} from '@/lib/brd-risk'
import { TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * Sales & paperwork → Manifests → the respiratory note on cattle coming in.
 *
 * The manifest is already the record of when a load moved and from where, so
 * this reads it rather than asking for the same facts twice. Four columns on
 * the manifest fill in the rest of the list the Alberta entry study names.
 *
 * It is a list of factors and never a score: none of the Canadian papers
 * published a scoring function, so adding them up would be arithmetic the
 * research does not support. See src/lib/brd-risk.ts.
 */

const STATE_STYLE: Record<RiskFactor['state'], string> = {
  raises: 'bg-amber-100 text-amber-900',
  neutral: 'bg-gray-100 text-gray-700',
  unknown: 'bg-blue-50 text-blue-700',
}

const day = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

export function ArrivalRisk({ cropYear, canEdit }: { cropYear: number; canEdit: boolean }) {
  const { data: arrivals, isLoading } = useArrivals(cropYear)
  const dates = useMemo(() => (arrivals ?? []).map((a) => a.moved_on).filter(Boolean), [arrivals])
  const { data: weather } = useArrivalWeather(dates)
  const [open, setOpen] = useState<string | null>(null)

  if (isLoading) return null

  const rows = (arrivals ?? []).map((a) => {
    const head = a.lines.reduce((s, l) => s + (l.head ?? 0), 0)
    // Weight the average by head, so one line of 20 calves does not drag a
    // load of 200 yearlings.
    const weighted = a.lines.reduce((s, l) => s + (l.avg_weight_lb == null ? 0 : Number(l.avg_weight_lb) * (l.head ?? 0)), 0)
    const weighedHead = a.lines.reduce((s, l) => s + (l.avg_weight_lb == null ? 0 : (l.head ?? 0)), 0)
    return {
      arrival: a,
      head,
      risk: arrivalRisk({
        movedOn: a.moved_on,
        sourceKind: (a.source_kind as SourceKind | null) ?? null,
        commingled: a.commingled,
        transportKm: a.transport_km == null ? null : Number(a.transport_km),
        restStopH: a.rest_stop_h == null ? null : Number(a.rest_stop_h),
        head,
        avgWeightLb: weighedHead > 0 ? weighted / weighedHead : null,
        classes: a.lines.map((l) => l.animal_class).filter((c): c is string => Boolean(c)),
        weather: (a.moved_on && weather?.get(a.moved_on)) || null,
      }),
    }
  })

  const inWindow = rows.filter((r) => r.risk.windowOpen)

  return (
    <Card
      title="Cattle coming in: the respiratory note"
      icon={Stethoscope}
      right={
        <span className="text-xs text-white/80">
          {rows.length === 0
            ? 'no arrivals recorded'
            : inWindow.length > 0
              ? `${inWindow.length} inside the ${BRD_WINDOW_DAYS}-day window`
              : `${rows.length} this year`}
        </span>
      }
    >
      {rows.length === 0 ? (
        <div className="px-3 py-3 text-sm text-gray-600">
          <p>
            No arrivals recorded for {cropYear}. Every manifest so far is paperwork for cattle leaving;
            mark one as cattle <i>arriving</i> and this reads the date, the origin and the lines against the
            southern Alberta feedlot work.
          </p>
          <p className="mt-1.5 text-xs text-gray-500">
            About {HIGH_RISK_SHARE_PCT} per cent of calves entering western Canadian feedlots are rated high
            risk for respiratory disease even after preconditioning and vaccination at arrival, so the note
            is a prompt to ride the pen, not a verdict on the load.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_TH}>Arrived</th>
                  <th className={TABLE_TH}>From</th>
                  <th className={cn(TABLE_TH, 'text-right')}>Head</th>
                  <th className={TABLE_TH}>Source</th>
                  <th className={TABLE_TH}>Window</th>
                  <th className={cn(TABLE_TH, 'text-center')}>Factors raised</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ arrival, head, risk }) => (
                  <tr
                    key={arrival.id}
                    className={cn('cursor-pointer hover:bg-gray-50', risk.windowOpen && 'bg-amber-50/60')}
                    onClick={() => setOpen(open === arrival.id ? null : arrival.id)}
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-900">{day(arrival.moved_on)}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{arrival.origin_address ?? arrival.owner_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">{head || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {arrival.source_kind ? SOURCE_LABEL[arrival.source_kind as SourceKind] : <span className="text-gray-400">not recorded</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{risk.headline}</td>
                    <td className="px-3 py-2 text-center text-xs tabular-nums">
                      <span className={cn('rounded-full px-2 py-0.5 font-medium', risk.raised > 0 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600')}>
                        {risk.raised} of {risk.recorded} recorded
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows
            .filter(({ arrival }) => open === arrival.id)
            .map(({ arrival, risk }) => (
              <div key={arrival.id} className="border-t border-gray-200 bg-gray-50 px-3 py-3">
                <p className="text-sm font-medium text-gray-800">{risk.headline}</p>
                <ul className="mt-2 space-y-1.5">
                  {risk.factors.map((f) => (
                    <li key={f.key} className="text-xs text-gray-700">
                      <span className={cn('mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATE_STYLE[f.state])}>
                        {f.label}
                      </span>
                      <b>{f.value}</b> — {f.says}
                    </li>
                  ))}
                </ul>

                {risk.windowOpen && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-900">
                      What the Canadian work supports doing in the next{' '}
                      {Math.max(0, BRD_WINDOW_DAYS - (risk.daysOn ?? 0))} day
                      {BRD_WINDOW_DAYS - (risk.daysOn ?? 0) === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-900">
                      {WINDOW_ACTIONS.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {arrival.arrival_note && <p className="mt-2 text-xs italic text-gray-600">{arrival.arrival_note}</p>}
                {canEdit && <ArrivalForm arrival={arrival} />}
              </div>
            ))}
        </>
      )}

      <div className="border-t border-gray-100 px-3 py-2">
        <HelpNote
          summary="Southern Alberta feedlot work: a factor list, not a score."
          title="What the Canadian papers actually support"
          width={470}
        >
          <p>
            <b>The factor list.</b> &ldquo;{BRD_SOURCES.entry.paper}&rdquo; ({BRD_SOURCES.entry.year}) swabbed
            2,824 head at entry into feedlots in southern and central Alberta over 19 months, before any
            antimicrobial was given. It records the facts the feedlots&rsquo; own risk algorithms are built
            from and names them: age class, body weight, source, commingling before arrival, weather,
            transport distance, and a visual health assessment. That list is the backbone of this note — a
            feedlot&rsquo;s own checklist written down by researchers, not a model fitted to an outcome.
          </p>
          <p>
            <b>Source, and not in the obvious direction.</b> Beef-type cattle from backgrounding operations
            had <i>higher</i> odds of carrying antimicrobial-resistant bacteria than auction-derived calves.
            More than two thirds of the beef cattle sampled ({AUCTION_SHARE_PCT} per cent) came through an
            auction market, and their earlier history was unknown even to the researchers.
          </p>
          <p>
            <b>Resistance mostly is not brought in — it arrives.</b> Studies sampling at arrival found
            Mannheimia haemolytica and Pasteurella multocida still susceptible to the fluoroquinolones,
            macrolides, beta-lactams and cephalosporins. &ldquo;{BRD_SOURCES.penLevel.paper}&rdquo; (
            {BRD_SOURCES.penLevel.year}) watched it change: 1,599 western Canadian steer calves in 16 pens,
            swabbed at 1 day on feed and again at 13, with resistance up by day 13 — worst for the
            tetracyclines and the macrolides. A susceptibility result from day 1 does not describe day 13.
          </p>
          <p>
            <b>Why fourteen days.</b> &ldquo;{BRD_SOURCES.firstTwoWeeks.paper}&rdquo; (
            {BRD_SOURCES.firstTwoWeeks.year}) sampled 380 western Canadian calves and yearlings on arrival
            and again at 14 days on feed. In fall-placed calves, bovine herpesvirus 1, parainfluenza 3,
            respiratory syncytial virus and influenza D were all more prevalent at 14 days than on arrival,
            and Mannheimia haemolytica detection rose too.
          </p>
          <p>
            <b>What this screen will not do.</b> Score the load, or recommend a drug. On metaphylaxis the
            library holds one southern Alberta trial — &ldquo;{BRD_SOURCES.metaphylaxis.paper}&rdquo; (
            {BRD_SOURCES.metaphylaxis.year}), a 25,000-head commercial feedlot — which found tildipirosin
            gave significantly lower first-pull BRD treatment rates than tilmicosin (P &lt; 0.01), with no
            difference in relapse rate, overall mortality, or BRD and histophilosis mortality; tilmicosin
            still came out $6.85 a head ahead on drug price at the time. That is a finishing trial and a
            2013 price comparison. What to give is the vet&rsquo;s call and a prescription.
          </p>
          <TechnicalDetails title="Papers behind this that are citations only">
            <p>
              Two of the papers this feature was asked to use are in the library without extracted text, so
              nothing on this screen is quoted from either and no effect size from them appears anywhere:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                &ldquo;{BRD_SOURCES.restStop.paper}&rdquo; ({BRD_SOURCES.restStop.year}) — the auction and
                rest-stop question. The rest-stop hours are recorded on the manifest and reported back
                without a claim attached.
              </li>
              <li>
                &ldquo;{BRD_SOURCES.economics.paper}&rdquo; ({BRD_SOURCES.economics.year}) — so no dollar
                cost per case is shown.
              </li>
            </ul>
          </TechnicalDetails>
          <p>
            <Link
              to={`/research?tab=search&q=${encodeURIComponent('bovine respiratory disease feedlot')}`}
              className="font-medium underline"
            >
              Open the cattle health shelf in the research library
            </Link>
          </p>
        </HelpNote>
      </div>
    </Card>
  )
}

/** The four facts the manifest does not already carry. */
function ArrivalForm({ arrival }: { arrival: ArrivalWithLines }) {
  const save = useArrivalMutations()
  const [source, setSource] = useState(arrival.source_kind ?? '')
  const [commingled, setCommingled] = useState(arrival.commingled == null ? '' : arrival.commingled ? 'yes' : 'no')
  const [km, setKm] = useState(arrival.transport_km == null ? '' : String(arrival.transport_km))
  const [rest, setRest] = useState(arrival.rest_stop_h == null ? '' : String(arrival.rest_stop_h))
  const [note, setNote] = useState(arrival.arrival_note ?? '')

  const n = (s: string) => {
    if (s.trim() === '') return null
    const v = Number(s)
    return Number.isFinite(v) ? v : null
  }

  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">What the load went through</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          Source
          <Select
            value={source}
            onChange={setSource}
            placeholder="Not recorded"
            options={[{ value: '', label: 'Not recorded' }, ...SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]}
            className="mt-0.5 w-52"
          />
        </label>
        <label className="text-xs text-gray-600">
          Mixed with other cattle first
          <Select
            value={commingled}
            onChange={setCommingled}
            placeholder="Not recorded"
            options={[
              { value: '', label: 'Not recorded' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            className="mt-0.5 w-40"
          />
        </label>
        <label className="text-xs text-gray-600">
          Hauled km
          <input type="number" step="any" value={km} onChange={(e) => setKm(e.target.value)} className="mt-0.5 block w-24 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" />
        </label>
        <label className="text-xs text-gray-600">
          Rested in transit, h
          <input type="number" step="any" value={rest} onChange={(e) => setRest(e.target.value)} className="mt-0.5 block w-24 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" />
        </label>
      </div>
      <label className="mt-2 block text-xs text-gray-600">
        Note
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How they looked off the truck"
          className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <button
        onClick={() =>
          save.mutate({
            id: arrival.id,
            patch: {
              source_kind: source === '' ? null : source,
              commingled: commingled === '' ? null : commingled === 'yes',
              transport_km: n(km),
              rest_stop_h: n(rest),
              arrival_note: note || null,
            },
          })
        }
        disabled={save.isPending}
        className="mt-2 rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      <p className="mt-1.5 text-[11px] text-gray-500">
        The visual health assessment on the study&rsquo;s list is the one factor the app cannot read — that is
        the note above, and the pen rider.
      </p>
    </div>
  )
}
