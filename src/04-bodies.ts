/**
 * Steps 4 onwards — decoding the body.
 *
 * Step 3 gave us a header and a body. The header's message id says what kind of
 * message this is, and therefore how to read the body. This file is the place
 * that decision gets made.
 *
 * Decoders live here for the four message ids PROTOCOL.md documents:
 *
 *     0x0002  heartbeat       body is empty
 *     0x0102  authentication  body is an ASCII authentication code
 *     0x0100  registration    fixed-offset fields, ASCII ones null-padded
 *     0x0200  location        position, speed, heading, time, then TLV items
 *
 * The location report's extension items are not decoded yet; their bytes are
 * reported as undecoded rather than skipped.
 */

import type { FrameHeader } from './03-header.ts';

import { bcdToDigits } from './bcd.ts';

/**
 * The decoded body, once we know what kind of message it is.
 */
export type MessageBody =
  | { readonly type: 'heartbeat' }
  | { readonly type: 'authentication'; readonly authCode: string }
  | RegistrationBody
  | LocationBody;

/**
 * 0x0100 — what a device says about itself when it registers.
 *
 * Field layout from PROTOCOL.md. Offsets are into the body, not the frame:
 *
 *     0   2 bytes   province id
 *     2   2 bytes   city id
 *     4   5 bytes   manufacturer id   ASCII
 *     9   20 bytes  terminal model    ASCII, null-padded
 *     29  7 bytes   terminal id       ASCII, null-padded
 *     36  1 byte    plate colour      0 = no plate assigned yet
 *     37  ..        registration plate ASCII
 */
export interface RegistrationBody {
  readonly type: 'registration';
  readonly provinceId: number;
  readonly cityId: number;
  readonly manufacturerId: string;
  readonly terminalModel: string;
  readonly terminalId: string;
  readonly plateColour: number;
  readonly plate: string;
}

/**
 * True when every field that identifies the device came back empty.
 *
 * plateColour is deliberately NOT part of this test. The spec gives 0 a real
 * meaning — "no plate assigned yet" — so a zero there is a measurement, not a
 * blank. That distinction matters more in Part 2, but it starts here.
 */
export function isBlankRegistration(r: RegistrationBody): boolean {
  return (
    r.provinceId === 0 &&
    r.cityId === 0 &&
    r.manufacturerId === '' &&
    r.terminalModel === '' &&
    r.terminalId === '' &&
    r.plate === ''
  );
}

/**
 * 0x0200 — where the bus is, how fast, which way, and when.
 *
 * Fixed part, from PROTOCOL.md. Offsets are into the body:
 *
 *     0   4 bytes   alarm word      bit flags  (named in step 7)
 *     4   4 bytes   status word     bit flags  (named in step 7)
 *     8   4 bytes   latitude        degrees x 1,000,000
 *     12  4 bytes   longitude       degrees x 1,000,000
 *     16  2 bytes   altitude        metres
 *     18  2 bytes   speed           1/10 km/h
 *     20  2 bytes   heading         degrees, 0 = north, clockwise
 *     22  6 bytes   timestamp       BCD YYMMDDhhmmss
 *     28  ..        extension items (step 8)
 */
export interface LocationBody {
  readonly type: 'location';

  /** Raw words. Step 7 expands these into named flags; here they are numbers. */
  readonly alarmWord: number;
  readonly statusWord: number;

  /**
   * Degrees, signed. NULL — not 0 — when the device reports no GPS fix.
   *
   * This is the "a zero is not a measurement" rule made unavoidable. When status
   * bit 1 is clear the device is telling us it does not know where it is, and
   * the coordinate bytes are zero. Storing 0.0 would place the bus in the
   * Atlantic off Ghana. `number | null` forces every reader to handle that.
   */
  readonly latitude: number | null;
  readonly longitude: number | null;

  readonly altitudeM: number;
  readonly speedKph: number;
  readonly headingDeg: number;

