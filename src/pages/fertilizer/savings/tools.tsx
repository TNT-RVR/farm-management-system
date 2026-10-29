import { BlendPremiumCard, BuyWindowCard, InventoryCard, NeedVsBookedCard, NutrientCostCard, ProgramsCard, QuoteSheetCard, ServiceAuditCard } from './Buying'
import {
  DontApplyCard,
  EconomicNCard,
  EnhancedCard,
  ManureCreditCard,
  PriorCropCard,
  RemovalCard,
  SplitCard,
  TissueGateCard,
  VrCard,
} from './Applying'
import { BalanceAndStripsCard, CostPerBushelCard, OverAppliedCard } from './Proving'
import { GrantsCard, NerpCard, PrepayCard, PriceCheckCard, SamplingPaybackCard, SpreadWindowCard, StoreCard } from './More'
import { NRichStripCard, NTrialCard, PkBalanceCard, ProteinCard, ResampleCard, SalinityCard, YieldGoalCard } from './Research'

/**
 * One savings tool by its number. Shared by the Savings tab and the tabs the
 * moved tools live on now (lib/fert-savings/homes.ts); each must sit inside a
 * SavingsProvider, which loads what the tools read.
 */
export function SavingsTool({ id, isManager }: { id: number; isManager: boolean }) {
  switch (id) {
    case 1: return <BuyWindowCard />
    case 2: return <NutrientCostCard />
    case 3: return <BlendPremiumCard />
    case 4: return <NeedVsBookedCard />
    case 5: return <QuoteSheetCard />
    case 6: return <ProgramsCard />
    case 7: return <ServiceAuditCard />
    case 8: return <InventoryCard />
    case 9: return <ManureCreditCard />
    case 10: return <PriorCropCard />
    case 11: return <EconomicNCard />
    case 12: return <DontApplyCard />
    case 13: return <RemovalCard />
    case 14: return <SplitCard />
    case 15: return <TissueGateCard />
    case 16: return <EnhancedCard />
    case 17: return <VrCard />
    case 18: return <OverAppliedCard />
    case 19: return <CostPerBushelCard />
    case 20: return <BalanceAndStripsCard />
    case 21: return <PriceCheckCard />
    case 22: return <GrantsCard />
    case 23: return <NerpCard />
    case 24: return <SpreadWindowCard />
    case 26: return <PrepayCard isManager={isManager} />
    case 27: return <StoreCard />
    case 28: return <SamplingPaybackCard />
    case 29: return <YieldGoalCard />
    case 30: return <SalinityCard />
    case 31: return <ResampleCard />
    case 32: return <NRichStripCard />
    case 33: return <NTrialCard />
    case 34: return <ProteinCard />
    case 35: return <PkBalanceCard />
    // 36, the 4R / NERP record pack, is the report of that name on Reports.
    default: return null
  }
}
