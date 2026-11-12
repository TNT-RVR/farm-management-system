import type { UsageType } from './handling'

/**
 * Undo and redo for the Handling System designer.
 *
 * The layout lives in the database, not in the page, so there is no document
 * to keep old copies of. What is kept instead is a list of what was done, each
 * entry carrying enough of the old values to put back — a stack of inverses.
 * Everything here is pure: a step, how to turn it round, and the two stacks.
 * Carrying it out is the page's job, because only the page has the mutations.
 *
 * The one thing that makes this harder than a stack of inverses: putting back
 * a deleted panel INSERTS it, and the row comes back with a new id. Every
 * later step that mentioned the old id is then pointing at nothing. So an id
 * can be swapped through the whole history (`remapId`), and the page does that
 * as each insert returns. Without it, undoing a delete and then undoing the
 * move before it would silently do nothing — the worst kind of broken undo,
 * because the button still lights up.
 */

export type ItemFields = { catalog_id: string; lng: number; lat: number; rotation: number; swing_deg: number }
export type ItemPatch = { lng?: number; lat?: number; rotation?: number; swing_deg?: number }

export type PathFields = {
  points: [number, number][]
  is_closed: boolean
  label: string | null
  color: string
  stroke_width: number
  usage_type: UsageType
  assigned_classes: string[]
}
export type PathPatch = Partial<PathFields>

/**
 * One thing a person did, described by its effect.
 *
 * Plural where a gesture can touch several pieces at once: dragging six
 * selected panels is one thing that happened and has to come back in one
 * press, not six.
 */
export type Step =
  | { kind: 'items-added'; items: { id: string; fields: ItemFields }[] }
  | { kind: 'items-removed'; items: { id: string; fields: ItemFields }[] }
  | { kind: 'items-moved'; items: { id: string; from: ItemPatch; to: ItemPatch }[] }
  | { kind: 'paths-added'; paths: { id: string; fields: PathFields }[] }
  | { kind: 'paths-removed'; paths: { id: string; fields: PathFields }[] }
  | { kind: 'path-changed'; id: string; from: PathPatch; to: PathPatch }

/** The same step, the other way round. */
export function invert(step: Step): Step {
  switch (step.kind) {
    case 'items-added':
      return { kind: 'items-removed', items: step.items }
    case 'items-removed':
      return { kind: 'items-added', items: step.items }
    case 'items-moved':
      return { kind: 'items-moved', items: step.items.map((i) => ({ id: i.id, from: i.to, to: i.from })) }
    case 'paths-added':
      return { kind: 'paths-removed', paths: step.paths }
    case 'paths-removed':
      return { kind: 'paths-added', paths: step.paths }
    case 'path-changed':
      return { kind: 'path-changed', id: step.id, from: step.to, to: step.from }
  }
}

/**
 * What the button says it will undo.
 *
 * "Undo" on its own leaves you pressing it to find out. Naming the step is
 * how somebody who has been drawing for ten minutes knows whether the next
 * press takes back a nudge or a whole pen.
 */
export function stepLabel(step: Step): string {
  const pieces = (n: number) => (n === 1 ? 'a piece' : `${n} pieces`)
  const pens = (n: number) => (n === 1 ? 'a pen' : `${n} pens`)
  switch (step.kind) {
    case 'items-added':
      return `placing ${pieces(step.items.length)}`
    case 'items-removed':
      return `deleting ${pieces(step.items.length)}`
    case 'items-moved': {
      const turned = step.items.every((i) => i.to.lng == null && i.to.lat == null)
      return `${turned ? 'turning' : 'moving'} ${pieces(step.items.length)}`
    }
    case 'paths-added':
      return `drawing ${pens(step.paths.length)}`
    case 'paths-removed':
      return `deleting ${pens(step.paths.length)}`
    case 'path-changed':
      return step.to.points ? 'reshaping a pen' : 'changing a pen'
  }
}

export type History = { past: Step[]; future: Step[] }
export const EMPTY_HISTORY: History = { past: [], future: [] }

/**
 * How far back it goes.
 *
 * Fifty is a long afternoon of panels and costs nothing to hold. It is a cap
 * rather than no cap because every step keeps a copy of what it replaced, and
 * a pen's corner list is not tiny.
 */
export const HISTORY_LIMIT = 50

/** Remember a step that has just been carried out. */
export function record(h: History, step: Step): History {
  const past = [...h.past, step]
  return { past: past.slice(Math.max(0, past.length - HISTORY_LIMIT)), future: [] }
}

export function undoStep(h: History): { step: Step; next: History } | null {
  const step = h.past[h.past.length - 1]
  if (!step) return null
  return { step, next: { past: h.past.slice(0, -1), future: [step, ...h.future] } }
}

export function redoStep(h: History): { step: Step; next: History } | null {
  const step = h.future[0]
  if (!step) return null
  return { step, next: { past: [...h.past, step], future: h.future.slice(1) } }
}

/** Point every mention of a row at the row it came back as. */
export function remapId(h: History, from: string, to: string): History {
  const fix = (step: Step): Step => {
    switch (step.kind) {
      case 'items-added':
      case 'items-removed':
        return { ...step, items: step.items.map((i) => (i.id === from ? { ...i, id: to } : i)) }
      case 'items-moved':
        return { ...step, items: step.items.map((i) => (i.id === from ? { ...i, id: to } : i)) }
      case 'paths-added':
      case 'paths-removed':
        return { ...step, paths: step.paths.map((p) => (p.id === from ? { ...p, id: to } : p)) }
      case 'path-changed':
        return step.id === from ? { ...step, id: to } : step
    }
  }
  return { past: h.past.map(fix), future: h.future.map(fix) }
}
