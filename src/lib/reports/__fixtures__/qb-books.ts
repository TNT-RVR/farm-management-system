// QuickBooks reports shaped the way /api/quickbooks-report returns them, for
// the books tests. Made-up figures.

type Obj = Record<string, unknown>
export const acct = (name: string, id: string, amount: number) => ({ ColData: [{ value: name, id }, { value: String(amount) }], type: 'Data' })
const section = (title: string, group: string | null, rows: Obj[], sum?: number): Obj => ({
  Header: { ColData: [{ value: title }, { value: '' }] },
  Rows: { Row: rows },
  ...(sum != null ? { Summary: { ColData: [{ value: `Total ${title}` }, { value: String(sum) }] } } : {}),
  type: 'Section',
  ...(group ? { group } : {}),
})

const COLUMNS = { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] }

/** A fiscal year's Profit and Loss. Net income 494,500. */
export const PL: Obj = {
  Header: { StartPeriod: '2025-09-01', EndPeriod: '2026-08-31', ReportBasis: 'Accrual' },
  Columns: COLUMNS,
  Rows: {
    Row: [
      section('Income', 'Income', [
        acct('4130-00 Potato Sales', 'i1', 500_000),
        acct('4100-00 Grain Sales', 'i2', 300_000),
        acct('4300-00 Cattle Sales', 'i3', 80_000),
        acct('4700-00 Rental Income', 'i4', 12_000),
        acct('4956-00 Management Fee', 'i5', 30_000),
      ], 922_000),
      section('Cost of Goods Sold', 'COGS', [acct('Cost of Goods Sold', 'c1', 9_000)], 9_000),
      section('Expenses', 'Expenses', [
        acct('6600-00 Payroll Expenses_', 'e1', 80_000),
        acct('5811-00 Family Wages', 'e2', 20_000),
        acct('5867-00 Hired Mans House', 'e3', 10_000),
        acct('5010-00 Fertilizer Expense', 'e4', 60_000),
        acct('5020-00 Chemical Expense', 'e5', 40_000),
        acct('5030-00 Seed Expense', 'e6', 25_000),
        acct('5050-00 Fuel Expense', 'e7', 30_000),
        acct('5705-01 Repairs & Maintenance - Equip', 'e8', 40_000),
        acct('5705-10 Twine & Containers Expense', 'e9', 500),
        acct('5855-00 Interest on Long Term Debt', 'e10', 20_000),
        acct('5400-00 Amortization Expense', 'e11', 50_000),
        acct('5710-00 Land Rent', 'e12', 15_000),
        acct('5825-01 Charitable Donations', 'e13', 5_000),
        acct('5805-01 General Insurance Expense', 'e14', 10_000),
        acct('5860-00 Electricity', 'e15', 7_000),
        acct('5210-01 Salt & Mineral Expense', 'e16', 3_000),
        acct('5070-00 Canola Levy', 'e17', 1_000),
        acct('5049-00 Grain Drying', 'e18', 2_000),
      ], 418_500),
      { Summary: { ColData: [{ value: 'Net Income' }, { value: '494500' }] }, type: 'Section', group: 'NetIncome' },
    ],
  },
}

/** The Balance Sheet at the same year end. Current 400,000 / 220,000; liabilities 500,000; equity 500,000. */
export const BS: Obj = {
  Header: { StartPeriod: '2025-09-01', EndPeriod: '2026-08-31', ReportBasis: 'Accrual' },
  Columns: COLUMNS,
  Rows: {
    Row: [
      section('ASSETS', 'TotalAssets', [
        section('Current Assets', 'CurrentAssets', [
          section('Bank Accounts', 'BankAccounts', [acct('Chequing', 'a1', 50_000)], 50_000),
          section('Accounts Receivable', 'AR', [acct('Accounts Receivable (A/R)', 'a2', 100_000)], 100_000),
          section('Other Current Assets', 'OtherCurrentAssets', [acct('Grain Inventory', 'a3', 250_000)], 250_000),
        ], 400_000),
        section('Fixed Assets', 'FixedAssets', [acct('Machinery', 'a4', 900_000), acct('Accumulated Amortization', 'a5', -300_000)], 600_000),
      ], 1_000_000),
      section('LIABILITIES AND EQUITY', 'TotalLiabilitiesAndEquity', [
        section('Liabilities', 'Liabilities', [
          section('Current Liabilities', 'CurrentLiabilities', [
            section('Accounts Payable', 'AP', [acct('Accounts Payable (A/P)', 'l1', 80_000)], 80_000),
            section('Other Current Liabilities', 'OtherCurrentLiabilities', [acct('Operating Line', 'l2', 100_000), acct('Current Portion of Long Term Debt', 'l3', 40_000)], 140_000),
          ], 220_000),
          section('Long-Term Liabilities', 'LongTermLiabilities', [acct('Farm Mortgage', 'l4', 280_000)], 280_000),
        ], 500_000),
        section('Equity', 'Equity', [acct('Share Capital', 'q1', 100), acct('Retained Earnings', 'q2', 300_000), { ColData: [{ value: 'Net Income' }, { value: '199900' }], type: 'Data' }], 500_000),
      ], 1_000_000),
    ],
  },
}

/** The same report with QuickBooks' group keys taken off: the headings alone must do. */
export function withoutGroups(r: Obj): Obj {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Obj).filter(([k]) => k !== 'group').map(([k, x]) => [k, strip(x)]))
    return v
  }
  return strip(r) as Obj
}
