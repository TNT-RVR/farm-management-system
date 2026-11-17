import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bookmark, X } from 'lucide-react'
import { addView, removeView, savedAs, useSavedViews, useSaveViews, viewsFor } from '@/lib/saved-views'
import { dbErrorMessage } from '@/lib/db-error'
import { cn } from '@/lib/utils'

/**
 * The filters on this page, under a name you can come back to.
 *
 * A long list's filters already live in its URL, so a saved view is a name
 * and that URL — "active rented fields" instead of setting the same boxes
 * every time. Saved against the person, so it follows them to the phone.
 */
export function SavedViews() {
  const views = useSavedViews()
  const save = useSaveViews()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const mine = viewsFor(views, pathname)
  const already = savedAs(views, pathname, search)
  // A tab is not a filter: there is nothing to come back to in "the plan tab".
  const filtered = [...new URLSearchParams(search).keys()].some((k) => k !== 'tab')
  const chip = 'rounded-full border px-2 py-0.5 text-xs'

  const keep = () => {
    if (!name.trim()) return
    save.mutate(addView(views, { name, path: pathname, search }))
    setName('')
    setNaming(false)
  }

  if (!mine.length && !naming && !already) {
    // Nothing saved here yet: one quiet button, and only once there is
    // something worth saving.
    if (!filtered) return null
    return (
      <button onClick={() => setNaming(true)} className="flex items-center gap-1 text-xs text-brand-700 underline">
        <Bookmark className="h-3.5 w-3.5" /> Save this view
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.map((v) => {
        const here = v.name === already
        return (
          <span key={v.name} className={cn(chip, 'flex items-center gap-1', here ? 'border-brand-300 bg-brand-50 text-brand-900' : 'border-gray-300 text-gray-700')}>
            <button onClick={() => navigate(`${v.path}${v.search}`)} className="font-medium">
              {v.name}
            </button>
            <button onClick={() => save.mutate(removeView(views, v.path, v.name))} aria-label={`Forget ${v.name}`} className="text-gray-400 hover:text-gray-700">
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}

      {naming ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? keep() : e.key === 'Escape' ? setNaming(false) : undefined)}
            placeholder="Name this view"
            className="w-36 rounded-md border border-gray-300 px-2 py-0.5 text-xs"
          />
          <button onClick={keep} className="text-xs font-medium text-brand-700">
            Save
          </button>
        </span>
      ) : already || !filtered ? null : (
        <button onClick={() => setNaming(true)} className={cn(chip, 'flex items-center gap-1 border-dashed border-gray-300 text-gray-600')}>
          <Bookmark className="h-3 w-3" /> Save this view
        </button>
      )}

      {save.isError && <span className="text-xs text-red-700">{dbErrorMessage(save.error)}</span>}
    </div>
  )
}
