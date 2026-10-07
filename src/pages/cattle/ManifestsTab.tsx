import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, Plus, Printer, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { ConfirmDialog } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { useHerdCounts } from '@/lib/cattle'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import {
  PURPOSES,
  missingFor,
  totalHead,
  useManifestMutations,
  useManifests,
  type ManifestLine,
  type ManifestWithLines,
} from '@/lib/manifests'
import type { Database } from '@/lib/database.types'
import { ManifestPrint } from '@/pages/cattle/ManifestPrint'

type ManifestInsert = Database['public']['Tables']['cattle_manifests']['Insert']
type ManifestLineInsert = Omit<
  Database['public']['Tables']['cattle_manifest_lines']['Insert'],
  'manifest_id'
>

type Draft = Record<string, string>
type LineDraft = Partial<Record<keyof ManifestLine, string>>

function useRanches() {
  return useQuery({
    queryKey: ['ranches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ranches').select('*').order('sort_order')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Put the origin details on the ranch, so they fill themselves next time.
 *
 * Only what was actually typed: a blank box must not wipe a brand that is
 * already recorded.
 */
function useRememberRanchDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ranchId, from }: { ranchId: string; from: ManifestInsert }) => {
      // A plain string map, narrowed on the way out: the generated Update type
      // makes every key optional, so indexing it by a variable resolves to
      // `undefined` and refuses the assignment.
      const patch: Record<string, string> = {}
      const pairs: [keyof ManifestInsert, string][] = [
        ['owner_name', 'owner_name'],
        ['owner_phone', 'owner_phone'],
        ['origin_address', 'address'],
        ['origin_premises_id', 'premises_id'],
        ['brand', 'brand'],
        ['brand_location', 'brand_location'],
      ]
      for (const [src, dest] of pairs) {
        const v = from[src]
        if (typeof v === 'string' && v.trim()) patch[dest] = v.trim()
      }
      if (!Object.keys(patch).length) return
      const { error } = await supabase
        .from('ranches')
        .update(patch as Database['public']['Tables']['ranches']['Update'])
        .eq('id', ranchId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ranches'] }),
  })
}

