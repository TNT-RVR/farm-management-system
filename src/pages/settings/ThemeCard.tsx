import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const CHOICES: [Theme, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['auto', 'Match phone'],
]

/** Light or dark screen, for this device only. See lib/theme.ts. */
export function ThemeCard() {
  const [theme, setTheme] = useTheme()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
      <span className="text-gray-500">Screen</span>
      <div role="radiogroup" aria-label="Screen colours" className="inline-flex rounded-md border border-gray-200 p-0.5">
        {CHOICES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={theme === k}
            onClick={() => setTheme(k)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium',
              theme === k ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
