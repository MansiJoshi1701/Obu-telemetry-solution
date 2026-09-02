/**
 * Steps 4 onwards — decoding the body.
 *
 * Step 3 gave us a header and a body. The header's message id says what kind of
 * message this is, and therefore how to read the body. This file is the place
 * that decision gets made.
 *
 * Step 4 handles the two simple ones:
 *
 *     0x0002  heartbeat       body is empty
 *     0x0102  authentication  body is an ASCII authentication code
 */

import type { FrameHeader } from './03-header.ts';

/**
 * The decoded body, once we know what kind of message it is.
 */
export type MessageBody =
  | { readonly type: 'heartbeat' }
  | { readonly type: 'authentication'; readonly authCode: string }
  | RegistrationBody;

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
