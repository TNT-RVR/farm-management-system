# Connecting QuickBooks Online

The app can read your QuickBooks Online books — bills, expenses, invoices,
their attached PDFs — so you can find any invoice, add up spending by vendor,
account or month, and ask questions about it. It only ever **reads**; it never
changes anything in QuickBooks. Only the farm's owners, and people they give
finance access (your accountant), can connect it or see the data.

You need your own Intuit developer app. Intuit asks a long list of questions
before it hands out production keys; this page is the checklist, with what the
app actually does so you can answer each one truthfully. Answers marked
**(you)** depend on your business, not the app — answer those yourself.

Throughout, `your-farm.netlify.app` means your site's address (Settings → Farm
setup → Keys → Site address).

---

## Part 1 — Before you start (in the app)

- [ ] **Settings → Farm setup → Names and defaults → Support contact email.**
      Fill it in. It appears on your privacy policy, licence agreement and the
      QuickBooks card, and Intuit's review looks for a contact. Leave it blank
      and those pages say "contact the owners".
- [ ] Check your farm name and province on Farm setup — the legal pages use them.
- [ ] Open both legal pages and read them. They describe what this app does
      with QuickBooks data. Change the text in `src/pages/LegalPage.tsx` if
      your situation differs; have your own advisor review them if you want.
  - Privacy policy: `https://your-farm.netlify.app/legal/privacy`
  - Licence agreement: `https://your-farm.netlify.app/legal/terms`
- [ ] `TOKEN_ENC_KEY` is set in Netlify (see SETUP.md) — it encrypts the stored
      QuickBooks sign-in, the same as John Deere's and FieldNET's.

## Part 2 — Create the Intuit app

