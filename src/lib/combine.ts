/**
 * Setting the combine, and finding out what it is throwing over the back.
 *
 * Written for the two New Holland CR9090s. A twin-rotor machine behaves
 * differently from a walker combine in ways that matter to every rule below:
 * threshing and separation both happen along the rotors, so grain going out the
 * back has two quite separate causes with opposite fixes, and telling them
 * apart before touching anything is most of the job.
 *
 * NOTHING HERE IS A FACTORY SETTING. The starting points are the middle of the
 * range a CR runs in for each crop, meant to get the machine into the field on
 * the first morning; the operator's manual is the authority, and the numbers
 * that matter in the end are the ones saved off the machine after a day that
 * went well. That is why every crop's settings are editable and stored.
 */

export type SettingKey =
  | 'rotor_rpm'
  | 'concave_mm'
  | 'vane_angle'
  | 'fan_rpm'
  | 'presieve_mm'
  | 'chaffer_mm'
  | 'sieve_mm'
  | 'ground_speed_mph'

export type Setting = {
  key: SettingKey
  label: string
  unit: string
  /** What the knob physically does. */
  does: string
  /** What going up costs you, and what going down costs you. */
  tooHigh: string
  tooLow: string
}

/**
 * The seven things worth touching, in the order they are usually touched.
 *
 * Ordered deliberately: the first three change how hard the crop is threshed,
 * the next three change what is separated out of it afterwards, and ground
 * speed sits last because it is the one people reach for first and the one
 * most likely to make every other setting wrong.
 */
export const SETTINGS: Setting[] = [
  {
    key: 'rotor_rpm',
    label: 'Rotor speed',
    unit: 'rpm',
    does: 'How fast the twin rotors turn. Sets how aggressively the crop is rubbed apart between rotor and concave, and how hard the grain is handled the whole way along.',
    tooHigh:
      'Cracked, peeled and split grain, straw broken into chaff, a dirty sample because there is more fine material for the shoe to deal with, and more horsepower burnt.',
    tooLow:
      'Unthreshed heads and cobs out the back, and grain still locked in the pod or the hull.',
  },
  {
    key: 'concave_mm',
    label: 'Concave clearance',
    unit: 'mm',
    does: 'The gap between the rotor and the concave. Together with rotor speed it decides how much the crop is squeezed as it passes.',
    tooHigh:
      'Under-threshing — heads and pods come through whole. Grain that never got knocked loose cannot be separated later.',
    tooLow:
      'Grain damage, broken straw, heavy returns and a hard-working machine. On a tough day it is also how you plug a rotor.',
  },
  {
    key: 'vane_angle',
    label: 'Rotor vane setting',
    unit: 'notch',
    does: 'How steeply the vanes in the rotor housing drive material rearward. This is the CR-specific one: it sets how long the crop stays in the rotor rather than how hard it is hit.',
    tooHigh:
      'Material rushes through — short retention time, so grain that needed another turn to shake loose leaves with the straw. Shows up as free grain in the straw, not as whole heads.',
    tooLow:
      'Material lingers, the rotor loads up and draws power, straw gets ground into chaff, and in a heavy crop it is the first thing to slug.',
  },
  {
    key: 'fan_rpm',
    label: 'Cleaning fan',
    unit: 'rpm',
    does: 'The air blast up through the chaffer and sieve, floating chaff off the back while grain falls through.',
    tooHigh:
      'Light grain blown out over the sieves. This is the classic canola and sainfoin mistake — a seed that light does not need much air to leave.',
    tooLow:
      'The sieves load up and blind over, the sample comes in dirty, and once the chaffer is choked grain rides over the top of it and out the back anyway.',
  },
  {
    key: 'presieve_mm',
    label: 'Pre-sieve',
    unit: 'mm',
    does: 'The short sieve at the front of the shoe, set by hand. Takes the first cut at the material coming off the grain pan before the upper sieve sees it, so the upper sieve starts with less on it.',
    tooHigh:
      'Coarse chaff and broken straw drop straight through to the lower sieve and the returns, and the sample gets dirtier for it.',
    tooLow:
      'It blinds over and carries grain back onto the upper sieve in a heap, which is the uneven loading the manual warns about. Shoe loss that no fan setting fixes.',
  },
  {
    key: 'chaffer_mm',
    label: 'Upper sieve (chaffer)',
    unit: 'mm',
    does: 'How far the top sieve louvres open. Decides how much of what comes off the rotors is allowed down to the bottom sieve.',
    tooHigh:
      'Chaff and unthreshed bits fall through, so the sample is dirty and returns get heavy.',
    tooLow:
      'Grain cannot get down through it and rides out the back over the top. Shoe loss, and it looks exactly like too much fan.',
  },
  {
    key: 'sieve_mm',
    label: 'Bottom sieve',
    unit: 'mm',
    does: 'Final sizing before the clean grain auger. What gets past here is what goes in the tank; what does not goes round again as returns.',
    tooHigh: 'Dirty sample — chaff and small trash reach the tank.',
    tooLow: 'Clean grain sent back round as returns, rethreshed, and cracked in the process.',
  },
  {
    key: 'ground_speed_mph',
    label: 'Ground speed',
    unit: 'mph',
    does: 'How much crop per second the machine has to deal with. Every other setting is chosen for some feed rate, and this is that feed rate.',
    tooHigh:
      'Loss everywhere at once, and no setting change fixes it. If loss climbs the moment you speed up, the machine is full and it is telling you so.',
    tooLow:
      'Nothing breaks, you just do not get the crop off. A combine that is never loaded is a combine running at half capacity.',
  },
]

