/**
 * The keys and links a farm can enter on Farm setup instead of in Netlify.
 *
 * Shared by the setup screen (what to ask for, and how to get it) and the
 * server (netlify/shared/secrets.ts, which loads saved ones into a function
 * before it runs). A key set in Netlify's environment always wins, so a farm
 * that already set things up there sees nothing change.
 *
 * Not here, deliberately: the database's own keys (the app cannot start
 * without them), TOKEN_ENC_KEY (it encrypts the stored Deere and FieldNET
 * tokens, so it must not live beside them), and anything the browser needs at
 * build time.
 */

export type SetupKey = {
  /** The environment variable name — also the app_secrets key it is saved under. */
  env: string
  label: string
  group: string
  /** True for anything that must never be shown again once saved. */
  secret: boolean
  /** One line: what it is and where it comes from. */
  help: string
  link?: string
  /** The server can make one up (a random shared secret between two of our own functions). */
  generate?: boolean
  optional?: boolean
  /** A plain note (an account email, say) shown back once saved. Never set on a secret. */
  shown?: boolean
}

export const SETUP_KEYS: SetupKey[] = [
  {
    env: 'SITE_URL',
    label: 'Site address',
    group: 'Your site',
    secret: false,
    help: "This app's address, e.g. https://your-farm.netlify.app — used for sign-in links, the John Deere and FieldNET connections, and phone notifications.",
  },
  {
    env: 'PUSH_HOOK_SECRET',
    label: 'Notification secret',
    group: 'Your site',
    secret: true,
    generate: true,
    help: 'Lets the database ask this site to send a phone notification, and nobody else. Press Generate.',
  },
  {
    env: 'ANTHROPIC_API_KEY',
    label: 'AI key (Anthropic)',
    group: 'AI features',
    secret: true,
    help: 'Powers label reading, advice, write-ups and voice capture. Create a key in the Anthropic console.',
    link: 'https://console.anthropic.com/settings/keys',
  },
  {
    env: 'JOB_WORKER_KEY',
    label: 'Background jobs key',
    group: 'AI features',
    secret: true,
    generate: true,
    help: 'Lets the scheduled jobs start the longer background ones. Any long random string — press Generate.',
  },
  {
    env: 'JD_CLIENT_ID',
    label: 'Application ID',
    group: 'John Deere Operations Center',
    secret: false,
    help: 'From your app on developer.deere.com. Set its redirect URI to <your site>/api/jd-callback.',
    link: 'https://developer.deere.com',
  },
  { env: 'JD_CLIENT_SECRET', label: 'Application secret', group: 'John Deere Operations Center', secret: true, help: 'From the same app on developer.deere.com.' },
  {
    env: 'FIELDNET_CLIENT_ID',
    label: 'Client ID',
    group: 'Lindsay FieldNET',
    secret: false,
    help: "From Lindsay's developer program. Callback: <your site>/api/fieldnet/callback.",
  },
  { env: 'FIELDNET_CLIENT_SECRET', label: 'Client secret', group: 'Lindsay FieldNET', secret: true, help: "From Lindsay's developer program." },
  {
    env: 'QUICKBOOKS_CLIENT_ID',
    label: 'Client ID',
    group: 'QuickBooks Online',
    secret: false,
    help: 'The production Client ID from your app on developer.intuit.com (Keys & credentials → Production). Add <your site>/api/quickbooks/callback under Production redirect URIs.',
    link: 'https://developer.intuit.com/app/developer/dashboard',
  },
  { env: 'QUICKBOOKS_CLIENT_SECRET', label: 'Client secret', group: 'QuickBooks Online', secret: true, help: 'The production secret from the same Intuit app.' },
  {
    env: 'GOOGLE_DRIVE_CLIENT_ID',
    label: 'Client ID',
    group: 'Google Drive backup',
    secret: false,
    help: 'From a Google Cloud project with the Google Drive API on: an OAuth client of type "Web application", with <your site>/api/google-drive-callback as its redirect URI. Publish the consent screen (In production) or Google drops the sign-in after 7 days.',
    link: 'https://console.cloud.google.com/apis/credentials',
  },
  { env: 'GOOGLE_DRIVE_CLIENT_SECRET', label: 'Client secret', group: 'Google Drive backup', secret: true, help: 'From the same OAuth client.' },
  {
    env: 'CDSE_CLIENT_ID',
    label: 'Client ID',
    group: 'Satellite imagery (Copernicus)',
    secret: false,
    help: 'A free OAuth client from the Copernicus Data Space dashboard.',
    link: 'https://shapps.dataspace.copernicus.eu/dashboard/',
  },
  { env: 'CDSE_CLIENT_SECRET', label: 'Client secret', group: 'Satellite imagery (Copernicus)', secret: true, help: 'From the same Copernicus OAuth client.' },
  {
    env: 'SAT_INGEST_ENABLED',
    label: 'Fetch imagery automatically',
    group: 'Satellite imagery (Copernicus)',
    secret: false,
    optional: true,
    help: 'Type true to have new imagery pulled on a schedule.',
  },
  {
    env: 'ESHEPHERD_REPRO_TOKEN',
    label: 'Dashboard token',
    group: 'eShepherd collars',
    secret: true,
    optional: true,
    help: 'From eShepherd, for the pregnancy and heat dashboard.',
  },
  {
    env: 'SOLIS_KEY_ID',
    label: 'KeyID',
    group: 'SolisCloud solar',
    secret: false,
    help: 'From soliscloud.com on a computer: Service → API Management → View Key, once Solis support has turned API access on.',
    link: 'https://www.soliscloud.com',
  },
  { env: 'SOLIS_KEY_SECRET', label: 'KeySecret', group: 'SolisCloud solar', secret: true, help: 'Shown beside the KeyID on the same SolisCloud page.' },
  {
    env: 'SOLIS_API_URL',
    label: 'API URL',
    group: 'SolisCloud solar',
    secret: false,
    optional: true,
    help: 'Shown with the keys. Leave blank for the usual https://www.soliscloud.com:13333.',
  },
  {
    env: 'TIMEOFF_ICS_URL',
    label: 'Time-off calendar link',
    group: 'Staff time off',
    secret: true,
    optional: true,
    help: 'The calendar subscription link (webcal:// or https://) from your HR or payroll system’s time-off page.',
  },
  {
    env: 'INBOUND_EMAIL_SENDERS',
    label: 'Accepted sender domains',
    group: 'Invoices and reports by email',
    secret: false,
    optional: true,
    help: 'Comma-separated, e.g. "afsc.ca, myretailer.com". Mail from anywhere else is ignored.',
  },
  {
    env: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    label: 'Service account email',
    group: 'Feed sheet (Google Sheets)',
    secret: false,
    optional: true,
    help: 'A Google Cloud service account the feed sheet is shared with.',
  },
  { env: 'FEED_SHEET_ID', label: 'Sheet ID', group: 'Feed sheet (Google Sheets)', secret: false, optional: true, help: 'The long ID in the sheet’s address.' },
  {
    env: 'RESEND_ACCOUNT_EMAIL',
    label: 'Resend login email',
    group: 'Email sender (Resend)',
    secret: false,
    optional: true,
    shown: true,
    help: 'The email you sign in to resend.com with, kept here as a reminder. Resend sends the sign-in emails; its key is saved in Supabase (Authentication → Emails → SMTP), not here.',
    link: 'https://resend.com/login',
  },
]

export const SETUP_KEY_NAMES = new Set(SETUP_KEYS.map((k) => k.env))

/** What the server says about a key — never its value. */
export type KeyStatus = {
  env: string
  source: 'netlify' | 'app' | null
  updated_at: string | null
  /** Only for keys marked `shown`. */
  value?: string | null
}
