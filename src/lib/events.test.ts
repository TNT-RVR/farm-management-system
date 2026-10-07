import { describe, expect, it } from 'vitest'
import {
  dateRange,
  daysUntil,
  groupByMonth,
  isUpcoming,
  bySeries,
  meetingItems,
  nextDeadline,
  nextEdition,
  priceToday,
  projectForward,
  seriesKeyFor,
  reachOf,
  scoreEvent,
  type FarmEvent,
} from './events'

const TODAY = new Date('2026-09-01T12:00:00')

const ev = (over: Partial<FarmEvent> = {}): FarmEvent => ({
  id: 'e1',
  name: 'Event',
  organiser: null,
  url: null,
  starts_on: '2026-11-14',
  ends_on: '2026-11-16',
  registration_deadline: null,
  early_bird_deadline: null,
  venue: null,
  city: 'Lethbridge',
  region: 'Alberta',
  country: 'Canada',
  cost: 300,
  early_bird_cost: null,
  currency: 'CAD',
  cost_notes: null,
  categories: ['crop'],
  why_go: null,
  relevance: null,
  status: 'watching',
  travel_notes: null,
  ...over,
})

describe('reachOf', () => {
  it('knows the home corner from the rest of the province', () => {
    expect(reachOf({ city: 'Lethbridge', region: 'Alberta', country: 'Canada' })).toBe('local')
    expect(reachOf({ city: 'Taber', region: 'Alberta', country: 'Canada' })).toBe('local')
    expect(reachOf({ city: 'Edmonton', region: 'Alberta', country: 'Canada' })).toBe('province')
    expect(reachOf({ city: 'Saskatoon', region: 'Saskatchewan', country: 'Canada' })).toBe('prairies')
    expect(reachOf({ city: 'Toronto', region: 'Ontario', country: 'Canada' })).toBe('canada')
    expect(reachOf({ city: 'Tulare', region: 'California', country: 'USA' })).toBe('international')
  })
})

describe('scoreEvent', () => {
  it('puts a local irrigation event above a general show down the road', () => {
    const irrigation = scoreEvent({
      categories: ['irrigation', 'agronomy'],
      city: 'Lethbridge',
      region: 'Alberta',
      country: 'Canada',
    })
    const general = scoreEvent({
      categories: ['business'],
      city: 'Lethbridge',
      region: 'Alberta',
      country: 'Canada',
    })
    expect(irrigation).toBeGreaterThan(general)
  })

  it('rates alfalfa seed and leafcutter work as highly as irrigation', () => {
    const here = { city: 'Brooks', region: 'Alberta', country: 'Canada' }
    expect(scoreEvent({ categories: ['leafcutter', 'alfalfa-seed'], ...here })).toBeGreaterThan(
      scoreEvent({ categories: ['crop'], ...here }),
    )
  })

  it('does not let a general trade show win on category count alone', () => {
    const here = { city: 'Lethbridge', region: 'Alberta', country: 'Canada' }
    const broad = scoreEvent({
      categories: ['crop', 'cattle', 'equipment', 'ag-tech', 'business', 'soil'],
      ...here,
    })
    const focused = scoreEvent({ categories: ['irrigation'], ...here })
    expect(focused).toBeGreaterThan(broad)
  })

  it('still rates a far-away specialist event worth considering', () => {
    const far = scoreEvent({
      categories: ['alfalfa-seed', 'leafcutter'],
      city: 'Boise',
      region: 'Idaho',
      country: 'USA',
    })
    expect(far).toBeGreaterThan(40)
  })

  it('stays inside 0-100', () => {
    const s = scoreEvent({
      categories: ['irrigation', 'alfalfa-seed', 'leafcutter'],
      city: 'Lethbridge',
      region: 'Alberta',
      country: 'Canada',
    })
    expect(s).toBeLessThanOrEqual(100)
    expect(s).toBeGreaterThanOrEqual(0)
  })
})