export type CombineCropKey =
  | 'canola'
  | 'corn'
  | 'wheat'
  | 'durum'
  | 'beans'
  | 'barley'
  | 'oats'
  | 'sainfoin'

export type CropBaseline = {
  key: CombineCropKey
  label: string
  /**
   * Starting point per setting. Where the New Holland manual has a figure for
   * the crop it is the manual's (22 in rotor), and startingPoints() in
   * combine-manual.ts says which ones those are; the rest are our estimate.
   */
  start: Record<SettingKey, number>
  /** The sensible span for each, for a slider and for sanity-checking. */
  range: Record<SettingKey, [number, number]>
  /** What makes this crop awkward. */
  note: string
  /** Loss worth chasing, as a share of yield. */
  targetLossPct: number
}

/**
 * Starting points per crop.
 *
 * Rotor, concave, fan and the three sieves come from the CR operator's manual
 * (section 6, "Machine settings for different crops", 22 in rotor column).
 * Vane setting and ground speed are not in that table and are ours. Sainfoin
 * has no row in the book at all. They exist so nobody starts from zero at six
 * in the morning; they are meant to be replaced by what the machine actually
 * ran at.
 */
export const CROP_BASELINES: CropBaseline[] = [
  {
    key: 'canola',
    label: 'Canola',
    start: {
      rotor_rpm: 630,
      concave_mm: 23,
      vane_angle: 2,
      fan_rpm: 500,
      presieve_mm: 7,
      chaffer_mm: 9,
      sieve_mm: 4,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [450, 800],
      concave_mm: [10, 28],
      vane_angle: [1, 4],
      fan_rpm: [400, 900],
      presieve_mm: [4, 12],
      chaffer_mm: [6, 16],
      sieve_mm: [3, 8],
      ground_speed_mph: [2, 6],
    },
    note: 'Threshes almost for free — the pods want to open. Nearly all of the loss is out the shoe, and nearly all of that is too much fan. A seed this small also finds every leak in the machine, so check the unloading auger boot and the rock trap before blaming settings. Book: feeder drum 3, DSP 1100, smooth returns cover, Graepel upper extension.',
    targetLossPct: 1,
  },
  {
    key: 'corn',
    label: 'Corn',
    start: {
      rotor_rpm: 500,
      concave_mm: 23,
      vane_angle: 1,
      fan_rpm: 1000,
      presieve_mm: 11,
      chaffer_mm: 13,
      sieve_mm: 12,
      ground_speed_mph: 4,
    },
    range: {
      rotor_rpm: [250, 650],
      concave_mm: [15, 45],
      vane_angle: [1, 3],
      fan_rpm: [800, 1300],
      presieve_mm: [8, 16],
      chaffer_mm: [10, 22],
      sieve_mm: [7, 16],
      ground_speed_mph: [2.5, 6],
    },
    note: 'Slow rotor, wide concave, lots of air. The kernel is heavy so it will not blow out easily, which means fan is a blunt tool here and grain damage is the thing to watch. Most corn loss never reaches the machine at all — it is ears on the ground at the header, so count in front of the combine before you count behind it. The book has a whole conversion list for corn: feeder drum 5, DSP 640, universal or round-bar concaves with half the wires out, corn sieve package, humped grain pan insert OUT, vanes slow front / mid rear.',
    targetLossPct: 1,
  },
  {
    key: 'wheat',
    label: 'Wheat',
    start: {
      rotor_rpm: 1150,
      concave_mm: 13,
      vane_angle: 2,
      fan_rpm: 850,
      presieve_mm: 10,
      chaffer_mm: 10,
      sieve_mm: 4,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [650, 1400],
      concave_mm: [6, 18],
      vane_angle: [1, 4],
      fan_rpm: [650, 1100],
      presieve_mm: [6, 14],
      chaffer_mm: [8, 20],
      sieve_mm: [3, 10],
      ground_speed_mph: [2.5, 6],
    },
    note: 'The straightforward one, and the one where straw condition changes everything: tough straw wants more rotor and a steeper vane, dry brittle straw wants less of both or you make chaff and hand the shoe a mess. Starting points are the book’s "Wheat normal" row; its "Wheat hard red" row runs the rotor 200 faster with the concave nearly closed, and is where durum starts. Vanes mid front / fast rear.',
    targetLossPct: 1,
  },
  {
    key: 'durum',
    label: 'Durum',
    start: {
      rotor_rpm: 1350,
      concave_mm: 8,
      vane_angle: 2,
      fan_rpm: 850,
      presieve_mm: 8,
      chaffer_mm: 13,
      sieve_mm: 8,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [800, 1500],
      concave_mm: [4, 18],
      vane_angle: [1, 4],
      fan_rpm: [650, 1100],
      presieve_mm: [5, 14],
      chaffer_mm: [8, 20],
      sieve_mm: [4, 12],
      ground_speed_mph: [2.5, 6],
    },
    note: 'The book has no durum row; these are its "Wheat hard red" numbers, which is the nearest thing. Durum threshes harder than a spring wheat and downgrades on checked or broken kernels, so if the sample shows cracks come off the rotor before opening anything else, and keep the returns light — the second trip through is where the damage happens.',
    targetLossPct: 1,
  },
  {
    key: 'beans',
    label: 'Dry beans',
    start: {
      rotor_rpm: 700,
      concave_mm: 21,
      vane_angle: 2,
      fan_rpm: 900,
      presieve_mm: 9,
      chaffer_mm: 11,
      sieve_mm: 9,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [400, 900],
      concave_mm: [12, 32],
      vane_angle: [1, 4],
      fan_rpm: [650, 1150],
      presieve_mm: [6, 14],
      chaffer_mm: [8, 16],
      sieve_mm: [5, 14],
      ground_speed_mph: [2, 6],
    },
    note: 'Gentle. A split bean is a downgrade, so run the slowest rotor and widest concave that leave nothing in the pod, and keep the returns light because the second trip is where they crack. Book row is "Peas / Edible beans": feeder drum 3, DSP 640, universal or round-bar concaves with half the wires out, the corn and bean sieve package, smooth returns cover, and the humped grain pan insert OUT.',
    targetLossPct: 2,
  },
  {
    key: 'barley',
    label: 'Barley',
    start: {
      rotor_rpm: 1100,
      concave_mm: 14,
      vane_angle: 2,
      fan_rpm: 800,
      presieve_mm: 11,
      chaffer_mm: 13,
      sieve_mm: 5,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [750, 1350],
      concave_mm: [8, 20],
      vane_angle: [1, 4],
      fan_rpm: [600, 1000],
      presieve_mm: [6, 16],
      chaffer_mm: [8, 18],
      sieve_mm: [3, 9],
      ground_speed_mph: [2.5, 6],
    },
    note: 'Peeled and skinned kernels are the barley fault — the hull comes off with too much rotor or too tight a concave, and a malt sample fails on it. Awns and chaff are light, so the fan does most of the cleaning. Book: feeder drum 2, DSP 1100, spike returns cover, small-grain sieve package, extension out.',
    targetLossPct: 1,
  },
  {
    key: 'oats',
    label: 'Oats',
    start: {
      rotor_rpm: 930,
      concave_mm: 14,
      vane_angle: 2,
      fan_rpm: 600,
      presieve_mm: 9,
      chaffer_mm: 11,
      sieve_mm: 6,
      ground_speed_mph: 3.5,
    },
    range: {
      rotor_rpm: [650, 1200],
      concave_mm: [8, 20],
      vane_angle: [1, 4],
      fan_rpm: [400, 800],
      presieve_mm: [6, 14],
      chaffer_mm: [8, 16],
      sieve_mm: [3, 9],
      ground_speed_mph: [2.5, 6],
    },
    note: 'Light and bulky. Dehulled kernels in the tank mean the rotor is too fast or the concave too tight. The book’s fan is low for a grain this size, so shoe loss comes quickly if it goes up — clean the sample with the sieves before the fan. Feeder drum 2, DSP 1100, spike returns cover, extension out.',
    targetLossPct: 1,
  },
  {
    key: 'sainfoin',
    label: 'Sainfoin',
    start: {
      rotor_rpm: 700,
      concave_mm: 13,
      vane_angle: 2,
      fan_rpm: 550,
      presieve_mm: 7,
      chaffer_mm: 10,
      sieve_mm: 5,
      ground_speed_mph: 2.5,
    },
    range: {
      rotor_rpm: [500, 900],
      concave_mm: [8, 20],
      vane_angle: [1, 4],
      fan_rpm: [350, 750],
      presieve_mm: [4, 12],
      chaffer_mm: [6, 14],
      sieve_mm: [3, 8],
      ground_speed_mph: [1.5, 4],
    },
    note: 'Not in the book at all; these are ours. Harvested in the hull, and the hull is nearly as light as the seed — so the air that clears the chaff also clears the crop. Start the fan low and bring it up until the sample is clean, rather than down until the loss stops. Stemmy green growth is what plugs it; slow down before opening anything up.',
    targetLossPct: 2,
  },
]

