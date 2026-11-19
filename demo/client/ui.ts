/**
 * The demo's own bits of screen: the loading cover while the farm unpacks,
 * and the badge that says this is a demo and offers a reset.
 *
 * Plain DOM with inline styles, so it draws before the app does and does not
 * depend on the app's stylesheet having anything in it.
 */

import { count } from './count'

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
  /**
   * One failure a visit, however many ways it surfaces. A start that fails
   * also fails the sign-in a moment later, and counting both would say two
   * people could not get in where there was one.
   */
  let failed = false

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
      if (failed) return
      failed = true
      count('fail', message)
      bar.style.background = '#b91c1c'
      bar.style.width = '100%'
      const note = cover.querySelector<HTMLElement>('[data-note]')!
      // The farm is a real Postgres compiled to WebAssembly, so a browser with
      // WebAssembly switched off cannot run the demo at all. Three visitors met
      // the raw "WebAssembly is not defined" and were told to reload, which
      // cannot help (16 Nov 2026). The counter still gets the real error.
      if (/WebAssembly/i.test(message)) {
        text.textContent = 'This browser cannot run the demo.'
        note.innerHTML = `The demo farm is a real database running inside your browser, and that needs
          <b>WebAssembly</b>, which is off or missing here — so reloading will not help. It is usually a
          browser setting, an extension that blocks scripts, or Lockdown Mode on an Apple device. Any
          up-to-date Chrome, Edge, Firefox or Safari will run it.
          <div style="margin-top:10px">The code itself is on
          <a href="${PUBLIC_REPO}" target="_blank" rel="noopener noreferrer" style="color:${BRAND};font-weight:600">GitHub</a>
          if you would rather look at that.</div>`
        return
      }
      text.textContent = `The demo could not start: ${message}`
      note.textContent =
        'It needs a fairly recent browser with a few hundred MB of memory free. Try reloading, or open it on a computer.'
    },
  }
}

function resetButton(onReset: () => void) {
  const btn = document.createElement('button')
  btn.textContent = 'Reset'
  btn.title = 'Throw away your changes and start the farm again'
  btn.style.cssText = `border:1px solid #f59e0b;background:#fff;color:#92400e;border-radius:999px;padding:2px 10px;font:inherit;cursor:pointer`
  btn.onclick = () => {
    if (confirm('Start the demo farm again? Everything you changed will be thrown away.')) onReset()
  }
  return btn
}

/**
 * The corner badge: this is a demo, and a way back to the start.
 *
 * Wider screens only. On a phone a floating badge sat over the bottom of
 * every form and covered the event form's Add button (phone pass, 18 Nov
 * 2026), so there the same words and Reset ride in the top banner instead.
 */
export function badge(onReset: () => void) {
  const style = document.createElement('style')
  style.textContent = `.rvr-demo-badge{right:12px;bottom:12px}@media (max-width:767px){.rvr-demo-badge{display:none!important}}@media print{.rvr-demo-badge{display:none!important}}`
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.className = 'rvr-demo-badge'
  el.style.cssText = `position:fixed;z-index:2147483645;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:999px;background:#fffbeb;border:1px solid #fcd34d;box-shadow:0 2px 8px rgba(0,0,0,.12);font-family:${font};font-size:12px;color:#78350f`
  el.innerHTML = `<span><b>Demo</b> · made-up farm, resets overnight</span>`
  const btn = resetButton(onReset)
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
export function banner(onReset: () => void) {
  const style = document.createElement('style')
  // Phones get the short wording and a second line standing in for the corner badge.
  style.textContent = `body.rvr-demo-has-banner{display:flex;flex-direction:column}body.rvr-demo-has-banner #root{flex:1 1 auto;min-height:0;height:auto}.rvr-demo-phone{display:none}@media (max-width:767px){.rvr-demo-long{display:none}.rvr-demo-phone{display:flex}}@media print{.rvr-demo-banner{display:none!important}}`
  document.head.appendChild(style)
  const el = document.createElement('div')
  el.className = 'rvr-demo-banner'
  el.setAttribute('role', 'region')
  el.setAttribute('aria-label', 'About this demo')
  el.style.cssText = `flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:4px 10px;flex-wrap:wrap;padding:6px 40px 6px 12px;position:relative;background:${BRAND};color:#fff;font-family:${font};font-size:13px;line-height:1.35;text-align:center`
  const text = document.createElement('span')
  text.innerHTML = `<b>Want this for your own farm?</b><span class="rvr-demo-long"> Build your own version for free.</span>`
  const link = document.createElement('a')
  link.href = PUBLIC_REPO
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'Get it on GitHub →'
  link.style.cssText = 'color:#fff;font-weight:700;text-decoration:underline;white-space:nowrap'
  link.addEventListener('click', () => count('github'))
  const close = document.createElement('button')
  close.textContent = '×'
  close.setAttribute('aria-label', 'Hide this banner')
  close.title = 'Hide until the page reloads'
  close.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px'
  close.onclick = () => {
    el.remove()
    document.body.classList.remove('rvr-demo-has-banner')
  }
  const phone = document.createElement('div')
  phone.className = 'rvr-demo-phone'
  phone.style.cssText = 'flex-basis:100%;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#fef3c7'
  phone.innerHTML = `<span><b>Demo</b> · made-up farm, resets overnight</span>`
  phone.append(resetButton(onReset))
  el.append(text, link, phone, close)
  document.body.classList.add('rvr-demo-has-banner')
  document.body.insertBefore(el, document.body.firstChild)
}