function useBuyers() {
  return useQuery({
    queryKey: ['contacts', 'manifest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('active', true)
        .order('company')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * The paperwork that moves cattle off the place.
 *
 * An Alberta manifest asks the same questions every time — who owns them,
 * where they left, where they are going, what is on the truck, who is hauling
 * it — and the farm already knows most of the answers. Picking the ranch fills
 * the owner, the address, the premises ID and the brand; picking a buyer fills
 * the destination; the herd counts propose the lines.
 *
 * Not the official Livestock Identification Services form. Where a numbered LIS
 * manifest is required this is what goes on it, and the number is a field here
 * so the two tie together.
 */
export function ManifestsTab({ cropYear, canEdit }: { cropYear: number; canEdit: boolean }) {
  const { data: manifests, isLoading } = useManifests(cropYear)
  const { data: ranches } = useRanches()
  const { data: buyers } = useBuyers()
  const { save, remove, saveLines } = useManifestMutations()
  const rememberRanch = useRememberRanchDetails()
  const [open, setOpen] = useState<string | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ManifestWithLines | null>(null)

  /**
   * Which manifest is being printed.
   *
   * Printing the page would give every manifest of the year plus whatever else
   * is on screen; a manifest is a single sheet handed to a driver. The chosen
   * one is rendered into a print-only block and everything else is hidden for
   * the length of the print.
   */
  const [printing, setPrinting] = useState<ManifestWithLines | null>(null)
  useEffect(() => {
    if (!printing) return
    // Painted before the dialog opens, otherwise the browser captures the page
    // as it was a frame ago — which is the page without the print block on it.
    const id = requestAnimationFrame(() => window.print())
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="space-y-4">
      {printing && (
        <div className="hidden print:block">
          <ManifestPrint manifest={printing} />
        </div>
      )}
      <div className={cn('space-y-4', printing && 'print:hidden')}>
        <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
          <HelpNote
            className="max-w-2xl text-xs"
            summary="Pick the ranch and the buyer and most of it fills itself."
            title="About manifests"
          >
            <p>
              What goes on a manifest when cattle leave. Pick the ranch and the buyer and most of it
              fills itself; the rest is the load and the truck. This is the farm&rsquo;s record —
              where a numbered LIS manifest is required, put its number in the box so the two tie
              together.
            </p>
          </HelpNote>
          {canEdit && (
            <button
              onClick={() => setOpen('new')}
              className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> New manifest
            </button>
          )}
        </div>

        {open && (
          <ManifestForm
            key={open}
            cropYear={cropYear}
            existing={
              open === 'new' ? null : ((manifests ?? []).find((m) => m.id === open) ?? null)
            }
            ranches={ranches ?? []}
            buyers={buyers ?? []}
            onClose={() => setOpen(null)}
            onSave={async (row, lines, rememberOn) => {
              const id = await save.mutateAsync(row)
              await saveLines.mutateAsync({ manifestId: id, lines })
              if (rememberOn) await rememberRanch.mutateAsync({ ranchId: rememberOn, from: row })
              setOpen(null)
            }}
            saving={save.isPending || saveLines.isPending}
          />
        )}

        {!manifests?.length ? (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
            No manifests for {cropYear}.
          </p>
        ) : (
          manifests.map((m) => {
            const gaps = missingFor(m, m.lines)
            return (
              <section
                key={m.id}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white print:break-inside-avoid"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-brand-700" />
                  <span className="font-semibold text-gray-900">
                    {m.moved_on} · {totalHead(m.lines)} head
                  </span>
                  <span className="text-sm text-gray-600">
                    {m.destination_name ?? 'destination not set'}
                    {m.manifest_no ? ` · manifest ${m.manifest_no}` : ''}
                  </span>
                  {gaps.length > 0 && (
                    <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                      <AlertTriangle className="h-3 w-3" /> {gaps.length} to fill
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 print:hidden">
                    <button
                      onClick={() => setPrinting(m)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Print"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => setOpen(m.id)}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDelete(m)}
                          className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </span>
                </div>

                <div className="grid gap-3 px-3 py-2 text-sm sm:grid-cols-2">
                  <Block
                    title="From"
                    rows={[
                      ['Owner', m.owner_name],
                      ['Phone', m.owner_phone],
                      ['Address', m.origin_address],
                      ['Premises ID', m.origin_premises_id],
                      ['Brand', [m.brand, m.brand_location].filter(Boolean).join(' — ')],
                    ]}
                  />
                  <Block
                    title="To"
                    rows={[
                      ['Destination', m.destination_name],
                      ['Phone', m.destination_phone],
                      ['Address', m.destination_address],
                      ['Premises ID', m.destination_premises_id],
                      ['Purpose', PURPOSES.find((p) => p.value === m.purpose)?.label ?? null],
                    ]}
                  />
                  <Block
                    title="Hauled by"
                    rows={[
                      ['Transporter', m.transporter_name],
                      ['Driver', m.driver_name],
                      ['Plate', m.licence_plate],
                      ['Phone', m.transporter_phone],
                    ]}
                  />
                  <Block
                    title="Signed"
                    rows={[
                      ['By', m.signed_by],
                      ['On', m.signed_on],
                      ['Notes', m.notes],
                    ]}
                  />
                </div>

                {m.lines.length > 0 && (
                  <div className="overflow-x-auto border-t border-gray-100 px-3 py-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="pb-1 pr-3 font-medium">Class</th>
                          <th className="pb-1 pr-3 text-right font-medium">Head</th>
                          <th className="pb-1 pr-3 font-medium">Sex</th>
                          <th className="pb-1 pr-3 font-medium">Colour</th>
                          <th className="pb-1 pr-3 text-right font-medium">Avg lb</th>
                          <th className="pb-1 pr-3 font-medium">Brand</th>
                          <th className="pb-1 font-medium">Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.lines.map((l) => (
                          <tr key={l.id} className="border-t border-gray-100">
                            <td className="py-1 pr-3 capitalize">{l.animal_class ?? '—'}</td>
                            <td className="py-1 pr-3 text-right font-medium tabular-nums">
                              {l.head ?? '—'}
                            </td>
                            <td className="py-1 pr-3 text-gray-600">{l.sex ?? '—'}</td>
                            <td className="py-1 pr-3 text-gray-600">{l.colour ?? '—'}</td>
                            <td className="py-1 pr-3 text-right tabular-nums text-gray-600">
                              {l.avg_weight_lb ?? '—'}
                            </td>
                            <td className="py-1 pr-3 text-gray-600">{l.brand ?? '—'}</td>
                            <td className="py-1 text-gray-600">{l.tag_range ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {gaps.length > 0 && (
                  <p className="border-t border-gray-100 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:hidden">
                    Still to fill: {gaps.map((g) => `${g.field} (${g.why})`).join('; ')}.
                  </p>
                )}
              </section>
            )
          })
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this manifest?"
          message="The record and its livestock lines both go."
          onConfirm={() => {
            remove.mutate(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function Block({ title, rows }: { title: string; rows: [string, string | null][] }) {
  const shown = rows.filter(([, v]) => v)
  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
      {shown.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing recorded.</p>
      ) : (
        <dl className="mt-0.5 space-y-0.5">
          {shown.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-24 shrink-0 text-xs text-gray-500">{k}</dt>
              <dd className="min-w-0 flex-1 text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

const CLASSES = ['steers', 'heifers', 'cows', 'bulls', 'calves', 'yearlings']

function ManifestForm({
  cropYear,
  existing,
  ranches,
  buyers,
  onClose,
  onSave,
  saving,
}: {
  cropYear: number
  existing: ManifestWithLines | null
  ranches: { id: string; name: string; [k: string]: unknown }[]
  buyers: {
    id: string
    company: string | null
    contact_name: string | null
    [k: string]: unknown
  }[]
  onClose: () => void
  onSave: (
    row: ManifestInsert,
    lines: ManifestLineInsert[],
    /** Ranch to write the origin details back to, or null to leave it alone. */
    rememberOn: string | null,
  ) => Promise<void> | void
  saving: boolean
}) {
  const [d, setD] = useState<Draft>(() => {
    const base: Draft = {
      moved_on: existing?.moved_on ?? new Date().toISOString().slice(0, 10),
    }
    if (!existing) return base
    for (const [k, v] of Object.entries(existing)) {
      if (k === 'lines' || v == null) continue
      base[k] = String(v)
    }
    return base
  })
  // Writing the owner, address, premises ID and brand back onto the ranch, so
  // the next manifest fills itself. Offered rather than done: these are facts
  // about a place and somebody should say so on purpose the first time.
  const [remember, setRemember] = useState(false)

  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      existing?.lines.map((l) => ({
        animal_class: l.animal_class ?? '',
        head: l.head == null ? '' : String(l.head),
        sex: l.sex ?? '',
        colour: l.colour ?? '',
        avg_weight_lb: l.avg_weight_lb == null ? '' : String(l.avg_weight_lb),
        brand: l.brand ?? '',
        tag_range: l.tag_range ?? '',
      })) ?? [{}],
  )
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }))
  const { data: herd } = useHerdCounts(d.ranch_id ?? '')

  /** Picking the ranch fills everything that belongs to the place. */
  const pickRanch = (id: string) => {
    const r = ranches.find((x) => x.id === id)
    setD((x) => ({
      ...x,
      ranch_id: id,
      // Only fills what is empty, so an edited manifest is not overwritten by
      // re-selecting the ranch it already came from.
      owner_name: x.owner_name || (r?.owner_name as string) || '',
      owner_phone: x.owner_phone || (r?.owner_phone as string) || '',
      origin_address: x.origin_address || (r?.address as string) || '',
      origin_premises_id: x.origin_premises_id || (r?.premises_id as string) || '',
      brand: x.brand || (r?.brand as string) || '',
      brand_location: x.brand_location || (r?.brand_location as string) || '',
    }))
  }

  const pickBuyer = (id: string) => {
    const b = buyers.find((x) => x.id === id)
    setD((x) => ({
      ...x,
      destination_contact_id: id,
      destination_name: b?.company || b?.contact_name || x.destination_name || '',
      destination_phone: (b?.phone as string) || x.destination_phone || '',
      destination_address: (b?.address as string) || x.destination_address || '',
    }))
  }

  /** The herd counts, as a starting set of lines to cut down. */
  const fillFromHerd = () => {
    if (!herd?.length) return
    setLines(
      herd
        .filter((h) => h.head_count > 0)
        .map((h) => ({
          animal_class: h.class_name.toLowerCase(),
          head: String(h.head_count),
          brand: d.brand ?? '',
        })),
    )
  }

  const num = (v: string | undefined) => {
    const s = (v ?? '').trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  const cleanLines = lines
    .filter((l) => (l.animal_class ?? '').trim() || num(l.head) != null)
    .map((l) => ({
      animal_class: (l.animal_class ?? '').trim() || null,
      head: num(l.head),
      sex: (l.sex ?? '').trim() || null,
      colour: (l.colour ?? '').trim() || null,
      avg_weight_lb: num(l.avg_weight_lb),
      brand: (l.brand ?? '').trim() || null,
      tag_range: (l.tag_range ?? '').trim() || null,
    }))

  const gaps = missingFor(
    {
      ...(d as unknown as Record<string, string>),
      moved_on: d.moved_on,
    } as never,
    cleanLines,
  )

  const text = (k: string, label: string, placeholder?: string) => (
    <label className="text-[11px] font-medium text-gray-500">
      {label}
      <input
        value={d[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  )

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3 print:hidden">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">
        {existing ? 'Edit manifest' : `New manifest — ${cropYear}`}
      </h3>

      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-[11px] font-medium text-gray-500">
          Date moved
          <input
            type="date"
            value={d.moved_on ?? ''}
            onChange={(e) => set('moved_on', e.target.value)}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        {text('manifest_no', 'LIS manifest #', 'off the book')}
        <label className="text-[11px] font-medium text-gray-500">
          Cattle left
          <Select
            value={d.ranch_id ?? ''}
            ariaLabel="Ranch"
            size="sm"
            className="mt-0.5"
            onChange={pickRanch}
            options={[
              { value: '', label: '—' },
              ...ranches.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Purpose
          <Select
            value={d.purpose ?? ''}
            ariaLabel="Purpose"
            size="sm"
            className="mt-0.5"
            onChange={(v) => set('purpose', v)}
            options={[{ value: '', label: '—' }, ...PURPOSES]}
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">From</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {text('owner_name', 'Owner')}
        {text('owner_phone', 'Phone')}
        {text('origin_premises_id', 'Premises ID')}
        {text('origin_address', 'Address')}
        {text('brand', 'Brand')}
        {text('brand_location', 'Brand location', 'left rib')}
      </div>

      {d.ranch_id && (
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember the owner, address, premises ID and brand for{' '}
          {ranches.find((r) => r.id === d.ranch_id)?.name ?? 'this ranch'}, so the next manifest
          fills itself
        </label>
      )}

      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">To</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[11px] font-medium text-gray-500">
          From contacts
          <Select
            value={d.destination_contact_id ?? ''}
            ariaLabel="Destination contact"
            size="sm"
            className="mt-0.5"
            onChange={pickBuyer}
            options={[
              { value: '', label: '—' },
              ...buyers.map((b) => ({
                value: b.id,
                label: b.company || b.contact_name || 'Unnamed',
              })),
            ]}
          />
        </label>
        {text('destination_name', 'Destination')}
        {text('destination_phone', 'Phone')}
        {text('destination_address', 'Address')}
        {text('destination_premises_id', 'Premises ID')}
      </div>

      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Hauled by
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        {text('transporter_name', 'Transporter')}
        {text('driver_name', 'Driver')}
        {text('licence_plate', 'Plate')}
        {text('transporter_phone', 'Phone')}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          On the truck
        </p>
        {d.ranch_id && (herd?.length ?? 0) > 0 && (
          <button
            onClick={fillFromHerd}
            className="text-[11px] font-medium text-brand-700 hover:underline"
          >
            Start from the herd counts
          </button>
        )}
        <button
          onClick={() => setLines((l) => [...l, {}])}
          className="ml-auto text-[11px] font-medium text-brand-700 hover:underline"
        >
          + Add a line
        </button>
      </div>

      <div className="mt-1 space-y-1">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-1.5">
            <label className="text-[10px] text-gray-500">
              Class
              <Select
                value={l.animal_class ?? ''}
                ariaLabel="Class"
                size="sm"
                className="mt-0.5 w-28"
                onChange={(v) =>
                  setLines((xs) => xs.map((x, j) => (j === i ? { ...x, animal_class: v } : x)))
                }
                options={[
                  { value: '', label: '—' },
                  ...CLASSES.map((c) => ({ value: c, label: c })),
                ]}
              />
            </label>
            {(
              [
                ['head', 'Head', 'w-16'],
                ['sex', 'Sex', 'w-16'],
                ['colour', 'Colour', 'w-24'],
                ['avg_weight_lb', 'Avg lb', 'w-20'],
                ['brand', 'Brand', 'w-20'],
                ['tag_range', 'Tags', 'w-36'],
              ] as const
            ).map(([k, label, w]) => (
              <label key={k} className="text-[10px] text-gray-500">
                {label}
                <input
                  value={(l[k] as string) ?? ''}
                  onChange={(e) =>
                    setLines((xs) =>
                      xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                    )
                  }
                  className={cn(
                    'mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm',
                    w,
                  )}
                />
              </label>
            ))}
            <button
              onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}
              className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {text('signed_by', 'Signed by')}
        <label className="text-[11px] font-medium text-gray-500">
          Signed on
          <input
            type="date"
            value={d.signed_on ?? ''}
            onChange={(e) => set('signed_on', e.target.value)}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        {text('notes', 'Notes')}
      </div>

      {gaps.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          Still to fill: {gaps.map((g) => g.field).join(', ')}. It saves either way — a manifest
          being put together over two days is normal.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          disabled={saving}
          onClick={() => {
            const row: ManifestInsert = {
              ...(existing ? { id: existing.id } : {}),
              crop_year: cropYear,
              moved_on: d.moved_on || new Date().toISOString().slice(0, 10),
            }
            for (const k of [
              'manifest_no',
              'ranch_id',
              'owner_name',
              'owner_phone',
              'origin_address',
              'origin_premises_id',
              'brand',
              'brand_location',
              'destination_contact_id',
              'destination_name',
              'destination_address',
              'destination_phone',
              'destination_premises_id',
              'purpose',
              'transporter_name',
              'transporter_phone',
              'licence_plate',
              'driver_name',
              'signed_by',
              'signed_on',
              'notes',
            ]) {
              ;(row as Record<string, unknown>)[k] = (d[k] ?? '').trim() || null
            }
            void onSave(row, cleanLines, remember ? (d.ranch_id ?? null) : null)
          }}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save manifest'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
