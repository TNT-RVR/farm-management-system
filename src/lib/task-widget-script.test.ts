import { describe, expect, it } from 'vitest'
import { scriptableWidget } from './task-widget-script'

const FEED = 'https://farm.example/api/my-tasks?token=' + 'a1'.repeat(24)
const APP = 'https://farm.example/'

// Scriptable runs scripts with top-level await, so they parse as an async function body.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (
  ...a: unknown[]
) => Promise<void>

/** Just enough of Scriptable's API to run the script and see what it drew. */
function fakeScriptable(family: string | undefined, body: unknown, status = 200) {
  const texts: { text: string; color?: unknown }[] = []
  const urls: string[] = []
  const done: { widget?: unknown; presented?: string; completed?: boolean } = {}
  class Stack {
    url?: string
    spacing = 0
    backgroundColor: unknown
    layoutHorizontally() {}
    centerAlignContent() {}
    addSpacer() {}
    setPadding() {}
    addStack() {
      const s = new Stack()
      return new Proxy(s, {
        set(t, k, v) {
          if (k === 'url') urls.push(v as string)
          ;(t as unknown as Record<string | symbol, unknown>)[k] = v
          return true
        },
      })
    }
    addText(text: string) {
      const t: { text: string; color?: unknown; [k: string]: unknown } = { text }
      texts.push(t)
      return new Proxy(t, {
        set(o, k, v) {
          if (k === 'textColor') o.color = v
          o[k as string] = v
          return true
        },
      })
    }
  }
  class ListWidget extends Stack {
    async presentSmall() { done.presented = 'small' }
    async presentMedium() { done.presented = 'medium' }
    async presentLarge() { done.presented = 'large' }
  }
  class Color {
    constructor(public hex: string) {}
    static dynamic(light: Color) { return light }
  }
  const Font = { boldSystemFont: () => ({}), systemFont: () => ({}), semiboldSystemFont: () => ({}) }
  class Request {
    timeoutInterval = 0
    response?: { statusCode: number }
    constructor(public url: string) {}
    async loadJSON() {
      this.response = { statusCode: status }
      return body
    }
  }
  const config = { widgetFamily: family, runsInWidget: family !== undefined }
  const Script = {
    setWidget: (w: unknown) => { done.widget = w },
    complete: () => { done.completed = true },
  }
  return { texts, urls, done, args: { ListWidget, Color, Font, Request, config, Script } }
}

async function run(family: string | undefined, body: unknown, status = 200) {
  const env = fakeScriptable(family, body, status)
  const names = Object.keys(env.args)
  const fn = new AsyncFunction(...names, scriptableWidget(FEED, APP))
  await fn(...names.map((n) => (env.args as Record<string, unknown>)[n]))
  return env
}

const feed = {
  name: 'Pat',
  updatedAt: '2026-10-24T12:00:00Z',
  open: 12,
  overdue: 2,
  tasks: Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    due: i < 8 ? '2026-10-2' + (i % 9) + 'T15:00:00Z' : null,
    overdue: i < 2,
    url: `https://farm.example/tasks/t${i}`,
  })),
}

describe('scriptableWidget', () => {
  it('embeds the link and the app address, escaped', () => {
    const s = scriptableWidget(FEED, APP)
    expect(s).toContain(JSON.stringify(FEED))
    expect(s).toContain('"https://farm.example"')
    const odd = scriptableWidget('https://x.example/?t="quote"\n', APP)
    expect(odd).toContain(JSON.stringify('https://x.example/?t="quote"\n'))
  })

  it('is valid JavaScript', () => {
    expect(() => new AsyncFunction(scriptableWidget(FEED, APP))).not.toThrow()
  })

  it('draws the name, counts and a few tasks in each size', async () => {
    for (const [family, shown] of [['small', 3], ['medium', 4], ['large', 8]] as const) {
      const { texts, urls, done } = await run(family, feed)
      const words = texts.map((t) => t.text)
      expect(words).toContain('Pat')
      expect(words).toContain('12 open')
      expect(words).toContain('2 overdue')
      expect(words.filter((w) => /^Task \d$/.test(w))).toHaveLength(shown)
      expect(words).toContain(`+${12 - shown} more`)
      // Small widgets take one tap target only; bigger ones open each task.
      expect(urls).toHaveLength(family === 'small' ? 0 : shown)
      expect(done.widget).toBeTruthy()
      expect(done.completed).toBe(true)
    }
  })

  it('previews when run in the app, and says when the link is off', async () => {
    const preview = await run(undefined, feed)
    expect(preview.done.presented).toBe('large')
    const off = await run('medium', { error: 'no' }, 401)
    expect(off.texts.map((t) => t.text).join(' ')).toMatch(/turned off/)
  })
})