- [ ] Sign in at [developer.intuit.com](https://developer.intuit.com) with the
      Intuit login that owns your QuickBooks company.
- [ ] **Create an app** → QuickBooks Online and Payments → scope
      **Accounting** (`com.intuit.quickbooks.accounting`) only.
- [ ] Development settings → **Redirect URIs** → add exactly
      `https://your-farm.netlify.app/api/quickbooks/callback`
- [ ] Copy the **development** Client ID and Client secret.

## Part 3 — Test with a sandbox first (Intuit asks if you did)

- [ ] developer.intuit.com → **Sandbox** → add a sandbox company in your
      country if you don't have one. It's sample data, not your books.
- [ ] In the app: **Settings → Farm setup → Keys → QuickBooks Online** — paste
      the development Client ID and secret. Leave *Sandbox or production* blank.
- [ ] **Settings → Integrations → QuickBooks Online → Connect QuickBooks**, sign
      in, pick the sandbox company. You land back on Integrations and the first
      sync starts by itself.
- [ ] Open the **QuickBooks** page — it shows a yellow "Sandbox" banner and the
      sample company's transactions. Open one with an attachment.
- [ ] Press **Disconnect**, then **Connect QuickBooks** again. (Intuit asks
      whether you tested connect, disconnect and reconnect.)

## Part 4 — The production questionnaire

### App details and URLs

| Field | Enter |
| --- | --- |
| End-user licence agreement URL | `https://your-farm.netlify.app/legal/terms` |
| Privacy policy URL | `https://your-farm.netlify.app/legal/privacy` |
| Host domain | `your-farm.netlify.app` (no https://) |
| Launch URL | `https://your-farm.netlify.app/quickbooks` |
| Disconnect URL | `https://your-farm.netlify.app/integrations?qb_disconnected=1` |
| Connect/Reconnect URL | `https://your-farm.netlify.app/integrations` |
| Where hosted — country | The country of your Netlify and Supabase regions (usually **United States**) |
| IP address | **Leave blank** — Netlify has no fixed outgoing IP, which is the case Intuit's note describes |

### Compliance

| Question | Answer |
| --- | --- |
| Complaints, lawsuits or regulator requests? | **(you)** |
| Worked with legal counsel on regulatory requirements? | **(you)** — only Yes if someone actually reviewed it |
| Will comply with Intuit's security policies? | Yes — HTTPS everywhere, tokens encrypted and server-side only, read-only |
| App relates to QuickBooks / a business process? | Yes |
| On a sanctions list / doing business in embargoed regions? | **(you)** |
| Generative AI? | **Yes** — the optional *Ask* box sends summarised figures to Anthropic's Claude API, which does not train on API data, to answer questions about your own books. Say so; the privacy policy does. |

### About the app

| Question | Answer |
| --- | --- |
| Which is true about your app | **You built your app from scratch and wrote the code that lets it interact with Intuit APIs and data** |
| Platforms it calls from | **Web/SaaS** (all calls come from the app's server functions, never the browser) |
| How it interacts with data | **It reads data** only |
| Private or public | **Private app for my team/business** |
| QuickBooks users who can use it | Your own company only |
| Integrates with other platforms | Yes if you use John Deere, FieldNET or the AI features; otherwise No |

### OAuth

| Question | Answer |
| --- | --- |
| Tested connect, disconnect, reconnect with a sandbox | Yes — once you've done Part 3 |
| How often are access tokens refreshed | Before each use when within 5 minutes of expiry (they last an hour) |
| Retries failed authorization requests | **No** — it stops and asks for a reconnect; the next nightly sync is the only other attempt |
| Asks customers to reconnect on auth errors | Yes — the Integrations card shows it and the health monitor alerts managers |
| Used Intuit's discovery document | Yes |
| Handles expired access tokens / expired refresh tokens / invalid grant / CSRF | Yes / Yes / Yes / Yes (a one-time `state` is checked on every connect) |
| Relies on the OAuth playground or offline tools | No |

### API usage

| Question | Answer |
| --- | --- |
| API categories | **Accounting API** |
| How often it calls the API | **Daily** (nightly sync, plus manual syncs and opening attachments) |
| QuickBooks versions | All four (Simple Start, Essentials, Plus, Advanced) |
| Handles gaining or losing version features | Yes — e.g. classes (Plus/Advanced only) are simply empty when absent |
| Multicurrency / sales tax features | **None of the above** (it doesn't do anything special with them) |
| Webhooks | No |
| CDC | Yes — *why:* "Querying specific entities doesn't give me the information I need" + Other: "nightly incremental sync; one CDC call returns everything created, changed or deleted since the last sync, including deletions, which a query can't report." *How often:* **Daily** |

### Errors and support

| Question | Answer |
| --- | --- |
| Tested API errors (syntax, validation) | Yes — after you've run the sandbox test |
| Captures `intuit_tid` | Yes — every Intuit error message carries it |
| Stores error information in logs | Yes — Netlify function logs, the connection's last error, the health monitor |
| Support contact inside the app | Yes — the QuickBooks card shows your Farm setup support email |

### Security

| Question | Answer |
| --- | --- |
| Security breach requiring notification | **(you)** |
| Security team that assesses risks | **(you)** — a farm usually answers No |
| Client ID and secret stored securely | Yes — saved server-side in a table no signed-in user can read; never in the code or the browser |
| Multi-factor authentication | Yes if your owners and accountant turn on authenticator-app sign-in (Settings → Your account); otherwise No |
| Captcha | No |
| WebSocket | Yes — the live notification bell; no QuickBooks data travels over it |
| Intuit data shown to anyone other than that customer | No — only your own owners and accountant |

## Part 5 — Switch to your real books

- [ ] When Intuit approves, copy the **production** Client ID and secret.
- [ ] Add the same redirect URI under **production** settings.
- [ ] Farm setup → Keys → paste the production keys and type `production` in
      *Sandbox or production*.
- [ ] Integrations → **Connect QuickBooks** again and choose your real company.
      The sandbox rows stay behind under the sandbox company and never mix in.

## If something goes wrong

- The Integrations card shows the last error, including Intuit's
  `intuit_tid` — give that to QuickBooks support.
- "Reconnect QuickBooks": the sign-in expired (100 days unused) or was
  removed from QuickBooks' side. Press Connect again.
- Netlify → Logs → Functions → `quickbooks-sync-background` shows each sync.
