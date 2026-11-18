/**
 * True in the public demo build (demo/vite.config.ts defines VITE_DEMO), where
 * the database runs in the browser and nothing reaches the outside world.
 *
 * Use it only to say "not in the demo" in place of a dead end the farm's own
 * copy never meets: a feed address that answers 503, a blank form left out of
 * the public copy, a background AI run with no server behind it.
 */
export const IS_DEMO: boolean = import.meta.env.VITE_DEMO === '1'
