import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bug, Copy, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/Card'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { Select } from '@/components/Select'
import { askConfirm } from '@/components/askConfirm'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  BEE_FACTS,
  BEE_PAPERS,
  LEAFCUTTER_HATCH_HOURS,
  SEVERITY_LABEL,
  SEVERITY_STYLE,
  beePaperLink,
  beekeeperNote,
  inFieldOn,
  type BeeKind,
} from '@/lib/pollinators'
import {
  useDeletePlacement,
  usePollinatorSeason,
  useSavePlacement,
  type PollinatorField,
} from '@/lib/pollinators-data'
import { cn } from '@/lib/utils'

const day = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 disabled:bg-gray-50'

const ADVICE_WORDS: Record<string, (pct: number) => string> = {
  'too early': (p) => `${Math.round(p)}% bloom — too early for either kind`,
  'stock leafcutters': (p) => `${Math.round(p)}% bloom — leafcutters due in`,
  'stock honey bees': (p) => `${Math.round(p)}% bloom — honey bees due in`,
  'both due': (p) => `${Math.round(p)}% bloom — both kinds due in`,
  in: (p) => `${Math.round(p)}% bloom, bees in`,
  waning: (p) => `${Math.round(p)}% bloom and falling — start taking honey bees out in stages`,
  over: (p) => `bloom over, peaked near ${Math.round(p)}%`,
}

/**
 * Canola bloom → Pollinators (4 Nov 2026).
 *
 * Alberta's two 2019 seed canola pollinator guides are almost entirely about
 * timing, and every piece of that timing is something the app already knows —
 * except whether there are bees in the field. That is what this tab records,
 * and it is the only reason the warnings below could not be made before.
 *
 * It lives on the bloom page because the stocking decision is a bloom-share
 * decision: leafcutters at five per cent, honey bees at ten.
 */
export function PollinatorsTab({ cropYear }: { cropYear: number }) {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data, isLoading, error } = usePollinatorSeason(cropYear)
  const [adding, setAdding] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !data) return <p className="text-sm text-gray-500">Loading…</p>
  if (!data.fields.length) return <p className="text-sm text-gray-500">No canola bloom rows for {cropYear} yet.</p>

  const note = beekeeperNote(
    data.fields.map((f) => ({
      fieldName: f.fieldName,
      pct: f.yellowNow == null ? null : f.yellowNow * 100,
      stage: f.stage,
      placements: f.placements,
      upcoming: f.upcoming,
    })),
    data.today,
  )

  return (
    <div className="space-y-3">
      <HelpNote summary="Leafcutters in at 5 % bloom, honey bees at 10 %, and never an insecticide on blooming canola.">
        Alberta's two seed canola pollinator guides are a timing document, and the app holds the timings: the bloom share from the satellite, the
        sprays from the application records, the pivot passes and the hail reports. Record when the bees go in and it can check all four against each
        other.{' '}
        <Link to={beePaperLink(BEE_PAPERS.growers)} className="font-medium text-brand-700 hover:underline">
          The growers' guide
        </Link>{' '}
        and{' '}
        <Link to={beePaperLink(BEE_PAPERS.beekeepers)} className="font-medium text-brand-700 hover:underline">
          the beekeepers' one
        </Link>{' '}
        (Government of Alberta, 2019).
      </HelpNote>

      <Card title={`Canola fields · ${cropYear}`} icon={Bug}>
        <div className="divide-y divide-gray-100">
          {data.fields.map((f) => (
            <FieldRow
              key={f.fieldId}
              f={f}
              today={data.today}
              canEdit={canEdit}
              cropYear={cropYear}
              contacts={data.contacts}
              adding={adding === f.fieldId}
              onAdd={() => setAdding(adding === f.fieldId ? null : f.fieldId)}
            />
          ))}
        </div>
      </Card>

      {note && (
        <Card
          title="Note for the beekeeper"
          icon={Copy}
          header="inline"
          right={
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(note)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          }
        >
          <div className="p-3">
            <p className="mb-2 text-xs text-gray-500">
              Built from the records each time it is shown, so it cannot go stale. The guides make keeping the beekeeper informed the grower's job
              and give no form for it.
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-xs text-gray-800">{note}</pre>
          </div>
        </Card>
      )}

      <Fold title="What the guides ask for" summary="Stocking, sprays, the pivot, the end gun, hail and taking them out.">
        <Guidance />
      </Fold>
    </div>
  )
}

