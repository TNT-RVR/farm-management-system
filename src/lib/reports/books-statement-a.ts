import { cattleSaleCode, cropCode } from '@/lib/agristability-codes'
import { categoryOf, total, type BooksAccount, type BooksCategory, type BooksReport, type CategoryOverride } from '@/lib/qb-books-core'
import { longDate } from './framework'
import type { ReportBooks } from './books'

/**
 * The program year's Profit and Loss from QuickBooks, account by account, put
 * on the Statement A line it belongs to — for the AgriStability package and
 * the prefilled form (agristability.ts, agristability-form.ts).
 *
 * Allowable and non-allowable are CRA's, from guide RC4060 chapter 3,
 * "AgriStability program – Allowable expenses" and "– Non-allowable
 * expenses" (read 7 Oct 2026):
 * https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4060/rc4060-05.html
 *
 *   - Allowable: 9661 containers and twine, 9662 fertilizer, 9663 pesticides,
 *     9665 crop insurance premiums, 9713 vet and breeding, 9714 minerals and
 *     salts, 9764 machinery fuel, 9799 electricity, 9801 freight, 9802 heating
 *     fuel, 9815 ARM'S LENGTH salaries (room and board for hired help, the
 *     employer's CPP, EI and WCB included), 9822 storage and drying, 9836
 *     commissions and levies, 9953 private livestock insurance.
 *   - Non-allowable: 9760 machinery repairs, licences and insurance, 9765
 *     machinery leases, 9792 advertising, 9795 building and fence repairs, 9796
 *     land clearing, 9798 contract work (seed cleaning included), 9804 other
 *     insurance, 9805 interest, 9807 memberships, 9808 office, 9809 legal and
 *     accounting, 9810 property tax, 9811 rent, 9816 NON-ARM'S LENGTH salaries
 *     (family, a connected corporation), 9819 motor vehicles, 9820 small tools,
 *     9821 soil testing, 9823 licences, 9824 telephone, 9826 gravel, 9936
 *     capital cost allowance, 9896 other.
 *   - Seed, feed and livestock bought are commodity purchases (Total C), under
 *     the commodity's code; pasture-related feed costs are allowable from 2026
 *     (AFSC's 2026 supplementary forms, code 586).
 *
 * Wages: the books keep one payroll, so it goes on 9815 and says to move what
 * was paid to family or shareholders to 9816. An account whose name says it
 * is family or shareholder pay goes to 9816 by itself.
 *
 * The year-end amortization is the CCA (9936), not cash. The management fee
 * the farm earns is other income (9600) for the accountant to confirm;
 * cost of goods sold was not farm production and stays off the form.
 *
 * The owners' account categories (qb_account_categories) decide the part
 * first, the account's name then picks the line inside it.
 */

export type StatementPart = 'income' | 'other_income' | 'purchases' | 'allowable' | 'non_allowable' | 'left_off'

export type LineFor = { line: string; item: string; part: StatementPart; confirm?: string }

const strip = (name: string) => name.replace(/^\d{4}-\d{2}\s*/, '').replace(/ Expenses?_?$/i, '').trim()

const L = (part: StatementPart, line: string, item: string, confirm?: string): LineFor => (confirm ? { part, line, item, confirm } : { part, line, item })

