import { describe, expect, it } from 'vitest'
import { issueFingerprint, worthReporting } from './app-issues'

describe('app problems sent to Claude', () => {
  it('counts the same crash on any record as one problem', () => {
    const a = issueFingerprint('app_crash', { name: 'TypeError', message: "Cannot read properties of undefined (reading 'name')" }, '/fields/2908fda4-6d09-464b-b124-4e66cff52570/history')
    const b = issueFingerprint('app_crash', { name: 'TypeError', message: "Cannot read properties of undefined (reading 'name')" }, '/fields/65fe72a7-a215-44cb-b239-7d117b1fc125/history')
    expect(a).toBe(b)
    expect(a).toContain('/fields/:id/history')
  })
  it('leaves out what is not the app’s fault', () => {
    expect(worthReporting(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(false)
    expect(worthReporting(new Error('Failed to fetch'))).toBe(false)
    expect(worthReporting(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(false)
    expect(worthReporting(new Error('x is not a function'), false)).toBe(false)
    expect(worthReporting(new Error('x is not a function'), true)).toBe(true)
  })
})
