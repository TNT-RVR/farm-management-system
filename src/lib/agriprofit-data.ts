/**
 * Alberta's 2024 AgriProfit$ cost and return benchmarks, per acre.
 *
 * The farm's own budget says what a crop costs us. These say what it cost the
 * Alberta producers who sent their cost-of-production data in, in the same soil
 * zone, in the same year. One line beside the other is the most useful figure
 * in the research library for the money pages, and it needs no modelling — only
 * a lookup.
 *
 * Both sets come out of the two 2024 benchmark publications the library holds:
 * the irrigated soil zone, which is this farm, and the black soil zone, which
 * is dryland and a different zone — kept because it is the only dryland set
 * published for 2024, and labelled so nobody reads it as ours.
 *
 * Every number was parsed out of the PDF text rather than copied by hand, and
 * each table checks against its own arithmetic: variable plus capital costs
 * equal total production costs, gross return less total costs equals return to
 * equity, gross return less cash costs equals gross margin. The test holds
 * those three identities down, so a transcription slip cannot pass quietly.
 *
 * Only the 'ALL' tenure tables are here. The publications also split some crops
 * into owned and rented land, which differ mostly in rent and capital interest;
 * the combined row is the one a whole-farm budget compares against.
 */

export type AgriProfitRow = {
  crop: string
  /** The unit the publication's second column is in: bushel, tonne or ton. */
  unit: string | null
  yieldPerAcre: number | null

  // (A) Gross return
  cropSales: number | null
  cropInsurance: number | null
  miscReceipts: number | null
  governmentProgram: number | null
  strawAftermath: number | null
  grossReturn: number | null

  // (B) Variable costs
  seed: number | null
  fertilizer: number | null
  chemicals: number | null
  insurancePremiums: number | null
  trucking: number | null
  fuel: number | null
  irrigationPower: number | null
  repairsMachine: number | null
  repairsBuildings: number | null
  utilities: number | null
  customWork: number | null
  operatingInterest: number | null
  paidLabour: number | null
  unpaidLabour: number | null
  variableCosts: number | null

  // (C) Capital costs
  rent: number | null
  taxesAndWater: number | null
  depreciation: number | null
  leasePayments: number | null
  capitalInterest: number | null
  capitalCosts: number | null

  // (D) to (F) and the investment line
  cashCosts: number | null
  totalCosts: number | null
  grossMargin: number | null
  returnToEquity: number | null
  totalInvestment: number | null
}

export const AGRIPROFIT_SOURCE = {
  irrigated: {
    paperId: '7dc748a7-82c2-40fa-b919-b497b881690b',
    paper: '2024 cost and return benchmarks for crops and forages : irrigated',
    zone: 'Alberta irrigated soil zone',
  },
  black: {
    paperId: 'd24a6d07-afc2-4c8d-ab46-cff7661ee8ee',
    paper: '2024 cost and return benchmarks for crops and forages : black soil zone',
    zone: 'Alberta black soil zone, dryland',
  },
} as const

/**
 * Which of our crop names each benchmark crop answers for.
 *
 * Explicit, and deliberately short. A benchmark put against the wrong crop is
 * an argument made with the wrong number, and a missing comparison is easier to
 * live with than a misleading one. Potatoes, dry beans, hybrid seed canola and
 * sugar beet have no 2024 benchmark published, so they get none here.
 */