export type AdjustDirection = 'up' | 'down' | 'check'

export type Adjustment = {
  setting: SettingKey | 'header' | 'inspect'
  direction: AdjustDirection
  /** How much to move it in one go. */
  step: string
  why: string
}

export type Symptom = {
  key: string
  label: string
  /** How to be sure this is the problem before changing anything. */
  confirm: string
  /** In order. Do the first, look again, and only then do the second. */
  fixes: Adjustment[]
  /** Crops this is especially worth knowing about, if any. */
  crops?: CombineCropKey[]
}

/**
 * Symptom to adjustment.
 *
 * One change at a time, in order, checking between each — a machine with four
 * settings changed at once teaches you nothing about which one mattered, and
 * two of them were probably pulling against each other.
 *
 * The split between rotor loss and shoe loss runs through all of this, because
 * the same complaint ("losing grain out the back") has opposite fixes depending
 * on which one it is.
 */
export const SYMPTOMS: Symptom[] = [
  {
    key: 'rotor_loss_free_grain',
    label: 'Loose grain in the straw out the back',
    confirm:
      'Shut the chopper off and lay a windrow. Free grain UNDER the straw row is rotor loss — it was threshed and never separated. Grain out in the chaff, wider than the straw row, is shoe loss instead; use the next entry for that.',
    fixes: [
      {
        setting: 'ground_speed_mph',
        direction: 'down',
        step: '0.5 mph',
        why: 'Separation takes time, and time is what a full rotor does not have. If half a mile an hour fixes it, the machine was simply full.',
      },
      {
        setting: 'vane_angle',
        direction: 'down',
        step: 'one notch',
        why: 'Shallower vanes hold the crop in the rotor longer, giving grain more turns to work its way out through the separating grates. This is the lever a walker combine does not have.',
      },
      {
        setting: 'rotor_rpm',
        direction: 'up',
        step: '50 rpm',
        why: 'More centrifugal force throwing grain out through the grates — but watch the sample, because this is also how you start cracking it.',
      },
      {
        setting: 'inspect',
        direction: 'check',
        step: 'grates and covers',
        why: 'Blanked-off or blinded separating grates lose grain no setting will recover. Worth a look before chasing rpm any further.',
      },
    ],
  },
  {
    key: 'shoe_loss',
    label: 'Grain going out over the sieves',
    confirm:
      'Grain lands out in the chaff spread, wider than the straw row, and a pan under the shoe catches whole clean grain with the chaff.',
    fixes: [
      {
        setting: 'fan_rpm',
        direction: 'down',
        step: '50 rpm',
        why: 'The commonest cause by a distance, and the first thing to try in canola and sainfoin. Come down until loss stops, then back up until the sample is clean again.',
      },
      {
        setting: 'chaffer_mm',
        direction: 'up',
        step: '2 mm',
        why: 'If grain cannot get down through the chaffer it rides over the top and out. A choked chaffer looks exactly like too much wind.',
      },
      {
        setting: 'ground_speed_mph',
        direction: 'down',
        step: '0.5 mph',
        why: 'A shoe buried in material cannot clean, whatever the openings are set to.',
      },
      {
        setting: 'inspect',
        direction: 'check',
        step: 'sieve for blinding',
        why: 'Damp chaff or green material pastes over the louvres and stops anything falling through. It looks like a settings problem and is not.',
      },
    ],
  },
  {
    key: 'dirty_sample',
    label: 'Sample is not clean enough',
    confirm: 'Chaff, hulls, straw pieces or green material in the tank sample.',
    fixes: [
      {
        setting: 'fan_rpm',
        direction: 'up',
        step: '50 rpm',
        why: 'Air is what carries the light material away, and it costs no grain until it is enough to lift the grain too. Go here before closing anything down.',
      },
      {
        setting: 'sieve_mm',
        direction: 'down',
        step: '1 mm',
        why: 'Sizes the trash out at the last stage. Watch the returns — close it too far and you send clean grain round again to be cracked.',
      },
      {
        setting: 'chaffer_mm',
        direction: 'down',
        step: '2 mm',
        why: 'Keeps the coarse stuff from ever reaching the bottom sieve. Closing the chaffer is the one that risks putting grain out the back, so it comes after the other two.',
      },
      {
        setting: 'rotor_rpm',
        direction: 'down',
        step: '50 rpm',
        why: 'If the sample is full of fine chaff rather than whole trash, the rotor is grinding the straw up and the shoe is being asked to clean something it should never have seen.',
      },
    ],
  },
  {
    key: 'unthreshed',
    label: 'Unthreshed heads, pods or cobs out the back',
    confirm:
      'Whole heads or unopened pods in the straw, or cobs with kernels still on them. Different from loose grain in the straw — that is a separation problem, this is a threshing one.',
    fixes: [
      {
        setting: 'concave_mm',
        direction: 'down',
        step: '2 mm',
        why: 'Squeeze the crop harder against the concave. The most direct threshing lever, and the first to try.',
      },
      {
        setting: 'rotor_rpm',
        direction: 'up',
        step: '50 rpm',
        why: 'More rubbing per pass. Comes second because it does more to the sample than closing the concave does.',
      },
      {
        setting: 'vane_angle',
        direction: 'down',
        step: 'one notch',
        why: 'Holds the crop in the rotor longer, so it gets threshed more without hitting it any harder. Often the gentlest way out of this.',
      },
      {
        setting: 'inspect',
        direction: 'check',
        step: 'rasp bars and concaves for wear',
        why: 'The manual lists worn rasp bars and worn concaves as a cause of unthreshed heads. If the settings that worked last year do not this year, look at the iron before the numbers.',
      },
      {
        setting: 'inspect',
        direction: 'check',
        step: 'moisture and time of day',
        why: 'Tough crop at eight in the morning is not a settings problem. If it threshes clean by noon on the same settings, wait.',
      },
    ],
  },
  {
    key: 'cracked_grain',
    label: 'Cracked, split or peeled grain',
    confirm:
      'Damage in the tank sample. Check the returns too — grain going round twice gets cracked, and the fix for that is different.',
    fixes: [
      {
        setting: 'rotor_rpm',
        direction: 'down',
        step: '50 rpm',
        why: 'The single biggest cause of damaged grain in a rotary. Come down until the damage stops, then check nothing is going out unthreshed.',
      },
      {
        setting: 'concave_mm',
        direction: 'up',
        step: '2 mm',
        why: 'Less squeeze. Pairs with the rotor coming down; do one at a time so you know which did it.',
      },
      {
        setting: 'sieve_mm',
        direction: 'up',
        step: '1 mm',
        why: 'If the returns are heavy, the damage is happening on the second trip through. Opening the bottom sieve lets grain into the tank the first time.',
      },
      {
        setting: 'inspect',
        direction: 'check',
        step: 'elevator chain tension and a plugged concave',
        why: 'The manual’s other causes: a loose clean-grain or straw elevator chain, bunch feeding at the elevator, and a plugged concave that will not let free grain out. None of them show up in a setting.',
      },
    ],
  },
  {
    key: 'heavy_returns',
    label: 'Returns running heavy',
    confirm: 'Returns auger loaded, or the returns volume showing high on the monitor.',
    fixes: [
      {
        setting: 'sieve_mm',
        direction: 'up',
        step: '1 mm',
        why: 'Most heavy returns are clean grain that could not get into the tank, not unthreshed material. Open the bottom sieve first.',
      },
      {
        setting: 'chaffer_mm',
        direction: 'down',
        step: '2 mm',
        why: 'If the returns are full of chaff and heads rather than grain, too much is dropping through the top sieve.',
      },
      {
        setting: 'concave_mm',
        direction: 'down',
        step: '2 mm',
        why: 'Returns full of unthreshed heads means the rotor did not finish the job and the shoe is sending the evidence back.',
      },
    ],
  },
  {
    key: 'plugging',
    label: 'Rotor loading up or slugging',
    confirm: 'Engine pulling down, rotor drive slipping, or an outright plug.',
    crops: ['sainfoin', 'canola'],
    fixes: [
      {
        setting: 'ground_speed_mph',
        direction: 'down',
        step: '0.5 mph',
        why: 'Always first. A slug is a feed-rate problem wearing a settings costume.',
      },
      {
        setting: 'vane_angle',
        direction: 'up',
        step: 'one notch',
        why: 'Steeper vanes move material out of the rotor faster. Costs some separation, which is the trade you want when the alternative is stopping to unplug.',
      },
      {
        setting: 'concave_mm',
        direction: 'up',
        step: '2 mm',
        why: 'More room for green or damp material to pass. Expect a few more unthreshed heads and take them.',
      },
      {
        setting: 'header',
        direction: 'check',
        step: 'cut higher',
        why: 'Everything below the pods is material the machine has to deal with and nothing it can sell. In sainfoin and canola this is often the whole fix.',
      },
    ],
  },
  {
    key: 'header_loss',
    label: 'Losing it at the header',
    confirm:
      'Count in FRONT of the combine, in standing crop that has not been cut. Anything on the ground there is header loss and no rotor setting will touch it.',
    crops: ['canola', 'corn'],
    fixes: [
      {
        setting: 'header',
        direction: 'check',
        step: 'reel speed 1.1–1.25× ground speed',
        why: 'A reel turning faster than the crop is travelling beats seed out of the pod in front of the knife. In canola this is often the largest single loss on the machine.',
      },
      {
        setting: 'header',
        direction: 'check',
        step: 'reel height and fore/aft',
        why: 'The reel should carry the crop back onto the table, not thresh it against the knife.',
      },
      {
        setting: 'ground_speed_mph',
        direction: 'down',
        step: '0.5 mph',
        why: 'Slower travel means a slower reel for the same ratio, and less shatter in a ripe crop.',
      },
      {
        setting: 'header',
        direction: 'check',
        step: 'corn: deck plates and stripper rolls',
        why: 'In corn nearly all field loss is ears and kernels lost at the head. Deck plates set too wide shell kernels onto the ground before the ear ever reaches the machine.',
      },
    ],
  },
]

