import { taskListRows } from './reports/lists'

/** A home tile's live number — see components/TileStat. */
export type TileStatTone = 'neutral' | 'ok' | 'warn' | 'bad'
export type TileStatValue = { n: number; word: string; tone: TileStatTone }

/** My open tasks: how many are late, or else how many are open. Same filter the Tasks page opens on. */
export function tasksStat(
  tasks: Parameters<typeof taskListRows>[0],
  profileId: string | null | undefined,
  now: Date,
): TileStatValue | null {
  const mine = taskListRows(tasks, { who: 'mine', status: 'open', profileId })
  const late = mine.filter((t) => t.due_at && new Date(t.due_at) < now).length
  if (late > 0) return { n: late, word: 'late', tone: 'bad' }
  if (mine.length > 0) return { n: mine.length, word: 'open', tone: 'neutral' }
  return null
}
