import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

type Row = { id: string; name: string; grazed_after_harvest: boolean; open_to_pasture: boolean; never_grazed: boolean; grazing_note: string | null }
type Tick = 'grazed_after_harvest' | 'open_to_pasture' | 'never_grazed'
/**
 * "Open to the pasture" read as nothing in particular (Sam, 3 Nov 2026): it
 * means no fence between the field and the pasture beside it, so it says so.
 */
const TICKS: { key: Tick; label: string; help: string }[] = [
  { key: 'grazed_after_harvest', label: 'Grazed after harvest', help: 'Cattle are turned onto the field once the crop is off.' },
  { key: 'open_to_pasture', label: 'No fence to pasture', help: 'No fence between this field and the pasture beside it, so cattle in that pasture can walk onto it.' },
  { key: 'never_grazed', label: 'Never grazed', help: 'Cattle never go on it (land farmed 50/50 for its owner): no grazing warnings at all.' },
]

/** The note, typed in place and saved when you leave the box. */
function NoteCell({ row, canEdit, onSave }: { row: Row; canEdit: boolean; onSave: (note: string | null) => void }) {
  const [text, setText] = useState(row.grazing_note ?? '')
  if (!canEdit) return <span className="text-gray-500">{row.grazing_note ?? ''}</span>
  const save = () => {
    const v = text.trim() || null
    if (v !== (row.grazing_note ?? null)) onSave(v)
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(row.grazing_note ?? '')
          e.currentTarget.blur()
        }
      }}
      placeholder="Add a note"
      aria-label={`${row.name}: note`}
      className="w-full min-w-[12rem] rounded border border-transparent px-1.5 py-1 text-xs text-gray-700 placeholder:text-gray-300 hover:border-gray-200 focus:border-brand-600 focus:outline-none"
    />
  )
}

/**
 * Which crop fields cattle get onto: grazed once the crop is off, or not
 * fenced off from the pasture around them. Either makes a spray whose label
 * restricts grazing or feeding worth an alert on that field, whatever the
 * crop; only a field with no fence to its pasture counts cattle in that pasture as on it.
 */
export function FieldLivestockAccess({ isManager }: { isManager: boolean }) {
  const qc = useQueryClient()
  const { data: fields } = useQuery({
    queryKey: ['fields', 'livestock_access'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fields')
        .select('id, name, grazed_after_harvest, open_to_pasture, never_grazed, grazing_note')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Row[]
    },
  })
  const set = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Row, Tick | 'grazing_note'>> }) => {
      const { error } = await supabase.from('fields').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fields', 'livestock_access'] })
      void qc.invalidateQueries({ queryKey: ['grazing-restrictions'] })
    },
  })
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('font-medium', CARD_HEAD)}>Cattle on crop fields</h2>
      <div className="px-3 py-2">
        <HelpNote className="text-xs text-gray-600" summary="Tick where cattle get onto a field." title="What the ticks do">
          <ul className="list-disc space-y-1 pl-4">
            {TICKS.map((t) => (
              <li key={t.key}>
                <span className="font-medium">{t.label}:</span> {t.help}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            A field cattle get onto raises an alert when a spray's label restricts grazing or feeding, whatever the crop. Cattle in a pasture count as on a
            field only when there is no fence between them.
          </p>
        </HelpNote>
      </div>
      {/* The green bar runs the tile's full width: the table sits outside the padding. */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TABLE_TH}>Field</th>
              {TICKS.map((t) => (
                <th key={t.key} className={cn(TABLE_TH, 'whitespace-nowrap text-center')} title={t.help}>
                  {t.label}
                </th>
              ))}
              <th className={cn(TABLE_TH, 'w-full')}>Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(fields ?? []).map((f) => (
              <tr key={f.id}>
                <td className="whitespace-nowrap px-3 py-1 text-gray-800">{f.name}</td>
                {TICKS.map(({ key: k, label }) => (
                  <td key={k} className="px-3 py-2.5 text-center sm:py-1">
                    <input
                      type="checkbox"
                      checked={f[k]}
                      disabled={!isManager || set.isPending}
                      onChange={(e) => set.mutate({ id: f.id, patch: { [k]: e.target.checked } })}
                      aria-label={`${f.name}: ${label.toLowerCase()}`}
                      className="h-4 w-4"
                    />
                  </td>
                ))}
                <td className="px-3 py-0.5">
                  <NoteCell key={f.grazing_note ?? ''} row={f} canEdit={isManager} onSave={(note) => set.mutate({ id: f.id, patch: { grazing_note: note } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {set.isError && <p className="px-3 py-2 text-xs text-red-700">{(set.error as Error).message}</p>}
    </section>
  )
}