export const BENCHMARK_CROP_LABELS: Record<string, string> = {
  wheat: 'spring wheat',
  'spring wheat': 'spring wheat',
  'hard red spring wheat': 'spring wheat',
  'cps wheat': 'spring wheat',
  'winter wheat': 'winter wheat',
  durum: 'durum',
  'durum wheat': 'durum',
  'soft wheat': 'soft wheat',
  'soft white wheat': 'soft wheat',
  'soft white spring wheat': 'soft wheat',
  barley: 'feed barley',
  'feed barley': 'feed barley',
  'malt barley': 'malt barley',
  'malting barley': 'malt barley',
  rye: 'rye',
  'fall rye': 'rye',
  canola: 'argentine canola',
  'argentine canola': 'argentine canola',
  'liberty link canola': 'liberty link canola',
  'll canola': 'liberty link canola',
  'roundup ready canola': 'argentine canola',
  peas: 'peas',
  pea: 'peas',
  'field peas': 'peas',
  alfalfa: 'alfalfa hay',
  'alfalfa hay': 'alfalfa hay',
  'alfalfa grass hay': 'alfalfa/grass hay',
  'alfalfa/grass hay': 'alfalfa/grass hay',
  'grass hay': 'alfalfa/grass hay',
  'corn silage': 'corn silage',
  'silage corn': 'corn silage',
  // A bare "Corn" is deliberately absent. This farm keeps Silage Corn, Grain
  // Corn and High-Moisture Corn as separate crops, and only silage has a 2024
  // benchmark — so an unqualified "Corn" would be costed as silage on a guess.
  greenfeed: 'greenfeed',
  'green feed': 'greenfeed',
  'grain silage': 'grain silage',
  'barley silage': 'grain silage',
}

