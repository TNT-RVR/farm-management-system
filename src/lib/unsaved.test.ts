import { describe, expect, it } from 'vitest'
import { blockedDestination, type LinkClick } from './unsaved'

const click = (over: Partial<LinkClick> = {}): LinkClick => ({
  button: 0,
  modified: false,
  defaultPrevented: false,
  link: { origin: 'https://app.example.com', path: '/fields', newWindow: false, download: false },
  here: '/fields/abc/settings',
  origin: 'https://app.example.com',
  ...over,
})

const link = (over: Partial<NonNullable<LinkClick['link']>>) => ({
  origin: 'https://app.example.com',
  path: '/fields',
  newWindow: false,
  download: false,
  ...over,
})

describe('blockedDestination', () => {
  it('asks about a plain click on another page in the app', () => {
    expect(blockedDestination(click())).toBe('/fields')
  })

  it('keeps the query and the anchor, so the warning lands where the link went', () => {
    expect(blockedDestination(click({ link: link({ path: '/plan?tab=budget#totals' }) }))).toBe(
      '/plan?tab=budget#totals',
    )
  })

  it('lets a click that is not on a link through', () => {
    expect(blockedDestination(click({ link: null }))).toBeNull()
  })

  // Each of these would be a warning in the wrong place: the typing is not
  // going anywhere, so interrupting the click only breaks the click.
  it('lets a middle or right click through', () => {
    expect(blockedDestination(click({ button: 1 }))).toBeNull()
    expect(blockedDestination(click({ button: 2 }))).toBeNull()
  })

  it('lets a ctrl- or cmd-click open its new tab', () => {
    expect(blockedDestination(click({ modified: true }))).toBeNull()
  })

  it('lets a link that opens a new window through', () => {
    expect(blockedDestination(click({ link: link({ newWindow: true }) }))).toBeNull()
  })

  it('lets a download start', () => {
    expect(blockedDestination(click({ link: link({ download: true }) }))).toBeNull()
  })

  it('leaves an outside link to beforeunload', () => {
    expect(blockedDestination(click({ link: link({ origin: 'https://afsc.ca' }) }))).toBeNull()
  })

  it('says nothing about a link to the page already open', () => {
    expect(blockedDestination(click({ link: link({ path: '/fields/abc/settings' }) }))).toBeNull()
  })

  it('leaves a click something else has already handled alone', () => {
    expect(blockedDestination(click({ defaultPrevented: true }))).toBeNull()
  })
})
