import type { SupabaseClient } from '@supabase/supabase-js'

export type RecordHit = { group: string; label: string; sub?: string; to: string }

/** The page each kind of record lives on, so a switched-off page hides its records too. */
export const RECORD_HOME: Record<string, string> = {
  Fields: '/fields',
  Contacts: '/contacts',
  Tasks: '/tasks',
  Cattle: '/cattle',
  Checklists: '/checklists',
  Crops: '/crops',
  Calendar: '/calendar',
  Equipment: '/equipment',
  Bins: '/harvest',
  Contracts: '/contracts',
  Grants: '/grants',
}

/**
 * The farm's records: a keyword (ILIKE) search over the small single-farm
 * dataset, no AI key needed. Takes the client so the ask job can run it with
 * the asker's own login (netlify/functions/app-ask-background.mts).
 */
export async function runSearch(supabase: SupabaseClient, q: string): Promise<RecordHit[]> {
  const like = `%${q}%`
  const hits: RecordHit[] = []

  const [fields, contacts, tasks, cattle, templates, crops, events, equipment, bins, contracts, grants] = await Promise.all([
    supabase
      .from('fields')
      .select('id, name, legal_land_description, notes_md')
      .or(`name.ilike.${like},legal_land_description.ilike.${like},notes_md.ilike.${like}`)
      .limit(8),
    supabase
      .from('contacts')
      .select('id, company, contact_name, email, notes_md')
      .or(`company.ilike.${like},contact_name.ilike.${like},email.ilike.${like},notes_md.ilike.${like}`)
      .limit(8),
    supabase
      .from('tasks')
      .select('id, title, description_md')
      .or(`title.ilike.${like},description_md.ilike.${like}`)
      .limit(8),
    supabase
      .from('cattle')
      .select('id, tag, name, breed, notes_md')
      .or(`tag.ilike.${like},name.ilike.${like},breed.ilike.${like},notes_md.ilike.${like}`)
      .limit(8),
    supabase
      .from('checklist_templates')
      .select('id, name, description_md')
      .or(`name.ilike.${like},description_md.ilike.${like}`)
      .limit(6),
    supabase
      .from('crops')
      .select('id, name, cheatsheet_md')
      .or(`name.ilike.${like},cheatsheet_md.ilike.${like}`)
      .limit(6),
    supabase.from('calendar_events').select('id, title, notes_md').or(`title.ilike.${like},notes_md.ilike.${like}`).limit(6),
    supabase
      .from('equipment')
      .select('id, name, make, model, year, serial')
      .or(`name.ilike.${like},make.ilike.${like},model.ilike.${like},serial.ilike.${like},notes_md.ilike.${like}`)
      .limit(6),
    supabase.from('bins').select('id, name, site').or(`name.ilike.${like},site.ilike.${like},notes_md.ilike.${like}`).limit(6),
    supabase.from('contracts').select('id, contract_number, crop_year, notes_md').or(`contract_number.ilike.${like},notes_md.ilike.${like}`).limit(6),
    supabase.from('grants').select('id, title, funder').or(`title.ilike.${like},funder.ilike.${like},summary.ilike.${like}`).limit(6),
  ])

  fields.data?.forEach((f) => hits.push({ group: 'Fields', label: f.name, sub: f.legal_land_description ?? undefined, to: `/fields/${f.id}` }))
  contacts.data?.forEach((c) => hits.push({ group: 'Contacts', label: c.company || c.contact_name || 'Contact', sub: c.email ?? undefined, to: '/contacts' }))
  tasks.data?.forEach((t) => hits.push({ group: 'Tasks', label: t.title, to: `/tasks/${t.id}` }))
  cattle.data?.forEach((c) =>
    hits.push({ group: 'Cattle', label: `${c.tag ? `#${c.tag} ` : ''}${c.name ?? ''}`.trim() || 'Animal', sub: c.breed ?? undefined, to: `/cattle/${c.id}` }),
  )
  templates.data?.forEach((t) => hits.push({ group: 'Checklists', label: t.name, to: '/checklists' }))
  crops.data?.forEach((c) => hits.push({ group: 'Crops', label: c.name, to: `/crops/${c.id}` }))
  events.data?.forEach((e) => hits.push({ group: 'Calendar', label: e.title, to: '/calendar' }))
  equipment.data?.forEach((e) =>
    hits.push({ group: 'Equipment', label: e.name, sub: [e.year, e.make, e.model].filter(Boolean).join(' ') || undefined, to: `/equipment/${e.id}` }),
  )
  bins.data?.forEach((b) => hits.push({ group: 'Bins', label: b.name, sub: b.site ?? undefined, to: '/harvest?tab=bins' }))
  contracts.data?.forEach((c) => hits.push({ group: 'Contracts', label: c.contract_number || 'Contract', sub: c.crop_year ? String(c.crop_year) : undefined, to: '/contracts' }))
  grants.data?.forEach((g) => hits.push({ group: 'Grants', label: g.title, sub: g.funder ?? undefined, to: '/grants' }))

  return hits
}