export const IRRIGATED_2024: AgriProfitRow[] = [
  { crop: "spring wheat", unit: "bushel", yieldPerAcre: 96.07, cropSales: 752.9, cropInsurance: 109.27, miscReceipts: 0.27, governmentProgram: 4.46, strawAftermath: 32.93, grossReturn: 899.83, seed: 26.35, fertilizer: 90.12, chemicals: 52.12, insurancePremiums: 27.5, trucking: 5.65, fuel: 31.84, irrigationPower: 38.06, repairsMachine: 42.34, repairsBuildings: 5.13, utilities: 22.92, customWork: 33.82, operatingInterest: 13.63, paidLabour: 36.08, unpaidLabour: 26.41, variableCosts: 451.96, rent: 27.22, taxesAndWater: 24.45, depreciation: 159.17, leasePayments: 12.6, capitalInterest: 23.92, capitalCosts: 247.35, cashCosts: 513.73, totalCosts: 699.31, grossMargin: 386.1, returnToEquity: 200.51, totalInvestment: 11442.21 },
  { crop: "winter wheat", unit: "bushel", yieldPerAcre: 108.78, cropSales: 854.45, cropInsurance: 76.55, miscReceipts: 0, governmentProgram: 3.52, strawAftermath: 10.22, grossReturn: 944.75, seed: 48.26, fertilizer: 79.89, chemicals: 66.48, insurancePremiums: 39.75, trucking: 5.84, fuel: 32.54, irrigationPower: 41.27, repairsMachine: 44.14, repairsBuildings: 5.6, utilities: 29.09, customWork: 38.19, operatingInterest: 36.85, paidLabour: 73.2, unpaidLabour: 43.67, variableCosts: 584.78, rent: 140.41, taxesAndWater: 18.69, depreciation: 217.27, leasePayments: 38.61, capitalInterest: 0, capitalCosts: 414.99, cashCosts: 738.83, totalCosts: 999.77, grossMargin: 205.92, returnToEquity: -55.02, totalInvestment: 12530.54 },
  { crop: "durum", unit: "bushel", yieldPerAcre: 90.83, cropSales: 850.23, cropInsurance: 26.76, miscReceipts: 0, governmentProgram: 0, strawAftermath: 24.23, grossReturn: 901.22, seed: 30.31, fertilizer: 88.83, chemicals: 41.39, insurancePremiums: 25.38, trucking: 7.31, fuel: 42.82, irrigationPower: 26.87, repairsMachine: 57.69, repairsBuildings: 2.03, utilities: 24.22, customWork: 12.37, operatingInterest: 10.22, paidLabour: 60.53, unpaidLabour: 27.84, variableCosts: 457.81, rent: 152.88, taxesAndWater: 20.93, depreciation: 72.25, leasePayments: 91.36, capitalInterest: 0, capitalCosts: 337.42, cashCosts: 695.14, totalCosts: 795.23, grossMargin: 206.08, returnToEquity: 105.99, totalInvestment: 8109.4 },
  { crop: "soft wheat", unit: "bushel", yieldPerAcre: 103.48, cropSales: 763.85, cropInsurance: 0, miscReceipts: 0, governmentProgram: 0, strawAftermath: 28.1, grossReturn: 791.95, seed: 31.25, fertilizer: 157.9, chemicals: 47.16, insurancePremiums: 33.59, trucking: 0.84, fuel: 8.7, irrigationPower: 25.53, repairsMachine: 47.73, repairsBuildings: 0.57, utilities: 10.46, customWork: 42.75, operatingInterest: 3.98, paidLabour: 49.41, unpaidLabour: 13.71, variableCosts: 473.58, rent: 0, taxesAndWater: 15.14, depreciation: 169.54, leasePayments: 0, capitalInterest: 0, capitalCosts: 184.68, cashCosts: 475.01, totalCosts: 658.27, grossMargin: 316.94, returnToEquity: 133.69, totalInvestment: 18434.38 },
  { crop: "malt barley", unit: "bushel", yieldPerAcre: 110.21, cropSales: 671.06, cropInsurance: 66.5, miscReceipts: 0.38, governmentProgram: 4.39, strawAftermath: 42.45, grossReturn: 784.78, seed: 38.18, fertilizer: 82.75, chemicals: 74.1, insurancePremiums: 30.71, trucking: 5.14, fuel: 31.87, irrigationPower: 38.43, repairsMachine: 47.41, repairsBuildings: 8.83, utilities: 29.37, customWork: 17.83, operatingInterest: 13.51, paidLabour: 60.7, unpaidLabour: 24.47, variableCosts: 503.3, rent: 14.6, taxesAndWater: 20.71, depreciation: 208.34, leasePayments: 0.26, capitalInterest: 14.09, capitalCosts: 258.01, cashCosts: 528.5, totalCosts: 761.31, grossMargin: 256.28, returnToEquity: 23.47, totalInvestment: 16599.95 },
  { crop: "feed barley", unit: "bushel", yieldPerAcre: 116.73, cropSales: 740.27, cropInsurance: 4.55, miscReceipts: 0, governmentProgram: 0, strawAftermath: 47.05, grossReturn: 791.87, seed: 23.13, fertilizer: 94.45, chemicals: 44.14, insurancePremiums: 5.64, trucking: 7.18, fuel: 22.09, irrigationPower: 32.6, repairsMachine: 32.75, repairsBuildings: 4.6, utilities: 12.47, customWork: 31.34, operatingInterest: 9.18, paidLabour: 44.74, unpaidLabour: 26.8, variableCosts: 391.11, rent: 22.64, taxesAndWater: 12.81, depreciation: 135.42, leasePayments: 4.63, capitalInterest: 0, capitalCosts: 175.49, cashCosts: 404.38, totalCosts: 566.6, grossMargin: 387.49, returnToEquity: 225.27, totalInvestment: 16822.12 },
  { crop: "rye", unit: "bushel", yieldPerAcre: 145.06, cropSales: 1053.89, cropInsurance: 46.05, miscReceipts: 0, governmentProgram: 2.64, strawAftermath: 52.72, grossReturn: 1155.3, seed: 55.87, fertilizer: 93.24, chemicals: 32.02, insurancePremiums: 44.51, trucking: 101.77, fuel: 35.36, irrigationPower: 43.96, repairsMachine: 51.52, repairsBuildings: 7.24, utilities: 30.85, customWork: 29.59, operatingInterest: 5.29, paidLabour: 69.01, unpaidLabour: 32.13, variableCosts: 632.38, rent: 92.27, taxesAndWater: 23.34, depreciation: 124.1, leasePayments: 27.15, capitalInterest: 0, capitalCosts: 266.87, cashCosts: 743.02, totalCosts: 899.25, grossMargin: 412.28, returnToEquity: 256.05, totalInvestment: 13198.85 },
  { crop: "argentine canola", unit: "bushel", yieldPerAcre: 67.05, cropSales: 953.71, cropInsurance: 0, miscReceipts: 0, governmentProgram: 0, strawAftermath: 5.14, grossReturn: 958.84, seed: 87.45, fertilizer: 133, chemicals: 56.51, insurancePremiums: 27.42, trucking: 5.48, fuel: 24.36, irrigationPower: 47.7, repairsMachine: 37.32, repairsBuildings: 2.07, utilities: 12.89, customWork: 18.9, operatingInterest: 18.69, paidLabour: 49.32, unpaidLabour: 40.54, variableCosts: 561.64, rent: 85.8, taxesAndWater: 13.59, depreciation: 199.55, leasePayments: 1.66, capitalInterest: 0, capitalCosts: 300.61, cashCosts: 622.16, totalCosts: 862.25, grossMargin: 336.68, returnToEquity: 96.59, totalInvestment: 12651.87 },
  { crop: "liberty link canola", unit: "bushel", yieldPerAcre: 59.41, cropSales: 867.81, cropInsurance: 0, miscReceipts: 0, governmentProgram: 0, strawAftermath: 0, grossReturn: 867.81, seed: 78.26, fertilizer: 161.03, chemicals: 41.94, insurancePremiums: 0, trucking: 1.1, fuel: 24.51, irrigationPower: 46.26, repairsMachine: 18.23, repairsBuildings: 3.66, utilities: 11.28, customWork: 1.52, operatingInterest: 10.2, paidLabour: 24.24, unpaidLabour: 25.05, variableCosts: 447.28, rent: 0, taxesAndWater: 9.22, depreciation: 80.09, leasePayments: 0, capitalInterest: 0, capitalCosts: 89.32, cashCosts: 431.45, totalCosts: 536.59, grossMargin: 436.36, returnToEquity: 331.21, totalInvestment: 16766.9 },
  { crop: "peas", unit: "bushel", yieldPerAcre: 79.25, cropSales: 969.79, cropInsurance: 15.88, miscReceipts: 4.7, governmentProgram: 1.05, strawAftermath: 5.18, grossReturn: 996.6, seed: 75.24, fertilizer: 43.01, chemicals: 66.15, insurancePremiums: 42.21, trucking: 8.8, fuel: 38.4, irrigationPower: 31.58, repairsMachine: 57.28, repairsBuildings: 3.82, utilities: 33.42, customWork: 22.03, operatingInterest: 8.21, paidLabour: 64.05, unpaidLabour: 32.26, variableCosts: 526.46, rent: 118.94, taxesAndWater: 27.83, depreciation: 118.8, leasePayments: 61.22, capitalInterest: 0, capitalCosts: 326.8, cashCosts: 702.2, totalCosts: 853.26, grossMargin: 294.39, returnToEquity: 143.33, totalInvestment: 11508.41 },
  { crop: "alfalfa hay", unit: "tonne", yieldPerAcre: 4.5, cropSales: 1163.47, cropInsurance: 0.13, miscReceipts: 0.14, governmentProgram: 1.85, strawAftermath: 0, grossReturn: 1165.6, seed: 5.28, fertilizer: 75.87, chemicals: 6.5, insurancePremiums: 0, trucking: 6.11, fuel: 17.72, irrigationPower: 50.38, repairsMachine: 32.06, repairsBuildings: 4.31, utilities: 15.21, customWork: 15.39, operatingInterest: 8.16, paidLabour: 39.95, unpaidLabour: 15.16, variableCosts: 292.1, rent: 0, taxesAndWater: 14.24, depreciation: 130.75, leasePayments: 0, capitalInterest: 10.13, capitalCosts: 155.12, cashCosts: 301.31, totalCosts: 447.22, grossMargin: 864.28, returnToEquity: 718.37, totalInvestment: 16156.31 },
  { crop: "alfalfa/grass hay", unit: "tonne", yieldPerAcre: 3.15, cropSales: 647.86, cropInsurance: 0, miscReceipts: 0, governmentProgram: 0, strawAftermath: 0, grossReturn: 647.86, seed: 4.29, fertilizer: 56.12, chemicals: 0, insurancePremiums: 0, trucking: 8.2, fuel: 18.82, irrigationPower: 43.08, repairsMachine: 41.89, repairsBuildings: 4.11, utilities: 19.47, customWork: 2.97, operatingInterest: 10.26, paidLabour: 41.81, unpaidLabour: 31.42, variableCosts: 282.44, rent: 0, taxesAndWater: 13.14, depreciation: 116.52, leasePayments: 1.24, capitalInterest: 0, capitalCosts: 130.91, cashCosts: 265.41, totalCosts: 413.36, grossMargin: 382.45, returnToEquity: 234.51, totalInvestment: 17688.59 },
  { crop: "corn silage", unit: "tonne", yieldPerAcre: 17.8, cropSales: 1397.12, cropInsurance: 0, miscReceipts: 0, governmentProgram: 0, strawAftermath: 0, grossReturn: 1397.12, seed: 51.68, fertilizer: 115.29, chemicals: 16, insurancePremiums: 0, trucking: 9.3, fuel: 11.94, irrigationPower: 56.21, repairsMachine: 32.7, repairsBuildings: 4.3, utilities: 9.02, customWork: 62.01, operatingInterest: 3.4, paidLabour: 48.91, unpaidLabour: 7.8, variableCosts: 428.57, rent: 0, taxesAndWater: 13.14, depreciation: 106.4, leasePayments: 0, capitalInterest: 0, capitalCosts: 119.54, cashCosts: 433.91, totalCosts: 548.11, grossMargin: 963.2, returnToEquity: 849.01, totalInvestment: 16213.52 },
]

