import { describe, expect, it } from 'vitest'
import {
  CORNELL_3RB_1225,
  CORNELL_3RB_EFF,
  CORNELL_4RB_1069,
  CORNELL_4RB_1069_EFF,
  CORNELL_4RB_EFF,
  pump6Estimate,
  rayDaltonEstimate,
  CORNELL_5H_1522,
  CORNELL_5RB_1275,
  jensenEstimate,
  mapleEstimate,
  CORNELL_5RB_EFF,
  brakeHp,
  creekflatEstimate,
  couleeCrownHillEstimate,
  flowAtHead,
  headAtFlow,
  motorLimitedGpm,
  psiToFt,
  trimCurve,
} from './pump-curve'

describe('pump curve', () => {
  it('reads the flow off the curve at a head', () => {
    expect(flowAtHead(CORNELL_5H_1522, 225)).toBe(1400)
    expect(flowAtHead(CORNELL_5H_1522, 206)).toBe(1600)
    // Between 1,000 gpm (250 ft) and 1,200 (239 ft).
    expect(flowAtHead(CORNELL_5H_1522, 240)).toBeCloseTo(1182, 0)
  })

  it('gives nothing above the shut-off head', () => {
    expect(flowAtHead(CORNELL_5H_1522, 280)).toBeNull()
  })

  it('checks the curve against the motor', () => {
    // 100 hp at 83%: 100 × 3,960 × 0.83 ÷ 225 = 1,461 gpm.
    expect(motorLimitedGpm(100, 0.83, 225)).toBeCloseTo(1461, 0)
    // The curve's 1,400 gpm at 225 ft takes about 96 hp — inside the motor.
    expect(brakeHp(1400, 225, 0.83)).toBeCloseTo(95.8, 1)
    // 1,600 gpm at 206 ft takes about 100 hp: the edge of the motor, inside its 1.15 service factor.
    expect(brakeHp(1600, 206, 0.82)).toBeLessThan(115)
  })

  it('stays inside the stored 1,200–1,600 gpm range', () => {
    for (const r of couleeCrownHillEstimate()) {
      expect(r.curveGpm!).toBeGreaterThanOrEqual(1180)
      expect(r.curveGpm!).toBeLessThanOrEqual(1620)
    }
    expect(psiToFt(50)).toBeCloseTo(115.5, 1)
  })
})

describe('Creek flat pump curve (Cornell 5RB, 12.75")', () => {
  it('trims the 13" line to 12.75" by the affinity laws', () => {
    const t = trimCurve([{ gpm: 1000, headFt: 169 }], 13, 12.75)[0]
    expect(t.gpm).toBeCloseTo(980.8, 1)
    expect(t.headFt).toBeCloseTo(162.6, 1)
    // Shut-off: the 13" line's 183 ft scales to 176 ft, and down to 12" gives the 156 ft the 12" line shows.
    expect(183 * (12.75 / 13) ** 2).toBeCloseTo(176, 0)
    expect(183 * (12 / 13) ** 2).toBeCloseTo(156, 0)
  })

  it('reads about 1,150–1,600 gpm over 155–130 ft', () => {
    const [h130, h145, h155] = creekflatEstimate()
    expect(h155.curveGpm!).toBeGreaterThan(1100)
    expect(h155.curveGpm!).toBeLessThan(1200)
    expect(h145.curveGpm!).toBeGreaterThan(1350)
    expect(h145.curveGpm!).toBeLessThan(1400)
    expect(h130.curveGpm!).toBeGreaterThan(1580)
    expect(h130.curveGpm!).toBeLessThan(1640)
    // The motor agrees at the middle: 60 × 3,960 × 0.84 ÷ 145 = 1,376.
    expect(h145.motorGpm).toBeCloseTo(1376, 0)
    // The high end runs a little into the 1.15 service factor (69 hp), not past it.
    expect(brakeHp(h130.curveGpm!, 130, CORNELL_5RB_EFF)).toBeGreaterThan(60)
    expect(brakeHp(h130.curveGpm!, 130, CORNELL_5RB_EFF)).toBeLessThan(69)
  })

  it("puts the pivot's 1,200 gpm at about 153 ft (66 psi)", () => {
    const h = headAtFlow(CORNELL_5RB_1275, 1200)!
    expect(h).toBeGreaterThan(151)
    expect(h).toBeLessThan(155)
    expect(h / 2.31).toBeGreaterThan(65)
    expect(h / 2.31).toBeLessThan(67)
    expect(headAtFlow(CORNELL_5RB_1275, 3000)).toBeNull()
  })
})

