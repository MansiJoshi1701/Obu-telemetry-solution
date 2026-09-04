/**
 * The transport layer.
 *
 * A payload from the log reader is the raw bytes the collector received. Before anyone
 * can read fields out of it, three things have to happen:
 *
 *   1. confirm it really is a frame (starts and ends with the marker 0x7E)
 *   2. unescape the bytes, so the real data is restored
 *   3. verify the check byte, so we know the bytes were not corrupted
 */


//Marks the start and end of every frame.
export const FLAG = 0x7e;

/** Announces an escape sequence. The byte after it says which one. */
export const ESCAPE = 0x7d;


// A frame that passed every check.
export interface VerifiedFrame {
  readonly content: Buffer;  //the 12-byte header plus the body, already unescaped
  readonly checkByte: number;
}

/**
 * Everything that can come out of `readFrame`.
 *
 * Reason for using Discriminated Union: Since we're not supposed to silently drop/accept a frame,
 * With this type, the compiler physically will not let you ignore the failure cases.
 */
export type FrameResult =
  | { readonly kind: 'ok'; readonly frame: VerifiedFrame }
  | { readonly kind: 'not-a-frame'; readonly reason: string }
  | { readonly kind: 'bad-escape'; readonly reason: string }
  | { readonly kind: 'bad-check'; readonly expected: number; readonly actual: number };

/**
 * Undo the sender's escaping.
 *
 * Returns null if it meets a 0x7D followed by anything else, because that is not
 * a valid escape sequence so we report it.
 */
export function unescape(wire: Buffer): Buffer | null {
  // We collect into a plain number array because we do not know the final
  // length in advance, then convert to a Buffer at the end.
  const out: number[] = [];

  for (let i = 0; i < wire.length; i++) {
    const byte = wire[i]!;

    // An ordinary byte. Copy it and move on.
    if (byte !== ESCAPE) {
      out.push(byte);
      continue;
    }

    // We are on a 0x7D, so the NEXT byte decides what it means.
    const next = wire[i + 1];

    if (next === 0x02) {
      out.push(FLAG); // 7D 02  ->  7E
      i++; // consume the second byte of the pair as well
    } else if (next === 0x01) {
      out.push(ESCAPE); // 7D 01  ->  7D
      i++;
    } else {
      // Either the frame ended right after a 0x7D, or the byte after it is not
      // 0x01 or 0x02. Neither is legal.
      return null;
    }
  }

  return Buffer.from(out); // Convert the number array to a Buffer.
}


// The check code: XOR every byte together.
export function checksum(bytes: Buffer): number {
  let acc = 0;
  for (const byte of bytes) acc ^= byte; // means "acc = acc XOR byte" 
  return acc;
}


// Read a single payload and return either the verified frame or a reason it failed.
export function readFrame(payload: Buffer): FrameResult {
  
  // -- 1. Is this even a frame? ------------------------------------------
  // A real frame is at least: start marker, check byte, end marker.
  if (payload.length < 3) {
    return { kind: 'not-a-frame', reason: `only ${payload.length} bytes` };
  }

  // A valid frame has a 0x7E at the start and end, 0x7E in the middle is illegal.
  if (payload[0] !== FLAG) {
    return { kind: 'not-a-frame', reason: 'does not start with 0x7E' };
  }

  if (payload[payload.length - 1] !== FLAG) {
    return { kind: 'not-a-frame', reason: 'does not end with 0x7E' };
  }

  // Everything strictly between the two markers is the actual message.
  const inner = payload.subarray(1, payload.length - 1);

  // A 0x7E in the middle is illegal.
  if (inner.includes(FLAG)) {
    return { kind: 'not-a-frame', reason: 'unescaped 0x7E inside the frame' };
  }

  // -- 2. Unescape --------------------------------------------------------
  const message = unescape(inner);

  if (message === null) {
    return { kind: 'bad-escape', reason: '0x7D not followed by 0x01 or 0x02' };
  }

  // After unescaping we need at least one byte to BE the check byte.
  if (message.length < 1) {
    return { kind: 'not-a-frame', reason: 'empty after unescaping' };
  }

  // -- 3. Verify the check byte -------------------------------------------
  
  // The check byte is the last byte of the UNESCAPED message.
  const content = message.subarray(0, message.length - 1); // everything except the check byte
  const actual = message[message.length - 1]!; // the check byte itself
  const expected = checksum(content); // the XOR of all the content bytes

  if (expected !== actual) {
    return { kind: 'bad-check', expected, actual };
  }

  return { kind: 'ok', frame: { content, checkByte: actual } };
}