  /** The device's own clock reading. Null if the BCD was not valid. */
  readonly measuredAt: Date | null;

  /** True when status bit 1 says the position is meaningful. */
  readonly positioned: boolean;
}

export interface DecodedBody {
  readonly value: MessageBody | null; // The decoded body, or null when we have no decoder for this message id
  readonly undecodedBytes: number; // Body bytes we could not account for.
}


const DOCUMENTED_MESSAGE_NAMES: Readonly<Record<number, string>> = {
  0x0002: 'heartbeat',
  0x0100: 'registration',
  0x0102: 'authentication',
  0x0200: 'location',
};

//The documented name for a message id, or undefined if the spec never lists it.
export function messageName(id: number): string | undefined {
  return DOCUMENTED_MESSAGE_NAMES[id];
}

// Decode a body, given the header that describes it.
export function decodeBody(header: FrameHeader, body: Buffer): DecodedBody {

  // An encrypted body cannot be read without the key, and we do not have one so report it as undecoded.
  if (header.encryption !== 0) {
    return { value: null, undecodedBytes: body.length };
  }

  switch (header.messageId) {
    case 0x0002: // Heartbeat.
      // PROTOCOL.md defines the body as empty, so if a heartbeat ever arrived carrying bytes,
      // `body.length` would be non-zero and those bytes would be counted as undecoded.
      return { value: { type: 'heartbeat' }, undecodedBytes: body.length };

    case 0x0102: {
      // Authentication code, ASCII, occupying the whole body.
      const authCode = body.toString('ascii');
      return { value: { type: 'authentication', authCode }, undecodedBytes: 0 };
    }

    case 0x0100:
      return decodeRegistration(body);

    case 0x0200:
      return decodeLocation(body);

    default:
      // A message id we have no decoder for so report as undecoded.
      return { value: null, undecodedBytes: body.length };
  }
}

/**
 * Read a fixed-width ASCII field, dropping the trailing null padding.
 *
 * A 20-byte model field holding "AB" is "AB" followed by 18 zero bytes, because
 * the field cannot shrink without moving every offset after it. Left in, those
 * nulls give a string that prints as "AB" but is 20 characters long and never
 * compares equal to "AB".
 *
 * PROTOCOL.md marks only terminal model and terminal id as null-padded. We apply
 * the same treatment to manufacturer id, which is fixed-width and must therefore
 * be padded with something the spec does not name. See NOTES.md.
 *
 * Trailing nulls only, and nothing else: no whitespace trimming, because the
 * spec never mentions space padding and we have no evidence of any.
 */
function asciiField(bytes: Buffer): string {
  return bytes.toString('ascii').replace(/\0+$/, '');
}

/** The fixed part of a registration body: offsets 0 to 36 inclusive. */
const REGISTRATION_FIXED_LENGTH = 37;

function decodeRegistration(body: Buffer): DecodedBody {
  // Anything shorter than 37 bytes cannot be read at all. Report the whole
  // thing rather than decoding some fields and inventing the rest.
  if (body.length < REGISTRATION_FIXED_LENGTH) {
    return { value: null, undecodedBytes: body.length };
  }

  return {
    value: {
      type: 'registration',
      provinceId: body.readUInt16BE(0),
      cityId: body.readUInt16BE(2),
      manufacturerId: asciiField(body.subarray(4, 9)),
      terminalModel: asciiField(body.subarray(9, 29)),
      terminalId: asciiField(body.subarray(29, 36)),
      plateColour: body.readUInt8(36),

      // The plate runs from offset 37 to the end of the body, however long that
      // is. In this dataset the body is 38 bytes, so the plate is a single byte.
      plate: asciiField(body.subarray(REGISTRATION_FIXED_LENGTH)),
    },

    // Every byte is accounted for: 37 fixed, then the plate takes the rest.
    undecodedBytes: 0,
  };
}


