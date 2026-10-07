/**
 * The demo's own bits of screen: the loading cover while the farm unpacks,
 * and the badge that says this is a demo and offers a reset.
 *
 * Plain DOM with inline styles, so it draws before the app does and does not
 * depend on the app's stylesheet having anything in it.
 */

const BRAND = '#15803d'
const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1)} MB`

export function overlay() {
  const cover = document.createElement('div')
  cover.setAttribute('role', 'status')
  cover.style.cssText = `position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:#f8faf8;font-family:${font};color:#1f2937;padding:16px`
  cover.innerHTML = `
    <div style="max-width:380px;width:100%;text-align:center">
      <div style="font-size:20px;font-weight:700;color:${BRAND}">Prairie Creek Farm</div>
      <div style="margin-top:4px;font-size:13px;color:#6b7280">A demo farm that runs entirely in your browser</div>
      <div style="margin:22px 0 8px;height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden">
        <div data-bar style="height:100%;width:4%;background:${BRAND};transition:width .2s"></div>
      </div>
      <div data-text style="font-size:13px;color:#374151">Getting the demo farm ready…</div>
      <div data-note style="margin-top:14px;font-size:12px;line-height:1.5;color:#6b7280">
        The first visit downloads the farm once; after that it opens straight away.
        Change anything you like — it's your own copy, and it resets overnight.
      </div>
    </div>`
  const attach = () => document.body.appendChild(cover)
  if (document.body) attach()
  else document.addEventListener('DOMContentLoaded', attach, { once: true })
  const bar = cover.querySelector<HTMLElement>('[data-bar]')!
  const text = cover.querySelector<HTMLElement>('[data-text]')!
  let size = 0

  return {
    size(bytes: number) {
      size = bytes
      text.textContent = `Downloading the demo farm (about ${mb(bytes)}) — best on Wi-Fi…`
    },
    progress(stage: string, got?: number, total?: number) {
      if (stage === 'download') {
        const all = total || size
        const pct = all ? Math.min(100, (100 * (got ?? 0)) / all) : 30
        bar.style.width = `${Math.max(4, pct * 0.7)}%`
        text.textContent = all ? `Downloading the demo farm… ${mb(got ?? 0)} of ${mb(all)}` : 'Downloading the demo farm…'
      } else if (stage === 'open') {
        bar.style.width = '60%'
        text.textContent = 'Opening your copy of the farm…'
      } else if (stage === 'unpack') {
        bar.style.width = '75%'
        text.textContent = 'Unpacking the farm…'
      } else if (stage === 'start') {
        bar.style.width = '90%'
        text.textContent = 'Starting up…'
      }
    },
    resetting() {
      cover.style.display = 'flex'
      bar.style.width = '20%'
      text.textContent = 'Putting the farm back the way it started…'
      if (!cover.isConnected) attach()
    },
    done() {
      bar.style.width = '100%'
      cover.style.display = 'none'
    },
    fail(message: string) {
      bar.style.background = '#b91c1c'
      bar.style.width = '100%'
      text.textContent = `The demo could not start: ${message}`
      cover.querySelector<HTMLElement>('[data-note]')!.textContent =
        'It needs a fairly recent browser with a few hundred MB of memory free. Try reloading, or open it on a computer.'
    },
  }
}

/** The corner badge: this is a demo, and a way back to the start. */
export function badge(onReset: () => void) {
  // Above the phone layout's bottom navigation bar (56 px, md:hidden), beside it on wider screens.
  const style = document.createElement('style')
  // Phones: bottom left, above the navigation bar. Wider screens: bottom right, clear of the sidebar.
  style.textContent = `.rvr-demo-badge{left:12px;bottom:calc(68px + env(safe-area-inset-bottom))}@media (min-width:768px){.rvr-demo-badge{left:auto;right:12px;bottom:12px}}@media print{.rvr-demo-badge{display:none!important}}`
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.className = 'rvr-demo-badge'
  el.style.cssText = `position:fixed;z-index:2147483645;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:999px;background:#fffbeb;border:1px solid #fcd34d;box-shadow:0 2px 8px rgba(0,0,0,.12);font-family:${font};font-size:12px;color:#78350f`
  el.innerHTML = `<span><b>Demo</b> · made-up farm, resets overnight</span>`
  const btn = document.createElement('button')
  btn.textContent = 'Reset'
  btn.title = 'Throw away your changes and start the farm again'
  btn.style.cssText = `border:1px solid #f59e0b;background:#fff;color:#92400e;border-radius:999px;padding:2px 10px;font:inherit;cursor:pointer`
  btn.onclick = () => {
    if (confirm('Start the demo farm again? Everything you changed will be thrown away.')) onReset()
  }
  const hide = document.createElement('button')
  hide.textContent = '×'
  hide.title = 'Hide this badge until the page reloads'
  hide.setAttribute('aria-label', 'Hide the demo badge')
  hide.style.cssText = 'border:0;background:none;color:#92400e;font:inherit;font-size:14px;cursor:pointer;padding:0 4px'
  hide.onclick = () => el.remove()
  el.append(btn, hide)
  document.body.appendChild(el)
}

/** Where the free, farm-free copy of the app lives. */
export const PUBLIC_REPO = 'https://github.com/TNT-RVR/farm-management-system'

/**
 * The strip across the top: this is a demo, and here is how to have your own.
 *
 * Above the app rather than over it: the page becomes a column of banner +
 * app, and the app (#root, normally the full window height) takes what is
 * left, so nothing of the app is covered and nothing extra scrolls.
 */
export function banner() {
  const style = document.createElement('style')
  style.textContent = `body.rvr-demo-has-banner{display:flex;flex-direction:column}body.rvr-demo-has-banner #root{flex:1 1 auto;min-height:0;height:auto}@media print{.rvr-demo-banner{display:none!important}}`
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.className = 'rvr-demo-banner'
  el.setAttribute('role', 'region')
  el.setAttribute('aria-label', 'About this demo')
  el.style.cssText = `flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:7px 40px 7px 12px;position:relative;background:${BRAND};color:#fff;font-family:${font};font-size:13px;line-height:1.35;text-align:center`
  const text = document.createElement('span')
  text.innerHTML = `<b>Want this for your own farm?</b> Build your own version for free.`
  const link = document.createElement('a')
  link.href = PUBLIC_REPO
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'Get it on GitHub →'
  link.style.cssText = 'color:#fff;font-weight:700;text-decoration:underline;white-space:nowrap'
  const close = document.createElement('button')
  close.textContent = '×'
  close.setAttribute('aria-label', 'Hide this banner')
  close.title = 'Hide until the page reloads'
  close.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px'
  close.onclick = () => {
    el.remove()
    document.body.classList.remove('rvr-demo-has-banner')
  }
  el.append(text, link, close)
  document.body.classList.add('rvr-demo-has-banner')
  document.body.insertBefore(el, document.body.firstChild)
}
