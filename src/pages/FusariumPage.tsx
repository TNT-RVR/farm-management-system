import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Droplets, Wheat } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/Card'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { CardList, RowCard } from '@/components/RowCards'
import { useCropYear } from '@/lib/crop-year'
import {
  FHB_PAPER,
  GROUP_11_NOTE,
  HOLD_OFF_BEFORE_DAYS,
  INFECTION_WINDOW_DAYS,
  LEVEL_LABEL,
  LEVEL_STYLE,
  RULE_IN_WORDS,
  SPRAY_WINDOW_DAYS,
  SUSCEPTIBILITY,
  type FhbField,
  type Spell,
} from '@/lib/fusarium'
import { useFusariumSeason } from '@/lib/fusarium-data'
import { cn } from '@/lib/utils'

const day = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

const sheetLink = `/research?tab=search&q=${encodeURIComponent(FHB_PAPER.title)}`

const STATE_WORD: Record<string, string> = {
  before: 'not heading yet',
  'spray window': 'in the spray window',
  open: 'flowering and filling',
  past: 'window closed',
}

const th = 'px-3 py-2 text-left text-xs font-medium text-gray-500'
const td = 'px-3 py-2 text-sm text-gray-800'

/**
 * Fusarium risk (3 Nov 2026), from Alberta's own factsheet on fusarium head
 * blight in barley and wheat.
 *
 * The page answers one question per cereal field: did the weather Alberta
 * describes land on this field while its heads were open, and was there
 * residue on the field for it to land from. Everything on it is worked out
 * from records the app already keeps — nothing is typed in here.
 */