/**
 * Seed counts, for turning what is in the pan into bushels an acre.
 *
 * Thousand-kernel weight varies enough between varieties and years to matter,
 * so these are defaults to be overridden with a real TKW when there is one —
 * a canola TKW of 3.0 against 4.0 moves the answer by a third.
 */
export type SeedSpec = { lbPerBushel: number; gramsPer1000: number }

export const SEED_DEFAULTS: Record<CombineCropKey, SeedSpec> = {
  // 50 lb/bu, TKW around 3.5 g for the hybrids grown here.
  canola: { lbPerBushel: 50, gramsPer1000: 3.5 },
  // 56 lb/bu, TKW around 350 g.
  corn: { lbPerBushel: 56, gramsPer1000: 350 },
  // 60 lb/bu, TKW around 35 g.
  wheat: { lbPerBushel: 60, gramsPer1000: 35 },
  // Harvested in the hull; 28 lb/bu is the usual figure and the seed runs
  // around 25 g per thousand with the hull on. Both are worth checking against
  // a real sample before trusting a loss number to two decimal places.
  sainfoin: { lbPerBushel: 28, gramsPer1000: 25 },
  // 60 lb/bu; durum kernels run heavier than CWRS, around 42 g.
  durum: { lbPerBushel: 60, gramsPer1000: 42 },
  // 60 lb/bu. Pintos run around 350 g per thousand, blacks nearer 200 — put
  // the real seed weight in before trusting a bean loss number.
  beans: { lbPerBushel: 60, gramsPer1000: 300 },
  // 48 lb/bu, TKW around 40 g.
  barley: { lbPerBushel: 48, gramsPer1000: 40 },
  // 34 lb/bu in Canada, TKW around 35 g with the hull on.
  oats: { lbPerBushel: 34, gramsPer1000: 35 },
}