describe('Maple pump curve (Cornell 4RB, 12.62")', () => {
  it('reads about 890–1,150 gpm over 155–130 ft, inside the service factor', () => {
    const [h130, h145, h155] = mapleEstimate()
    expect(Math.round(h155.curveGpm!)).toBe(887)
    expect(Math.round(h145.curveGpm!)).toBe(1010)
    expect(Math.round(h130.curveGpm!)).toBe(1155)
    // 12.62" is Cornell's largest for 40 hp using the 1.15 SF: over 40 hp, under 46.
    for (const r of [h130, h145, h155]) {
      const bhp = brakeHp(r.curveGpm!, r.headFt, CORNELL_4RB_EFF)
      expect(bhp).toBeGreaterThan(40)
      expect(bhp).toBeLessThan(46)
    }
  })
})

describe('Ray Dalton pump curve (Cornell 4RB, 10.69")', () => {
  it('reads about 670–920 gpm over 115–100 ft, the top end at the service factor', () => {
    const [h100, h107, h115] = rayDaltonEstimate()
    expect(Math.round(h115.curveGpm!)).toBe(665)
    expect(Math.round(h107.curveGpm!)).toBe(821)
    expect(Math.round(h100.curveGpm!)).toBe(919)
    // At 100 ft the curve's flow takes 28.3 hp: right at the 25 hp motor's 1.15 service factor.
    expect(brakeHp(h100.curveGpm!, 100, CORNELL_4RB_1069_EFF)).toBeLessThan(25 * 1.15)
    expect(brakeHp(h100.curveGpm!, 100, CORNELL_4RB_1069_EFF)).toBeGreaterThan(28)
    // This impeller can't reach the river pivots' 130 ft.
    expect(flowAtHead(CORNELL_4RB_1069, 130)).toBeNull()
  })
})

describe('#6 pump curve (Cornell 4RB, 11.38")', () => {
  it('reads about 720–1,010 gpm over 130–110 ft, into the service factor at the top', () => {
    const [h110, h120, h130] = pump6Estimate()
    expect(Math.round(h110.curveGpm!)).toBe(1014)
    expect(Math.round(h120.curveGpm!)).toBeGreaterThan(880)
    expect(Math.round(h120.curveGpm!)).toBeLessThan(910)
    expect(Math.round(h130.curveGpm!)).toBe(715)
    // 30 hp × 1.15 = 34.5 hp: the curve's flows stay inside it.
    for (const r of [h110, h120, h130]) expect(brakeHp(r.curveGpm!, r.headFt, CORNELL_4RB_1069_EFF)).toBeLessThanOrEqual(34.5)
  })
})

describe('Jensen pump curve (Cornell 3RB, 12.25")', () => {
  it('scales the 12" line up and reads about 460–610 gpm', () => {
    expect(CORNELL_3RB_1225[0].headFt).toBeCloseTo(167.4, 1)
    const [h130, h145, h155] = jensenEstimate()
    expect(Math.round(h155.curveGpm!)).toBe(462)
    expect(Math.round(h145.curveGpm!)).toBe(532)
    expect(Math.round(h130.curveGpm!)).toBe(609)
    // 25 hp × 3,960 × 0.76 ÷ 145 = 519 gpm: the motor agrees within 3%.
    expect(h145.motorGpm).toBeCloseTo(519, 0)
    expect(brakeHp(h130.curveGpm!, 130, CORNELL_3RB_EFF)).toBeLessThan(25 * 1.15)
  })
})
