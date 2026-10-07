/**
 * Who this app belongs to: its name, its logo, and where its maps open.
 *
 * ── Start here to make the app yours. ──
 *
 * Every screen that shows the app's or the farm's name, or draws a map before
 * it knows where your fields are, reads it from here. Change these and the
 * login page, the header, the home-screen icon name, notifications and every
 * map's starting view follow.
 *
 * For your own logo, put the file in /public (an SVG or a PNG around 256 px
 * tall) and point `logo` at it. For the home-screen icons, replace
 * public/pwa-192.png, pwa-512.png, apple-touch-icon.png and favicon.png with
 * your own at the same sizes.
 */
export const BRAND = {
  /** Full name, on the login page and the installed app. */
  appName: 'Farm Management System',
  /** Under the home-screen icon; keep it to about 12 characters. */
  shortName: 'Farm',
  /** Your farm, as it should appear on printouts and greetings. */
  farmName: 'Your Farm',
  /** One line for the installed app's description. */
  description: 'Farm and ranch management',
  /** Logo in the header and on the login page, from /public. */
  logo: '/logo.svg',
  /** Browser bar and installed-app colour. */
  themeColor: '#166534',
  /**
   * Where a map opens before it has any fields to zoom to: [longitude,
   * latitude]. Put the middle of your farm here — right-click a spot in
   * Google Maps to copy it (Google gives latitude first; swap them).
   */
  mapCenter: [-113.5, 52.5] as [number, number],
} as const
