import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useCropYear } from '@/lib/crop-year'
import { useMissingChecklist } from '@/lib/missing-checklist'
import { checklistByArea, type ChecklistLine } from '@/lib/reports/missing'

/**
 * What's missing (Sam, 16 Oct 2026): one checklist of the inputs nobody
 * has entered that hold features back, grouped by area, each line linking
 * to where it is filled in. The rules are reports/missing.ts; the Monday
 * meeting shows the top of the same list.
 */
export function MissingPage() {
  const { cropYear } = useCropYear()
  const { lines, canFix, isLoading, error } = useMissingChecklist(cropYear)
  const groups = checklistByArea(lines)
  const items = lines.reduce((s, l) => s + l.count, 0)
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="What's missing"
        icon={<ListChecks className="h-5 w-5 text-brand-700" />}
        subtitle={isLoading ? 'Checking…' : `${lines.length} things to fill in · ${items} items · ${cropYear}${canFix ? '' : ' · a manager fills these in'}`}
        actions={
          // The download is the managers' report.
          canFix && (
            <Link to="/reports?open=missing" className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Download
            </Link>
          )
        }
      />
      {error && <p className="text-sm text-red-700">Could not check: {error.message}</p>}
      {!isLoading && !error && !lines.length && <p className="text-sm text-gray-500">Nothing missing — every check passed.</p>}
      {groups.map((g) => (
        <section key={g.area} className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b border-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.area}</h2>
          <ul className="divide-y divide-gray-100">
            {g.lines.map((l) => (
              <Line key={l.id} line={l} canFix={canFix} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Line({ line, canFix }: { line: ChecklistLine; canFix: boolean }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <li className="px-4 py-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Hide the items' : 'Show the items'} className="rounded p-0.5 text-gray-400 hover:bg-gray-100">
          <Chevron className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1">
          {canFix ? (
            <Link to={line.path} className="text-sm font-medium text-gray-900 hover:text-brand-700 hover:underline">
              {line.title}
            </Link>
          ) : (
            <span className="text-sm font-medium text-gray-900">{line.title}</span>
          )}
          <span className="block text-xs text-gray-500">{line.why}</span>
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900">{line.count}</span>
      </div>
      {open && (
        <ul className="ml-7 mt-1 space-y-1">
          {line.items.map((i, n) => (
            <li key={n} className="text-xs">
              {canFix ? (
                <Link to={i.path} className="font-medium text-gray-800 hover:text-brand-700 hover:underline">
                  {i.item}
                </Link>
              ) : (
                <span className="font-medium text-gray-800">{i.item}</span>
              )}
              <span className="text-gray-500"> — {i.missing}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
