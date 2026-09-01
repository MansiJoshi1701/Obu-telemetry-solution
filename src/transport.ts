/**
 * Step 2 — the transport layer.
 *
 * A payload from Step 1 is the raw bytes the collector received. Before anyone
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
 * 0x7E means "frame boundary", so that byte is not allowed to appear inside a
 * frame. When the real data contains it, the sender substitutes two bytes. And
 * because the substitute marker 0x7D is now special too, it needs the same
 * treatment:
 *
 *     real 0x7E   was sent as   0x7D 0x02
 *     real 0x7D   was sent as   0x7D 0x01
 *
 * So the output of this function is always the same length as the input or
 * SHORTER — never longer. Every escape pair collapses back into one byte.
 *
 * Returns null if it meets a 0x7D followed by anything else, because that is not
 * a valid escape sequence and we would rather report it than invent a meaning.
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

  return Buffer.from(out);
}

/**
 * The check code: XOR every byte together.
 *
 * XOR ("exclusive or") compares two numbers bit by bit. Each output bit is 1
 * when the two input bits differ, and 0 when they are the same:
 *
 *     0x0F  =  0000 1111
 *     0x33  =  0011 0011
 *     ----     ---------
 *     0x3C  =  0011 1100
 *
 * Running it across every byte gives one byte that depends on all of them, so
 * flipping any single bit anywhere changes the answer. It is a weak check — two
 * errors can cancel each other out — but it costs almost nothing to compute,
 * which matters on the tiny chip inside the bus.
 *
 * `acc ^= byte` is shorthand for `acc = acc ^ byte`, the same way `+=` works.
 */
export function checksum(bytes: Buffer): number {
  let acc = 0;
  for (const byte of bytes) acc ^= byte;
  return acc;
}

/**
 * Take one payload from Step 1 and either verify it or say why it failed.
 *
 * The order of operations here is not negotiable. PROTOCOL.md is explicit:
 * unescape FIRST, then everything else. The body length, every field offset and
 * the check code all describe the UNESCAPED message.
 */
export function readFrame(payload: Buffer): FrameResult {
  // -- 1. Is this even a frame? ------------------------------------------
  //
  // A real frame is at least: start marker, one byte, end marker.
  if (payload.length < 3) {
    return { kind: 'not-a-frame', reason: `only ${payload.length} bytes` };
  }

  // This is where the 19 TLS handshakes in day1 get rejected. They are traffic
  // from internet scanners that found the open port, and they do contain 0x7E
  // bytes — so a parser that hunted for markers anywhere inside a line would
  // happily invent frames out of them. Requiring the marker at BOTH ENDS is
  // what keeps that from happening.
  if (payload[0] !== FLAG) {
    return { kind: 'not-a-frame', reason: 'does not start with 0x7E' };
  }

  if (payload[payload.length - 1] !== FLAG) {
    return { kind: 'not-a-frame', reason: 'does not end with 0x7E' };
  }

  // Everything strictly between the two markers. subarray(1, length - 1) starts
  // at index 1 and stops BEFORE the last index, so both markers are dropped.
  const inner = payload.subarray(1, payload.length - 1);

  // A 0x7E in the middle should be impossible — that is the entire reason
  // escaping exists. If we find one, either the line holds two frames stuck
  // together or something is corrupt. Say so rather than guessing.
  if (inner.includes(FLAG)) {
    return { kind: 'not-a-frame', reason: 'unescaped 0x7E inside the frame' };
  }

  // -- 2. Unescape --------------------------------------------------------
  const message = unescape(inner);

  // `unescape` returns `Buffer | null`. Because `strict` is on, TypeScript will
  // not let us use `message` as a Buffer until we have ruled out null. That is
  // the compiler forcing us to handle the failure, not politeness on our part.
  if (message === null) {
    return { kind: 'bad-escape', reason: '0x7D not followed by 0x01 or 0x02' };
  }

  // After unescaping we need at least one byte to BE the check byte.
  if (message.length < 1) {
    return { kind: 'not-a-frame', reason: 'empty after unescaping' };
  }

  // -- 3. Verify the check byte -------------------------------------------
  //
  // The check byte is the last byte of the UNESCAPED message.
  //
  // This is the detail that catches people out. You cannot find it by counting
  // backwards from the closing 0x7E in the original bytes, because the check
  // byte itself gets escaped when it needs to be. PROTOCOL.md gives a frame
  // ending `7D 01 7E`: counting backwards from the marker hands you 0x01, when
  // the real check byte is 0x7D. Unescaping first makes the problem disappear.
  const content = message.subarray(0, message.length - 1);
  const actual = message[message.length - 1]!;
  const expected = checksum(content);

  if (expected !== actual) {
    return { kind: 'bad-check', expected, actual };
  }

  return { kind: 'ok', frame: { content, checkByte: actual } };
}
