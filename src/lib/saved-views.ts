import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

/**
 * Named filters a person can come back to.
 *
 * The long lists already hold their filters in the URL, so a saved view is a
 * name, a page and its query string — "active rented fields" rather than a
 * set of boxes to tick again every time.
 */
export type SavedView = { name: string; path: string; search: string }

/** Keeps one person's list short enough to stay a shortcut rather than a list to search. */
export const MAX_VIEWS = 12

const clean = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 40)

/** Whatever was stored, read as views; anything malformed is dropped. */
export function readViews(stored: unknown): SavedView[] {
  if (!Array.isArray(stored)) return []
  return stored
    .map((v) => {
      const o = (v ?? {}) as Partial<SavedView>
      return { name: clean(String(o.name ?? '')), path: String(o.path ?? ''), search: String(o.search ?? '') }
    })
    .filter((v) => v.name !== '' && v.path.startsWith('/'))
    .slice(0, MAX_VIEWS)
}

/** Saving a view under a name that is taken replaces it, rather than making a second. */
export function addView(views: SavedView[], view: SavedView): SavedView[] {
  const name = clean(view.name)
  if (!name || !view.path.startsWith('/')) return views
  const next = views.filter((v) => !(v.path === view.path && v.name.toLowerCase() === name.toLowerCase()))
  return [...next, { ...view, name }].slice(-MAX_VIEWS)
}

export function removeView(views: SavedView[], path: string, name: string): SavedView[] {
  return views.filter((v) => !(v.path === path && v.name === name))
}

/** The views saved for one page, in the order they were saved. */
export const viewsFor = (views: SavedView[], path: string) => views.filter((v) => v.path === path)

/** Whether this page, with these filters, is already saved — and under what name. */
export function savedAs(views: SavedView[], path: string, search: string): string | null {
  // Sorted, so the same filters in a different order are the same view.
  const here = (s: string) => {
    const p = new URLSearchParams(s)
    p.sort()
    return p.toString()
  }
  return viewsFor(views, path).find((v) => here(v.search) === here(search))?.name ?? null
}

export function useSavedViews() {
  const { profile } = useAuth()
  return readViews((profile as { saved_views?: unknown } | null)?.saved_views)
}

export function useSaveViews() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (views: SavedView[]) => {
      if (!profile) throw new Error('Not signed in')
      // database.types.ts is generated and has not been regenerated since this
      // column was added, so the row type does not know saved_views yet.
      const patch = { saved_views: views } as unknown as Database['public']['Tables']['users']['Update']
      const { error } = await supabase.from('users').update(patch).eq('id', profile.id)
      if (error) throw error
      return views
    },
    // Optimistic: saving or clearing a view should feel like a button, not a
    // round trip, the same way the tile picker does.
    onMutate: async (views) => {
      const key = ['profile', profile?.id]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, (old: unknown) => (old ? { ...(old as object), saved_views: views } : old))
      return { prev, key }
    },
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['profile'] }),
  })
}
