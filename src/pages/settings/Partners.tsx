import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Plus, UserPlus, X } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { Select } from '@/components/Select'
import { hasAdminAccess, inviteUser, useAuth } from '@/lib/auth'
import { PARTNER_PAGE_LABELS, PARTNER_PRESETS, isPartnerPath, type PartnerAccess } from '@/lib/partner'
import { usePartnerPreviewControls } from '@/lib/partner-view'
import { useCrops } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { TILES } from '@/lib/tiles'
import { CompanyFields } from '@/pages/settings/PartnerFields'

/**
 * Settings → Users & access → Partners (docs/partners.md, step 3): each
 * partner company, its people, and what it is given of ours. The database
 * holds every one of these (partner_fields, partner_crops, partner_access);
 * this page only sets them.
 */

type Company = { id: string; name: string; preset: string; views: Record<string, boolean>; extras: string[] }
type Person = { id: string; email: string; full_name: string; active: boolean; partner_admin: boolean; farm_id: string | null }

const card = 'max-w-3xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm'
const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm'
const button = 'inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

const EXTRAS = [
  { key: 'rotation', label: 'Our whole rotation', hint: 'Every one of our fields in the rotation, read-only.' },
  { key: 'contracts', label: 'Our contracts', hint: 'Our contracts and scale tickets for the shared crops, read-only.' },
]

function useCompanies() {
  return useQuery({
    queryKey: ['partner_companies'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('partner_companies')
      if (error) throw error
      return (data ?? []).map((c) => ({ ...c, views: (c.views ?? {}) as Record<string, boolean> })) as Company[]
    },
  })
}

function usePartnerPeople() {
  return useQuery({
    queryKey: ['users', 'partners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, active, partner_admin, farm_id')
        .eq('role', 'partner')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Person[]
    },
  })
}

export function PartnersAdmin() {
  const qc = useQueryClient()
  const { data: companies, error } = useCompanies()
  const { data: people } = usePartnerPeople()
  const [name, setName] = useState('')
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('add_partner_company', { p_name: name.trim() })
      if (error) throw error
    },
    onSuccess: () => {
      setName('')
      void qc.invalidateQueries({ queryKey: ['partner_companies'] })
    },
  })
  const loose = (people ?? []).filter((p) => !p.farm_id)

  return (
    <div className="mt-4 space-y-4">
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {(companies ?? []).map((c) => (
        <CompanyCard key={c.id} company={c} people={(people ?? []).filter((p) => p.farm_id === c.id)} />
      ))}
      {companies?.length === 0 && <p className="text-sm text-gray-500">No partner companies yet.</p>}
      {loose.length > 0 && (
        <p className="text-xs text-gray-500">
          Partner accounts in no company, so they see nothing: {loose.map((p) => p.full_name || p.email).join(', ')}.
        </p>
      )}
      <form
        className="flex max-w-3xl items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) add.mutate()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" aria-label="New company name" className={input} />
        <button type="submit" disabled={!name.trim() || add.isPending} className={button}>
          <Plus className="h-3.5 w-3.5" /> Add company
        </button>
        {add.isError && <span className="text-xs text-red-600">{(add.error as Error).message}</span>}
      </form>
    </div>
  )
}

