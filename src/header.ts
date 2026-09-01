/**
 * Step 3 — the frame header.
 *
 * Step 2 handed us a verified message: the escaping is undone and the check byte
 * matched. That message is laid out as a fixed 12-byte header followed by the
 * body. This step reads the header fields and checks them for plausibility.
 */

import { bcdToDigits } from './bcd.ts';

// The header is always 12 bytes long.
export const HEADER_LENGTH = 12;

export interface FrameHeader {

  readonly messageId: number;
  readonly bodyAttributes: number;
  readonly declaredBodyLength: number; // Bits 0-9 of bodyAttributes
  readonly encryption: number; // Bits 10-12 of bodyAttributes
  readonly isSubPackage: boolean; // Bit 13 of bodyAttributes
  readonly deviceId: string; // The 6-byte BCD device id, converted to a string of digits.
  readonly serial: number; // A counter the device increments per message.
}

export type HeaderResult =
  | { readonly kind: 'ok'; readonly header: FrameHeader; readonly body: Buffer }
  | { readonly kind: 'too-short'; readonly length: number }
  | { readonly kind: 'bad-device-id'; readonly bytes: string };

/**
 * Split a verified message into its header fields and its body.
 *
 * `content` is the `content` from step 2's VerifiedFrame: unescaped, and with
 * the check byte already removed.
 */
export function decodeHeader(content: Buffer): HeaderResult {

  // The header is always 12 bytes long, otherwise reject it.
  if (content.length < HEADER_LENGTH) {
    return { kind: 'too-short', length: content.length };
  }

  // readUInt16BE = "read an unsigned 16-bit integer, big-endian, starting at this offset"
  const messageId = content.readUInt16BE(0);
  const bodyAttributes = content.readUInt16BE(2);

  // The attributes word packs three separate things into 16 bits. We pull each
  // one out with a shift and a mask.
  //
  //   bit  15 14 13 12 11 10  9 8 7 6 5 4 3 2 1 0
  //        │  │  │  └──┬───┘  └───────┬────────┘
  //        │  │  │     │              └── bits 0-9:  body length
  //        │  │  │     └───────────────── bits 10-12: encryption
  //        │  │  └─────────────────────── bit 13:     sub-package flag
  //        └──┴────────────────────────── bits 14-15: reserved

  // `& 0x03ff` keeps the low ten bits and zeroes everything above them.
  //   0x03ff = 0000 0011 1111 1111
  const declaredBodyLength = bodyAttributes & 0x03ff;

  // `>>> 10` slides bits 10-12 down into positions 0-2, then `& 0x07` keeps just those three.
  const encryption = (bodyAttributes >>> 10) & 0x07;

  // Slide bit 13 down to position 0 and keep it. `=== 1` turns it into a real
  // boolean rather than a 0 or 1, so the field reads as a yes/no.
  const isSubPackage = ((bodyAttributes >>> 13) & 1) === 1;

  
  const deviceBytes = content.subarray(4, 10); // The 6-byte BCD device id is at offset 4.
  const deviceId = bcdToDigits(deviceBytes); // Convert the BCD bytes to a string of digits, or null if it is not valid BCD.

  // Null means a half-byte was not 0-9, so this field is not BCD. Report it.
  if (deviceId === null) {
    return { kind: 'bad-device-id', bytes: deviceBytes.toString('hex') };
  }

  const header: FrameHeader = {
    messageId,
    bodyAttributes,
    declaredBodyLength,
    encryption,
    isSubPackage,
    deviceId,
    serial: content.readUInt16BE(10),
  };

  // Everything after the header is the body
  return { kind: 'ok', header, body: content.subarray(HEADER_LENGTH) };
}

/** A readable "0x0200" from the number 512, for printing. */
export function formatMessageId(id: number): string {
  return '0x' + id.toString(16).toUpperCase().padStart(4, '0');
}