export function FusariumPage() {
  const { cropYear } = useCropYear()
  const { data, isLoading, error } = useFusariumSeason(cropYear)

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="Fusarium risk"
        icon={<Wheat className="h-5 w-5 text-brand-700" />}
        subtitle={`Cereal fields in ${cropYear}, against Alberta's conditions for head blight`}
      />

      <HelpNote summary="Warm, wet weather while the heads are open, landing on cereal or corn residue.">
        Alberta's factsheet says disease development accelerates when air temperatures around 25 °C are associated with precipitation, or very high
        humidity, for 36 hours. This page looks for that weather in each cereal field's flowering window, at the field's own station, and says what
        else was stacked against the field — the last two years' crops, irrigation through flowering, and whether a Group 11 fungicide went on.{' '}
        <Link to={sheetLink} className="font-medium text-brand-700 hover:underline">
          {FHB_PAPER.title}
        </Link>{' '}
        ({FHB_PAPER.publisher}, {FHB_PAPER.year}).
      </HelpNote>

      {error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data.fields.length ? (
        <Card title={`No cereals in ${cropYear}`} icon={Wheat}>
          <div className="space-y-2 p-3 text-sm text-gray-700">
            <p>
              The crop plan has no wheat, barley, oats, triticale or green feed on an active field this year, so there is nothing for head blight to
              infect.
            </p>
            {data.cornThisYear.length > 0 && (
              <p className="text-gray-600">
                Corn on {data.cornThisYear.join(', ')} this year, though. Corn stubble carries more fusarium inoculum than any other residue, so a
                cereal on those fields next year or the year after starts at a disadvantage.
              </p>
            )}
            {data.skipped.length > 0 && <Skipped skipped={data.skipped} />}
          </div>
        </Card>
      ) : (
        <>
          <Card title={`${data.fields.length} cereal field${data.fields.length === 1 ? '' : 's'}`} icon={Wheat}>
            <table className="hidden w-full sm:table">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className={th}>Field</th>
                  <th className={th}>Risk</th>
                  <th className={th}>Heads open</th>
                  <th className={th}>Conducive weather</th>
                  <th className={th}>Last two years</th>
                  <th className={th}>Irrigation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.fields.map((f) => (
                  <Row key={f.fieldId} f={f} />
                ))}
              </tbody>
            </table>
            <CardList>
              {data.fields.map((f) => (
                <RowCard
                  key={f.fieldId}
                  heading={
                    <Link to={`/fields/${f.fieldId}`} className="text-brand-700">
                      {f.fieldName}
                    </Link>
                  }
                  actions={<LevelChip f={f} />}
                  facts={[
                    { label: 'Crop', node: `${f.cropName}${f.variety ? ` · ${f.variety}` : ''}` },
                    { label: 'Heads open', node: f.window ? `${day(f.window.from)} – ${day(f.window.to)}` : null },
                    { label: 'Conducive weather', node: f.spells.length ? spellWords(f) : 'none found' },
                    { label: 'Last two years', node: residueWords(f) },
                    { label: 'Irrigation in the window', node: f.irrigation.length ? `${f.irrigation.length} pass${f.irrigation.length === 1 ? '' : 'es'}` : null },
                  ]}
                >
                  <Why f={f} />
                </RowCard>
              ))}
            </CardList>
          </Card>

          {data.clashes.length > 0 && (
            <Card title="Fields flowering together" icon={AlertTriangle} header="inline">
              <div className="space-y-2 p-3 text-sm text-gray-700">
                <p className="text-xs text-gray-500">
                  Alberta asks for seeding dates to be varied so the cereal fields do not all flower at once — the spray window is only about{' '}
                  {SPRAY_WINDOW_DAYS} days wide, and the sprayer cannot be everywhere in it.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {data.clashes.map((c) => (
                    <li key={c.on}>
                      Around {day(c.on)}: {c.fields.join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {data.cornThisYear.length > 0 && (
            <Card title="Corn this year" icon={Wheat} header="inline">
              <p className="p-3 text-sm text-gray-700">
                {data.cornThisYear.join(', ')}. Corn stubble holds more fusarium inoculum than any other residue, so the sheet's two years away from
                a host starts counting from this crop, not from the last cereal.
              </p>
            </Card>
          )}

          {data.skipped.length > 0 && (
            <Card title="Left out" icon={AlertTriangle} header="inline">
              <div className="p-3">
                <Skipped skipped={data.skipped} />
              </div>
            </Card>
          )}

          <Fold title="What Alberta says to do about it" summary="Rotation, variety, seeding rate, irrigation and the fungicide.">
            <Advice />
          </Fold>
        </>
      )}
    </div>
  )
}

function Skipped({ skipped }: { skipped: { fieldName: string; why: string }[] }) {
  return (
    <div className="text-sm text-gray-600">
      <p className="text-xs text-gray-500">
        These cereal fields have no window to test, so they are not in the list above rather than sitting in it looking safe:
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {skipped.map((s) => (
          <li key={s.fieldName}>
            {s.fieldName} — {s.why}
          </li>
        ))}
      </ul>
    </div>
  )
}

function LevelChip({ f }: { f: FhbField }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', LEVEL_STYLE[f.level])}>
      {LEVEL_LABEL[f.level]}
    </span>
  )
}

const spellWords = (f: FhbField) => {
  const n = f.spells.length
  const forecast = f.spells.filter((s) => s.forecast).length
  return `${n} spell${n === 1 ? '' : 's'}${forecast ? `, ${forecast} forecast` : ''}`
}

const residueWords = (f: FhbField) => {
  if (f.residue.hosts.length) return f.residue.hosts.map((h) => `${h.cropName} ${h.crop_year}`).join(', ')
  return f.residue.unknown ? 'one year not on record' : 'two years off a host'
}

function Row({ f }: { f: FhbField }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(!open)}>
        <td className={td}>
          <Link to={`/fields/${f.fieldId}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            {f.fieldName}
          </Link>
          <div className="text-xs text-gray-500">
            {f.cropName}
            {f.variety ? ` · ${f.variety}` : ''}
            {f.irrigated ? ' · irrigated' : ''}
          </div>
        </td>
        <td className={td}>
          <LevelChip f={f} />
        </td>
        <td className={td}>
          {f.window ? `${day(f.window.from)} – ${day(f.window.to)}` : '—'}
          {f.state && <div className="text-xs text-gray-500">{STATE_WORD[f.state]}</div>}
        </td>
        <td className={td}>
          {f.spells.length ? (
            <span className="font-medium text-amber-700">{spellWords(f)}</span>
          ) : f.basis === 'none' ? (
            <span className="text-gray-500">no weather on record</span>
          ) : (
            <span className="text-gray-600">none found</span>
          )}
          <div className="text-xs text-gray-500">{f.basis === 'hourly' ? 'hour by hour' : f.basis === 'daily' ? 'from daily records' : ''}</div>
        </td>
        <td className={td}>{residueWords(f)}</td>
        <td className={td}>
          {f.irrigation.length ? (
            <span className={cn(f.irrigation.some((e) => !e.before) && 'font-medium text-amber-700')}>
              {f.irrigation.length} pass{f.irrigation.length === 1 ? '' : 'es'}
            </span>
          ) : (
            <span className="text-gray-500">none</span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-gray-50 px-3 py-2">
            <Why f={f} />
          </td>
        </tr>
      )}
    </>
  )
}

/** Everything the level was built from, for the row that was opened. */
function Why({ f }: { f: FhbField }) {
  return (
    <div className="space-y-2 text-sm text-gray-800">
      {f.group11.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2">
          <div className="flex items-center gap-1.5 font-medium text-red-800">
            <AlertTriangle className="h-4 w-4" /> A Group 11 fungicide went on in this window
          </div>
          <p className="mt-0.5 text-xs text-red-800">
            {f.group11.map((a) => `${a.name}, ${day(a.applied_on)}`).join('; ')}. {GROUP_11_NOTE}
          </p>
        </div>
      )}

      {f.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {f.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {!f.reasons.length && <p className="text-gray-600">Nothing on record against this field.</p>}

      {f.spells.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-xs font-medium text-gray-700">
            The spells
            <InfoPopover title="What counts as a spell">
              <p>
                Alberta's words are &ldquo;air temperatures around 25 degrees C ... associated with precipitation, or very high humidity, for 36
                hours&rdquo;. The sheet gives no thresholds, so this app reads that as {RULE_IN_WORDS}.
              </p>
              <p className="mt-2">
                Read hour by hour where the hourly record reaches — it is kept for about four months — and off daily highs, rain and humidity for
                earlier seasons, which is coarser. The column says which was used.
              </p>
            </InfoPopover>
          </div>
          <ul className="mt-0.5 space-y-0.5 text-sm">
            {f.spells.map((s) => (
              <li key={`${s.from}-${s.to}`}>
                <SpellLine s={s} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {f.irrigation.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-xs font-medium text-gray-700">
            <Droplets className="h-3.5 w-3.5" /> Irrigation
          </div>
          <p className="text-sm">
            {f.irrigation
              .map((e) => `${day(e.date)}${e.gross_mm == null ? '' : ` (${Math.round(e.gross_mm)} mm)`}${e.before ? ', before flowering' : ''}`)
              .join('; ')}
          </p>
          <p className="text-xs text-gray-500">
            Alberta asks for irrigation to be limited in the {HOLD_OFF_BEFORE_DAYS} days before and through flowering, to keep the canopy dry.
          </p>
        </div>
      )}

      <p className="text-xs text-gray-500">
        {f.cereal}: {SUSCEPTIBILITY[f.cereal].label}. Heads taken as open from the start of this crop's mid stage — the same boundary the irrigation
        trigger uses — for {INFECTION_WINDOW_DAYS} days, which carries past the {SPRAY_WINDOW_DAYS}-day spray window into early kernel fill.
      </p>
    </div>
  )
}

function SpellLine({ s }: { s: Spell }) {
  const what = s.wet === 'both' ? 'rain and high humidity' : s.wet === 'rain' ? 'rain' : 'high humidity'
  return (
    <span>
      {day(s.from)}
      {s.from === s.to ? '' : ` – ${day(s.to)}`}: {Math.round(s.hours)} h at {s.meanTempC.toFixed(1)} °C with {what}
      {s.rainMm > 0 && `, ${s.rainMm.toFixed(1)} mm`}
      {s.meanRh != null && `, ${Math.round(s.meanRh)}% humidity`}
      {s.forecast && <span className="ml-1 rounded bg-blue-100 px-1 text-xs font-medium text-blue-800">forecast</span>}
    </span>
  )
}

function Advice() {
  return (
    <div className="space-y-2 p-3 text-sm text-gray-800">
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <span className="font-medium">Rotation.</span> At least two years away from cereals and corn, so the infested residue has decomposed
          before the next cereal. Canola, pulses and forage legumes are the non-hosts.
        </li>
        <li>
          <span className="font-medium">Variety.</span> Susceptibility falls from durum, through CPS and hard red spring wheat, to barley and oat.
          Winter wheat usually escapes: it flowers before the spores are about. Oat is least susceptible but has very little tolerance for damaged
          kernels.
        </li>
        <li>
          <span className="font-medium">Seeding rate and date.</span> A higher rate means less tillering, a shorter and more uniform flowering
          period, and so a narrower window to protect — and a shorter time irrigation has to stay off. Vary seeding dates between fields.
        </li>
        <li>
          <span className="font-medium">Irrigation.</span> Limit it just before and during flowering, to keep humidity out of the canopy.
        </li>
        <li>
          <span className="font-medium">Fungicide.</span> Suppression only, never control, and the window is about seven days — from the heads being
          out of the boot until half the main-stem heads are in flower. Warm weather narrows it. {GROUP_11_NOTE}
        </li>
        <li>
          <span className="font-medium">Scout at late milk to early dough</span> for prematurely bleached spikelets — late July or early August for
          spring cereals. Too late to spray by then, but it is the record that sets up next year.
        </li>
      </ul>
      <p className="text-xs text-gray-500">
        All of it from{' '}
        <Link to={sheetLink} className="font-medium text-brand-700 hover:underline">
          {FHB_PAPER.title}
        </Link>
        , {FHB_PAPER.publisher}, {FHB_PAPER.year}.
      </p>
    </div>
  )
}
