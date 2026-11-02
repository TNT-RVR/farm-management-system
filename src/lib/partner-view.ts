import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { fieldsSource, isPartner, setPartnerAccess, useCropShareFields, type PartnerAccess } from '@/lib/partner'
import { getPartnerPreview, setPartnerPreview, subscribePartnerPreview } from '@/lib/partner-preview'
import { compareFieldNames, useCrops, useFields, type FieldRow } from '@/lib/queries'
import { supabase } from '@/lib/supabase'

/** The preview an admin has on, if any (lib/partner-preview.ts). */
export function usePartnerPreview() {
  const preview = useSyncExternalStore(subscribePartnerPreview, getPartnerPreview, () => null)
  // The real role: while previewing, profile.role is the partner's.
  const { profile, realRole } = useAuth()
  const admin = hasAdminAccess(realRole)
  // Admins only. Anyone else's leftover preview is dropped.
  useEffect(() => {
    if (preview && profile && !admin) setPartnerPreview(null)
  }, [preview, profile, admin])
  return admin ? preview : null
}

/** Draw the partner's side: a partner, or an admin viewing as one (whose profile then carries the partner role). */
export function usePartnerView(): boolean {
  return isPartner(useAuth().profile?.role)
}

/**
 * Start and stop viewing as a partner. The query cache is emptied both ways,
 * as at sign-in and sign-out: lists fetched under one set of rules must not
 * show under the other.
 */
