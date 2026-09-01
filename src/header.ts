/**
 * Step 3 — the frame header.
 *
 * Step 2 handed us a verified message: the escaping is undone and the check byte
 * matched. That message is laid out as a fixed 12-byte header followed by the
 * body:
 *
 *     0002   0000   008800000001   00BC   | body...
 *     └─2─┘  └─2─┘  └────6─────┘  └─2─┘
 *     msg    body      device      serial
 *     id     attrs       id
 *
 *     bytes 0-1   message id
 *     bytes 2-3   body attributes
 *     bytes 4-9   device id (BCD)
 *     bytes 10-11 serial number
 *     byte 12+    the body
 *
 * There are no labels anywhere. A field means what it means purely because of
 * WHERE it sits. That is why the offsets above are worth reading twice.
 */

import { bcdToDigits, isValidBcd } from './bcd.ts';

/** The header is always exactly this long. The body starts right after it. */
export const HEADER_LENGTH = 12;

export interface FrameHeader {
  /** What kind of message this is. 0x0200 is a location report, and so on. */
  readonly messageId: number;

  /** The raw 16-bit attributes word, kept so the fields below can be re-checked. */
  readonly bodyAttributes: number;

  /** Bits 0-9 of the attributes: how long the body should be after unescaping. */
  readonly declaredBodyLength: number;

  /** Bits 10-12: 0 means plaintext, 1 means RSA. No other value is defined. */
  readonly encryption: number;

  /** Bit 13: this frame is one slice of a message split across several frames. */
  readonly isSubPackage: boolean;

  /** Six BCD bytes as the twelve digits they encode, e.g. "008800000001". */
  readonly deviceId: string;

  /**
   * A counter the device increments per message.
   *
   * Worth knowing early: this is NOT a reliable unique id. Devices reconnect and
   * start counting again, so the same serial reappears for genuinely different
   * messages. That matters when choosing a de-duplication key later.
   */
  readonly serial: number;
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
  // Without 12 bytes there is no header to read. Reading anyway would run off
  // the end of the buffer and throw, so we report instead.
  if (content.length < HEADER_LENGTH) {
    return { kind: 'too-short', length: content.length };
  }

  // readUInt16BE means "read an unsigned 16-bit integer, big-endian, starting
  // at this offset". Big-endian = the first byte is the most significant one.
  //
  //     bytes 00 BC  ->  0x00 * 256 + 0xBC  =  188
  //
  // Getting this backwards (little-endian) would read 0xBC00 = 48128 instead.
  // The protocol says every multi-byte integer is big-endian, so BE it is.
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

  // `>>> 10` slides bits 10-12 down into positions 0-2, then `& 0x07` keeps
  // just those three.
  const encryption = (bodyAttributes >>> 10) & 0x07;

  // Slide bit 13 down to position 0 and keep it. `=== 1` turns it into a real
  // boolean rather than a 0 or 1, so the field reads as a yes/no.
  const isSubPackage = ((bodyAttributes >>> 13) & 1) === 1;

  // Six bytes of BCD. subarray(4, 10) takes bytes 4,5,6,7,8,9 — the second
  // number is where it stops, not the last index it includes.
  const deviceBytes = content.subarray(4, 10);

  // If a half-byte is not 0-9 then this is not BCD and we should say so rather
  // than emit a device id with letters in it.
  if (!isValidBcd(deviceBytes)) {
    return { kind: 'bad-device-id', bytes: deviceBytes.toString('hex') };
  }

  const header: FrameHeader = {
    messageId,
    bodyAttributes,
    declaredBodyLength,
    encryption,
    isSubPackage,
    deviceId: bcdToDigits(deviceBytes),
    serial: content.readUInt16BE(10),
  };

  // Everything after the header is the body. We do not interpret it here —
  // that depends on the message id, and it is what steps 4 to 8 are for.
  return { kind: 'ok', header, body: content.subarray(HEADER_LENGTH) };
}

/** A readable "0x0200" from the number 512, for printing. */
export function formatMessageId(id: number): string {
  return '0x' + id.toString(16).toUpperCase().padStart(4, '0');
}