describe('daysUntil', () => {
  it('counts forward and back from today', () => {
    expect(daysUntil('2026-09-01', TODAY)).toBe(0)
    expect(daysUntil('2026-09-11', TODAY)).toBe(10)
    expect(daysUntil('2026-08-22', TODAY)).toBe(-10)
    expect(daysUntil(null, TODAY)).toBeNull()
  })
})

describe('isUpcoming', () => {
  it('keeps an event that has started but not finished', () => {
    expect(isUpcoming({ starts_on: '2026-08-30', ends_on: '2026-09-03' }, TODAY)).toBe(true)
  })

  it('drops one that has finished', () => {
    expect(isUpcoming({ starts_on: '2026-08-01', ends_on: '2026-08-03' }, TODAY)).toBe(false)
  })

  it('falls back to the start date when there is no end date', () => {
    expect(isUpcoming({ starts_on: '2026-12-01', ends_on: null }, TODAY)).toBe(true)
    expect(isUpcoming({ starts_on: '2026-01-01', ends_on: null }, TODAY)).toBe(false)
  })
})

describe('nextDeadline', () => {
  it('warns about the early bird first when both are open', () => {
    const d = nextDeadline(
      { early_bird_deadline: '2026-10-01', registration_deadline: '2026-11-01' },
      TODAY,
    )
    expect(d?.kind).toBe('early_bird')
    expect(d?.daysLeft).toBe(30)
  })

  it('moves on to registration once the early bird has passed', () => {
    const d = nextDeadline(
      { early_bird_deadline: '2026-08-01', registration_deadline: '2026-11-01' },
      TODAY,
    )
    expect(d?.kind).toBe('registration')
  })

  it('says nothing when both have passed', () => {
    expect(
      nextDeadline(
        { early_bird_deadline: '2026-07-01', registration_deadline: '2026-08-01' },
        TODAY,
      ),
    ).toBeNull()
  })
})

describe('priceToday', () => {
  it('charges the early-bird price while it lasts', () => {
    expect(
      priceToday(ev({ cost: 400, early_bird_cost: 300, early_bird_deadline: '2026-10-01' }), TODAY),
    ).toBe(300)
  })

  it('reverts to full price once it has passed', () => {
    expect(
      priceToday(ev({ cost: 400, early_bird_cost: 300, early_bird_deadline: '2026-08-01' }), TODAY),
    ).toBe(400)
  })
})

describe('dateRange', () => {
  it('collapses a range inside one month', () => {
    expect(dateRange({ starts_on: '2026-11-14', ends_on: '2026-11-16' })).toBe('14–16 Nov 2026')
  })

  it('spells out both months when it spans two', () => {
    expect(dateRange({ starts_on: '2026-11-29', ends_on: '2026-12-02' })).toBe('29 Nov–2 Dec 2026')
  })

  it('gives one date for a one-day event', () => {
    expect(dateRange({ starts_on: '2026-11-14', ends_on: '2026-11-14' })).toBe('14 Nov 2026')
    expect(dateRange({ starts_on: '2026-11-14', ends_on: null })).toBe('14 Nov 2026')
  })

  it('says so when there is no date yet', () => {
    expect(dateRange({ starts_on: null, ends_on: null })).toBe('Dates to confirm')
  })
})