function FieldRow({
  f,
  today,
  canEdit,
  cropYear,
  contacts,
  adding,
  onAdd,
}: {
  f: PollinatorField
  today: string
  canEdit: boolean
  cropYear: number
  contacts: { id: string; label: string }[]
  adding: boolean
  onAdd: () => void
}) {
  const del = useDeletePlacement(cropYear)
  const inField = f.placements.filter((p) => inFieldOn(p, today))
  const words = f.advice.state === 'unknown' ? null : ADVICE_WORDS[f.advice.state]?.(f.advice.pct)

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to={`/fields/${f.fieldId}`} className="font-medium text-brand-700 hover:underline">
            {f.fieldName}
          </Link>
          <div className="text-xs text-gray-500">
            {words ?? 'no bloom share read yet'}
            {/* The stage is already in the words for a crop that is over or
                waning, and "bloom over · over" reads like a stutter. */}
            {f.stage && f.advice.state !== 'over' && f.advice.state !== 'waning' ? ` · ${f.stage}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {inField.map((p) => (
            <span key={p.id} className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
              {p.units ?? '?'} {BEE_FACTS[p.kind].unit}
            </span>
          ))}
          {canEdit && (
            <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <Plus className="h-3.5 w-3.5" /> Bees
            </button>
          )}
        </div>
      </div>

      {f.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {f.warnings.map((w) => (
            <li key={`${w.severity}-${w.on}-${w.text}`} className="flex flex-wrap items-start gap-1.5 text-sm">
              <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', SEVERITY_STYLE[w.severity])}>
                {SEVERITY_LABEL[w.severity]}
              </span>
              <span className="text-gray-800">{w.text}</span>
              <InfoPopover title="What the guides say">
                <p>{w.why}</p>
              </InfoPopover>
            </li>
          ))}
        </ul>
      )}

      {f.placements.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
          {f.placements.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span>
                {BEE_FACTS[p.kind].label}: {p.units ?? '?'} {BEE_FACTS[p.kind].unit}, {day(p.placed_on)}
                {p.removed_on ? ` – ${day(p.removed_on)}` : ' – still in'}
                {p.contactName ? ` · ${p.contactName}` : ''}
                {p.note ? ` · ${p.note}` : ''}
              </span>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove the ${BEE_FACTS[p.kind].label.toLowerCase()} record placed ${p.placed_on}`}
                  onClick={async () => {
                    if (await askConfirm(`Delete this ${BEE_FACTS[p.kind].label.toLowerCase()} record?`)) del.mutate(p.id)
                  }}
                  className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && <PlacementForm fieldId={f.fieldId} cropYear={cropYear} contacts={contacts} today={today} onDone={onAdd} />}
    </div>
  )
}