/** The fixed part of a location body: offsets 0 to 27. Extension items follow. */
const LOCATION_FIXED_LENGTH = 28;

/**
 * Read bit `n` of a 32-bit word as a boolean, counting from 0 at the low end.
 *
 * Two steps: `>>> n` slides bit n down to position 0, then `& 1` discards every
 * other bit, so the result can only be 0 or 1.
 *
 * `>>>` is the unsigned right shift. Here it makes no difference to the answer,
 * because `& 1` masks away the only bits the signed and unsigned versions
 * disagree about. It is used as a habit: the moment a shifted value is read
 * WITHOUT a mask, `>>` on a word with the top bit set gives a negative number.
 *
 * Step 6 needs only bits 1, 2 and 3 (see below). Step 7 expands the rest.
 */
function bit(word: number, n: number): boolean {
  return ((word >>> n) & 1) === 1;
}

/**
 * Turn six BCD bytes of YYMMDDhhmmss into a Date.
 *
 * This lives here rather than in bcd.ts on purpose: bcd.ts knows how to read
 * digits out of bytes, and nothing more. That these particular six bytes mean a
 * date, in that particular field order, is a fact about JT/T 808.
 *
 * Returns null rather than an Invalid Date.
 */
function bcdToDate(bytes: Buffer): Date | null {
  const digits = bcdToDigits(bytes);

  // Null already means "not valid BCD". We also need exactly 12 digits.
  if (digits === null || digits.length !== 12) return null;

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const hh = Number(digits.slice(6, 8));
  const mi = Number(digits.slice(8, 10));
  const ss = Number(digits.slice(10, 12));

  // Valid BCD digits can still be an impossible date, e.g. month 99.
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) {
    return null;
  }

  // Two-digit year, no century field in the protocol. These captures are from
  // 2026, so 2000 + yy.
  //
  // Date.UTC, not the local-time constructor: the protocol does not say what
  // timezone this reading is in, and building it in UTC at least makes the
  // result the same on every machine. See NOTES.md — the wall-clock reading is
  // what the device sent; the label we put on it is our choice, not a finding.
  return new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
}

function decodeLocation(body: Buffer): DecodedBody {

  // Too short to hold even the fixed part. Report all of it.
  if (body.length < LOCATION_FIXED_LENGTH) {
    return { value: null, undecodedBytes: body.length };
  }

  const statusWord = body.readUInt32BE(4);

  // Bit 1 is the one that decides whether the position means anything at all.
  const positioned = bit(statusWord, 1);

  // The coordinate fields are UNSIGNED magnitudes — there is no minus sign in
  // the bytes. Which hemisphere you are in lives in status bits 2 and 3.
  const southLatitude = bit(statusWord, 2);
  const westLongitude = bit(statusWord, 3);

  // Stored as degrees x 1,000,000, so 28515124 is 28.515124 degrees.
  const rawLatitude = body.readUInt32BE(8) / 1_000_000;
  const rawLongitude = body.readUInt32BE(12) / 1_000_000;

  return {
    value: {
      type: 'location',
      alarmWord: body.readUInt32BE(0),
      statusWord,
      positioned,

      // No fix means we do not have a coordinate, not that the coordinate is 0.
      latitude: positioned ? (southLatitude ? -rawLatitude : rawLatitude) : null,
      longitude: positioned ? (westLongitude ? -rawLongitude : rawLongitude) : null,

      altitudeM: body.readUInt16BE(16),
      speedKph: body.readUInt16BE(18) / 10, // sent as 1/10 km/h
      headingDeg: body.readUInt16BE(20),
      measuredAt: bcdToDate(body.subarray(22, 28)),
    },

    // Everything from offset 28 on is the extension items, which step 8 decodes.
    // Until then those bytes are honestly reported as unaccounted for.
    undecodedBytes: body.length - LOCATION_FIXED_LENGTH,
  };
}