/** Where an income account goes: a commodity's code, another income line, or rent (T776). */
function incomeLine(a: Pick<BooksAccount, 'name' | 'section'>): LineFor {
  const n = a.name.toLowerCase()
  const name = strip(a.name)
  if (/management fee/.test(n)) return L('other_income', '9600', `Other: ${name}`, 'The management fee the farm earns: other income, not commodity sales. Whether it is farming income at all is the accountant’s call.')
  if (/\brent/.test(n) && !/machine|equipment/.test(n)) return L('left_off', 'T776', `Rent received: ${name}`, 'Land rent is rental income, not farming income on Statement A (RC4060).')
  if (/agristability|agriinvest|agri-?recovery|program pay|disaster|business risk/.test(n)) return L('other_income', '9544', 'Business risk management and disaster assistance payments', 'Check the payment’s own code on RC4060’s program payment lists.')
  if (/hail/.test(n)) return L('income', '407', 'Private hail insurance', 'Counts for AgriInvest only, not AgriStability.')
  if (/insurance|claim|indemnit/.test(n)) return L('income', '401', 'AgriInsurance (production insurance)')
  if (/gst|hst|rebate|refund/.test(n)) return L('other_income', '9574', 'Resales, rebates, GST/HST for allowable expenses', 'If it is for non-allowable expenses it goes on 9575.')
  if (/patronage|dividend/.test(n)) return L('other_income', '9605', 'Patronage dividends')
  if (/interest/.test(n)) return L('other_income', '9607', 'Interest')
  if (/custom|contract work/.test(n)) return L('other_income', '9601', 'Agricultural contract work')
  if (/truck|haul/.test(n)) return L('other_income', '9611', 'Trucking (farm-related only)')
  if (/machine|equipment/.test(n)) return L('other_income', '9614', 'Machine rentals')
  if (/surface|well|lease/.test(n)) return L('other_income', '9613', 'Leases (gas, oil well, surface)')
  if (/gravel/.test(n)) return L('other_income', '9610', 'Gravel')
  if (/cattle|calf|calves|cow|bull|steer|heifer|livestock/.test(n)) {
    const c = cattleSaleCode(name)
    return L('income', c.code, c.commodity, c.confirm)
  }
  const crop = cropCode(name.replace(/\b(sales?|income|revenue)\b/gi, '').trim())
  if (crop) return L('income', crop.code, `${crop.commodity} (${name})`, crop.confirm)
  if (/OTHER INCOME/.test(a.section)) return L('other_income', '9600', `Other: ${name}`)
  return L('income', 'code needed', name, 'No commodity code from the account’s name: split it by commodity (the app’s estimate shows the crops), or ask AFSC.')
}

