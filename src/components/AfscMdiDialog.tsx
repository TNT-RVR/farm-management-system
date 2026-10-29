import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { COVERAGE_OPTIONS, useMdiPreviousYear, useSaveMdiYear, type MdiYear } from '@/lib/afsc-mdi'

/**
 * The year's answers for AFSC's pasture insurance.
 *
 * Everything here is something the app cannot work out: which weather
 * stations to use, which coverage option, what the pasture is worth a pound,
 * and the AFSC identification number. The stations and the option are chosen
 * again every year, so the dialog opens on last year's answers rather than on
 * nothing — most years it is a glance and a Save.
 *
 * The standing answers (the business, its address, the home quarter) are
 * folded away: they are asked once and then only when something changes.
 */

const STATION_TOOL = 'https://experience.arcgis.com/experience/132ef3c4e1444047984503852df8990e?org=AFSC1'
const STATION_NORMALS = 'https://afsc.ca/wp-content/uploads/2026/01/Weather-Station-Normals-2026.pdf'

type Draft = Partial<MdiYear> & { crop_year: number }

export function AfscMdiDialog({ cropYear, current, onClose }: { cropYear: number; current: MdiYear | null; onClose: () => void }) {
  const previous = useMdiPreviousYear(cropYear)

  // The form starts from whatever it is going to start from, so it waits for
  // last year rather than opening empty and refilling itself underneath
  // whoever is already typing.
  if (!current && previous.isLoading) {
    return (
      <Modal title={`Pasture insurance — ${cropYear}`} onClose={onClose} wide>
        <p className="py-6 text-center text-sm text-gray-500">Looking up last year’s answers…</p>
      </Modal>
    )
  }
  return <Form cropYear={cropYear} current={current} previous={previous.data ?? null} onClose={onClose} />
}

/**
 * A year with no row of its own starts from the last one that has: the
 * identification number and the address never change, and the stations are
 * usually the same two again.
 */
function startFrom(cropYear: number, current: MdiYear | null, previous: MdiYear | null): Draft {
  if (current) return current
  if (!previous) return { crop_year: cropYear }
  // Last year's answers, under this year's number.
  return { ...previous, crop_year: cropYear }
}

function Form({
  cropYear,
  current,
  previous,
  onClose,
}: {
  cropYear: number
  current: MdiYear | null
  previous: MdiYear | null
  onClose: () => void
}) {
  const save = useSaveMdiYear()
  const [d, setD] = useState<Draft>(() => startFrom(cropYear, current, previous))

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  const field = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none'
  const label = 'block text-xs font-medium text-gray-500'

  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  return (
    <Modal title={`Pasture insurance — ${cropYear}`} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(d as Draft, { onSuccess: onClose })
        }}
        className="space-y-4"
      >
        {!current && previous && (
          <p className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-900">
            Started from {previous.crop_year}’s answers. Change what has moved and save.
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">What to insure</h3>
          <HelpNote className="text-xs" summary="Fenced dryland pasture only." title="What MDI covers">
            AFSC pays on the rain recorded at the weather stations you pick, against their normal for the months your option
            weights — not on what your grass actually did. Conditions at a station may not match the field.
          </HelpNote>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {[
              ['insure_native', 'Native pasture'],
              ['insure_improved', 'Improved pasture'],
              ['insure_bush', 'Bush pasture'],
              ['insure_community', 'Community pasture / forestry grazing'],
            ].map(([key, text]) => (
              <label key={key} className="flex min-h-9 items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={!!d[key as keyof Draft]}
                  onChange={(e) => set(key as keyof Draft, e.target.checked as never)}
                  className="h-4 w-4 shrink-0 rounded border-gray-300"
                />
                {text}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-x-3 text-sm font-semibold text-gray-900">
            Weather stations
            <a href={STATION_TOOL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-normal text-brand-700 hover:underline">
              AFSC’s picker <ExternalLink className="h-3 w-3" />
            </a>
            <a href={STATION_NORMALS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-normal text-brand-700 hover:underline">
              2026 normals <ExternalLink className="h-3 w-3" />
            </a>
          </h3>
          <HelpNote className="text-xs" summary="One, two or three. No jumping over one." title="Choosing stations">
            Your payment rate is the average of the stations you pick. You may pick one, two or three, but you cannot skip over a
            nearer station to reach a further one. Pick the ones whose history looks most like the rain this pasture actually gets.
          </HelpNote>
          <div className="grid gap-2 sm:grid-cols-3">
            {([1, 2, 3] as const).map((n) => (
              <label key={n} className={label}>
                Station {n}
                {n > 1 && <span className="font-normal text-gray-400"> (optional)</span>}
                <input
                  value={(d[`station_${n}` as keyof Draft] as string) ?? ''}
                  onChange={(e) => set(`station_${n}` as keyof Draft, (e.target.value || null) as never)}
                  className={field}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2">
          <label className={label}>
            Coverage option
            <select
              value={d.coverage_option ?? ''}
              onChange={(e) => set('coverage_option', (e.target.value || null) as never)}
              className={field}
            >
              <option value="">not chosen</option>
              {COVERAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} — {o.weights}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Price, $ per pound
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={d.price_per_lb ?? ''}
              onChange={(e) => set('price_per_lb', num(e.target.value) as never)}
              className={field}
            />
          </label>
        </section>

        <Fold title="The business, and the number AFSC knows you by" summary="Asked once; only changes when something moves." storageKey="afsc-mdi-standing">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>
              AFSC identification number
              <input
                value={d.identification_number ?? ''}
                onChange={(e) => set('identification_number', (e.target.value || null) as never)}
                placeholder="870…"
                className={field}
              />
              <span className="mt-0.5 block font-normal text-gray-400">The forms print the 870; only the rest is written.</span>
            </label>
            <label className={label}>
              Business name
              <input value={d.business_name ?? ''} onChange={(e) => set('business_name', (e.target.value || null) as never)} className={field} />
            </label>
            <label className={`${label} sm:col-span-2`}>
              Business address
              <input value={d.business_address ?? ''} onChange={(e) => set('business_address', (e.target.value || null) as never)} className={field} />
            </label>
            <label className={label}>
              GST / BN / Trust number
              <input value={d.gst_bn ?? ''} onChange={(e) => set('gst_bn', (e.target.value || null) as never)} className={field} />
            </label>
            <label className={label}>
              Primary contact
              <input value={d.contact_person ?? ''} onChange={(e) => set('contact_person', (e.target.value || null) as never)} className={field} />
            </label>
            <div className="sm:col-span-2">
              <p className={label}>Home quarter</p>
              <div className="mt-1 grid grid-cols-5 gap-1.5">
                {(['home_part', 'home_section', 'home_township', 'home_range', 'home_meridian'] as const).map((k, i) => (
                  <input
                    key={k}
                    value={(d[k] as string) ?? ''}
                    onChange={(e) => set(k, (e.target.value || null) as never)}
                    placeholder={['Part', 'Sec', 'Twp', 'Rge', 'Mer'][i]}
                    aria-label={['Part', 'Section', 'Township', 'Range', 'Meridian'][i]}
                    className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-brand-600 focus:outline-none"
                  />
                ))}
              </div>
            </div>
          </div>
        </Fold>

        <label className={label}>
          Anything to note
          <textarea
            rows={2}
            value={d.notes ?? ''}
            onChange={(e) => set('notes', (e.target.value || null) as never)}
            className={field}
          />
        </label>

        {save.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(save.error as Error).message}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
