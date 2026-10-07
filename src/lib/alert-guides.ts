import { PUBLIC_COPY } from '../config/edition'
/**
 * What each kind of notification means and what to do about it. Opened from
 * the notification itself, so whoever gets the alert on their phone has the
 * steps in front of them, and the error log at the bottom of the page can tell
 * an AI chat where in the code the alert comes from.
 *
 * Written for any farm running this app, so nothing here names a field,
 * person or place. `raisedBy` lists the files that raise the alert; keep it
 * current when an alert moves.
 */

export type AlertGuide = {
  /** A plain name for the kind of alert. */
  name: string
  /** What happened, in a sentence or two. */
  meaning: string
  /** What to do, in order. */
  steps: string[]
  /** Things to look at when the steps don't settle it. */
  checks: string[]
  /** Where in the code this alert is raised (for the error log). */
  raisedBy: string[]
  /** Severity for the page's colour: an alert to act on, a notice, or good news. */
  tone: 'act' | 'notice' | 'info'
}

const G: Record<string, AlertGuide> = {
  integration_alert: {
    name: 'Data feed health',
    meaning:
      'A data feed the app depends on (weather, FieldNET, John Deere, invoices, market prices, satellite…) has stopped reporting or returned an error. Anything built on that feed is now running on old data. A "recovered" alert means it is healthy again and nothing needs doing.',
    steps: [
      'Open Settings → Integrations and find the feed named in the title. Its line says when it last worked and what went wrong.',
      'If it is a connected account (John Deere, FieldNET, Google), use Reconnect — expired logins are the most common cause.',
      'If it is a scheduled job, use its Run now / Sync button where there is one, then reload the Integrations page.',
      'If it errors again, copy the error log below into an AI chat with this repository open.',
    ],
    checks: [
      'Is the outside service itself down? (Try its own website or app.)',
      'Did a password, API key or token change recently? Keys live in the hosting environment variables.',
      'Is the "last success" time older than the feed\'s allowed gap? The detail line says how stale it is.',
      'For a job that runs on this office computer (invoice import), is the computer on and Google Drive syncing?',
    ],
    raisedBy: ['netlify/functions/integration-health.mts (judgeProbe and the alert at the end of each source)'],
    tone: 'act',
  },
  aimm_change: {
    name: 'Irrigation model source changed',
    meaning:
      'A source the irrigation model copies from the provincial AIMM program changed or disappeared: its crop curves, station list, manuals or announcement page. The app never applies such a change by itself — someone has to look and decide.',
    steps: [
      'Read the "What changed" section below: lines added and removed, and what that source feeds in the app.',
      'If the crop table changed: reload the AIMM crop table and re-check the water-use calibration against AIMM.',
      'If the station list changed: check each weather station in Irrigation → Setup still has a file to read.',
      'If a manual or the AIMM page changed: skim it for a new version or changed equations.',
      'If a source is "gone": find where it moved and update its address in the AIMM watch list.',
    ],
    checks: [
      'Did the province publish a new AIMM version (new manual year in the link)?',
      'Are the AIMM graph and the app\'s graph still close for a field you know?',
      'Irrigation → Setup → AIMM alignment shows every watched source and its state.',
    ],
    raisedBy: ['netlify/functions/aimm-watch.mts', 'src/lib/watch-text.ts'],
    tone: 'notice',
  },
  fieldnet_fault: {
    name: 'Pivot fault',
    meaning: 'A pivot reported a fault or a shutdown to FieldNET (alignment, pressure, power, end gun…). It has probably stopped.',
    steps: [
      'Check the pivot in the FieldNET app or go to it — the fault name in the message is what the panel reported.',
      'Fix the cause on site and restart the pivot.',
      'In the app, the field\'s irrigation graph will show the dry arc the stopped pass left; plan a pass to cover it.',
    ],
    checks: ['Power and pressure at the pivot.', 'Tower alignment and tires.', 'Whether the panel has signal (an offline panel cannot report).'],
    raisedBy: ['netlify/shared/fieldnet-sync-core.ts'],
    tone: 'act',
  },
  fieldnet_behind: {
    name: 'Uneven watering',
    meaning: 'Part of a pivot circle has had much less water this season than the rest — usually a pass that stopped partway.',
    steps: ['Open the field\'s irrigation page and its map; the dry wedges show where.', 'Run a pass over that part of the circle.'],
    checks: ['FieldNET history for a pass that stopped early.', 'A pivot parked over the same spot for days.'],
    raisedBy: ['netlify/shared/fieldnet-sync-core.ts'],
    tone: 'act',
  },
  fieldnet_offline: {
    name: 'Pivot panel offline',
    meaning: 'A pivot\'s FieldNET panel has stopped reporting. Water it applies is not being recorded, so the irrigation balance will run dry on paper.',
    steps: [
      'Check the panel\'s power and cell signal; restart it.',
      'Until it is back, log each pass by hand on the field\'s irrigation page ("hours run").',
    ],
    checks: ['The panel\'s cellular plan or SIM.', 'A breaker or a damaged antenna.'],
    raisedBy: ['netlify/functions/fieldnet-applied-background.mts'],
    tone: 'act',
  },
  water_allotment: {
    name: 'Water allotment',
    meaning: 'A reminder about this season\'s irrigation-district allotment, or a change to it.',
    steps: ['Open Irrigation → Graph, pick a canal field and check the allotment line.', 'Set the year\'s allotment if it has not been set.'],
    checks: ['The district\'s latest notice.'],
    raisedBy: ['netlify/shared/smrid-allotment.ts', 'netlify/shared/lease-reminders.ts'],
    tone: 'notice',
  },
  stock_return: {
    name: 'Grazing lease stock returns due',
    meaning:
      'Each provincial grazing lease files a Stewardship Stock Return every year, due 31 January after the grazing season: the livestock that grazed it, the dates in and out, brands, hay and feed, and other land fenced in with it. This reminder comes once in early January and lists the leases with no return marked filed for the year.',
    steps: [
      'Open Cattle → Grazing leases and pick each lease named in the reminder.',
      'Check the answers the app filled in (marked "check"), fill the rest, and tick the declaration.',
      'Download the PDF, copy it onto the province’s form or send it to the district office, then mark the return filed.',
    ],
    checks: [
      'The counts and dates the app offers are the ranch’s whole herd unless the lease’s pastures are ticked in its setup, so check them against what actually went on it.',
      'A lease that has ended can be switched off so it stops being listed.',
    ],
    raisedBy: ['netlify/shared/lease-reminders.ts (remindStockReturns)'],
    tone: 'notice',
  },
  water_quality_request: {
    name: 'Ask for the irrigation water results',
    meaning:
      'The province samples the irrigation canal every month of the summer but only publishes the results a year or more later. Its water quality specialist will send them on request: the general chemistry, nutrients, metals and bacteria about two weeks after each sample, and the pesticides in one batch the following winter. This reminder comes once in the fall and once in the winter, and only while the results are still missing from the app.',
    steps: [
      'Email the specialist named in the details below and ask for the results listed there.',
      PUBLIC_COPY
        ? 'When the spreadsheet comes back, have your AI assistant add an upload for it on River → Water quality (this copy has no import for it yet).'
        : 'When the spreadsheet comes back, load it: node scripts/import-water-quality-file.mjs "<file>" --dry to check it, then again without --dry.',
      'Open River → Water quality to see the new results and anything over a guideline.',
    ],
    checks: [
      'Did the province publish them in the meantime? The monthly pull would then have them already.',
      'Do the site codes in the spreadsheet match the stations in the app? Unknown sites are listed and skipped by the loader.',
    ],
    raisedBy: ['netlify/shared/lease-reminders.ts (remindWaterQualityRequest)'],
    tone: 'notice',
  },
  smrid_allotment: {
    name: 'District allotment changed',
    meaning: 'The irrigation district published a new allotment per acre. The app has updated itself; water-use pace and "on pace to run out" verdicts now use it.',
    steps: ['Open a canal field\'s water use on the irrigation page to see the new figure.'],
    checks: ['The district notice linked on that page.'],
    raisedBy: ['netlify/shared/smrid-allotment.ts'],
    tone: 'info',
  },
  irrigation: {
    name: 'Irrigation needed',
    meaning: 'The soil-water balance says a field has reached, or is about to reach, its irrigation threshold.',
    steps: ['Open the field on the irrigation page; the planner shows when to start the pivot and at what speed.'],
    checks: ['Recent rain the model may not have yet (log your gauge).', 'A measured soil moisture reading to confirm.'],
    raisedBy: ['netlify/functions/irrigation-sync.mts'],
    tone: 'act',
  },
  river_release: {
    name: 'River flow',
    meaning: 'River flow or a dam release crossed the level you set an alert for.',
    steps: ['Open Irrigation → River for the station readings.', 'Decide whether pumps need to come out or go back in.'],
    checks: ['The upstream station and the travel time to your pumps.'],
    raisedBy: ['netlify/functions/river-watch.mts'],
    tone: 'act',
  },
  water_quality: {
    name: 'Something in the irrigation water',
    meaning:
      'A new provincial sample of the river or canal water you irrigate from had something above a Canadian or Alberta guideline for irrigation or livestock water: a pesticide, a metal, salt, or bacteria. Guidelines are set to protect the most sensitive crop or animal with a wide margin, so being over one is a reason to look, not proof of harm. The samples are taken by the province, not on your farm, and often reach the app months after they were taken.',
    steps: [
      'Read "What changed" below: what was found, how much, where and when, and the guideline it was over.',
      'Open Irrigation → River → Water quality to see whether it is a one-off or keeps turning up season after season.',
      'For a herbicide: compare the amount in a season of irrigation (shown as g/ha) with the label rate, and think about which of your crops are sensitive to that group — beans, potatoes and other broadleaf crops for the growth-regulator herbicides (2,4-D, MCPA, dicamba, clopyralid).',
      'For E. coli: matters most for crops eaten raw (carrots, spinach, other vegetables) and for watering stock. Talk to the district and the buyer about their food-safety rules.',
      'For salt (EC, SAR, sodium, chloride): watch the salt-sensitive crops (beans, potatoes, carrots) and the saline patches.',
      'If it matters for a crop decision, ask the district or the province\'s water quality specialist for the current season\'s results.',
    ],
    checks: [
      'Was the sample at a station near your intake? The station is named in the details.',
      'Was the lab\'s detection limit itself above the guideline? Then "not detected" does not mean under it.',
      'Has the same thing been over the guideline before? A long record of it with no crop symptoms is reassuring.',
      'Did anyone report crop injury downstream of the same canal or reach that season?',
    ],
    raisedBy: ['netlify/shared/water-quality.ts (flagNewConcerns)', 'src/lib/water-concerns.ts (guidelines and rules)'],
    tone: 'notice',
  },
  crop_weather: {
    name: 'Crop weather',
    meaning: 'Frost, heat or another weather event is forecast that matters to a crop in the ground.',
    steps: ['Open Weather for the forecast and the fields affected.'],
    checks: ['The crop stage on those fields.'],
    raisedBy: ['netlify/shared/crop-weather-watch.ts'],
    tone: 'notice',
  },
  bin_needs_air: {
    name: 'Bin needs air',
    meaning: 'A bin went in tough or damp, or its cable temperatures are rising. It needs aeration.',
    steps: ['Open Harvest → Bins for the bin\'s moisture and temperatures.', 'Turn the fan on.'],
    checks: ['Cable readings over the next days.', 'Outside humidity before running fans.'],
    raisedBy: ['database trigger on bin loads'],
    tone: 'act',
  },
  fert_buy_window: {
    name: 'Fertilizer buying window',
    meaning: 'A fertilizer price has dropped into its cheapest third of the past year.',
    steps: ['Open Fertilizer → Savings for the price history and a booking suggestion.'],
    checks: ['Your supplier\'s current quote.'],
    raisedBy: ['netlify/shared/fert-signals.ts'],
    tone: 'info',
  },
  fert_deadline: {
    name: 'Early-order deadline',
    meaning: 'A supplier\'s early-order or prepay deadline is about a week away.',
    steps: ['Open Fertilizer → Savings to compare prepay against your operating-loan rate.'],
    checks: ['The program\'s terms.'],
    raisedBy: ['netlify/shared/fert-signals.ts'],
    tone: 'notice',
  },
  n_ratio_moved: {
    name: 'Nitrogen price ratio moved',
    meaning: 'The nitrogen-to-crop price ratio moved enough to change the most profitable nitrogen rate.',
    steps: ['Open Fertilizer to see the new economic rate per crop.'],
    checks: ['That the crop prices in the app are current.'],
    raisedBy: ['netlify/shared/n-ratio-watch.ts'],
    tone: 'info',
  },
  market_alert: {
    name: 'Market alert',
    meaning: 'A price you set an alert or target for was reached.',
    steps: ['Open Marketing for the price and your position.'],
    checks: ['Basis and delivery period.'],
    raisedBy: ['netlify/shared/market-alerts.ts'],
    tone: 'notice',
  },
  grant_new: {
    name: 'Grant found',
    meaning: 'A new grant or program that may fit the farm was found.',
    steps: ['Open Grants for the details, eligibility and deadline.'],
    checks: ['The program\'s own page — amounts are found by search and need confirming.'],
    raisedBy: ['netlify/shared/grants-pull.ts'],
    tone: 'info',
  },
  lease: {
    name: 'Lease reminder',
    meaning: 'A land lease is coming up for renewal or a payment is due.',
    steps: ['Open Land → Leases for the lease and its terms.'],
    checks: ['Notice period in the lease.'],
    raisedBy: ['netlify/shared/lease-reminders.ts'],
    tone: 'notice',
  },
  monday_brief: {
    name: 'Weekly brief',
    meaning: 'The week-ahead summary.',
    steps: ['Read it; each line links to its screen.'],
    checks: [],
    raisedBy: ['netlify/shared/monday-brief.ts'],
    tone: 'info',
  },
  spray_rotation_conflict: {
    name: 'Herbicide carryover',
    meaning: 'A herbicide applied on a field may restrict the crop planned there next.',
    steps: ['Open the field\'s rotation plan to see the product and its re-cropping interval.'],
    checks: ['The product label\'s re-crop table.'],
    raisedBy: ['netlify/shared/spray-rotation-check.ts'],
    tone: 'act',
  },
  grazing_restriction: {
    name: 'Spray: keep livestock off',
    meaning:
      'A product was sprayed on ground that livestock eat from — a feed crop (silage, green feed, hay, high-moisture corn…), a field with stubble grazing planned, or a pasture — and its label says animals must not graze it, or it must not be cut and fed, until a date (or not at all for the treated crop). The details below give each product, the date it went on, the label\'s own words and the date it is allowed again.',
    steps: [
      'Read "What changed" below: each product, when it went on, and until when grazing or feeding is off.',
      'Tell whoever moves the cattle and whoever runs the swather or silage crew. Nothing goes on or comes off that ground before the date.',
      'Open the field (Go to it) and use "Open the label" to read the label\'s grazing and feeding section yourself — the app read it, but the label is the law.',
      'If stubble or swath grazing is planned there, move its start date past the restriction on Cattle → Feed, or plan another field.',
      'A "not at all" restriction covers the treated crop, its stubble and swaths included; the app counts it to 1 May next year.',
    ],
    checks: [
      'Was the crop right? The rule depends on the crop it went on (Deere\'s treated crop, else the crop plan). A label can allow grazing on one crop and forbid it on another.',
      'Is it marked "assumed"? Then the label does not name this crop, and the app used the label\'s strictest line, or the crop\'s feeding line for grazing. Check the label.',
      'Did the spray record come from John Deere with the right product? A wrong product can be corrected on the operation.',
      'Animals that graze treated ground may also have to come off a number of days before slaughter — listed when the label says so.',
    ],
    raisedBy: ['netlify/shared/grazing-watch.ts (planGrazingNotices)', 'src/lib/grazing-restrictions.ts (the rules)', 'netlify/shared/grazing-rules-core.ts (reading the labels)'],
    tone: 'act',
  },
  grazing_conflict: {
    name: 'Cattle inside a spray restriction',
    meaning:
      'Cattle are on — or are planned to go onto — ground inside a spray\'s grazing restriction: a pasture move into a sprayed pasture, a pasture whose fence takes in a sprayed crop field, or stubble grazing planned to start before the label allows. Sent once per clash.',
    steps: [
      'Check now where the herd is. If they are on the sprayed ground (or can reach it), move them or fence it off.',
      'For planned stubble grazing: change its start date on Cattle → Feed to after the date in the alert, or plan another field.',
      'Open the field or the Grazing restrictions page and use "Open the label" to read the label\'s grazing section.',
      'If animals did graze it, check the label for a slaughter withdrawal (meat animals off treated fields a number of days before slaughter) and note it before anything is sold.',
    ],
    checks: [
      'Is the pasture fence really around the field? The app treats a field as inside a pasture when most of it is inside the pasture\'s mapped boundary; a pivot fenced off inside a pasture is not reachable.',
      'Are the grazing dates right? Pasture moves come from the collar imports; stubble grazing from the Feed tab.',
      'Was the spray on the right field and date in John Deere, or on the pasture spray record?',
    ],
    raisedBy: ['netlify/shared/grazing-watch.ts (planGrazingNotices)', 'src/lib/grazing-restrictions.ts (grazingPicture, clashes)'],
    tone: 'act',
  },
  jd_boundary: {
    name: 'Field boundary from John Deere',
    meaning: 'A field boundary changed in John Deere Operations Center.',
    steps: ['Open the field and check the boundary before accepting it.'],
    checks: [],
    raisedBy: ['netlify/functions/jd-boundaries-cron.mts'],
    tone: 'notice',
  },
  ab_input_prices: {
    name: 'Provincial input prices',
    meaning: 'New provincial farm input prices were published (fuel, fertilizer, feed, labour).',
    steps: ['Review the prices the app uses for estimates.'],
    checks: [],
    raisedBy: ['netlify/functions/ab-input-prices-cron.mts'],
    tone: 'info',
  },
  task_assigned: {
    name: 'Task assigned',
    meaning: 'Someone assigned you a task.',
    steps: ['Open Tasks.'],
    checks: [],
    raisedBy: ['database trigger fn_task_notify'],
    tone: 'notice',
  },
  task_completed: {
    name: 'Task done',
    meaning: 'A task you created or follow was completed.',
    steps: [],
    checks: [],
    raisedBy: ['database trigger fn_task_notify'],
    tone: 'info',
  },
  task_reminder: {
    name: 'Task reminder',
    meaning: 'A task\'s reminder time has come.',
    steps: ['Open Tasks.'],
    checks: [],
    raisedBy: ['supabase scheduled reminders'],
    tone: 'notice',
  },
  pasture_move: {
    name: 'Move the herd out of a pasture',
    meaning:
      'A pasture with a herd on it has reached the point where the app recommends moving them: the forage estimate says only a few days of grazing are left, the satellite shows it grazed down compared with pastures nobody grazed, or it has dropped faster than they did since the herd went in. A dry year (rain to date well under the 10-year average) makes it say so earlier, because what is grazed now will not grow back behind the herd.',
    steps: [
      'Read the reasons at the top — each line is one test that said move.',
      'Look at the pasture, or ask whoever checked the cattle last. The estimate does not see what is underfoot.',
      'If it is grazed down, pick the next pasture from the rotation list on the Cattle map (Ready or Optimal, with water inside 800 m) and move the herd — in the collar app if they are on virtual fence.',
      'Import the new collar Status file so the app knows where the herd went; until then it still thinks they are here.',
      'If the grass is fine, raise the thresholds for that ranch on the Grazing tab (Move-out alert) rather than ignoring the alert.',
    ],
    checks: [
      'How old is the collar import (collars_imported_on in the details)? An old import means the herd may already have moved.',
      'How old is the satellite look (forage_index_on)? Cloud can leave a pasture unread for a week or more.',
      'Late in the season NDVI reads green leaf, not cured grass: a low index on dry, standing feed can understate it. The rested pastures comparison is there for that, but walk it.',
      'Head and animal units: are the herd counts and AU per head on the Herd tab right? Calves at side wear no collars: they are added to the cows’ mob, a calf per cow at the calves’ AU, until the weaning date in Cattle settings.',
      'Grazeable acres and grass quality come from the Grazing tab row with the same letter; a pasture not listed there uses its mapped acres at Fair quality.',
    ],
    raisedBy: ['netlify/functions/pasture-move-cron.mts', 'netlify/shared/pasture-move-watch.ts', 'src/lib/pasture-move.ts'],
    tone: 'act',
  },
  winterizing_freeze: {
    name: 'Hard freeze coming, winterizing not finished',
    meaning:
      'The forecast has a hard freeze (a very cold night, or a day that never thaws) while a checklist that has to be done before the ground freezes is still open. Water left in a line, pump or meter can freeze and split it. The checklist is now due that day.',
    steps: [
      'Open the checklist from the alert and see which places are not done yet.',
      'Do the lines and pumps that hold water first: blow out or drain them, pull pump plugs, bring meters in.',
      'Tick each job as it is finished so the next alert shows what is really left.',
    ],
    checks: [
      'The freeze line is a farm setting (operating_settings "freeze_watch": low_c, high_c; default −8 °C at night or a high of 0 °C).',
      'The forecast is for the main weather site on Farm setup.',
    ],
    raisedBy: ['netlify/shared/freeze-watch.ts', 'src/lib/freeze-watch.ts', 'netlify/functions/crop-weather-cron.mts'],
    tone: 'act',
  },
  app_notice: {
    name: 'App notice',
    meaning: 'A message about the app itself.',
    steps: [],
    checks: [],
    raisedBy: [],
    tone: 'info',
  },
}

const FALLBACK: AlertGuide = {
  name: 'Notification',
  meaning: 'This notification has no written guide yet. Its message and the details below are everything the app knows.',
  steps: ['Open the screen it points to.', 'If something looks wrong, copy the error log below into an AI chat with this repository open.'],
  checks: [],
  raisedBy: [],
  tone: 'notice',
}

export function alertGuide(kind: string): AlertGuide {
  return G[kind] ?? { ...FALLBACK, name: kind.replace(/_/g, ' ') }
}

export const GUIDED_KINDS = Object.keys(G)

/**
 * What the Monday meeting lists under Alerts: everything that asks for action,
 * plus frost on standing crops (a notice on a phone, but a decision for the room).
 */
export const MEETING_ALERT_KINDS = [...GUIDED_KINDS.filter((k) => G[k].tone === 'act'), 'crop_weather']
