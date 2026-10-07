/**
 * Land leases: what each rented parcel costs a year, when the rent is due, and
 * when the notice to renew (or not) has to be given.
 *
 * Pure, so the page and the reminder job agree on every date.
 */

export type LeaseLike = {
  id: string
  landlord: string
  acres: number | null
  rent_per_acre: number | null
  rent_total: number | null
  start_date: string | null
  end_date: string | null
  notice_days: number
  /** [{ date: 'MM-DD', share: 0..1 }] */
  payment_schedule: unknown
  active: boolean
}

export type PaymentLike = { lease_id: string; due_on: string; amount: number | null; paid_on: string | null }

export type ScheduleEntry = { date: string; share: number }

export function scheduleOf(lease: Pick<LeaseLike, 'payment_schedule'>): ScheduleEntry[] {
  const raw = Array.isArray(lease.payment_schedule) ? lease.payment_schedule : []
  return raw
    .map((e) => ({ date: String((e as ScheduleEntry)?.date ?? ''), share: Number((e as ScheduleEntry)?.share ?? 0) }))
    .filter((e) => /^\d{2}-\d{2}$/.test(e.date) && e.share > 0)
}

/** The year's cash rent: the flat figure if there is one, else $/ac × acres. */
export function annualRent(lease: Pick<LeaseLike, 'rent_total' | 'rent_per_acre' | 'acres'>): number | null {
  if (lease.rent_total != null) return Number(lease.rent_total)
  if (lease.rent_per_acre != null && lease.acres != null) return Number(lease.rent_per_acre) * Number(lease.acres)
  return null
}

const inTerm = (lease: LeaseLike, day: string) => (!lease.start_date || day >= lease.start_date) && (!lease.end_date || day <= lease.end_date)

/** The rent payments a lease owes in a calendar year, from its schedule. */
export function paymentsForYear(lease: LeaseLike, year: number): { due_on: string; amount: number | null }[] {
  const rent = annualRent(lease)
  return scheduleOf(lease)
    .map((e) => ({ due_on: `${year}-${e.date}`, amount: rent == null ? null : Math.round(rent * e.share * 100) / 100 }))
    .filter((p) => inTerm(lease, p.due_on))
}

/** The last day to give notice: the end date less the notice period. */
export function noticeBy(lease: Pick<LeaseLike, 'end_date' | 'notice_days'>): string | null {
  if (!lease.end_date) return null
  const d = new Date(`${lease.end_date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (lease.notice_days ?? 0))
  return d.toISOString().slice(0, 10)
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export type LeaseAlert = { kind: 'renewal' | 'rent'; leaseId: string; date: string; days: number; text: string; paymentDue?: string; amount?: number | null }

/**
 * What needs doing: notice deadlines within 30 days (or passed while the lease
 * is still running), and rent unpaid within 14 days of its date or past it.
 */
export function leaseAlerts(leases: LeaseLike[], payments: PaymentLike[], today: string, renewalWindow = 30, rentWindow = 14): LeaseAlert[] {
  const out: LeaseAlert[] = []
  for (const l of leases.filter((x) => x.active)) {
    const by = noticeBy(l)
    if (by && l.end_date && l.end_date >= today) {
      const days = daysBetween(today, by)
      if (days <= renewalWindow)
        out.push({
          kind: 'renewal',
          leaseId: l.id,
          date: by,
          days,
          text: days >= 0 ? `${l.landlord}: notice to renew due in ${days} day${days === 1 ? '' : 's'} (lease ends ${l.end_date})` : `${l.landlord}: notice date passed ${-days} days ago; lease ends ${l.end_date}`,
        })
    }
    const year = Number(today.slice(0, 4))
    const due = [...paymentsForYear(l, year - 1), ...paymentsForYear(l, year)]
    for (const p of due) {
      const rec = payments.find((x) => x.lease_id === l.id && x.due_on === p.due_on)
      if (rec?.paid_on) continue
      const days = daysBetween(today, p.due_on)
      // Last year's unpaid rent only counts if it was put on the books.
      if (p.due_on.startsWith(String(year - 1)) && !rec) continue
      if (days > rentWindow) continue
      const amt = rec?.amount ?? p.amount
      out.push({
        kind: 'rent',
        leaseId: l.id,
        date: p.due_on,
        days,
        paymentDue: p.due_on,
        amount: amt,
        text: `${l.landlord}: rent${amt != null ? ` $${Math.round(amt).toLocaleString('en-CA')}` : ''} ${days >= 0 ? `due in ${days} day${days === 1 ? '' : 's'}` : `${-days} days overdue`} (${p.due_on})`,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
