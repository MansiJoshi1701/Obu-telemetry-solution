/**
 * Turning the two 32-bit words in a location report into named flags.
 *
 * A 32-bit number is 32 independent yes/no switches. PROTOCOL.md says what each
 * position means. This file holds those tables and nothing else, so the decoder
 * in 04-bodies.ts stays readable and the tables can be checked against the spec
 * side by side.
 */

/**
 * Read bit `n` of a word as a boolean, counting from 0 at the low end.
 *
 * `>>> n` slides bit n down to position 0, then `& 1` discards every other bit,
 * so the result can only be 0 or 1.
 *
 * `>>>` is the unsigned right shift. Here it makes no difference to the answer,
 * because `& 1` masks away the only bits the signed and unsigned versions
 * disagree about. It is used as a habit: the moment a shifted value is read
 * WITHOUT a mask, `>>` on a word with the top bit set gives a negative number.
 */
export function bit(word: number, n: number): boolean {
  return ((word >>> n) & 1) === 1;
}

/**
 * Read a run of `count` bits starting at `from`, as a number.
 *
 * The general form of `bit`. Same first move — slide the field down to position
 * 0 — but the mask has to be wide enough for the whole field instead of a single
 * bit. `(1 << count) - 1` builds that mask:
 *
 *     count = 1   ->  1 << 1 = 0b10,      minus 1 = 0b1
 *     count = 2   ->  1 << 2 = 0b100,     minus 1 = 0b11
 *     count = 4   ->  1 << 4 = 0b10000,   minus 1 = 0b1111
 *
 * A power of two minus one is always a run of ones, which is exactly the stencil
 * we want. Used here only for the 2-bit load state.
 */
export function bits(word: number, from: number, count: number): number {
  return (word >>> from) & ((1 << count) - 1);
}

/**
 * Alarm word bit meanings, transcribed from PROTOCOL.md.
 *
 * The gaps are deliberate: bits 12, 15, 16 and 17 are not listed in the spec's
 * table, and the spec says bits not listed are reserved.
 */
const ALARM_BITS: Readonly<Record<number, string>> = {
  0: 'emergency',
  1: 'over-speed',
  2: 'fatigue-driving',
  3: 'danger-warning',
  4: 'gnss-module-failure',
  5: 'gnss-antenna-cut',
  6: 'gnss-antenna-short-circuit',
  7: 'main-power-under-voltage',
  8: 'main-power-off',
  9: 'bdc-failure',
  10: 'tts-module-failure',
  11: 'camera-failure',
  13: 'speed-warning',
  14: 'fatigue-driving-warning',
  18: 'daily-driving-time-exceeded',
  19: 'over-time-parking',
  20: 'in-out-of-area',
  21: 'in-out-of-route',
  22: 'section-travel-time-abnormal',
  23: 'route-deviation',
  24: 'vehicle-vss-failure',
  25: 'abnormal-oil-quality',
  26: 'vehicle-stolen',
  27: 'illegal-ignition',
  28: 'illegal-displacement',
  29: 'collision-warning',
  30: 'rollover-warning',
  31: 'illegal-door-opening',
};

/**
 * The names of every alarm bit that is set.
 *
 * A bit the spec reserves is still reported, as `reserved-bit-N`, rather than
 * dropped. "The device set a bit the specification reserves" is exactly the kind
 * of finding the brief asks us not to swallow — and silently ignoring it would
 * make the two cases indistinguishable.
 */
export function decodeAlarms(word: number): string[] {
  const names: string[] = [];
  for (let n = 0; n < 32; n++) {
    if (!bit(word, n)) continue;
    names.push(ALARM_BITS[n] ?? `reserved-bit-${n}`);
  }
  return names;
}

/** Load state, from status bits 8-9. Value 2 is reserved by the spec. */
export type LoadState = 'empty' | 'half' | 'reserved' | 'full';

const LOAD_STATES: readonly LoadState[] = ['empty', 'half', 'reserved', 'full'];

export interface StatusFlags {
  readonly accOn: boolean;

  /**
   * Bit 1 — the one that decides whether the rest of the position is meaningful.
   * PROTOCOL.md calls this out explicitly.
   */
  readonly positioned: boolean;

  /** Bits 2 and 3. The hemisphere lives here, not in the sign of the coordinate. */
  readonly southLatitude: boolean;
  readonly westLongitude: boolean;

  readonly outage: boolean;
  readonly latLonEncrypted: boolean;
  readonly loadState: LoadState;
  readonly oilCircuitDisconnected: boolean;
  readonly vehicleCircuitAbnormal: boolean;
  readonly obuDoorLocked: boolean;

  /** Bits 13-17: doors 1-5 — front, middle, back, driver, custom. */
  readonly doorsOpen: readonly boolean[];

  readonly usingGps: boolean;
  readonly usingGlonass: boolean;
  readonly usingGalileo: boolean;
}

export function decodeStatus(word: number): StatusFlags {
  return {
    accOn: bit(word, 0),
    positioned: bit(word, 1),
    southLatitude: bit(word, 2),
    westLongitude: bit(word, 3),
    outage: bit(word, 4),
    latLonEncrypted: bit(word, 5),

    // Bits 8-9 hold a number, not a flag, so this needs the wider mask.
    // The index is 0-3 and the array has 4 entries, but noUncheckedIndexedAccess
    // makes TypeScript insist we handle a miss anyway. 'empty' is unreachable.
    loadState: LOAD_STATES[bits(word, 8, 2)] ?? 'empty',

    oilCircuitDisconnected: bit(word, 10),
    vehicleCircuitAbnormal: bit(word, 11),
    obuDoorLocked: bit(word, 12),
    doorsOpen: [13, 14, 15, 16, 17].map((n) => bit(word, n)),
    usingGps: bit(word, 18),
    usingGlonass: bit(word, 20),
    usingGalileo: bit(word, 21),
  };
}

/**
 * The status bits that are set, as names — for reporting.
 *
 * Bits 6, 7, 19 and 22-31 are not given a meaning by PROTOCOL.md's status table,
 * so a set bit there is reported as reserved rather than ignored, for the same
 * reason as in decodeAlarms.
 */
const STATUS_BIT_NAMES: Readonly<Record<number, string>> = {
  0: 'acc-on',
  1: 'positioned',
  2: 'south-latitude',
  3: 'west-longitude',
  4: 'outage',
  5: 'latlon-encrypted',
  10: 'oil-circuit-disconnected',
  11: 'vehicle-circuit-abnormal',
  12: 'obu-door-locked',
  13: 'door-1-front-open',
  14: 'door-2-middle-open',
  15: 'door-3-back-open',
  16: 'door-4-driver-open',
  17: 'door-5-custom-open',
  18: 'gps-in-use',
  20: 'glonass-in-use',
  21: 'galileo-in-use',
};

export function describeStatus(word: number): string[] {
  const names: string[] = [];
  for (let n = 0; n < 32; n++) {
    // Bits 8 and 9 are the load state, not flags, so they are named separately.
    if (n === 8 || n === 9) continue;
    if (!bit(word, n)) continue;
    names.push(STATUS_BIT_NAMES[n] ?? `reserved-bit-${n}`);
  }
  names.push(`load-${LOAD_STATES[bits(word, 8, 2)] ?? 'empty'}`);
  return names;
}