describe('groupByMonth', () => {
  it('buckets by month in date order', () => {
    const groups = groupByMonth([
      ev({ id: 'b', starts_on: '2026-12-02' }),
      ev({ id: 'a', starts_on: '2026-11-14' }),
      ev({ id: 'c', starts_on: '2026-11-28' }),
    ])
    expect(groups.map((g) => g.month)).toEqual(['2026-11', '2026-12'])
    expect(groups[0].events.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('puts undated events in their own bucket at the end', () => {
    const groups = groupByMonth([ev({ id: 'x', starts_on: null }), ev({ id: 'y' })])
    expect(groups[groups.length - 1].month).toBe('unscheduled')
  })
})

describe('seriesKeyFor', () => {
  it('strips the year so every edition shares a key', () => {
    expect(seriesKeyFor('Alberta Beef Industry Conference 2026')).toBe(
      'alberta-beef-industry-conference',
    )
    expect(seriesKeyFor('Alberta Beef Industry Conference 2027')).toBe(
      'alberta-beef-industry-conference',
    )
  })

  it('leaves a year that is part of the name alone', () => {
    expect(seriesKeyFor('Ag in Motion')).toBe('ag-in-motion')
  })
})

describe('projectForward', () => {
  it('keeps the month and day and steps whole years', () => {
    expect(projectForward('2026-02-02', 1, TODAY)).toBe('2027-02-02')
  })

  it('steps two years for a biennial event', () => {
    expect(projectForward('2025-05-25', 2, TODAY)).toBe('2027-05-25')
  })

  it('returns a date already in the future untouched', () => {
    expect(projectForward('2026-12-01', 1, TODAY)).toBe('2026-12-01')
  })

  it('projects nothing for an event that does not recur', () => {
    expect(projectForward('2026-02-02', 0, TODAY)).toBeNull()
  })
})

describe('nextEdition', () => {
  it('shows the soonest edition still to come', () => {
    const r = nextEdition(
      [
        ev({ id: 'old', starts_on: '2025-02-02', ends_on: '2025-02-04' }),
        ev({ id: 'soon', starts_on: '2026-11-14', ends_on: '2026-11-16' }),
        ev({ id: 'later', starts_on: '2027-11-14', ends_on: '2027-11-16' }),
      ],
      TODAY,
    )
    expect(r.event?.id).toBe('soon')
    expect(r.estimatedOn).toBeNull()
    expect(r.pastCount).toBe(1)
  })

  it('rolls on to the following edition once one has passed', () => {
    const editions = [
      ev({ id: 'a', starts_on: '2026-08-01', ends_on: '2026-08-03' }),
      ev({ id: 'b', starts_on: '2026-12-01', ends_on: '2026-12-03' }),
    ]
    // Before the first one runs, it is the one shown.
    expect(nextEdition(editions, new Date('2026-07-01T12:00:00')).event?.id).toBe('a')
    // After it finishes, the next takes over on its own.
    expect(nextEdition(editions, TODAY).event?.id).toBe('b')
  })

  it('projects the next date when only past editions are recorded', () => {
    const r = nextEdition([ev({ id: 'past', starts_on: '2026-02-02', ends_on: '2026-02-04' })], TODAY)
    expect(r.estimatedOn).toBe('2027-02-02')
    expect(r.event?.id).toBe('past')
  })

  it('does not project for a one-off', () => {
    const r = nextEdition(
      [ev({ id: 'once', starts_on: '2026-02-02', ends_on: '2026-02-02', recurrence: 'none' })],
      TODAY,
    )
    expect(r.estimatedOn).toBeNull()
  })

  it('falls back to an undated edition when there is nothing else', () => {
    const r = nextEdition([ev({ id: 'tbc', starts_on: null, ends_on: null })], TODAY)
    expect(r.event?.id).toBe('tbc')
    expect(r.estimatedOn).toBeNull()
  })
})

describe('bySeries', () => {
  it('folds editions together and orders by what happens soonest', () => {
    const out = bySeries(
      [
        ev({ id: 'a1', name: 'Big Show 2025', starts_on: '2025-02-02', ends_on: '2025-02-03' }),
        ev({ id: 'a2', name: 'Big Show 2027', starts_on: '2027-02-02', ends_on: '2027-02-03' }),
        ev({ id: 'b1', name: 'Small Show 2026', starts_on: '2026-10-01', ends_on: '2026-10-02' }),
      ],
      TODAY,
    )
    expect(out).toHaveLength(2)
    expect(out[0].event?.id).toBe('b1')
    expect(out[1].event?.id).toBe('a2')
    expect(out[1].editions).toHaveLength(2)
  })
})

describe('meetingItems', () => {
  it('splits the near month from the rest of the six', () => {
    const { soon, later } = meetingItems(
      [
        ev({ id: 'beyond', name: 'Beyond Show', starts_on: '2027-06-01', ends_on: '2027-06-02' }),
        ev({ id: 'soon', name: 'Soon Show', starts_on: '2026-09-20', ends_on: '2026-09-21' }),
        ev({ id: 'later', name: 'Later Show', starts_on: '2026-11-04', ends_on: '2026-11-06' }),
      ],
      31,
      183,
      TODAY,
    )
    expect(soon.map((i) => i.event.id)).toEqual(['soon'])
    expect(later.map((i) => i.event.id)).toEqual(['later'])
  })

  it('reaches events the old two-month window missed', () => {
    // Farmfair is 64 days out — outside two months, inside six.
    const { later } = meetingItems(
      [ev({ id: 'farmfair', name: 'Farmfair', starts_on: '2026-11-04', ends_on: '2026-11-08' })],
      31,
      183,
      TODAY,
    )
    expect(later.map((i) => i.event.id)).toEqual(['farmfair'])
  })

  it('puts a closing deadline on the near list even when the event is far off', () => {
    const { soon, later } = meetingItems(
      [
        ev({
          id: 'far',
          name: 'Far Show',
          starts_on: '2027-08-01',
          ends_on: '2027-08-02',
          early_bird_deadline: '2026-09-15',
        }),
      ],
      31,
      183,
      TODAY,
    )
    expect(soon.map((i) => i.event.id)).toEqual(['far'])
    expect(soon[0].reason).toBe('deadline')
    expect(later).toHaveLength(0)
  })

  it('lists a near event once, not twice for its own deadline', () => {
    const { soon } = meetingItems(
      [
        ev({
          id: 'both',
          starts_on: '2026-09-20',
          ends_on: '2026-09-21',
          early_bird_deadline: '2026-09-10',
        }),
      ],
      31,
      183,
      TODAY,
    )
    expect(soon).toHaveLength(1)
    expect(soon[0].reason).toBe('happening')
  })

  it('orders by whichever comes first, the event or its deadline', () => {
    const { soon } = meetingItems(
      [
        ev({ id: 'event-soon', name: 'A Show', starts_on: '2026-09-20', ends_on: '2026-09-21' }),
        ev({
          id: 'deadline-sooner',
          name: 'B Show',
          starts_on: '2027-03-01',
          ends_on: '2027-03-02',
          early_bird_deadline: '2026-09-05',
        }),
      ],
      31,
      183,
      TODAY,
    )
    expect(soon.map((i) => i.event.id)).toEqual(['deadline-sooner', 'event-soon'])
  })

  it('includes a projected date, and buckets it by that date rather than the old one', () => {
    // Last held Oct 2025, so the next is projected to Oct 2026 — thirty days
    // out, which puts it in this month and not in the far list.
    const { soon, later } = meetingItems(
      [ev({ id: 'p', name: 'Yearly Show', starts_on: '2025-10-01', ends_on: '2025-10-02' })],
      31,
      183,
      TODAY,
    )
    expect(later).toHaveLength(0)
    expect(soon).toHaveLength(1)
    expect(soon[0].projected).toBe(true)
    expect(soon[0].on).toBe('2026-10-01')
  })

  it('leaves out anything already skipped', () => {
    const { soon, later } = meetingItems(
      [ev({ id: 's', starts_on: '2026-09-20', ends_on: '2026-09-21', status: 'skipped' })],
      31,
      183,
      TODAY,
    )
    expect(soon).toHaveLength(0)
    expect(later).toHaveLength(0)
  })
})
