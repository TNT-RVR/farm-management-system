/**
 * What every turbine setting is, what it does, and what its units are.
 *
 * One catalogue rather than labels scattered through five screens, because
 * these explanations are the thing a person actually needs and they must not
 * drift from the register map in agent/README.md.
 *
 * ## Units, and the ones the panel does not state
 *
 * The panel is inconsistent about units, and the inconsistency is informative:
 * where it knows, it says so — `t(s)`, `t(m)`, `%`. Where it says nothing, the
 * unit is genuinely not determinable from the screen, and this file records
 * that as `unit: null` rather than guessing.
 *
 * That matters most for the PID settings, which are the ones people most want
 * a unit for:
 *
 * **Gain is not a pressure.** A gain of 5 is not 5 PSI. It is a multiplier —
 * how much speed to add per unit of pressure error — so its units are really
 * "% of speed per PSI", and every vendor scales it differently. Reading it as
 * PSI leads straight to changing it by 10 because "that's only 10 PSI", which
 * would double the loop's aggression.
 *
 * **Integral time is a time, but which one is not knowable from the panel.**
 * Schneider's PID blocks variously take tenths of a second, seconds, or
 * minutes depending on the block and its configuration. A value of 10 is
 * plausible in all three, which is exactly why it cannot be inferred. It has to
 * be read out of the Vijeo Designer project.
 */

export type PumpSetting = {
  /** Tag name, matching agent/README.md. `N` is replaced with the turbine number. */
  tag: string
  label: string
  /** Null where the panel does not state one and it cannot be inferred. */
  unit: string | null
  /**
   * False when the unit above is our reading of the panel rather than something
   * the panel says. The UI marks these, because a wrong unit on a writable
   * setting is worse than no unit.
   */
  unitConfirmed: boolean
  writable: boolean
  /** What the setting is. */
  what: string
  /** What moving it does, in both directions. */
  effect: string
}

export type PumpSettingGroup = {
  key: string
  title: string
  blurb?: string
  caution?: string
  settings: PumpSetting[]
}

