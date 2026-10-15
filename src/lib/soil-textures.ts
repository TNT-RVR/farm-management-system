import { SOIL_TEXTURES } from '@/lib/et'

/**
 * The nine soil textures the balance knows about, with the field-identification
 * detail for each.
 *
 * Kept in lib rather than beside the component for the same reason as
 * irrigation-help: this is farm reference data, it wants correcting without
 * touching a render tree, and the keys have to stay in lockstep with
 * SOIL_TEXTURES in et.ts — which is worth a test, and a test cannot reach into
 * a component module.
 */
export type Texture = {
  key: keyof typeof SOIL_TEXTURES & string
  label: string
  sand: number
  silt: number
  clay: number
  /** Base soil colour for the swatch — mineral tone, not organic staining. */
  base: string
  grain: string
  feel: string
  ribbon: string
  ball: string
  water: string
}

// Composition figures are the mid-points of each USDA texture-triangle class.
// Feel / ribbon / ball descriptions follow the USDA field texture-by-feel key.
export const TEXTURES: Texture[] = [
  {
    key: 'sand', label: 'Sand', sand: 92, silt: 5, clay: 3,
    base: '#d8bd8e', grain: '#a9854d',
    feel: 'Very gritty. Individual grains visible and easily felt.',
    ribbon: 'No ribbon at all.',
    ball: 'Will not hold a ball — falls apart in your hand.',
    water: 'Dries out fastest. Needs light, frequent applications.',
  },
  {
    key: 'loamy sand', label: 'Loamy sand', sand: 82, silt: 12, clay: 6,
    base: '#d2b587', grain: '#a07f4c',
    feel: 'Very gritty, with a faint trace of stickiness.',
    ribbon: 'No true ribbon — breaks under about 1 cm.',
    ball: 'Forms a weak ball that collapses when handled.',
    water: 'Holds a little more than sand, still drains quickly.',
  },
  {
    key: 'sandy loam', label: 'Sandy loam', sand: 65, silt: 25, clay: 10,
    base: '#c4a87e', grain: '#94764a',
    feel: 'Gritty, but holds together when moist.',
    ribbon: 'Ribbons less than 2.5 cm before breaking.',
    ball: 'Forms a ball that survives careful handling.',
    water: 'Moderate holding capacity; a common irrigated soil here.',
  },
  {
    key: 'loam', label: 'Loam', sand: 40, silt: 40, clay: 20,
    base: '#9c7f5c', grain: '#6f573a',
    feel: 'Neither gritty nor smooth — slightly floury, even.',
    ribbon: 'Ribbons about 2.5 cm.',
    ball: 'Forms a firm ball that handles well.',
    water: 'The balanced case, and the app default.',
  },
  {
    key: 'silt loam', label: 'Silt loam', sand: 20, silt: 60, clay: 20,
    base: '#a6906d', grain: '#7b6849',
    feel: 'Smooth and floury, like dry flour. Little grit.',
    ribbon: 'Ribbons about 2.5 cm; breaks rather than bends.',
    ball: 'Forms a firm ball; feels soft and silky when rubbed.',
    water: 'Excellent holding capacity, gives water up readily.',
  },
  {
    key: 'silty clay loam', label: 'Silty clay loam', sand: 10, silt: 55, clay: 35,
    base: '#8d7458', grain: '#63513c',
    feel: 'Smooth, with a definite sticky pull when wet.',
    ribbon: 'Ribbons 2.5 to 5 cm.',
    ball: 'Firm ball, moulds easily without cracking.',
    water: 'Holds a lot; slower to take water in.',
  },
  {
    key: 'clay loam', label: 'Clay loam', sand: 32, silt: 34, clay: 34,
    base: '#8a6a4f', grain: '#5f4633',
    feel: 'Slightly gritty and clearly plastic — moulds like putty.',
    ribbon: 'Ribbons 2.5 to 5 cm.',
    ball: 'Firm ball; fingerprints hold their shape in it.',
    water: 'Holds a lot; watch for runoff on a fast pivot pass.',
  },
  {
    key: 'silty clay', label: 'Silty clay', sand: 7, silt: 48, clay: 45,
    base: '#7d6450', grain: '#54402f',
    feel: 'Very smooth and sticky. No grit to be found.',
    ribbon: 'Ribbons over 5 cm without breaking.',
    ball: 'Hard ball; smears shiny when rubbed between fingers.',
    water: 'Very high storage, but takes water in slowly.',
  },
  {
    key: 'clay', label: 'Clay', sand: 22, silt: 25, clay: 53,
    base: '#6f5747', grain: '#48362a',
    feel: 'Very sticky and plastic. Cracks into hard blocks when dry.',
    ribbon: 'Ribbons well over 5 cm, long and flexible.',
    ball: 'Hard ball; rubs to a distinct shine.',
    water: 'Holds the most, and clings hardest to what it holds.',
  },
]

