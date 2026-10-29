/**
 * The iPhone home-screen widget for "my tasks": a Scriptable script.
 *
 * iOS gives web apps no widgets, so a person pastes this into the free
 * Scriptable app and adds a Scriptable widget that runs it (Sam, 24 Oct
 * 2026). It reads their private /api/my-tasks link and draws their name, the
 * open and overdue counts and the next few tasks, overdue in red. Tapping the
 * widget opens Tasks; on the medium and large sizes a task row opens that
 * task (iOS sends a small widget's taps to one place only).
 *
 * The link is written into the script itself, so the Settings card only
 * offers it right after making a link — the token is never stored to fill in
 * later.
 */
export function scriptableWidget(feedUrl: string, appUrl: string): string {
  const app = appUrl.replace(/\/$/, '')
  // JSON.stringify quotes and escapes, so nothing in a URL can break out of the string.
  return `// Tasks widget for Scriptable.
// This link is private: anyone who has it can read your open tasks.
// If it leaks, make a new link in the app's Settings and paste the new script.
const FEED = ${JSON.stringify(feedUrl)}
const APP = ${JSON.stringify(app)}

const family = config.widgetFamily || "large"
const SHOW = { small: 3, medium: 4, large: 8, extraLarge: 8 }[family] || 8
const SMALL = family === "small"

const text = Color.dynamic(new Color("#111827"), new Color("#f9fafb"))
const muted = Color.dynamic(new Color("#6b7280"), new Color("#9ca3af"))
const red = Color.dynamic(new Color("#dc2626"), new Color("#f87171"))

function dueLabel(iso) {
  const d = new Date(iso)
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(new Date())) / 86400000)
  if (diff === 0) return "today"
  if (diff === 1) return "tomorrow"
  if (diff === -1) return "yesterday"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

async function load() {
  try {
    const req = new Request(FEED)
    req.timeoutInterval = 20
    const body = await req.loadJSON()
    const status = req.response && req.response.statusCode
    if (status === 401) return { error: "Link turned off. Make a new one in Settings." }
    if (!body || !Array.isArray(body.tasks)) return { error: "Couldn't read your tasks." }
    return body
  } catch (e) {
    return { error: "Can't reach the app right now." }
  }
}

const data = await load()
const w = new ListWidget()
w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1f2937"))
w.setPadding(12, 14, 12, 14)
w.url = APP + "/tasks"
w.refreshAfterDate = new Date(Date.now() + 15 * 60000)

if (data.error) {
  const t = w.addText("Tasks")
  t.font = Font.boldSystemFont(14)
  t.textColor = text
  w.addSpacer(4)
  const e = w.addText(data.error)
  e.font = Font.systemFont(12)
  e.textColor = muted
} else {
  const head = w.addStack()
  head.layoutHorizontally()
  head.centerAlignContent()
  const name = head.addText(data.name)
  name.font = Font.boldSystemFont(SMALL ? 13 : 15)
  name.textColor = text
  name.lineLimit = 1
  name.minimumScaleFactor = 0.7
  head.addSpacer()

  const counts = w.addStack()
  counts.layoutHorizontally()
  const openT = counts.addText(data.open + " open")
  openT.font = Font.systemFont(11)
  openT.textColor = muted
  if (data.overdue > 0) {
    const sep = counts.addText(" · ")
    sep.font = Font.systemFont(11)
    sep.textColor = muted
    const od = counts.addText(data.overdue + " overdue")
    od.font = Font.semiboldSystemFont(11)
    od.textColor = red
  }
  w.addSpacer(6)

  if (data.tasks.length === 0) {
    const none = w.addText("Nothing open.")
    none.font = Font.systemFont(12)
    none.textColor = muted
  }
  for (const task of data.tasks.slice(0, SHOW)) {
    const row = w.addStack()
    row.layoutHorizontally()
    row.spacing = 6
    if (!SMALL) row.url = task.url
    const title = row.addText(task.title)
    title.font = Font.systemFont(SMALL ? 11 : 12)
    title.textColor = task.overdue ? red : text
    title.lineLimit = 1
    if (task.due && !SMALL) {
      row.addSpacer()
      const due = row.addText(dueLabel(task.due))
      due.font = Font.systemFont(11)
      due.textColor = task.overdue ? red : muted
      due.lineLimit = 1
    }
    w.addSpacer(3)
  }
  const more = data.open - Math.min(data.tasks.length, SHOW)
  if (more > 0) {
    const m = w.addText("+" + more + " more")
    m.font = Font.systemFont(10)
    m.textColor = muted
  }
}
w.addSpacer()

if (config.runsInWidget) {
  Script.setWidget(w)
} else if (family === "small") {
  await w.presentSmall()
} else if (family === "medium") {
  await w.presentMedium()
} else {
  await w.presentLarge()
}
Script.complete()
`
}