/** The Statement A line an account of the P&L goes on, from its part and its name. */
export function statementALine(a: Pick<BooksAccount, 'name' | 'section'>, category: BooksCategory): LineFor {
  const n = a.name.toLowerCase()
  const name = strip(a.name)
  if (category === 'income') return incomeLine(a)
  if (category === 'not_farm')
    return L('left_off', 'none', name, /COST OF GOODS/.test(a.section) ? 'Cost of goods sold: not the farm’s production (the CFO’s review).' : 'Not the farm’s production: income tax, gifts, penalties, life cover and the like.')
  switch (category) {
    case 'fertilizer':
      return L('allowable', '9662', 'Fertilizers and soil supplements')
    case 'chemical':
      return L('allowable', '9663', 'Pesticides and chemical treatments')
    case 'seed':
      return L('purchases', 'by crop', 'Seed and plants', 'Statement A enters seed as a purchase under each crop’s code: split it by crop.')
    case 'fuel':
      if (/vehicle|truck|car\b/.test(n)) return L('non_allowable', '9819', 'Motor vehicle expenses')
      if (/heat|propane|natural gas|furnace/.test(n)) return L('allowable', '9802', 'Heating fuel')
      return L('allowable', '9764', 'Machinery (gasoline, diesel fuel, oil)')
    case 'crop_insurance':
      return /hail|private/.test(n) && !/crop/.test(n)
        ? L('allowable', '9665', 'Insurance premiums (crop or production)', 'Private hail on crops is 9665 too; private livestock insurance is 9953.')
        : L('allowable', '9665', 'Insurance premiums (crop or production)')
    case 'custom_work':
      return L('non_allowable', '9798', 'Agricultural contract work', 'Chemical, fertilizer or fuel itemized on a custom bill can go on its own allowable line.')
    case 'storage':
      return L('allowable', '9822', 'Storage/drying')
    case 'freight':
      return L('allowable', '9801', 'Freight and shipping')
    case 'marketing':
      if (/twine|container|net ?wrap|bag(s|ging)?\b/.test(n) && !/clean/.test(n)) return L('allowable', '9661', 'Containers and twine')
      if (/clean/.test(n)) return L('non_allowable', '9798', 'Agricultural contract work', 'Seed cleaning is contract work (RC4060).')
      return L('allowable', '9836', 'Commissions and levies')
    case 'land_rent':
      if (/pasture|grazing/.test(n)) return L('purchases', '586', 'Pasture-related feed costs (allowable from 2026)')
      return L('non_allowable', '9811', 'Rent (land, buildings, pastures)')
    case 'cattle':
      if (/vet|medicine|breeding|semen|a\.?i\.?\b|preg/.test(n)) return L('allowable', '9713', 'Veterinary fees, medicine, breeding fees')
      if (/salt|mineral|vitamin|premix/.test(n)) return L('allowable', '9714', 'Minerals and salts')
      if (/pasture|grazing/.test(n)) return L('purchases', '586', 'Pasture-related feed costs (allowable from 2026)')
      if (/feed|hay|silage|grain bought|supplement/.test(n)) return L('purchases', '571 / 046', 'Feed bought (prepared feed, supplements)', 'Prepared feed is 571; forage is under its own crop code.')
      if (/purchase|bought|bull|cow|calves|calf|livestock/.test(n)) return L('purchases', '706 / 719', 'Livestock bought')
      if (/insurance/.test(n)) return L('allowable', '9953', 'Private insurance premiums for allowable commodities')
      return L('non_allowable', '9896', `Other: ${name}`, 'A cattle cost no rule places: check its line.')
    case 'labour':
      if (/family|shareholder|director|related|non.?arm|owner|management salar/.test(n)) return L('non_allowable', '9816', 'Non-arm’s length salaries')
      return L('allowable', '9815', 'Arm’s length salaries', 'Wages to anyone related (family, shareholders, a connected corporation) are non-arm’s length: move them to 9816.')
    case 'machinery':
      if (/small tool/.test(n)) return L('non_allowable', '9820', 'Small tools')
      if (/lease|rent/.test(n)) return L('non_allowable', '9765', 'Machinery lease/rental')
      return L('non_allowable', '9760', 'Machinery (repairs, licences, insurance)')
    case 'depreciation':
      return L('non_allowable', '9936', 'Capital cost allowance', 'The year-end amortization, taken as the CCA: not cash. Check it against the T2 Schedule 8.')
    case 'land':
      if (/interest/.test(n)) return L('non_allowable', '9805', 'Interest (real estate, mortgage, other)')
      if (/tax/.test(n)) return L('non_allowable', '9810', 'Property taxes')
      return L('non_allowable', '9896', `Other: ${name}`)
    default:
      break
  }
  // Overhead and anything else: by the name.
  if (/electric|power|hydro/.test(n)) return L('allowable', '9799', 'Electricity', 'The farm share only: not the house.')
  if (/heat|propane|natural gas|furnace/.test(n)) return L('allowable', '9802', 'Heating fuel', 'The farm share only: not the house.')
  if (/utilit/.test(n)) return L('allowable', '9799', 'Electricity', 'Utilities: split power (9799) from heating fuel (9802), farm share only.')
  if (/interest/.test(n)) return L('non_allowable', '9805', 'Interest (real estate, mortgage, other)')
  if (/property tax/.test(n)) return L('non_allowable', '9810', 'Property taxes')
  if (/vehicle|truck|car\b/.test(n)) return L('non_allowable', '9819', 'Motor vehicle expenses')
  if (/insurance/.test(n)) return L('non_allowable', '9804', 'Other insurance premiums')
  if (/licen|permit|registration/.test(n)) return L('non_allowable', '9823', 'Licences/permits')
  if (/phone|cell|internet/.test(n)) return L('non_allowable', '9824', 'Telephone')
  if (/office|postage|stationery|software|computer/.test(n)) return L('non_allowable', '9808', 'Office expenses')
  if (/legal|accounting|professional|consult/.test(n)) return L('non_allowable', '9809', 'Legal and accounting fees')
  if (/membership|subscription|dues/.test(n)) return L('non_allowable', '9807', 'Memberships/subscription fees')
  if (/advertis|promotion/.test(n)) return L('non_allowable', '9792', 'Advertising and promotion')
  if (/building|fence|yard/.test(n)) return L('non_allowable', '9795', 'Building and fence repairs')
  if (/clearing|drain/.test(n)) return L('non_allowable', '9796', 'Land clearing and draining')
  if (/soil test/.test(n)) return L('non_allowable', '9821', 'Soil testing')
  if (/gravel/.test(n)) return L('non_allowable', '9826', 'Gravel')
  if (/small tool/.test(n)) return L('non_allowable', '9820', 'Small tools')
  return L('non_allowable', '9896', `Other: ${name}`)
}