export const PUMP_SETTINGS: PumpSettingGroup[] = [
  {
    key: 'startup',
    title: 'Start-up pressure',
    blurb: 'The turbine works up this ladder rather than jumping straight to its running pressure.',
    settings: [
      {
        tag: 'pumpN.start_psi_step1',
        label: 'PSI step 1',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The first pressure the turbine is asked to hold on start-up. Deliberately below the running target, so an empty or part-full line fills gently instead of being hit with full pressure.',
        effect: 'Raise it and the line charges faster but with more shock. Lower it and start-up is gentler and slower.',
      },
      {
        tag: 'pumpN.start_psi_step2',
        label: 'PSI step 2',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The second rung. The turbine holds each step until it is satisfied, then moves up.',
        effect: 'Big gaps between steps make start-up quicker and rougher; small gaps are gentler on the pipe and take longer.',
      },
      {
        tag: 'pumpN.start_psi_step3',
        label: 'PSI step 3',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The third rung.',
        effect: 'As above. The spacing between rungs is what decides how hard the line is charged.',
      },
      {
        tag: 'pumpN.start_psi_step4',
        label: 'PSI step 4',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The last rung, and the pressure the turbine runs at once started.',
        effect: 'This is the one that sets your working pressure. Everything downstream sees it.',
      },
    ],
  },
  {
    key: 'fill',
    title: 'Line fill thresholds',
    blurb: 'When the system decides the line is charged, and when it decides it is not.',
    settings: [
      {
        tag: 'pumpN.fill_latch_psi',
        label: 'Latch at',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The pressure at which the line is declared full — and remembered as full, until the unlatch pressure releases it.',
        effect: 'Raise it and the system waits for more pressure before believing the line is charged. Lower it and it calls full sooner, including sometimes when it is not.',
      },
      {
        tag: 'pumpN.fill_unlatch_psi',
        label: 'Unlatch at',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'The pressure it must fall below before the line is called empty again. The gap between this and the latch point is the point of the arrangement: it stops the state flickering.',
        effect: 'Move it closer to the latch point and the state becomes twitchy. Move it lower and the system holds "full" through a bigger genuine drop.',
      },
      {
        tag: 'pumpN.fill_full_delay_s',
        label: 'Full delay',
        unit: 's',
        unitConfirmed: true,
        writable: true,
        what: 'How long pressure must stay above the latch point before "full" is declared. A brief spike as a valve shuts should not count.',
        effect: 'Longer is more certain and slower. Shorter reacts quicker and can be fooled by a surge.',
      },
      {
        tag: 'pumpN.fill_empty_delay_s',
        label: 'Empty delay',
        unit: 's',
        unitConfirmed: true,
        writable: true,
        what: 'The same in reverse: pressure has to stay below the unlatch point this long before the line is called empty.',
        effect: 'Longer rides through a momentary dip. Shorter notices a real break faster.',
      },
    ],
  },
  {
    key: 'speed',
    title: 'Speed limits',
    settings: [
      {
        tag: 'pumpN.pid_min_out_pct',
        label: 'Minimum speed',
        unit: '%',
        unitConfirmed: true,
        writable: true,
        what: 'The slowest the controller will run the turbine while it is running. Most turbines move little water below a certain speed and rely on flow to stay cool, so there is a floor below which running is pointless or harmful.',
        effect: 'Raise it and the turbine uses more power at low demand and may over-pressure. Lower it and it can throttle further back — check the turbine\'s own minimum first.',
      },
      {
        tag: 'pumpN.pid_max_out_pct',
        label: 'Maximum speed',
        unit: '%',
        unitConfirmed: true,
        writable: true,
        what: 'The ceiling. At 100 the turbine is allowed everything the drive can give it.',
        effect: 'Lowering it caps flow and pressure — occasionally useful to protect a weak section of pipe, at the cost of never reaching full output.',
      },
      {
        tag: 'pumpN.hand_speed_pct',
        label: 'Hand speed',
        unit: '%',
        unitConfirmed: true,
        writable: true,
        what: 'The fixed speed used in HAND — in hand there is no pressure control at all, the turbine runs at this speed whatever the pressure does. The panel labels this one SPEED_MANUAL, which is why the HMI says "manual" and the mode says "hand": they are the same number. It is ALSO the speed a line fill runs at, so changing it changes how hard the line gets filled.',
        effect: 'Raise it and you get more flow and more pressure with nothing regulating it — this is the setting most able to reach the high-pressure alarm. Remember it moves line fills too: a fill is driven from this number, not from the PID.',
      },
    ],
  },
  {
    key: 'sleep',
    title: 'Sleep',
    blurb: 'When a turbine with nothing to do stops rather than idling.',
    settings: [
      {
        tag: 'pumpN.sleep_low_speed_pct',
        label: 'Low speed',
        unit: '%',
        unitConfirmed: true,
        writable: true,
        what: 'The speed at which the turbine is considered to be doing nothing useful. Sit at or below it long enough and it stops.',
        effect: 'Raise it and the turbine gives up and sleeps sooner — fewer idle hours, more starts. Lower it and it keeps turning at low speed for longer.',
      },
      {
        tag: 'pumpN.sleep_delay_s',
        label: 'Sleep delay',
        // The panel writes "t(s)" on the line-fill delays and nothing here, so
        // seconds is a reasonable read and not a stated fact.
        unit: 's',
        unitConfirmed: false,
        writable: true,
        what: 'How long it has to stay at low speed before actually stopping.',
        effect: 'Longer means fewer stop/starts and more idling. Shorter saves power but cycles the motor more, and starts are what wear a motor.',
      },
      {
        tag: 'pumpN.wakeup_delay_s',
        label: 'Wake-up delay',
        unit: 's',
        unitConfirmed: false,
        writable: true,
        what: 'How long pressure must sit below target before a sleeping pump restarts.',
        effect: 'Longer ignores a brief draw — someone opening one valve — at the cost of a slower response. Shorter is more responsive and cycles more.',
      },
    ],
  },
  {
    key: 'pid',
    title: 'Pressure control tuning',
    blurb: 'How hard the turbine chases its pressure target in AUTO.',
    caution:
      'Change one at a time. Tuning interacts: adjust the gain, watch the pressure trend for a few minutes, then decide. Changing two together leaves you unable to say which one did it — and a badly tuned loop hammers the pipe rather than just running poorly.',
    settings: [
      {
        tag: 'pumpN.pid_kp',
        label: 'Gain',
        // Not a pressure. See the note at the top of this file.
        unit: null,
        unitConfirmed: true,
        writable: true,
        what: 'How strongly the turbine reacts to being off target. Not a pressure — it is a multiplier, roughly "how much speed to add per PSI of error", and every vendor scales it differently. A gain of 5 is not 5 PSI.',
        effect: 'Too high and pressure overshoots and hunts up and down. Too low and it takes a long time to reach target and sags whenever demand changes.',
      },
      {
        tag: 'pumpN.pid_ti',
        label: 'Integral time',
        unit: null,
        unitConfirmed: false,
        writable: true,
        what: 'Gain alone tends to settle slightly off target and stay there; this grinds out that last bit of error over time. Smaller is more aggressive, which catches people out. It is a time — but Schneider\'s PID blocks take tenths of a second, seconds or minutes depending on the block, and 10 is plausible in all three, so the unit has to be read out of the Vijeo project.',
        effect: 'Too small and it overcorrects and oscillates slowly. Too large and pressure sits stubbornly a few PSI under target.',
      },
      {
        tag: 'pumpN.pid_sample_period',
        label: 'Sampling period',
        unit: null,
        unitConfirmed: false,
        writable: true,
        what: 'How often the controller recalculates. Set once at commissioning. Same unit problem as integral time.',
        effect: 'Effectively never touched. Changing it changes what gain and integral time mean, so a tuning that worked will not any more.',
      },
    ],
  },
  {
    key: 'alarms',
    title: 'Alarms and restart',
    settings: [
      {
        tag: 'pumpN.hi_psi_alarm',
        label: 'High pressure alarm',
        unit: 'PSI',
        unitConfirmed: true,
        writable: true,
        what: 'Above this the panel raises a high-pressure alarm. It should sit comfortably above the running target — the headroom is for a normal surge.',
        effect: 'Raise it and genuine over-pressure stops being reported. Lower it and ordinary valve closures start raising alarms, which is how people learn to ignore them.',
      },
      {
        tag: 'pumpN.powerfail_restart_delay_m',
        label: 'Power-fail restart delay',
        // The panel states t(m) explicitly on this one.
        unit: 'min',
        unitConfirmed: true,
        writable: true,
        what: 'After power comes back, how long to wait before restarting on its own. It stops everything on the farm starting at the same instant and gives an unstable supply time to settle. Only applies when auto restart is on.',
        effect: 'Shorter gets water moving sooner after an outage. Longer is kinder to the supply and to the motor.',
      },
    ],
  },
]

/** The catalogue with `N` resolved to a turbine number. */
export function settingsFor(pump: number): PumpSettingGroup[] {
  return PUMP_SETTINGS.map((g) => ({
    ...g,
    settings: g.settings.map((s) => ({ ...s, tag: s.tag.replace('pumpN.', `pump${pump}.`) })),
  }))
}

/** Every tag the turbine screens read, for a completeness check against the map. */
export function allPumpSettingTags(pumps: number[]): string[] {
  return pumps.flatMap((n) => settingsFor(n).flatMap((g) => g.settings.map((s) => s.tag)))
}
