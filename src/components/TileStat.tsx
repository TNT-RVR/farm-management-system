import { useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useFieldnetSystems } from '@/lib/fieldnet'
import { useMissingChecklist } from '@/lib/missing-checklist'
import { useUnreadCount } from '@/lib/notifications'
import { tasksStat, type TileStatTone, type TileStatValue } from '@/lib/tile-stats'
import { useTasks } from '@/lib/tasks'
import { cn } from '@/lib/utils'

/**
 * A live number on a home tile (design review item 6, Sam's go-ahead 24 Nov
 * 2026).
 *
 * The dashboard used to be a page of summary numbers and was replaced by tiles,
 * rightly: a number was a reason to look at the dashboard, not to open the app.
 * This brings back only the numbers that answer "is anything wrong" — late
 * jobs, unread messages, gaps in the records — plus one that answers "is
 * anything running". Each is the count the tile's own page leads with, so the
 * number has one home and the tile only points at it.
 *
 * Silent at zero. A tile reading "0 late" is the same news as a tile reading
 * nothing, and twelve tiles of zeros is the page of numbers again.
 *
 * Each number is its own component, mounted only for a tile that is showing, so
 * a hidden tile costs no query. A tile with no number here renders nothing.
 */
export function TileStat({ tileKey }: { tileKey: string }) {
  switch (tileKey) {
    case 'tasks':
      return <TasksStat />
    case 'notifications':
      return <NotificationsStat />
    case 'pivots':
      return <PivotsStat />
    case 'missing':
      return <MissingStat />
    default:
      return null
  }
}

// Pale patches with dark words: dark mode leaves these alone (index.css), so
// they read the same on either screen.
const TONE: Record<TileStatTone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  ok: 'bg-green-50 text-green-800',
  warn: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-700',
}

function Pill({ stat }: { stat: TileStatValue | null }) {
  if (!stat || stat.n <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-baseline gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TONE[stat.tone],
      )}
    >
      <span className="text-sm font-semibold tabular-nums">{stat.n.toLocaleString('en-CA')}</span>
      {stat.word}
    </span>
  )
}

function TasksStat() {
  const { profile } = useAuth()
  const { data } = useTasks()
  return <Pill stat={data ? tasksStat(data, profile?.id, new Date()) : null} />
}

function NotificationsStat() {
  const { data } = useUnreadCount()
  return <Pill stat={data ? { n: data, word: 'unread', tone: 'warn' } : null} />
}

function PivotsStat() {
  const { data } = useFieldnetSystems()
  const on = (data ?? []).filter((s) => s.is_water_on).length
  return <Pill stat={{ n: on, word: 'watering', tone: 'ok' }} />
}

function MissingStat() {
  const { cropYear } = useCropYear()
  const { total } = useMissingChecklist(cropYear)
  return <Pill stat={{ n: total, word: 'to fill in', tone: 'warn' }} />
}
