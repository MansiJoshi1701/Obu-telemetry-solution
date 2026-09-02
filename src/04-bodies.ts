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
  | { readonly type: 'authentication'; readonly authCode: string };

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

/** The documented name for a message id, or undefined if the spec never lists it. */
export function messageName(id: number): string | undefined {
  return DOCUMENTED_MESSAGE_NAMES[id];
}

/**
 * Decode a body, given the header that describes it.
 */
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

    default:
      // A message id we have no decoder for so report as undecoded.
      return { value: null, undecodedBytes: body.length };
  }
}