const GRAMS_PER_LB = 453.59237
const SQFT_PER_ACRE = 43560

/** How many seeds make a bushel, from its weight and thousand-kernel weight. */
export function seedsPerBushel(spec: SeedSpec): number {
  if (spec.gramsPer1000 <= 0) return 0
  const seedsPerGram = 1000 / spec.gramsPer1000
  return spec.lbPerBushel * GRAMS_PER_LB * seedsPerGram
}

/**
 * The farm's drop pan, the loss check's starting pan area: a Bushel Plus
 * 3.W Harvest Loss System pan, the wide 40-inch model (serial
 * 1231DPWX40-2942). Measured on the pan in the shop, 7 Oct 2026: 10 in
 * across by 39½ in long — Bushel Plus does not publish the catch area.
 */
export const DROP_PAN = {
  name: 'Bushel Plus 40" wide pan',
  widthIn: 10,
  lengthIn: 39.5,
  sqFt: Math.round(((10 * 39.5) / 144) * 100) / 100,
} as const

export type LossInput = {
  /** Seeds counted in the pan. */
  seeds: number
  /** Pan opening, in square feet. */
  panAreaSqFt: number
  /** Header width being cut, in feet. */
  headerFt: number
  /**
   * Width the machine discharges over, in feet — the straw and chaff spread,
   * not the header. Loss lands concentrated in this width, so counting in it
   * overstates the field average by headerFt / dischargeFt.
   */
  dischargeFt: number
  spec: SeedSpec
  /** Yield, for expressing the loss as a share of the crop. */
  yieldBuPerAcre?: number | null
}

