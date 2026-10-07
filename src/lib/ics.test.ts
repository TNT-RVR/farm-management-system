import { describe, expect, it } from 'vitest'
import { parseIcs, readTimeOff } from './ics'

const FEED = `BEGIN:VCALENDAR
PRODID:-//HR//Time off
VERSION:2.0
BEGIN:VEVENT
UID:user-fb69@example.com
DTSTAMP:20250628T014914Z
SUMMARY:Douglas Olsen Paid Time Off leave for 8.00 hours
DESCRIPTION:Reason: If July 1 st is not a stat vac then I'll use another 8
 hrs for July 1. \\n\\nAll for vacation  time.
DTSTART;VALUE=DATE:20250630
DTEND;VALUE=DATE:20250701
END:VEVENT
BEGIN:VEVENT
UID:user-c9be@example.com
SUMMARY:Douglas Olsen Paid Time Off leave
DESCRIPTION:Reason:
DTSTART;VALUE=DATE:20251009
DTEND;VALUE=DATE:20251011
END:VEVENT
END:VCALENDAR
`.replace(/\n/g, '\r\n')

describe('parseIcs', () => {
  it('reads all-day events with folded descriptions', () => {
    const ev = parseIcs(FEED)
    expect(ev).toHaveLength(2)
    expect(ev[0]).toMatchObject({
      uid: 'user-fb69@example.com',
      start: '2025-06-30',
      end: '2025-07-01',
      allDay: true,
    })
    expect(ev[0].description).toContain('hrs for July 1.')
    expect(ev[0].description).toContain('\n\nAll for vacation')
    expect(ev[1].end).toBe('2025-10-11')
  })
})

describe('readTimeOff', () => {
  it('reads who, what and how long off the summary', () => {
    expect(readTimeOff('Douglas Olsen Paid Time Off leave for 8.00 hours', 'Reason: Dentist')).toEqual({
      who: 'Douglas Olsen',
      kind: 'Paid Time Off',
      hours: 8,
      reason: 'Dentist',
    })
    expect(readTimeOff('Douglas Olsen Paid Time Off leave', 'Reason: ')).toEqual({
      who: 'Douglas Olsen',
      kind: 'Paid Time Off',
      hours: null,
      reason: null,
    })
  })

  it('does not read unpaid leave as paid leave for somebody called Un', () => {
    expect(readTimeOff('Luke Hansen Unpaid Time Off leave', '')).toMatchObject({
      who: 'Luke Hansen',
      kind: 'Unpaid Time Off',
    })
  })

  it('keeps a summary it cannot read rather than dropping it', () => {
    expect(readTimeOff('Company holiday', '').who).toBe('Company holiday')
  })
})
