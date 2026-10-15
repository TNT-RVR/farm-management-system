import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/** Chrome's install event; not in the DOM typings. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const DISMISS_KEY = 'install-banner-dismissed-at'
const QUIET_DAYS = 30

/**
 * "Install the app" when the app is open in a browser, or in Chrome's
 * grey-X bar, instead of as an installed app (Sam, 10 Oct 2026).
 *
 * The bar with the X and ⋮ came back after the move to app.example.com:
 * a phone's home-screen app installed from the old netlify.app address is
 * forwarded here, and Chrome marks the page as outside that app. Installing
 * from this address gives a full-screen app again; the old icon can then be
 * removed. Shown only when Chrome says this address can be installed
 * (beforeinstallprompt), never inside the installed app, and quiet for 30
 * days once dismissed.
 */
export function InstallBanner() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [hidden, setHidden] = useState(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
      return Date.now() - at < QUIET_DAYS * 86_400_000
    } catch {
      return false
    }
  })

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
    if (standalone) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPrompt)
    }
    const onInstalled = () => setPrompt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!prompt || hidden) return null
  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* private window: shows again next time */
    }
  }
  return (
    <div className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
      <Download className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">Use RVR as a full-screen app, without the browser bar.</span>
      <button
        type="button"
        onClick={async () => {
          await prompt.prompt()
          const choice = await prompt.userChoice
          if (choice.outcome === 'accepted') setPrompt(null)
        }}
        className="shrink-0 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
      >
        Install the app
      </button>
      <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0 rounded p-1 text-brand-700 hover:bg-brand-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
