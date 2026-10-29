import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, LayoutGrid, PanelTop, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { RECORD_HOME, runSearch, type RecordHit } from '@/lib/search/records'
import { useVisibleReports } from '@/lib/reports/visible'
import { buildAppIndex, searchApp, type AppHitKind } from '@/lib/search/app-index'
import { TAB_ENTRIES } from '@/lib/search/tabs'
import { cn } from '@/lib/utils'

type Hit = RecordHit & { kind?: AppHitKind }

const KIND_GROUP: Record<AppHitKind, string> = { page: 'Pages', tab: 'Tabs', report: 'Reports' }
const KIND_ICON = { page: LayoutGrid, tab: PanelTop, report: FileText }

/**
 * One search for the whole app: its pages, the tabs inside them and its
 * reports (matched in the browser as you type), then the farm's records
 * (fields, contacts, tasks, cattle…) from the database. Arrow keys move,
 * Enter opens. Ctrl+K, / and the header's search icon open the search window
 * instead (PhoneSearchSheet); this page stays for the Search tile and old links.
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
    queryFn: () => runSearch(supabase, q.trim()),
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
