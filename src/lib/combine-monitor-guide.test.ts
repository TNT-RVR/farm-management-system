import { describe, expect, it } from 'vitest'
import { DISPLAY_BRANDS, monitorExporterPrompt } from './combine-monitor-guide'

describe('monitorExporterPrompt', () => {
  it('names the combine and display given', () => {
    const p = monitorExporterPrompt({ brand: 'claas', model: 'Lexion 8800', display: 'CEMIS 1200', version: '2.4' })
    expect(p).toContain('My combine: Claas Lexion 8800')
    expect(p).toContain('Its in-cab display: CEMIS 1200')
    expect(p).toContain('Display software version: 2.4')
  })

  it('asks for what is missing rather than guessing', () => {
    const p = monitorExporterPrompt({ brand: 'other', model: '', display: '', version: '' })
    expect(p).toContain('not known yet — ask me for the model')
    expect(p).toContain('ask me for a photo of the software version screen')
  })

  it('points at the working example and the safety rules', () => {
    const p = monitorExporterPrompt({ brand: 'john-deere', model: 'S790', display: 'G5', version: '' })
    for (const s of ['src/lib/combine-monitor.ts', 'src/lib/save-to-folder.ts', 'CAN bus', 'Operations Center']) expect(p).toContain(s)
  })

  it('has a key for every brand', () => {
    expect(new Set(DISPLAY_BRANDS.map((b) => b.key)).size).toBe(DISPLAY_BRANDS.length)
  })
})