function PlacementForm({
  fieldId,
  cropYear,
  contacts,
  today,
  onDone,
}: {
  fieldId: string
  cropYear: number
  contacts: { id: string; label: string }[]
  today: string
  onDone: () => void
}) {
  const { profile } = useAuth()
  const save = useSavePlacement(cropYear)
  const [kind, setKind] = useState<BeeKind>('leafcutter')
  const [placedOn, setPlacedOn] = useState(today)
  const [removedOn, setRemovedOn] = useState('')
  const [units, setUnits] = useState('')
  const [contactId, setContactId] = useState('')
  const [note, setNote] = useState('')

  const ok = placedOn !== '' && (removedOn === '' || removedOn >= placedOn)

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ok) return
        save.mutate(
          {
            field_id: fieldId,
            crop_year: cropYear,
            kind,
            placed_on: placedOn,
            removed_on: removedOn || null,
            units: units === '' ? null : Number(units),
            contact_id: contactId || null,
            note: note.trim() || null,
            created_by: profile?.id ?? null,
          },
          { onSuccess: onDone },
        )
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-gray-600">
          Kind
          <Select
            value={kind}
            onChange={(v) => setKind(v as BeeKind)}
            ariaLabel="Kind of bee"
            options={[
              { value: 'leafcutter', label: 'Leafcutter shelters' },
              { value: 'honey', label: 'Honey bee hives' },
            ]}
          />
        </label>
        <label className="text-xs text-gray-600">
          Placed
          <input type="date" className={input} value={placedOn} onChange={(e) => setPlacedOn(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Removed
          <input type="date" className={input} value={removedOn} onChange={(e) => setRemovedOn(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          {BEE_FACTS[kind].unit === 'hives' ? 'Hives' : 'Shelters'}
          <input className={input} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-600">
          Beekeeper or leafcutter producer
          <Select
            value={contactId}
            onChange={setContactId}
            ariaLabel="Beekeeper"
            placeholder="Nobody recorded"
            options={[{ value: '', label: 'Nobody recorded' }, ...contacts.map((c) => ({ value: c.id, label: c.label }))]}
          />
        </label>
        <label className="text-xs text-gray-600">
          Note
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where they sit, access, anything agreed" />
        </label>
      </div>
      {!ok && removedOn !== '' && <p className="text-xs text-red-600">They cannot come out before they went in.</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!ok || save.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={onDone} className="text-sm text-gray-600 hover:underline">
          Cancel
        </button>
        {save.error && <span className="text-xs text-red-600">{(save.error as Error).message}</span>}
      </div>
    </form>
  )
}

function Guidance() {
  return (
    <div className="space-y-2 p-3 text-sm text-gray-800">
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <span className="font-medium">Stocking.</span> Leafcutters at {BEE_FACTS.leafcutter.stockAtPct} per cent bloom, honey bees at{' '}
          {BEE_FACTS.honey.stockAtPct} per cent. Honey bees brought to a field with nothing to forage on learn to forage elsewhere. Sweep for pests
          before any bees are placed, so there is still time to spray.
        </li>
        <li>
          <span className="font-medium">Insecticides.</span> Blooming canola is never sprayed with one: it is harmful to all bees and can leave
          residues in honey.
        </li>
        <li>
          <span className="font-medium">Fungicides.</span> Be cautious with them, and with tank mixes containing one, while bees are in the field.
          Whatever has to go on goes on in the evening after flight has ceased, and never over the hives or the beekeepers. Give the sprayer width to
          the leafcutter producer so the shelters are not clipped.
        </li>
        <li>
          <span className="font-medium">The pivot.</span> After leafcutters are stocked it stays off until they have hatched — at least{' '}
          {LEAFCUTTER_HATCH_HOURS} hours, and longer in cool weather. End guns must not hit the hives: water in a hive kills bees and brood. Agree
          beforehand whether the drop tubes need wrapping, and leave the pivot tracks visible so the shelters can be placed.
        </li>
        <li>
          <span className="font-medium">Hail.</span> A hailed-out field has nothing to forage, so the hives and shelters may have to come out. Tell
          the beekeeper and the leafcutter producer within 24 hours.
        </li>
        <li>
          <span className="font-medium">Taking them out.</span> By the bloom guide, and in stages as bloom wanes — the remaining honey bees and the
          leafcutters are still pollinating. Hives cannot be shifted within the field once placed: a short move disorients them.
        </li>
        <li>
          <span className="font-medium">The two kinds.</span> Honey bees forage within {BEE_FACTS.honey.forageM} m of the hive and fly from{' '}
          {BEE_FACTS.honey.flightC} °C; leafcutters stay within {BEE_FACTS.leafcutter.forageM} m of the shelter and fly from{' '}
          {BEE_FACTS.leafcutter.flightC} °C.
        </li>
      </ul>
      <p className="flex items-start gap-1 text-xs text-gray-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        From{' '}
        <Link to={beePaperLink(BEE_PAPERS.growers)} className="font-medium text-brand-700 hover:underline">
          both 2019 Alberta communication guides
        </Link>
        . They also point at the Canadian Honey Council's &ldquo;Practices to Reduce Bee Poisoning from Agricultural Pesticides in Canada&rdquo;.
      </p>
    </div>
  )
}
