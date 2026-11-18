import { useEffect, useState } from 'react'

/**
 * Light or dark screen, chosen by each person on their own device
 * (design review, Nov 2026).
 *
 * The app gets used before dawn at feeding, in the cab after dark at harvest
 * and in a dark shop, where a full-white screen is hard on the eyes. Off unless
 * somebody turns it on: "Match phone" follows the phone's own setting, "Dark"
 * is always dark. Kept on the device, not the account, because the right
 * answer differs between the office computer and the phone in the truck.
 *
 * The colours live in index.css under `.dark`: it redefines the grey scale
 * and the white surfaces, so no component carries a `dark:` class of its own.
 */
export type Theme = 'light' | 'dark' | 'auto'

const KEY = 'rvr_theme'
const query = () => window.matchMedia('(prefers-color-scheme: dark)')

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'auto' ? v : 'light'
  } catch {
    return 'light'
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'auto' && query().matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** Called once at start-up, before the first paint of the app. */
export function initTheme() {
  apply(storedTheme())
  // "Match phone" changes with the phone, e.g. at sunset.
  query().addEventListener('change', () => apply(storedTheme()))
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
    apply(theme)
  }, [theme])
  return [theme, setTheme]
}
