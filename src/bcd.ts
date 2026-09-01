/**
 * BCD — binary-coded decimal.
 *
 * A way of storing decimal digits that needs no arithmetic to read back. Each
 * byte holds TWO decimal digits, one in each half-byte (each "nibble"):
 *
 *     byte 0x88   ->  the digits "88"
 *     byte 0x01   ->  the digits "01"
 *
 * So the six bytes 00 88 00 00 00 01 are the twelve digits "008800000001".
 *
 * The important consequence: this is NOT the number 0x008800000001. Read those
 * bytes as an ordinary big-endian integer and you get 584115552257, a
 * completely different value. BCD has to be read digit by digit.
 *
 * This lives in its own file because BCD is an encoding, not a property of any
 * one message. The frame header uses it for the device id, and the location
 * report uses it again for its timestamp.
 */

/**
 * Read BCD bytes as the decimal digits they encode, or null if they are not
 * valid BCD.
 *
 * How it works: Node already renders a Buffer as one hex character per nibble,
 * which is exactly the split BCD is defined in terms of. And because every
 * valid BCD nibble is 0-9, the hex character and the decimal digit are the same
 * character. So `toString('hex')` IS the BCD reading — no shifting or masking.
 *
 * The two readings only diverge on nibbles above 9, which are not valid BCD at
 * all. Those arrive as the letters a-f, and the test below rejects them.
 *
 * The check is inside this function rather than beside it so that unvalidated
 * digits cannot exist. There is no way to get a string out of here without it
 * having passed, and `strict` mode forces every caller to deal with the null.
 *
 * Returns a STRING, not a number, when it succeeds. Two reasons, both matter:
 *
 *  - Leading zeros are part of the identity. Device "008800000001" is not the
 *    same thing as 8800000001, and a number would throw the zeros away.
 *  - A device id is a label, not a quantity. Nothing sensible happens if you
 *    add two of them together, so it should not be a type that allows it.
 *
 * Null rather than false: `false` answers a yes/no question, but the caller is
 * asking for a value. Null is the ordinary way to say there is not one. It also
 * stays distinguishable from the empty string, which is falsy too.
 */
export function bcdToDigits(bytes: Buffer): string | null {
  const digits = bytes.toString('hex');
  return /^[0-9]*$/.test(digits) ? digits : null;
}