/** One Statement A line from the books: the accounts on it and their sum. */
export type BooksLine = LineFor & { amount: number; accounts: BooksAccount[]; confirms: string[] }

export type BooksStatementA = {
  start: string | null
  end: string | null
  basis: string | null
  lines: Record<StatementPart, BooksLine[]>
  /** QuickBooks' own net income for the period (its total line), else every account added with its sign. */
  net: number
}

const SPENT = /COST OF GOODS|EXPENSE/

/**
 * The P&L laid out by Statement A line. Expense sections count as spent,
 * income sections as earned; each line is the accounts on it added up.
 */
export function booksStatementA(report: BooksReport, overrides: Map<string, CategoryOverride>): BooksStatementA {
  const lines: Record<StatementPart, Map<string, BooksLine>> = { income: new Map(), other_income: new Map(), purchases: new Map(), allowable: new Map(), non_allowable: new Map(), left_off: new Map() }
  let net = 0
  for (const a of report.accounts) {
    const v = total(a)
    net += SPENT.test(a.section) ? -v : v
    const to = statementALine(a, categoryOf(a, overrides).category)
    const key = `${to.line}|${to.item}`
    const l = lines[to.part].get(key) ?? { ...to, amount: 0, accounts: [], confirms: [] }
    // An account moved across (income filed as a cost, or the other way) counts against its new line.
    const earning = to.part === 'income' || to.part === 'other_income'
    const crossed = to.part !== 'left_off' && earning === SPENT.test(a.section)
    l.amount += crossed ? -v : v
    l.accounts.push(a)
    if (to.confirm && !l.confirms.includes(to.confirm)) l.confirms.push(to.confirm)
    lines[to.part].set(key, l)
  }
  const sorted = (m: Map<string, BooksLine>) => [...m.values()].sort((a, b) => a.line.localeCompare(b.line, undefined, { numeric: true }) || a.item.localeCompare(b.item))
  return {
    start: report.start,
    end: report.end,
    basis: report.basis,
    lines: {
      income: sorted(lines.income),
      other_income: sorted(lines.other_income),
      purchases: sorted(lines.purchases),
      allowable: sorted(lines.allowable),
      non_allowable: sorted(lines.non_allowable),
      left_off: sorted(lines.left_off),
    },
    net: 'NetIncome' in report.totals ? report.totals.NetIncome : net,
  }
}

/** "Fertilizer 1,234.00 + Fertilizer - fall 500.00": the accounts on a line, for its note. */
export function accountsNote(accounts: BooksAccount[]): string {
  return [...accounts]
    .sort((a, b) => total(b) - total(a))
    .map((a) => `${strip(a.name)} ${total(a).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' + ')
}

export const partTotal = (ls: BooksLine[]) => ls.reduce((s, l) => s + l.amount, 0)

/** "7 Oct 2026, 10:41": when the books were read, farm time. */
export function fetchedLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })
  return `${longDate(day)}, ${d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Edmonton' })}`
}

/** What the AgriStability reports take from the books: the P&L by line, or why there is none. */
export type QbInput = { ok: true; sa: BooksStatementA; from: string; fyLabel: string } | { ok: false; note: string }

export function qbInput(b: ReportBooks): QbInput {
  if (!b.ok) return { ok: false, note: b.note }
  return { ok: true, sa: booksStatementA(b.pl, b.overrides), from: `From QuickBooks, ${fetchedLabel(b.plFetched)}`, fyLabel: b.fy.label }
}
