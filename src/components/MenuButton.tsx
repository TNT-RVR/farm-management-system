import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One button that asks which, instead of a button for each (Sam, 29 Oct
 * 2026: "they should only be one button but you can choose between the two").
 *
 * Two buttons side by side read as two different jobs. Feed today and A
 * period are the same job — recording a feeding — differing only in which day
 * it goes on, and the pair took twice the room for it.
 */

export type MenuChoice = {
  key: string
  label: string
  /** One line under the label, where the choice needs explaining. */
  hint?: string
  icon?: ComponentType<{ className?: string }>
  onPick: () => void
}

export function MenuButton({
  label,
  icon: Icon,
  choices,
  variant = 'primary',
  className,
  children,
}: {
  label: string
  icon?: ComponentType<{ className?: string }>
  choices: MenuChoice[]
  /** 'primary' is the app's green button; 'plain' the bordered white one. */
  variant?: 'primary' | 'plain'
  className?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
          variant === 'primary'
            ? 'bg-brand-700 text-white hover:bg-brand-800'
            : 'border border-gray-300 text-gray-700 hover:bg-gray-50',
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {children ?? label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-52 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                c.onPick()
              }}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
            >
              {c.icon && <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
              <span className="min-w-0">
                <span className="block text-sm text-gray-900">{c.label}</span>
                {c.hint && <span className="block text-xs text-gray-500">{c.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
