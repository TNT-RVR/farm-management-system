import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CircleHelp, SprayCan } from 'lucide-react'
import { Select } from '@/components/Select'
import { DeleteButton, EditButton, RecordEditModal, rowClick } from '@/components/RecordEditor'
import { RestrictionLines } from '@/components/GrazingRestrictions'
import { FieldLivestockAccess } from '@/pages/cattle/FieldLivestockAccess'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useChemicalSearch } from '@/lib/chemicals'
import { activeRestrictions, blocking, fmtDay, headlineFor, untilWord } from '@/lib/grazing-restrictions'
import { useGrazingPicture, usePastureSprayMutations, usePastureSprays } from '@/lib/grazing-restrictions-hooks'
import { farmTz } from '@/lib/farm-context'

/**
 * Every field and pasture a spray keeps livestock off, farm-wide.
 *
 * The question this answers is the one asked at the gate: can the cattle go
 * in there, and can that be cut for feed. Clashes first (cattle on, or
 * planned for, sprayed ground), then every field and pasture with a
 * restriction in force, then the pasture spray record — John Deere knows the
 * crop fields only, so a pasture sprayed with a quad or by a custom
 * applicator is written down here — and last what the app cannot judge yet.
 */
export function GrazingRestrictionsPage() {
  const { picture, today, isLoading, error } = useGrazingPicture()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading…</p>
  if (error || !picture) return <p className="p-6 text-sm text-red-600">Could not load the spray records: {(error as Error | null)?.message}</p>

  const clashes = picture.clashes.filter((c) => c.restriction.until! > today)
  const restricted = picture.places
    .filter((p) => blocking(p.restrictions, today).length)
    // Where livestock actually go first; then by name.
    .sort((a, b) => Number(b.eaten.length + b.inPastures.length > 0) - Number(a.eaten.length + a.inPastures.length > 0) || a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Grazing restrictions</h1>
        <p className="text-sm text-gray-600">
          What each sprayed product&apos;s label says about grazing the treated crop or feeding it to livestock, field by field and pasture by pasture. Read off the labels by the app — open the label to check it; the label is the law.
        </p>
      </div>

      {clashes.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Ban className="h-4 w-4 text-red-600" /> Cattle on (or planned for) sprayed ground
          </h2>
          <ul className="mt-1 space-y-1 text-xs">
            {clashes.map((c) => (
              <li key={c.key}>
                <b>{c.place.name}</b>
                {c.via ? ` (inside ${c.via.name})` : ''}:{' '}
                {c.grazing.kind === 'stubble'
                  ? `stubble grazing "${c.grazing.name}" planned from ${fmtDay(c.grazing.start)}`
                  : `${c.grazing.head ? `${c.grazing.head} head` : 'cattle'} in ${c.grazing.name} from ${fmtDay(c.grazing.start)}${c.grazing.end ? ` to ${fmtDay(c.grazing.end)}` : ' (still there)'}`}{' '}
                — {c.restriction.product} says no grazing until {untilWord([c.restriction])}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-800">In force today ({restricted.length})</h2>
        {restricted.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500">No field or pasture has a grazing or feeding restriction in force.</p>
        ) : (
          restricted.map((p) => {
            const reach = [...p.eaten, ...p.inPastures.map((x) => `inside ${x.name}'s fence`)]
            return (
              <div key={`${p.kind}:${p.id}`} className={reach.length ? 'rounded-lg border border-red-200 bg-white p-3 text-gray-800' : 'rounded-lg border border-gray-200 bg-white p-3 text-gray-800'}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  {p.kind === 'field' ? (
                    <Link to={`/fields/${p.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-gray-900">{p.name} (pasture)</span>
                  )}
                  <span className="text-xs font-medium text-red-700">{headlineFor(p, today)}</span>
                </div>
                <p className="text-xs text-gray-500">{reach.length ? `Livestock reach it: ${reach.join('; ')}.` : 'Nothing on record says livestock graze it or eat what comes off it.'}</p>
                <div className="mt-2">
                  <RestrictionLines restrictions={activeRestrictions(p.restrictions, today)} />
                </div>
              </div>
            )
          })
        )}
      </section>

      <FieldLivestockAccess isManager={isManager} />

      <PastureSprays pastures={picture.places.filter((p) => p.kind === 'pasture').map((p) => ({ id: p.id, name: p.name }))} isManager={isManager} />

      {(picture.unread.length > 0 || picture.unmatched.length > 0) && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <CircleHelp className="h-4 w-4 text-amber-600" /> Not known yet
          </h2>
          <p className="mt-0.5">Unknown is not the same as safe.</p>
          {picture.unread.length > 0 && (
            <>
              <p className="mt-2 font-semibold">Labels not read for grazing yet</p>
              <ul className="space-y-0.5">
                {picture.unread.map((u) => (
                  <li key={u.registration}>
                    {u.product} (Reg. {u.registration}) — on {u.places.slice(0, 6).join(', ')}
                    {u.places.length > 6 ? ` and ${u.places.length - 6} more` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {picture.unmatched.length > 0 && (
            <>
              <p className="mt-2 font-semibold">Sprayed names John Deere sent that the price book can&apos;t match to a product</p>
              <ul className="space-y-0.5">
                {picture.unmatched.map((u) => (
                  <li key={u.name}>
                    “{u.name}” — {u.passes} pass{u.passes === 1 ? '' : 'es'}, last {fmtDay(u.lastOn)}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                Match them on{' '}
                <Link to="/chemicals?tab=pricing" className="underline">
                  Chemical → Pricing settings
                </Link>{' '}
                so their labels count.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  )
}

/** The pasture spray record: a form, and what is on file. */
function PastureSprays({ pastures, isManager }: { pastures: { id: string; name: string }[]; isManager: boolean }) {
  const m = usePastureSprayMutations()
  const { data: rows } = usePastureSprays()
  const [f, setF] = useState({ pastureId: '', on: new Date().toLocaleDateString('en-CA', { timeZone: farmTz() }), product: '', reg: '', notes: '' })
  const [term, setTerm] = useState('')
  const { data: matches } = useChemicalSearch(term.length >= 3 ? term : '', '')
  const pick = term.length >= 3 ? (matches ?? []).slice(0, 8) : []
  type SprayRow = NonNullable<typeof rows>[number]
  const [editing, setEditing] = useState<SprayRow | null>(null)

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <h2 className="flex items-center gap-1.5 border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
        <SprayCan className="h-4 w-4 text-gray-400" /> Pasture sprays
      </h2>
      <p className="px-3 pt-2 text-xs text-gray-500">
        John Deere records the crop fields only. A pasture sprayed any other way goes here, so its label counts too.
      </p>
      <div className="flex flex-wrap items-end gap-2 px-3 py-2 text-xs">
        <label className="text-gray-500">
          Pasture
          <Select value={f.pastureId} size="sm" ariaLabel="Pasture" className="mt-0.5 w-44" onChange={(v) => setF((x) => ({ ...x, pastureId: v }))} options={[{ value: '', label: 'Choose…' }, ...pastures.map((p) => ({ value: p.id, label: p.name }))]} />
        </label>
        <label className="text-gray-500">
          Sprayed on
          <input type="date" value={f.on} onChange={(e) => setF((x) => ({ ...x, on: e.target.value }))} className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-sm" />
        </label>
        <label className="relative text-gray-500">
          Product
          <input
            value={f.product}
            onChange={(e) => {
              setF((x) => ({ ...x, product: e.target.value, reg: '' }))
              setTerm(e.target.value.trim())
            }}
            placeholder="Type 3 letters…"
            className="mt-0.5 block w-56 rounded border border-gray-300 px-1.5 py-1 text-sm"
          />
          {pick.length > 0 && !f.reg && (
            <ul className="absolute z-10 mt-0.5 max-h-56 w-72 overflow-auto rounded border border-gray-200 bg-white shadow">
              {pick.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setF((x) => ({ ...x, product: c.name, reg: c.registration_number }))
                      setTerm('')
                    }}
                    className="block w-full px-2 py-1 text-left text-xs text-gray-800 hover:bg-gray-50"
                  >
                    {c.name} <span className="text-gray-400">· {c.registration_number}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <label className="text-gray-500">
          Reg. no.
          <input value={f.reg} onChange={(e) => setF((x) => ({ ...x, reg: e.target.value.trim() }))} inputMode="numeric" className="mt-0.5 block w-20 rounded border border-gray-300 px-1.5 py-1 text-sm tabular-nums" />
        </label>
        <label className="text-gray-500">
          Notes
          <input value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} className="mt-0.5 block w-40 rounded border border-gray-300 px-1.5 py-1 text-sm" />
        </label>
        <button
          type="button"
          disabled={!f.pastureId || !f.on || !f.product.trim() || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              { pasture_id: f.pastureId, applied_on: f.on, product: f.product.trim(), registration_number: f.reg || null, notes: f.notes.trim() || null },
              { onSuccess: () => setF((x) => ({ ...x, product: '', reg: '', notes: '' })) },
            )
          }
          className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
        {m.add.isError && <span className="text-red-600">{(m.add.error as Error).message}</span>}
      </div>
      {f.product && !f.reg && <p className="px-3 pb-2 text-[11px] text-amber-700">Without a registration number the app cannot read the label for this spray.</p>}
      {(rows ?? []).length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-200 text-xs">
          {(rows ?? []).map((r) => (
            <li
              key={r.id}
              onClick={isManager ? rowClick(() => setEditing(r)) : undefined}
              className={isManager ? 'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 hover:bg-gray-50' : 'flex items-center justify-between gap-2 px-3 py-1.5'}
            >
              <span>
                <b>{r.pastures?.name ?? 'Pasture'}</b> · {fmtDay(r.applied_on)} · {r.product}
                {r.registration_number ? ` (Reg. ${r.registration_number})` : ''}
                {r.notes ? <span className="text-gray-500"> — {r.notes}</span> : null}
              </span>
              {isManager && (
                <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1">
                  <EditButton onClick={() => setEditing(r)} />
                  <DeleteButton confirm={`Remove the ${r.product} spray on ${r.pastures?.name ?? 'this pasture'}? Its grazing restriction goes with it.`} onDelete={() => m.remove.mutate(r.id)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <RecordEditModal
          title={`Edit the ${editing.product} spray`}
          fields={[
            { key: 'pasture_id', label: 'Pasture', kind: 'select', required: true, options: pastures.map((p) => ({ value: p.id, label: p.name })) },
            { key: 'applied_on', label: 'Sprayed on', kind: 'date', required: true },
            { key: 'product', label: 'Product', kind: 'text', required: true },
            { key: 'registration_number', label: 'Reg. no.', kind: 'text', hint: 'Without it the app cannot read the label for this spray.' },
            { key: 'notes', label: 'Notes', kind: 'textarea' },
          ]}
          row={editing}
          saving={m.update.isPending}
          error={m.update.error ? (m.update.error as Error).message : null}
          onClose={() => setEditing(null)}
          onDelete={() => m.remove.mutateAsync(editing.id)}
          deleteConfirm={`Remove the ${editing.product} spray? Its grazing restriction goes with it.`}
          onSave={(p) =>
            m.update.mutateAsync({
              id: editing.id,
              patch: {
                pasture_id: p.pasture_id as string,
                applied_on: p.applied_on as string,
                product: String(p.product).trim(),
                registration_number: p.registration_number ? String(p.registration_number).trim() : null,
                notes: p.notes as string | null,
              },
            })
          }
        />
      )}
    </section>
  )
}
