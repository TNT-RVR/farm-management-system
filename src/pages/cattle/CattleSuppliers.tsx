import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Package } from 'lucide-react'
import { AddButton, DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useHerdCounts } from '@/lib/cattle'
import type { Database } from '@/lib/database.types'
import { HelpNote } from '@/components/HelpNote'

type Program = Database['public']['Tables']['mineral_programs']['Row']
type Contact = Database['public']['Tables']['contacts']['Row']

function usePrograms() {
  return useQuery({
    queryKey: ['mineral_programs'],
    queryFn: async (): Promise<Program[]> => {
      const { data, error } = await supabase.from('mineral_programs').select('*').order('product')
      if (error) throw error
      return (data ?? []) as Program[]
    },
  })
}

function useCattleContacts() {
  return useQuery({
    queryKey: ['contacts', 'cattle'],
    queryFn: async (): Promise<Contact[]> => {
      const { data, error } = await supabase.from('contacts').select('*').contains('tags', ['cattle']).eq('active', true).order('company')
      if (error) throw error
      return (data ?? []) as Contact[]
    },
  })
}

const money = (v: number, dp = 2) => `$${v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

/**
 * Minerals and vet: who supplies them, how much goes out, and — once a receipt
 * gives the price — what minerals cost a head (Sam, 5 Oct 2026). Prices are
 * blank until the receipts are in.
 */
export function CattleSuppliers({ ranches, isManager }: { ranches: { id: string; name: string }[]; isManager: boolean }) {
  const { data: programs } = usePrograms()
  const { data: contacts } = useCattleContacts()
  const { data: herd } = useHerdCounts('')
  const qc = useQueryClient()
  // Full edit, add and delete (Sam, 7 Oct 2026); the price box stays on the
  // row because a receipt price is the edit made most often.
  const saveProgram = useMutation({
    mutationFn: async ({ id, row }: { id?: string; row: Database['public']['Tables']['mineral_programs']['Insert'] }) => {
      const { error } = id
        ? await supabase.from('mineral_programs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
        : await supabase.from('mineral_programs').insert(row)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mineral_programs'] }),
  })
  const removeProgram = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('mineral_programs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mineral_programs'] }),
  })
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Program | 'new' | null>(null)
  const setPrice = useMutation({
    mutationFn: async ({ id, price }: { id: string; price: number | null }) => {
      const { error } = await supabase.from('mineral_programs').update({ price_each: price, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mineral_programs'] }),
  })
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]))
  // Minerals are put out for the cattle on grass and in the yard; calves at side eat from the cows' tubs.
  const headAt = (ranchId: string) =>
    (herd ?? []).filter((h) => h.ranch_id === ranchId && h.background_head == null).reduce((s, h) => s + h.head_count, 0)
  const vets = (contacts ?? []).filter((c) => c.tags.includes('vet'))
  const mineralSuppliers = (contacts ?? []).filter((c) => c.tags.includes('minerals'))
  const fields: EditField[] = [
    { key: 'ranch_id', label: 'Ranch', kind: 'select', required: true, options: ranches.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'product', label: 'Product', kind: 'text', required: true, placeholder: 'Mineral tubs' },
    { key: 'quantity', label: 'How many', kind: 'number', required: true },
    { key: 'unit', label: 'Counted in', kind: 'text', required: true, placeholder: 'tub' },
    {
      key: 'per',
      label: 'Per',
      kind: 'select',
      required: true,
      options: [
        { value: 'month', label: 'a month' },
        { value: 'season', label: 'a season' },
      ],
    },
    { key: 'when_fed', label: 'When fed', kind: 'text', placeholder: 'Summer, on pasture' },
    {
      key: 'supplier_contact_id',
      label: 'Supplier',
      kind: 'select',
      options: [{ value: '', label: '—' }, ...(mineralSuppliers.length ? mineralSuppliers : (contacts ?? [])).map((c) => ({ value: c.id, label: c.company ?? c.contact_name ?? 'Contact' }))],
    },
    { key: 'price_each', label: 'Price each ($)', kind: 'number', step: '0.01' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Package className="h-4 w-4 text-gray-400" /> Minerals and vet
      </h2>
      <HelpNote className="mt-1 text-xs" summary="Prices wait for the receipts." title="Where these come from">
        <p>Sam, 5 Oct 2026. Type a tub&apos;s price from a receipt and the cost a head works out here. The calves at side are left out of the head: they eat from the cows&apos; tubs.</p>
      </HelpNote>
      {isManager && (
        <div className="mt-2 flex justify-end">
          <AddButton label="Add mineral" onClick={() => setEditing('new')} />
        </div>
      )}
      <ul className="mt-2 divide-y divide-gray-100 text-sm">
        {(programs ?? []).map((p) => {
          const ranch = ranches.find((r) => r.id === p.ranch_id)
          const head = headAt(p.ranch_id)
          const price = p.price_each == null ? null : Number(p.price_each)
          const perHead =
            price != null && head > 0 ? (p.per === 'month' ? (Number(p.quantity) * price) / 30.4 / head : (Number(p.quantity) * price) / head) : null
          return (
            <Fragment key={p.id}>
            <li onClick={rowClick(() => setOpen(open === p.id ? null : p.id))} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-1.5 hover:bg-gray-50">
              <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === p.id && 'rotate-90')} />
              <span className="w-28 font-medium text-gray-800">{ranch?.name ?? 'Ranch'}</span>
              <span className="text-gray-700">{p.product}</span>
              <span className="text-gray-700">
                {Number(p.quantity)} {p.unit}
                {Number(p.quantity) === 1 ? '' : 's'} a {p.per}
                {p.when_fed && <span className="text-gray-500"> · {p.when_fed.toLowerCase()}</span>}
              </span>
              <span className="text-xs text-gray-500">{p.supplier_contact_id ? (byId.get(p.supplier_contact_id)?.company ?? '') : ''}</span>
              <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                $
                <input
                  key={`${p.id}-${p.price_each}`}
                  type="number"
                  step="0.01"
                  disabled={!isManager}
                  defaultValue={price ?? ''}
                  placeholder="—"
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    if (v !== price) setPrice.mutate({ id: p.id, price: v })
                  }}
                  className="w-20 rounded-md border border-gray-200 px-1.5 py-0.5 text-right text-sm tabular-nums disabled:border-transparent"
                />
                a {p.unit}
              </label>
              <span className="w-40 text-right text-xs tabular-nums text-gray-700">
                {perHead == null ? 'price not in yet' : p.per === 'month' ? `${money(perHead, 3)} a head a day` : `${money(perHead)} a head a ${p.per}`}
              </span>
              {isManager && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                  <EditButton onClick={() => setEditing(p)} />
                  <DeleteButton confirm={`Delete the ${p.product.toLowerCase()} programme at ${ranch?.name ?? 'this ranch'}?`} onDelete={() => removeProgram.mutate(p.id)} />
                </span>
              )}
            </li>
            {open === p.id && (
              <li className="bg-gray-50 px-6 py-2">
                <DetailList
                  className="text-xs"
                  rows={[
                    ['Product', p.product],
                    ['Amount', `${Number(p.quantity)} ${p.unit}${Number(p.quantity) === 1 ? '' : 's'} a ${p.per}`],
                    ['When fed', p.when_fed],
                    ['Supplier', p.supplier_contact_id ? (byId.get(p.supplier_contact_id)?.company ?? null) : null],
                    ['Price each', price != null ? money(price) : 'Not in yet'],
                    ['Head it feeds', head ? `${head.toLocaleString('en-CA')} (calves at side left out)` : null],
                    ['Notes', p.notes],
                    ['Last changed', p.updated_at.slice(0, 10)],
                  ]}
                />
              </li>
            )}
            </Fragment>
          )
        })}
        {(programs ?? []).length === 0 && <li className="py-2 text-xs text-gray-400">No mineral programmes recorded.</li>}
      </ul>
      {(saveProgram.error || removeProgram.error) && (
        <p className="mt-1 text-xs text-red-600">{((saveProgram.error ?? removeProgram.error) as Error).message}</p>
      )}
      {editing && (
        <RecordEditModal
          title={editing === 'new' ? 'Add a mineral programme' : `Edit ${editing.product}`}
          fields={fields}
          row={editing === 'new' ? { ranch_id: ranches[0]?.id ?? '', product: 'Mineral tubs', unit: 'tub', per: 'month' } : editing}
          saving={saveProgram.isPending}
          error={saveProgram.error ? (saveProgram.error as Error).message : null}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => removeProgram.mutateAsync(editing.id)}
          deleteConfirm={editing === 'new' ? undefined : `Delete the ${editing.product.toLowerCase()} programme?`}
          onSave={(v) =>
            saveProgram.mutateAsync({
              id: editing === 'new' ? undefined : editing.id,
              row: {
                ranch_id: v.ranch_id as string,
                product: String(v.product).trim(),
                quantity: Number(v.quantity ?? 0),
                unit: String(v.unit).trim(),
                per: v.per as Program['per'],
                when_fed: v.when_fed as string | null,
                supplier_contact_id: (v.supplier_contact_id as string | null) || null,
                price_each: v.price_each as number | null,
                notes: v.notes as string | null,
              },
            })
          }
        />
      )}
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <p className="font-semibold text-gray-700">Mineral suppliers</p>
          {mineralSuppliers.map((c) => (
            <p key={c.id} className="text-gray-600">
              {c.company}
              {c.address && <span className="text-gray-400"> · {c.address}</span>}
              {c.notes_md && <span className="block text-[11px] text-gray-400">{c.notes_md}</span>}
            </p>
          ))}
        </div>
        <div>
          <p className="font-semibold text-gray-700">Vet</p>
          {vets.map((c) => (
            <p key={c.id} className="text-gray-600">
              {c.company}
              {c.contact_name && ` (${c.contact_name})`}
              {c.address && <span className="text-gray-400"> · {c.address}</span>}
              {c.notes_md && <span className="block text-[11px] text-gray-400">{c.notes_md}</span>}
            </p>
          ))}
          {vets.length === 0 && <p className="text-gray-400">None recorded.</p>}
        </div>
      </div>
    </section>
  )
}
