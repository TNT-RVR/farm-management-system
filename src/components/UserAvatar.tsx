import { cn } from '@/lib/utils'

/** Someone as a circle: their picture, or their initials on a colour of their own. */
export type AvatarPerson = { id?: string; full_name?: string | null; avatar_url?: string | null }

const COLOURS = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-teal-600', 'bg-orange-600', 'bg-indigo-600']

const initials = (name: string | null | undefined) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

// The same person gets the same colour everywhere.
const colourOf = (key: string) => COLOURS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLOURS.length]

const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-20 w-20 text-2xl' }

export function UserAvatar({ person, size = 'sm', className, title }: { person: AvatarPerson; size?: keyof typeof SIZES; className?: string; title?: string }) {
  const name = person.full_name ?? ''
  return person.avatar_url ? (
    <img src={person.avatar_url} alt={name} title={title ?? name} className={cn('shrink-0 rounded-full object-cover', SIZES[size], className)} />
  ) : (
    <span
      title={title ?? name}
      aria-label={name}
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', SIZES[size], colourOf(person.id ?? name), className)}
    >
      {initials(name)}
    </span>
  )
}

/** A few people overlapping, the rest as "+n". */
export function AvatarStack({ people, max = 4, size = 'sm' }: { people: AvatarPerson[]; max?: number; size?: keyof typeof SIZES }) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((p, i) => (
        <UserAvatar key={p.id ?? i} person={p} size={size} className="ring-2 ring-white" />
      ))}
      {more > 0 && (
        <span title={people.slice(max).map((p) => p.full_name).join(', ')} className={cn('inline-flex items-center justify-center rounded-full bg-gray-200 font-semibold text-gray-700 ring-2 ring-white', SIZES[size])}>
          +{more}
        </span>
      )}
    </span>
  )
}