function CompanyCard({ company, people }: { company: Company; people: Person[] }) {
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: async (p_name: string) => {
      const { error } = await supabase.rpc('rename_partner_company', { p_id: company.id, p_name })
      if (error) throw error
    },
    onSuccess: () => {
      setRenaming(null)
      void qc.invalidateQueries({ queryKey: ['partner_companies'] })
    },
  })
  // Extras, preset and ticks: one row per company.
  const save = useMutation({
    mutationFn: async (changes: { preset?: string; views?: Record<string, boolean>; extras?: string[] }) => {
      const { error } = await supabase
        .from('partner_access')
        .upsert({ farm_id: company.id, ...changes, updated_at: new Date().toISOString() }, { onConflict: 'farm_id' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['partner_companies'] }),
  })

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        {renaming == null ? (
          <>
            <h2 className="text-base font-semibold text-gray-900">{company.name}</h2>
            <button onClick={() => setRenaming(company.name)} className="text-xs text-gray-500 hover:underline">
              Rename
            </button>
          </>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming.trim()) rename.mutate(renaming.trim())
            }}
          >
            <input value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Company name" className={input} autoFocus />
            <button type="submit" disabled={rename.isPending} className={button}>Save</button>
            <button type="button" onClick={() => setRenaming(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
          </form>
        )}
      </div>
      {(rename.isError || save.isError) && <p className="mt-1 text-xs text-red-600">{((rename.error ?? save.error) as Error).message}</p>}

      <div className="mt-3 space-y-4">
        <CompanyPeople companyId={company.id} people={people} />
        <CompanyFields farmId={company.id} />
        <CompanyCrops companyId={company.id} />

        <div>
          <h3 className="text-sm font-semibold text-gray-700">Also sees</h3>
          <div className="mt-1 space-y-1">
            {EXTRAS.map((x) => (
              <label key={x.key} className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={company.extras.includes(x.key)}
                  disabled={save.isPending}
                  onChange={(e) =>
                    save.mutate({ extras: e.target.checked ? [...company.extras, x.key] : company.extras.filter((k) => k !== x.key) })
                  }
                />
                <span>
                  {x.label} <span className="text-xs text-gray-500">{x.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Fold title="Screens" summary={PARTNER_PRESETS[company.preset]?.label ?? company.preset}>
          <CompanyViews company={company} saving={save.isPending} onSave={(changes) => save.mutate(changes)} />
        </Fold>
      </div>
    </section>
  )
}

function CompanyPeople({ companyId, people }: { companyId: string; people: Person[] }) {
  const qc = useQueryClient()
  const admin = hasAdminAccess(useAuth().profile?.role)
  const preview = usePartnerPreviewControls()
  const [email, setEmail] = useState('')
  const [runs, setRuns] = useState(people.length === 0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const invite = useMutation({
    mutationFn: () => inviteUser(email.trim(), 'partner', { farm_id: companyId, partner_admin: runs }),
    onSuccess: () => {
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">People</h3>
      <ul className="mt-1 space-y-1">
        {people.length === 0 && <li className="text-xs text-gray-400">No one yet.</li>}
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
            {p.full_name || p.email}
            <span className="text-xs text-gray-500">{p.email}</span>
            {p.partner_admin && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">Runs the company</span>}
            {!p.active && <span className="text-xs text-amber-700">Off</span>}
            {admin && (
              <button
                onClick={() => {
                  setPreviewError(null)
                  preview.start(p).catch((e: Error) => setPreviewError(e.message))
                }}
                className={`${button} ml-auto`}
                title="See the app as they see it, in this window"
              >
                <Eye className="h-3.5 w-3.5" /> View as
              </button>
            )}
          </li>
        ))}
      </ul>
      {previewError && <p className="mt-1 text-xs text-red-600">{previewError}</p>}
      {admin && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) invite.mutate()
          }}
        >
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email to invite" className={`${input} w-56`} />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={runs} onChange={(e) => setRuns(e.target.checked)} />
            Runs the company
          </label>
          <button type="submit" disabled={!email.trim() || invite.isPending} className={button}>
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </button>
          {invite.isSuccess && <span className="text-xs text-brand-700">Invite sent.</span>}
          {invite.isError && <span className="text-xs text-red-600">{(invite.error as Error).message}</span>}
        </form>
      )}
    </div>
  )
}