export type LossResult = {
  seedsPerSqFt: number
  /** Seeds per square foot averaged over the whole cut width. */
  fieldSeedsPerSqFt: number
  buPerAcre: number
  /** Null when no yield was given. */
  pctOfYield: number | null
}

/**
 * Drop-pan loss, in bushels an acre.
 *
 * The correction that people get wrong: a pan under the back of the combine
 * sits in the discharge, where everything the machine cut across the full
 * header width has been funnelled into the width of the straw and chaff spread.
 * Counting there and calling it a field average overstates loss by the ratio of
 * those two widths — on a 40 ft header discharging over 20 ft, by double.
 *
 * Returns zeroes rather than NaN or Infinity for nonsense inputs, because this
 * gets used on a phone in a field and a blank pan area is a normal thing to
 * have on screen for a second.
 */
export function lossFromPan(input: LossInput): LossResult {
  const { seeds, panAreaSqFt, headerFt, dischargeFt, spec, yieldBuPerAcre } = input
  const perBu = seedsPerBushel(spec)
  if (panAreaSqFt <= 0 || headerFt <= 0 || dischargeFt <= 0 || perBu <= 0 || seeds < 0) {
    return { seedsPerSqFt: 0, fieldSeedsPerSqFt: 0, buPerAcre: 0, pctOfYield: null }
  }
  const seedsPerSqFt = seeds / panAreaSqFt
  const fieldSeedsPerSqFt = seedsPerSqFt * (dischargeFt / headerFt)
  const buPerAcre = (fieldSeedsPerSqFt * SQFT_PER_ACRE) / perBu
  const pctOfYield =
    yieldBuPerAcre && yieldBuPerAcre > 0 ? (buPerAcre / yieldBuPerAcre) * 100 : null
  return { seedsPerSqFt, fieldSeedsPerSqFt, buPerAcre, pctOfYield }
}

