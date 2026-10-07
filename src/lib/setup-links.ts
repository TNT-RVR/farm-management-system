/**
 * Where a missing piece of setup is filled in. An empty card says what is
 * missing; this takes the person straight to the box for it — the field's
 * own row, the right integration — rather than naming a page to go find.
 */
export const SETUP_LINKS = {
  /** Irrigation → Setup, scrolled to the field's row (planting date, crop curve). */
  plantingDate: (fieldId?: string | null) => `/irrigation?view=setup${fieldId ? `&field=${fieldId}` : ''}`,
  /** Settings → Integrations, FieldNET opened at the pivot → field list. */
  fieldnetPivot: (fieldId?: string | null) => `/settings?tab=Integrations&open=fieldnet${fieldId ? `&field=${fieldId}` : ''}`,
  /** Settings → Integrations with one company's card opened and in view. */
  integration: (card: 'deere' | 'quickbooks') => `/settings?tab=Integrations&open=${card}`,
  /** Settings → Farm setup, on one of its parts (admins only). */
  farmSetup: (part: 'overview' | 'farm' | 'features' | 'connections' | 'customize') => `/settings?tab=Farm setup&part=${part}`,
  /** Settings → My account → This device (offline access). */
  thisDevice: () => '/settings?section=device',
  /** The field's Settings tab, where its boundary is drawn. */
  fieldBoundary: (fieldId: string) => `/fields/${fieldId}/settings`,
  /** Fertilizer → Soil tests on that field, with the upload button. */
  soilTests: (fieldId?: string | null) => `/fertilizer?tab=Soil Sampling${fieldId ? `&field=${fieldId}` : ''}`,
  /** The crop's page, scrolled to its Moisture card (919 chart, moisture bands). */
  cropMoisture: (cropId?: string | null) => (cropId ? `/crops/${cropId}?section=moisture` : '/crops'),
  /** Crop financials → Plan, where each field's crop for the year is set. */
  cropPlan: () => '/plan?tab=plan',
  /** Chemicals → Prices, the product price book. */
  chemicalPrices: () => '/chemicals?tab=prices',
  /** Contracts → Contracts, where a grain contract is added. */
  contracts: () => '/contracts?tab=contracts',
  /** The Cameras page, where a camera is put on a river gauge. */
  cameras: () => '/cameras',
  /** Rotation, with the "Read re-cropping rules from the labels" button. */
  rotation: () => '/rotation',
  /** The main Map, whose Layers → Farm layers copies a My Map folder in. */
  farmMap: () => '/map?tab=map',
  /** Cattle → Herd on that ranch (group head counts). */
  cattleHerd: (ranchId?: string | null) => `/herd${ranchId ? `?ranch=${ranchId}` : ''}`,
  /** Cattle → Feed on that ranch (each group's ration). */
  cattleFeed: (ranchId?: string | null) => `/feed${ranchId ? `?ranch=${ranchId}` : ''}`,
  /** Cattle settings, the costs form opened on that ranch. */
  cattleCosts: (ranchId?: string | null) => `/cattle-settings${ranchId ? `?ranch=${ranchId}` : ''}`,
}
