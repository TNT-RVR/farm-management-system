import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, LayoutGrid, PanelTop, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useVisibleReports } from '@/lib/reports/visible'
import { buildAppIndex, searchApp, type AppHitKind } from '@/lib/search/app-index'
import { TAB_ENTRIES } from '@/lib/search/tabs'
import { cn } from '@/lib/utils'

type Hit = { group: string; label: string; sub?: string; to: string; kind?: AppHitKind }

/** The page each kind of record lives on, so a switched-off page hides its records too. */
const RECORD_HOME: Record<string, string> = {
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
 * dataset, no AI key needed.
 */
async function runSearch(q: string): Promise<Hit[]> {
  const like = `%${q}%`
  const hits: Hit[] = []

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

const KIND_GROUP: Record<AppHitKind, string> = { page: 'Pages', tab: 'Tabs', report: 'Reports' }
const KIND_ICON = { page: LayoutGrid, tab: PanelTop, report: FileText }

/**
 * One search for the whole app: its pages, the tabs inside them and its
 * reports (matched in the browser as you type), then the farm's records
 * (fields, contacts, tasks, cattle…) from the database. Arrow keys move,
 * Enter opens; Ctrl+K or / from anywhere comes here.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [text, setText] = useState(params.get('q') ?? '')
  const [active, setActive] = useState(0)
  const q = params.get('q') ?? ''
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()

  // The address follows the box a moment after typing stops, so Back returns
  // to the search and the records query is not fired on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = text.trim()
      if (v !== q) setParams(v ? { q: v } : {}, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [text, q, setParams])

  const index = useMemo(() => buildAppIndex(TAB_ENTRIES, reports, { isAdmin, isManager }), [reports, isAdmin, isManager])
  const appHits: Hit[] = useMemo(
    () =>
      text.trim().length < 2
        ? []
        : searchApp(index, text, (h) => !viewOff(h.gate)).map((h) => ({ group: KIND_GROUP[h.kind], label: h.label, sub: h.sub, to: h.to, kind: h.kind })),
    [index, text, viewOff],
  )

  const { data: records, isFetching } = useQuery({
    queryKey: ['search', q],
    enabled: q.trim().length >= 2,
    queryFn: () => runSearch(q.trim()),
  })
  const recordHits = useMemo(() => (records ?? []).filter((h) => !viewOff(RECORD_HOME[h.group] ?? h.to)), [records, viewOff])

  const all = useMemo(() => [...appHits, ...recordHits], [appHits, recordHits])
  const groups = all.reduce<Record<string, { h: Hit; i: number }[]>>((acc, h, i) => {
    ;(acc[h.group] ??= []).push({ h, i })
    return acc
  }, {})
  const typed = text.trim().length >= 2

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, all.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && all[active]) {
              e.preventDefault()
              navigate(all[active].to)
            }
          }}
          placeholder="Search pages, tabs, reports, fields, cattle, equipment…"
          aria-label="Search"
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-brand-600 focus:outline-none"
        />
      </div>

      <div className="mt-4">
        {!typed ? (
          <p className="text-sm text-gray-400">Type at least two characters. Ctrl+K or / opens this from anywhere.</p>
        ) : all.length > 0 ? (
          <div className="flex flex-col gap-4">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{group}</h2>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                  {items.map(({ h, i }) => {
                    const Icon = h.kind ? KIND_ICON[h.kind] : null
                    return (
                      <li key={`${h.to}-${i}`}>
                        <Link
                          to={h.to}
                          onMouseEnter={() => setActive(i)}
                          className={cn('flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50', i === active && 'bg-brand-50')}
                        >
                          {Icon && <Icon className="h-4 w-4 shrink-0 text-gray-400" />}
                          <span className="shrink-0 font-medium text-gray-900">{h.label}</span>
                          {h.sub && <span className="min-w-0 flex-1 truncate text-right text-xs text-gray-400">{h.sub}</span>}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {isFetching && <p className="text-xs text-gray-400">Searching records…</p>}
          </div>
        ) : isFetching || text.trim() !== q ? (
          <p className="text-sm text-gray-500">Searching…</p>
        ) : (
          <p className="text-sm text-gray-400">No matches for “{text.trim()}”.</p>
        )}
      </div>
    </div>
  )
}
