import { describe, expect, it } from 'vitest'
import { FIELD_TABS, SECTION_ANCHOR, fieldSectionPath, tabFor, type FieldSection } from './FieldTabs'

const ALL: FieldSection[] = ['overview', 'work', 'inputs', 'irrigation', 'soil', 'history', 'notes', 'scouting', 'scout-reports', 'money', 'settings']

describe('field tabs', () => {
  // Sam, 24 Oct 2026: "One tab bar, six tabs at most, one row, no scrolling".
  it('has six tabs at most', () => {
    expect(FIELD_TABS.length).toBeLessThanOrEqual(6)
  })

  it('puts every section on exactly one tab, except Settings (the gear)', () => {
    for (const s of ALL) {
      const on = FIELD_TABS.filter((t) => t.sections.includes(s))
      expect(on.length, s).toBe(s === 'settings' ? 0 : 1)
    }
  })

  it('gives each tab its own section first', () => {
    for (const t of FIELD_TABS) expect(t.sections[0]).toBe(t.key)
  })

  it('scrolls to every section that is not first on its tab', () => {
    for (const s of ALL) {
      const t = tabFor(s)
      if (t && t.sections[0] !== s) expect(SECTION_ANCHOR[s], s).toBeTruthy()
    }
  })

  it('keeps the old addresses', () => {
    expect(fieldSectionPath('f1', 'overview')).toBe('/fields/f1')
    expect(fieldSectionPath('f1', 'soil')).toBe('/fields/f1/soil')
    expect(fieldSectionPath('f1', 'scout-reports')).toBe('/fields/f1/scout-reports')
    expect(fieldSectionPath('f1', 'settings')).toBe('/fields/f1/settings')
  })
})