export const DRYLAND_BLACK_2024: AgriProfitRow[] = [
  { crop: "spring wheat", unit: "bushel", yieldPerAcre: 58.16, cropSales: 500.13, cropInsurance: 0.05, miscReceipts: 0.15, governmentProgram: 0.76, strawAftermath: 0, grossReturn: 501.09, seed: 23.05, fertilizer: 111.02, chemicals: 42.55, insurancePremiums: 17.01, trucking: 1.35, fuel: 17.24, irrigationPower: 0, repairsMachine: 13.11, repairsBuildings: 3, utilities: 10.6, customWork: 2.92, operatingInterest: 4.09, paidLabour: 14.82, unpaidLabour: 8.86, variableCosts: 269.62, rent: 30.21, taxesAndWater: 8.11, depreciation: 19.45, leasePayments: 0, capitalInterest: 9.52, capitalCosts: 67.29, cashCosts: 308.6, totalCosts: 336.91, grossMargin: 192.49, returnToEquity: 164.18, totalInvestment: 3898.37 },
  { crop: "malt barley", unit: "bushel", yieldPerAcre: 76.02, cropSales: 473.69, cropInsurance: 0, miscReceipts: 0.56, governmentProgram: 0.57, strawAftermath: 0, grossReturn: 474.82, seed: 22.6, fertilizer: 88.48, chemicals: 45.33, insurancePremiums: 37.47, trucking: 0.74, fuel: 18.4, irrigationPower: 0, repairsMachine: 10.71, repairsBuildings: 1.9, utilities: 12.23, customWork: 1.03, operatingInterest: 1.03, paidLabour: 8.74, unpaidLabour: 14.22, variableCosts: 262.89, rent: 38.11, taxesAndWater: 3.04, depreciation: 4.66, leasePayments: 0, capitalInterest: 6.48, capitalCosts: 52.3, cashCosts: 296.3, totalCosts: 315.19, grossMargin: 178.51, returnToEquity: 159.63, totalInvestment: 2230.54 },
  { crop: "feed barley", unit: "bushel", yieldPerAcre: 80.88, cropSales: 497.48, cropInsurance: 0.08, miscReceipts: 0, governmentProgram: 2.19, strawAftermath: 48.01, grossReturn: 547.76, seed: 24.66, fertilizer: 101.38, chemicals: 20.51, insurancePremiums: 18.15, trucking: 4.87, fuel: 21.62, irrigationPower: 0, repairsMachine: 21.45, repairsBuildings: 3.17, utilities: 12.65, customWork: 6.53, operatingInterest: 5.29, paidLabour: 10.35, unpaidLabour: 19.59, variableCosts: 270.23, rent: 12.44, taxesAndWater: 9.98, depreciation: 28.03, leasePayments: 0, capitalInterest: 7.02, capitalCosts: 57.47, cashCosts: 280.08, totalCosts: 327.7, grossMargin: 267.68, returnToEquity: 220.06, totalInvestment: 4386.34 },
  { crop: "oats", unit: "bushel", yieldPerAcre: 86.95, cropSales: 450.76, cropInsurance: 0, miscReceipts: 0.51, governmentProgram: 0.58, strawAftermath: 0, grossReturn: 451.85, seed: 24.48, fertilizer: 99.74, chemicals: 28.2, insurancePremiums: 36.87, trucking: 0.8, fuel: 19.56, irrigationPower: 0, repairsMachine: 10.99, repairsBuildings: 2.49, utilities: 13.07, customWork: 2.45, operatingInterest: 2.23, paidLabour: 9.51, unpaidLabour: 12.47, variableCosts: 262.87, rent: 29.63, taxesAndWater: 4.21, depreciation: 5.24, leasePayments: 0, capitalInterest: 6.5, capitalCosts: 45.58, cashCosts: 290.74, totalCosts: 308.45, grossMargin: 161.11, returnToEquity: 143.4, totalInvestment: 3295.37 },
  { crop: "liberty link canola", unit: "bushel", yieldPerAcre: 49.39, cropSales: 708.16, cropInsurance: 0, miscReceipts: 0.2, governmentProgram: 0.26, strawAftermath: 0, grossReturn: 708.61, seed: 76.24, fertilizer: 110.61, chemicals: 49.21, insurancePremiums: 27.71, trucking: 1.05, fuel: 19.08, irrigationPower: 0, repairsMachine: 10.74, repairsBuildings: 3.28, utilities: 10.77, customWork: 4.61, operatingInterest: 4.9, paidLabour: 17.21, unpaidLabour: 10.71, variableCosts: 346.11, rent: 37.66, taxesAndWater: 9.77, depreciation: 16.82, leasePayments: 0, capitalInterest: 8.51, capitalCosts: 72.76, cashCosts: 391.34, totalCosts: 418.87, grossMargin: 317.27, returnToEquity: 289.74, totalInvestment: 3723.57 },
  { crop: "roundup ready canola", unit: "bushel", yieldPerAcre: 36.47, cropSales: 492.85, cropInsurance: 0.15, miscReceipts: 0.01, governmentProgram: 2.45, strawAftermath: 0, grossReturn: 495.46, seed: 65.82, fertilizer: 111.56, chemicals: 26.55, insurancePremiums: 23.36, trucking: 5.12, fuel: 15.57, irrigationPower: 0, repairsMachine: 22.95, repairsBuildings: 1.17, utilities: 9.11, customWork: 1.79, operatingInterest: 2.34, paidLabour: 7.85, unpaidLabour: 13.6, variableCosts: 306.78, rent: 63.64, taxesAndWater: 3.44, depreciation: 40.64, leasePayments: 0, capitalInterest: 6.79, capitalCosts: 114.51, cashCosts: 367.05, totalCosts: 421.28, grossMargin: 128.41, returnToEquity: 74.17, totalInvestment: 2095.16 },
  { crop: "alfalfa/grass hay", unit: "tonne", yieldPerAcre: 1.44, cropSales: 295.2, cropInsurance: 4.27, miscReceipts: 0.57, governmentProgram: 5.28, strawAftermath: 0, grossReturn: 305.31, seed: 0, fertilizer: 0, chemicals: 0, insurancePremiums: 6.96, trucking: 3.61, fuel: 9.91, irrigationPower: 0, repairsMachine: 20.66, repairsBuildings: 3.05, utilities: 17.31, customWork: 1.46, operatingInterest: 2.3, paidLabour: 0.23, unpaidLabour: 24.14, variableCosts: 89.62, rent: 69.63, taxesAndWater: 4.65, depreciation: 21.37, leasePayments: 0, capitalInterest: 16.67, capitalCosts: 112.32, cashCosts: 156.43, totalCosts: 201.94, grossMargin: 148.89, returnToEquity: 103.37, totalInvestment: 3876.06 },
  { crop: "mixed grass hay", unit: "tonne", yieldPerAcre: 0.46, cropSales: 72.04, cropInsurance: 0.04, miscReceipts: 0.52, governmentProgram: 0.95, strawAftermath: 0, grossReturn: 73.55, seed: 0, fertilizer: 0, chemicals: 0, insurancePremiums: 0, trucking: 1.48, fuel: 9.46, irrigationPower: 0, repairsMachine: 13.12, repairsBuildings: 1.62, utilities: 12.29, customWork: 1.06, operatingInterest: 1.15, paidLabour: 6.8, unpaidLabour: 15.67, variableCosts: 62.65, rent: 30.09, taxesAndWater: 0, depreciation: 7.11, leasePayments: 0, capitalInterest: 5.38, capitalCosts: 42.58, cashCosts: 82.45, totalCosts: 105.23, grossMargin: -8.9, returnToEquity: -31.68, totalInvestment: 1739.14 },
  { crop: "greenfeed", unit: "tonne", yieldPerAcre: 2.12, cropSales: 333.68, cropInsurance: 1.21, miscReceipts: 1.05, governmentProgram: 1.91, strawAftermath: 0, grossReturn: 337.86, seed: 27.29, fertilizer: 83.66, chemicals: 0.57, insurancePremiums: 0.48, trucking: 3.04, fuel: 24.85, irrigationPower: 0, repairsMachine: 18.07, repairsBuildings: 0.94, utilities: 13.54, customWork: 1.53, operatingInterest: 1.05, paidLabour: 0.84, unpaidLabour: 19.57, variableCosts: 195.43, rent: 18.14, taxesAndWater: 5.67, depreciation: 10.09, leasePayments: 0, capitalInterest: 1.72, capitalCosts: 35.63, cashCosts: 201.4, totalCosts: 231.06, grossMargin: 136.46, returnToEquity: 106.8, totalInvestment: 4133.36 },
  { crop: "grain silage", unit: "tonne", yieldPerAcre: 6.03, cropSales: 581.05, cropInsurance: 67.62, miscReceipts: 31.17, governmentProgram: 9, strawAftermath: 0, grossReturn: 688.85, seed: 40.08, fertilizer: 88.64, chemicals: 29.39, insurancePremiums: 23.75, trucking: 4.12, fuel: 21.19, irrigationPower: 0, repairsMachine: 17.88, repairsBuildings: 2.6, utilities: 15.63, customWork: 15.46, operatingInterest: 0, paidLabour: 15.73, unpaidLabour: 0.92, variableCosts: 275.38, rent: 0, taxesAndWater: 2.7, depreciation: 0, leasePayments: 0, capitalInterest: 0.08, capitalCosts: 2.78, cashCosts: 277.25, totalCosts: 278.17, grossMargin: 411.6, returnToEquity: 410.68, totalInvestment: 9890.11 },
]
