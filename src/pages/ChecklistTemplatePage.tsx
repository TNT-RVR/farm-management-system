import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  CATEGORIES,
  useEquipment,
  useTemplateItems,
  useTemplates,
  type ChecklistCategory,
  type TemplateItemRow,
} from '@/lib/checklists'
import { useUsers } from '@/lib/queries'
import { TemplatePlaces } from './checklists/TemplatePlaces'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function ChecklistTemplatePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: templates } = useTemplates()
  const { data: allItems } = useTemplateItems(id)
  // Jobs tied to a place are edited on the map below; this list is the rest.
  const items = allItems?.filter((i) => !i.location_id)
  const { data: equipment } = useEquipment()
  const { data: users } = useUsers()

  const template = templates?.find((t) => t.id === id)
  const readonly = !hasManagerAccess(profile?.role)
  const [newItem, setNewItem] = useState('')

  const invalidateTpl = () =>
    void queryClient.invalidateQueries({ queryKey: ['checklist_templates'] })
  const invalidateItems = () =>
    void queryClient.invalidateQueries({ queryKey: ['checklist_template_items', id] })

  const patchTemplate = useMutation({
    mutationFn: async (patch: Database_Update) => {
      const { error } = await supabase.from('checklist_templates').update(patch).eq('id', id!)
      if (error) throw error
    },
    onSuccess: invalidateTpl,
  })

  const addItem = useMutation({
    mutationFn: async (text: string) => {
      const nextOrder = (items?.at(-1)?.sort_order ?? 0) + 1
      const { error } = await supabase
        .from('checklist_template_items')
        .insert({ template_id: id!, text, sort_order: nextOrder })
      if (error) throw error
    },
    onSuccess: () => {
      setNewItem('')
      invalidateItems()
    },
  })

  const patchItem = useMutation({
    mutationFn: async ({ itemId, patch }: { itemId: string; patch: Partial<TemplateItemRow> }) => {
      const { error } = await supabase.from('checklist_template_items').update(patch).eq('id', itemId)
      if (error) throw error
    },
    onSuccess: invalidateItems,
  })

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('checklist_template_items').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: invalidateItems,
  })

  const removeTemplate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('checklist_templates').delete().eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateTpl()
      navigate('/checklists')
    },
  })

  if (!template) {
    return (
      <div className="p-6 text-sm text-gray-500">{templates ? 'Not found.' : 'Loading…'}</div>
    )
  }

  return (
    <div className={template.map_based ? 'mx-auto max-w-6xl p-4 md:p-6' : 'mx-auto max-w-2xl p-4 md:p-6'}>
      <Link
        to="/checklists"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" /> Checklists
      </Link>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <input
          disabled={readonly}
          defaultValue={template.name}
          onBlur={(e) => {
            if (e.target.value !== template.name) patchTemplate.mutate({ name: e.target.value })
          }}
          className="w-full text-xl font-bold text-gray-900 focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-xs text-gray-500">
            Category
            <Select
              disabled={readonly}
              value={template.category}
              ariaLabel="Category"
              className="mt-1"
              onChange={(v) => patchTemplate.mutate({ category: v as ChecklistCategory })}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </label>
          <label className="text-xs text-gray-500">
            Equipment
            <Select
              disabled={readonly}
              value={template.equipment_id ?? ''}
              ariaLabel="Equipment"
              className="mt-1"
              onChange={(v) => patchTemplate.mutate({ equipment_id: v || null })}
              options={[
                { value: '', label: '—' },
                ...(equipment ?? []).map((eq) => ({ value: eq.id, label: eq.name })),
              ]}
            />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              disabled={readonly}
              checked={template.active}
              onChange={(e) => patchTemplate.mutate({ active: e.target.checked })}
            />
            Active
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-gray-500" title="Opens as a map of places, each with its own jobs, photos and instructions">
            <input
              type="checkbox"
              disabled={readonly}
              checked={template.map_based}
              onChange={(e) => patchTemplate.mutate({ map_based: e.target.checked })}
            />
            Map checklist
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-gray-500" title="A fresh copy every year in the month below; last year's stays as a record">
            <input
              type="checkbox"
              disabled={readonly}
              checked={template.yearly}
              onChange={(e) => patchTemplate.mutate({ yearly: e.target.checked })}
            />
            New copy every year
          </label>
        </div>
        {template.yearly && (
          <div className="mt-3 flex flex-wrap items-start gap-4 rounded-md bg-gray-50 p-3">
            <label className="text-xs text-gray-500">
              Starts each year on the 1st of
              <Select
                disabled={readonly}
                value={String(template.start_month ?? 1)}
                ariaLabel="Start month"
                className="mt-1"
                onChange={(v) => patchTemplate.mutate({ start_month: Number(v) === 1 ? null : Number(v) })}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              />
            </label>
            <label className="flex items-end gap-2 self-end pb-1.5 text-xs text-gray-500" title="The due date follows the forecast: the first night at −8 °C or colder, or a day that stays below 0 °C. Its people and the managers get an alert if it isn't finished.">
              <input
                type="checkbox"
                disabled={readonly}
                checked={template.due_on_freeze}
                onChange={(e) => patchTemplate.mutate({ due_on_freeze: e.target.checked })}
              />
              Due before the first hard freeze
            </label>
            <div className="min-w-0 flex-1 text-xs text-gray-500">
              Assign each year to
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {(users ?? []).map((u) => (
                  <label key={u.id} className="flex items-center gap-1.5 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      disabled={readonly}
                      checked={template.default_assignees.includes(u.id)}
                      onChange={(e) =>
                        patchTemplate.mutate({
                          default_assignees: e.target.checked
                            ? [...template.default_assignees, u.id]
                            : template.default_assignees.filter((x) => x !== u.id),
                        })
                      }
                    />
                    {u.full_name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {template.description_md && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {template.description_md}
          </p>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">{template.map_based ? 'General jobs (not tied to a place)' : 'Items'}</h3>
        <ul className="mt-2 divide-y divide-gray-100">
          {items?.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
              <input
                disabled={readonly}
                defaultValue={item.text}
                onBlur={(e) => {
                  if (e.target.value !== item.text)
                    patchItem.mutate({ itemId: item.id, patch: { text: e.target.value } })
                }}
                className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:border-brand-600 focus:outline-none"
              />
              <label
                className="flex shrink-0 items-center gap-1 text-xs text-gray-400"
                title="Requires a note when checked"
              >
                <input
                  type="checkbox"
                  disabled={readonly}
                  checked={item.requires_note}
                  onChange={(e) =>
                    patchItem.mutate({ itemId: item.id, patch: { requires_note: e.target.checked } })
                  }
                />
                note
              </label>
              {!readonly && (
                <button
                  onClick={() => removeItem.mutate(item.id)}
                  className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${item.text}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
          {items?.length === 0 && <li className="py-2 text-sm text-gray-400">No items yet.</li>}
        </ul>

        {!readonly && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newItem.trim()) addItem.mutate(newItem.trim())
            }}
            className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3"
          >
            <input
              placeholder="Add item…"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={!newItem.trim() || addItem.isPending}
              className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>
        )}
      </div>

      {template.map_based && <TemplatePlaces templateId={template.id} readonly={readonly} />}

      {!readonly && (
        <button
          onClick={() => {
            if (confirm(`Delete the “${template.name}” template? Past runs are kept.`))
              removeTemplate.mutate()
          }}
          className="mt-4 flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Delete template
        </button>
      )}
    </div>
  )
}

type Database_Update = {
  name?: string
  category?: ChecklistCategory
  equipment_id?: string | null
  active?: boolean
  description_md?: string | null
  map_based?: boolean
  yearly?: boolean
  default_assignees?: string[]
  start_month?: number | null
  due_on_freeze?: boolean
}
