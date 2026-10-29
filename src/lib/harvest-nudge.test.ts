import { describe, expect, it } from 'vitest'
import { harvestNudges, QUIET_LOADS_DAYS, type NudgeField } from './harvest-nudge'

const today = '2026-10-29'

const f = (over: Partial<NudgeField> = {}): NudgeField => ({
  fieldId: 'a',
  name: 'Novak Main',
  cropName: 'Grain Corn',
  acres: 88,
  loads: 5,
  lastLoadOn: '2026-10-22',
  harvestFinished: false,
  countsForHarvest: true,
  ...over,
})

describe('harvest nudges', () => {
  it('asks about a field the scale has gone quiet on', () => {
    const { ask } = harvestNudges([f()], today)
    expect(ask).toHaveLength(1)
    expect(ask[0].title).toBe('Is Novak Main off?')
    expect(ask[0].lastLoadOn).toBe('2026-10-22')
    expect(ask[0].description).toContain('5 loads')
    expect(ask[0].description).toContain('Grain Corn, 88 ac')
    expect(ask[0].description).toContain('7 days')
  })

  it('leaves a field alone while loads are still coming', () => {
    expect(harvestNudges([f({ lastLoadOn: '2026-10-28' })], today).ask).toEqual([])
    expect(QUIET_LOADS_DAYS).toBe(3)
  })

  it('asks on the third quiet day and not the second', () => {
    expect(harvestNudges([f({ lastLoadOn: '2026-10-27' })], today).ask).toEqual([])
    expect(harvestNudges([f({ lastLoadOn: '2026-10-26' })], today).ask).toHaveLength(1)
  })

  it('says nothing about a field with no loads', () => {
    // Silage corn: chopped, never weighed. There is no date to offer, so
    // asking "is it off, as of when?" would be a blank form by another name.
    const { ask, retire } = harvestNudges([f({ loads: 0, lastLoadOn: null })], today)
    expect(ask).toEqual([])
    expect(retire).toEqual([])
  })

  it('retires the question once the field is marked finished', () => {
    const { ask, retire } = harvestNudges([f({ harvestFinished: true })], today)
    expect(ask).toEqual([])
    expect(retire).toEqual(['a'])
  })

  it('retires the question for a crop that is not ours to harvest', () => {
    const { retire } = harvestNudges([f({ countsForHarvest: false })], today)
    expect(retire).toEqual(['a'])
  })

  it('names the acres even without a crop', () => {
    const { ask } = harvestNudges([f({ cropName: null })], today)
    expect(ask[0].description).toContain('(88 ac)')
  })
})
