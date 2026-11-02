import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { inviteUser, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useIsPartnerAdmin, usePartnerFarmId } from '@/lib/partner-view'

/**
 * A partner's own company (Sam, 29 Oct 2026): his people and his
 * farm setup. Everyone he invites joins his company and sees what he sees;
 * none of them can see ours beyond what he can.
 */

type Person = {
  id: string
  email: string
  full_name: string
  active: boolean
  partner_admin: boolean
}

const card = 'max-w-3xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm'

function useCompanyName(farmId: string | null) {
  return useQuery({
    queryKey: ['farms', 'partner', farmId],
    enabled: Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('farms')
        .select('name')
        .eq('id', farmId!)
        .maybeSingle()
      if (error) throw error
      return data?.name ?? null
    },
  })
}

function NoCompany() {
  return (
    <p className={`${card} text-sm text-gray-600`}>
      Your account is not linked to a company yet. Ask the farm to set it up.
    </p>
  )
}

/** Settings → Users & access, for a partner: his company's people. */
export function PartnerPeople({ head }: { head: (tabs?: React.ReactNode) => React.ReactNode }) {
  const farmId = usePartnerFarmId()
  const isAdmin = useIsPartnerAdmin()
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data: company } = useCompanyName(farmId)
  const { data: people, isLoading } = useQuery({
    queryKey: ['users', 'partner-company', farmId],
    enabled: Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, active, partner_admin')
        .eq('farm_id', farmId!)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Person[]
    },
  })
  const setActive = useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const { error } = await supabase.from('users').update({ active: v.active }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const invite = useMutation({
    // The server puts the new person in the inviter's company (invite-user.mts).
    mutationFn: () => inviteUser(email.trim(), 'partner'),
    onSuccess: () => {
      setSent(email.trim())
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['users'] })
    },
  })

  return (
    <>
      {head()}
      <div className="space-y-4 p-4 md:p-6">
        {!farmId ? (
          <NoCompany />
        ) : (
          <section className={card}>
            <h2 className="text-sm font-semibold text-gray-700">
              {company ?? 'Your company'}: people
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Everyone here sees the same fields and records you do, and nothing else of the farm's.
            </p>
            {isAdmin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setSent(null)
                  invite.mutate()
                }}
                className="mt-3 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-4"
              >
                <input
                  type="email"
                  required
                  placeholder="user-38a8@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={invite.isPending || !email.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                  {invite.isPending ? 'Inviting…' : 'Invite'}
                </button>
                {sent && (
                  <p className="w-full text-xs text-green-700">Invitation sent to {sent}.</p>
                )}
                {invite.isError && (
                  <p className="w-full text-xs text-red-600">{(invite.error as Error).message}</p>
                )}
              </form>
            )}
            {isLoading ? (
              <p className="mt-3 text-sm text-gray-400">Loading…</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {(people ?? []).map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                  >
                    <span className="font-medium text-gray-900">{u.full_name || u.email}</span>
                    <span className="text-xs text-gray-500">{u.email}</span>
                    {u.partner_admin && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        runs the company
                      </span>
                    )}
                    {!u.active && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        off
                      </span>
                    )}
                    {isAdmin && u.id !== profile?.id && (
                      <button
                        onClick={() => setActive.mutate({ id: u.id, active: !u.active })}
                        disabled={setActive.isPending}
                        className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        {u.active ? 'Turn off' : 'Turn on'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {setActive.isError && (
              <p className="mt-2 text-xs text-red-600">{(setActive.error as Error).message}</p>
            )}
          </section>
        )}
      </div>
    </>
  )
}

type Setup = {
  farm_name: string
  farm_description: string
  province: string
  time_zone: string
  units: string
}
const EMPTY: Setup = {
  farm_name: '',
  farm_description: '',
  province: '',
  time_zone: '',
  units: 'metric',
}

/** Settings → Farm setup, for a partner: his company's own "Your farm". */
export function PartnerFarmSetup({ head }: { head: (tabs?: React.ReactNode) => React.ReactNode }) {
  const farmId = usePartnerFarmId()
  const isAdmin = useIsPartnerAdmin()
  const { data: row, isLoading } = useQuery({
    queryKey: ['partner_farm_setup', farmId],
    enabled: Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_farm_setup')
        .select('*')
        .eq('farm_id', farmId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  return (
    <>
      {head()}
      <div className="space-y-4 p-4 md:p-6">
        {!farmId ? (
          <NoCompany />
        ) : isLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <SetupForm key={row?.id ?? 'new'} farmId={farmId} row={row ?? null} isAdmin={isAdmin} />
        )}
      </div>
    </>
  )
}

type SetupRow = Setup & { id: string }

function SetupForm({
  farmId,
  row,
  isAdmin,
}: {
  farmId: string
  row: { [K in keyof SetupRow]: SetupRow[K] | null } | null
  isAdmin: boolean
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Setup>(() =>
    row
      ? {
          farm_name: row.farm_name ?? '',
          farm_description: row.farm_description ?? '',
          province: row.province ?? '',
          time_zone: row.time_zone ?? '',
          units: row.units ?? 'metric',
        }
      : EMPTY,
  )
  const save = useMutation({
    mutationFn: async () => {
      const patch = {
        farm_id: farmId,
        farm_name: form.farm_name.trim() || null,
        farm_description: form.farm_description.trim() || null,
        province: form.province.trim() || null,
        time_zone: form.time_zone.trim() || null,
        units: form.units,
        updated_at: new Date().toISOString(),
      }
      const { error } = row
        ? await supabase.from('partner_farm_setup').update(patch).eq('id', row.id!)
        : await supabase.from('partner_farm_setup').insert(patch)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['partner_farm_setup'] }),
  })

  const input =
    'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50'
  const field = (key: keyof Setup, label: string, placeholder = '') => (
    <label className="block text-xs text-gray-500">
      {label}
      <input
        value={form[key]}
        disabled={!isAdmin}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={input}
      />
    </label>
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className={`${card} space-y-3`}
    >
      <h2 className="text-sm font-semibold text-gray-700">Your farm</h2>
      {field('farm_name', 'Farm or company name')}
      <label className="block text-xs text-gray-500">
        About the farm
        <textarea
          value={form.farm_description}
          disabled={!isAdmin}
          rows={3}
          onChange={(e) => setForm({ ...form, farm_description: e.target.value })}
          className={input}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {field('province', 'Province', 'AB')}
        {field('time_zone', 'Time zone', 'America/Edmonton')}
        <label className="block text-xs text-gray-500">
          Units
          <select
            value={form.units}
            disabled={!isAdmin}
            onChange={(e) => setForm({ ...form, units: e.target.value })}
            className={input}
          >
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
        </label>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {save.isSuccess && <span className="text-xs text-green-700">Saved.</span>}
          {save.isError && (
            <span className="text-xs text-red-600">{(save.error as Error).message}</span>
          )}
        </div>
      )}
    </form>
  )
}
