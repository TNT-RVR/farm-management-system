import { Bug, CheckSquare, ClipboardList, Droplet, Scale } from 'lucide-react'
import type { MenuIcon } from './nav-tree'

/**
 * The phone bar's Add (+): straight to the forms filled in standing up
 * (Sam, 29 Oct 2026: weigh scale, moisture test, scouting report, feed
 * today, and a task). Each opens its page with the form already open.
 */
export type QuickAdd = { key: string; label: string; to: string; icon: MenuIcon }

export const QUICK_ADDS: QuickAdd[] = [
  { key: 'weigh', label: 'Weigh in a load', to: '/harvest?tab=bins&weigh=1', icon: Scale },
  { key: 'moisture', label: 'Moisture test', to: '/harvest?tab=moisture', icon: Droplet },
  { key: 'scouting', label: 'Scouting report', to: '/scouting?new=1', icon: Bug },
  { key: 'feed', label: 'Feed today', to: '/feed?tab=records&new=1', icon: ClipboardList },
  { key: 'task', label: 'Task', to: '/tasks?new=1', icon: CheckSquare },
]