function CompanyCrops({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const { data: crops } = useCrops()
  const key = ['partner_crops', 'admin', companyId]
  const { data: shared } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from('partner_crops').select('crop_id, can_edit').eq('farm_id', companyId)
      if (error) throw error
      return data ?? []
    },
  })
  const done = () => void qc.invalidateQueries({ queryKey: ['partner_crops'] })
  const add = useMutation({
    mutationFn: async (crop_id: string) => {
      const { error } = await supabase.from('partner_crops').insert({ farm_id: companyId, crop_id, can_edit: true })
      if (error) throw error
    },
    onSuccess: done,
  })
  const setEdit = useMutation({
    mutationFn: async (v: { crop_id: string; can_edit: boolean }) => {
      const { error } = await supabase.from('partner_crops').update({ can_edit: v.can_edit }).eq('farm_id', companyId).eq('crop_id', v.crop_id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async (crop_id: string) => {
      const { error } = await supabase.from('partner_crops').delete().eq('farm_id', companyId).eq('crop_id', crop_id)
      if (error) throw error
    },
    onSuccess: done,
  })
  const name = useMemo(() => new Map((crops ?? []).map((c) => [c.id, c.name])), [crops])
  const have = new Set((shared ?? []).map((s) => s.crop_id))
  const err = add.error ?? setEdit.error ?? remove.error

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">Shared crops</h3>
      <p className="text-xs text-gray-500">One row both sides use: an editable crop's price and rules are ours too.</p>
      <ul className="mt-1 space-y-1">
        {(shared ?? []).length === 0 && <li className="text-xs text-gray-400">None.</li>}
        {[...(shared ?? [])]
          .sort((a, b) => (name.get(a.crop_id) ?? '').localeCompare(name.get(b.crop_id) ?? ''))
          .map((s) => (
            <li key={s.crop_id} className="flex items-center gap-3 text-sm text-gray-800">
              {name.get(s.crop_id) ?? 'Archived crop'}
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={s.can_edit} onChange={(e) => setEdit.mutate({ crop_id: s.crop_id, can_edit: e.target.checked })} />
                Can edit
              </label>
              <button onClick={() => remove.mutate(s.crop_id)} className="rounded-full p-0.5 text-gray-400 hover:bg-gray-100" aria-label={`Stop sharing ${name.get(s.crop_id) ?? 'crop'}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
      </ul>
      <Select
        value=""
        size="sm"
        className="mt-1 w-56"
        ariaLabel="Share a crop"
        placeholder="Share a crop…"
        onChange={(id) => id && add.mutate(id)}
        options={(crops ?? []).filter((c) => c.active && !have.has(c.id)).map((c) => ({ value: c.id, label: c.name }))}
      />
      {err && <p className="mt-1 text-xs text-red-600">{(err as Error).message}</p>}
    </div>
  )
}

/** A page's name: the preset's own, else its home tile's (one that opens the page, not a tab of it). */
const TILE_LABEL = new Map(TILES.filter((t) => !t.to.includes('?')).map((t) => [t.to, t.label]))
const labelOf = (path: string) => PARTNER_PAGE_LABELS[path] ?? TILE_LABEL.get(path) ?? path

/**
 * The preset, and this company's ticks over it. A tick is stored only where it
 * differs from the preset, so a later change to the preset still reaches it.
 */
function CompanyViews({ company, saving, onSave }: { company: Company; saving: boolean; onSave: (c: { preset?: string; views?: Record<string, boolean> }) => void }) {
  const preset = PARTNER_PRESETS[company.preset] ?? PARTNER_PRESETS['crop-share']
  const access: PartnerAccess = { preset: company.preset, views: company.views }
  const bare: PartnerAccess = { preset: company.preset, views: {} }
  const tick = (key: string, on: boolean) => {
    const views = { ...company.views }
    if (on === isPartnerPath(key, bare)) delete views[key]
    else views[key] = on
    onSave({ views })
  }
  // Pages ticked on beyond the preset, and the ones that could be.
  const extra = Object.keys(company.views).filter((k) => !k.includes('?') && company.views[k] && !preset.prefixes.includes(k))
  const addable = [...new Set(TILES.map((t) => t.to.split('?')[0]))]
    .filter((p) => TILE_LABEL.has(p) || PARTNER_PAGE_LABELS[p])
    .filter((p) => !isPartnerPath(p, access))
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)))

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        Preset
        <Select
          value={company.preset}
          size="sm"
          className="w-40"
          ariaLabel="Preset"
          disabled={saving}
          onChange={(v) => onSave({ preset: v })}
          options={Object.entries(PARTNER_PRESETS).map(([k, p]) => ({ value: k, label: p.label }))}
        />
      </label>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {[...preset.prefixes, ...extra].map((path) => (
          <li key={path}>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={isPartnerPath(path, access)} disabled={saving} onChange={(e) => tick(path, e.target.checked)} />
              {labelOf(path)}
              {company.views[path] !== undefined && <span className="text-xs text-amber-700">changed</span>}
            </label>
            {isPartnerPath(path, access) &&
              (preset.blockedTabs[path] ?? []).map((tab) => {
                const key = `${path}?tab=${tab}`
                return (
                  <label key={tab} className="ml-6 flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={isPartnerPath(key, access)} disabled={saving} onChange={(e) => tick(key, e.target.checked)} />
                    {tab.replace('-', ' ')} tab
                    {company.views[key] !== undefined && <span className="text-amber-700">changed</span>}
                  </label>
                )
              })}
          </li>
        ))}
      </ul>
      <Select
        value=""
        size="sm"
        className="w-64"
        ariaLabel="Open another screen"
        placeholder="Open another screen…"
        disabled={saving}
        onChange={(p) => p && tick(p, true)}
        options={addable.map((p) => ({ value: p, label: labelOf(p) }))}
      />
      <p className="text-xs text-gray-500">Screens only: the database still keeps our records to what is shared above.</p>
    </div>
  )
}