export function usePartnerPreviewControls() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const start = async (partner: { id: string; full_name: string; email: string }) => {
    const person = await supabase.from('users').select('farm_id').eq('id', partner.id).maybeSingle()
    if (person.error) throw person.error
    const farmId = (person.data as { farm_id?: string | null } | null)?.farm_id ?? null
    // What his company is given: its fields by year and its shared crops.
    const [assigned, shared] = farmId
      ? await Promise.all([
          supabase.from('partner_fields').select('field_id, crop_year').eq('farm_id', farmId),
          supabase.from('partner_crops').select('crop_id').eq('farm_id', farmId),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (assigned.error) throw assigned.error
    if (shared.error) throw shared.error
    setPartnerPreview({
      userId: partner.id,
      name: partner.full_name || partner.email,
      fieldIds: [...new Set((assigned.data ?? []).map((r) => r.field_id))],
      farmId,
      cropIds: (shared.data ?? []).map((r) => r.crop_id),
    })
    qc.clear()
    navigate('/fields')
  }
  const stop = () => {
    setPartnerPreview(null)
    qc.clear()
    navigate('/settings/people?tab=users')
  }
  return { start, stop }
}

/** His company (farms row): his own, or the previewed partner's. Null for staff. */
export function usePartnerFarmId(): string | null {
  const partner = usePartnerView()
  const preview = usePartnerPreview()
  const { profile } = useAuth()
  if (!partner) return null
  if (preview) return preview.farmId ?? null
  return profile?.farm_id ?? null
}

/**
 * His company's preset and view ticks (partner_access), put in place for
 * isPartnerPath before any page draws. False until then; true at once for
 * staff, and for a company with no row (the default preset).
 */
export function usePartnerViewsReady(): boolean {
  const partner = usePartnerView()
  const farmId = usePartnerFarmId()
  const { data, isSuccess, isError } = useQuery({
    queryKey: ['partner_access', farmId],
    enabled: partner && Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase.from('partner_access').select('preset, views').eq('farm_id', farmId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const access: PartnerAccess | null = data ? { preset: data.preset, views: (data.views ?? {}) as Record<string, boolean> } : null
  // Set during render: the pages below read it as they draw.
  setPartnerAccess(partner ? access : null)
  return !partner || !farmId || isSuccess || isError
}

/** Whether he runs his company: invites its people and keeps its setup. */
export function useIsPartnerAdmin(): boolean {
  const partner = usePartnerView()
  const preview = usePartnerPreview()
  const { profile } = useAuth()
  // An admin viewing as him sees what he would.
  if (preview) return true
  return partner && Boolean(profile?.partner_admin)
}

/**
 * Where a partner records: the fields and years listed for his
 * company (partner_fields), and every year of his company's own fields. He
 * reads every year of ours that are listed for him; any year not his is
 * read-only, as the database holds it (partner_scope). For staff everything
 * is open here and their own role checks decide.
 */
export function usePartnerAccess() {
  const partner = usePartnerView()
  const preview = usePartnerPreview()
  const farmId = usePartnerFarmId()
  const { data } = useQuery({
    queryKey: ['partner_fields', 'mine', preview?.farmId ?? 'self'],
    enabled: partner,
    queryFn: async () => {
      // His company's (RLS); while previewing, the previewed partner's company's.
      let q = supabase.from('partner_fields').select('field_id, crop_year')
      if (preview) q = q.eq('farm_id', preview.farmId ?? '00000000-0000-0000-0000-000000000000')
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })
  const { data: own } = useQuery({
    queryKey: ['fields', 'partner-own', farmId],
    enabled: partner && Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase.from(fieldsSource()).select('id').eq('farm_id', farmId!)
      if (error) throw error
      return (data ?? []).map((r) => r.id)
    },
  })
  return useMemo(() => {
    const assigned = data ?? []
    const open = new Set(assigned.map((r) => `${r.field_id}:${r.crop_year}`))
    const fields = new Set(assigned.map((r) => r.field_id))
    const ownIds = new Set(own ?? [])
    return {
      partner,
      assigned,
      /** His years on this field, newest first. */
      yearsOn: (fieldId: string | null | undefined) =>
        assigned.filter((r) => r.field_id === fieldId).map((r) => r.crop_year).sort((a, b) => b - a),
      /** His company's own field: his in full, every year. */
      isOwnField: (fieldId: string | null | undefined) => partner && fieldId != null && ownIds.has(fieldId),
      /** Some year on this field is his to record in. */
      canRecordOn: (fieldId: string | null | undefined) =>
        !partner || (fieldId != null && (fields.has(fieldId) || ownIds.has(fieldId))),
      canWrite: (fieldId: string | null | undefined, year: number | null | undefined) =>
        !partner || (fieldId != null && (ownIds.has(fieldId) || (year != null && open.has(`${fieldId}:${year}`)))),
    }
  }, [partner, data, own])
}

/** usePartnerAccess for one field: may he record in this year? */
export function usePartnerYears(fieldId: string | null | undefined) {
  const { partner, canWrite, yearsOn, isOwnField } = usePartnerAccess()
  return {
    partner,
    years: yearsOn(fieldId),
    own: isOwnField(fieldId),
    canWrite: (year: number | null | undefined) => canWrite(fieldId, year),
  }
}

/**
 * The rotation grid's fields. A partner reads all of ours there (names and
 * crops by year, nothing else: partner_rotation_fields_v), and plans only his
 * own field-years; everyone else gets the usual list.
 */
export function useRotationFields() {
  const partner = usePartnerView()
  const staff = useFields()
  const all = useQuery({
    queryKey: ['fields', 'partner-rotation'],
    enabled: partner,
    queryFn: async () => {
      const { data, error } = await supabase.from('partner_rotation_fields_v' as 'fields').select('*').eq('active', true)
      if (error) throw error
      return ([...(data ?? [])] as FieldRow[]).sort((a, b) => compareFieldNames(a.name, b.name))
    },
  })
  return partner ? all : staff
}

/**
 * The crops shared with his company (partner_crops), and his company's own.
 * `shared` is every one he reads; `editable` the ones he may change, one row
 * each with ours, so his price is our price. Null for staff (no limit).
 */
export function usePartnerCropShares(): { shared: Set<string>; editable: Set<string> } | null {
  const partner = usePartnerView()
  const preview = usePartnerPreview()
  const farmId = usePartnerFarmId()
  const { data: crops } = useCrops()
  const { data: rows } = useQuery({
    queryKey: ['partner_crops', farmId],
    enabled: partner && Boolean(farmId),
    queryFn: async () => {
      const { data, error } = await supabase.from('partner_crops').select('crop_id, can_edit').eq('farm_id', farmId!)
      if (error) throw error
      return data ?? []
    },
  })
  return useMemo(() => {
    if (!partner) return null
    // A preview cannot read his company's own crops; the shared ones it has.
    const shared = new Set(preview ? (preview.cropIds ?? []) : (rows ?? []).map((r) => r.crop_id))
    const editable = new Set(preview ? shared : (rows ?? []).filter((r) => r.can_edit).map((r) => r.crop_id))
    for (const c of crops ?? []) {
      if (farmId && c.farm_id === farmId) {
        shared.add(c.id)
        editable.add(c.id)
      }
    }
    return { shared, editable }
  }, [partner, preview, rows, crops, farmId])
}

/** The crops he may change. Null for staff (no limit). */
export function usePartnerCrops(): Set<string> | null {
  return usePartnerCropShares()?.editable ?? null
}

type LoadKey = { field_id: string | null; crop_year: number }

/**
 * Staff on the weigh scale: which loads are a partner's, to filter out
 * (Sam, 29 Oct 2026): those weighed off a field-year shared with a partner
 * company. A partner can weigh loads only there, so his own are among them.
 * Null when there are none to filter, and for a partner himself.
 */
export function usePartnerLoads(): ((l: LoadKey) => boolean) | null {
  const partner = usePartnerView()
  const { data } = useCropShareFields()
  return useMemo(() => {
    if (partner || !data?.length) return null
    const years = new Set(data.map((r) => `${r.field_id}|${r.crop_year}`))
    return (l: LoadKey) => years.has(`${l.field_id}|${l.crop_year}`)
  }, [partner, data])
}
