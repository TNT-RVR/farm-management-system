import type { ComponentType, MouseEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * A button that is only an icon: a row's pencil, a card's ×, a bin.
 *
 * The icon stays small; the button around it is at least 44px on a touch
 * screen, the size Apple and Google both give as the floor for a finger
 * (design review, Nov 2026 — the row icons were 14px, side by side, and one of
 * them deleted the row). On a mouse it shrinks to a 28px square so dense
 * desktop tables keep their rhythm.
 *
 * `label` is required: it is what a screen reader says and what the tooltip
 * shows, and an icon-only button without one is a guess.
 */
type Props = {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** `danger` colours the icon red on hover — for delete, not for archive. */
  tone?: 'default' | 'danger' | 'brand'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}

const TONES = {
  default: 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
  danger: 'text-gray-500 hover:bg-red-50 hover:text-red-600',
  brand: 'text-brand-700 hover:bg-brand-50',
}

export function IconButton({ icon: Icon, label, onClick, tone = 'default', disabled, className, type = 'button' }: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 pointer-fine:h-7 pointer-fine:w-7',
        TONES[tone],
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