/**
 * A saved loss check's answer, worked out again from what was counted — for
 * when a check is corrected after the fact (Sam, 7 Oct 2026: edit any row).
 * The stored answer is kept rather than recomputed on read, so an edit has to
 * redo it; a check saved without a seed weight takes the crop's default, as
 * the form would have.
 */
export function recomputeLossCheck(c: {
  crop_key: string
  seeds: number
  pan_area_sqft: number
  header_ft: number
  discharge_ft: number
  grams_per_1000: number | null
  lb_per_bushel: number | null
  yield_bu_per_acre: number | null
}): { loss_bu_per_acre: number; loss_pct: number | null } {
  const def = SEED_DEFAULTS[c.crop_key as CombineCropKey]
  const r = lossFromPan({
    seeds: Number(c.seeds),
    panAreaSqFt: Number(c.pan_area_sqft),
    headerFt: Number(c.header_ft),
    dischargeFt: Number(c.discharge_ft),
    spec: {
      gramsPer1000: c.grams_per_1000 != null ? Number(c.grams_per_1000) : (def?.gramsPer1000 ?? 0),
      lbPerBushel: c.lb_per_bushel != null ? Number(c.lb_per_bushel) : (def?.lbPerBushel ?? 0),
    },
    yieldBuPerAcre: c.yield_bu_per_acre != null ? Number(c.yield_bu_per_acre) : null,
  })
  // To 4 places, as the form saves it.
  return { loss_bu_per_acre: Number(r.buPerAcre.toFixed(4)), loss_pct: r.pctOfYield }
}

/** What the loss is worth at a given price, per acre and across the field. */
export function lossValue(
  buPerAcre: number,
  pricePerBu: number | null | undefined,
  acres: number | null | undefined,
): { perAcre: number | null; total: number | null } {
  if (!pricePerBu || pricePerBu <= 0) return { perAcre: null, total: null }
  const perAcre = buPerAcre * pricePerBu
  return { perAcre, total: acres && acres > 0 ? perAcre * acres : null }
}

/**
 * Whether a measured loss is worth chasing.
 *
 * Deliberately three states and not a pass/fail. A combine set for no loss at
 * all is a combine going too slowly to get the crop off, and "you are already
 * below where it pays to chase it" is as useful an answer as "fix this".
 */
export type LossVerdict = 'good' | 'watch' | 'high'

export function judgeLoss(pctOfYield: number | null, target: number): LossVerdict {
  if (pctOfYield == null) return 'watch'
  if (pctOfYield <= target) return 'good'
  return pctOfYield <= target * 2 ? 'watch' : 'high'
}
