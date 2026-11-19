/**
 * A ref callback for a form or row that an Add button has just opened
 * somewhere else on the page: bring it on screen and put the cursor in its
 * first box.
 *
 * Phone pass, 18 Nov 2026: on a phone three Add buttons opened their form
 * 500-950 px further down, out of sight, so the tap looked like it did
 * nothing. Skips an element that is not shown, so the same callback can sit
 * on both the phone card and the desktop row and only the visible one moves.
 */
export function revealOnMount(el: HTMLElement | null) {
  if (!el || el.offsetParent === null) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const box = el.matches('input, select, textarea') ? el : el.querySelector<HTMLElement>('input, select, textarea')
  box?.focus({ preventScroll: true })
}
