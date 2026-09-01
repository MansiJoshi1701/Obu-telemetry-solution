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
 * Read BCD bytes as the decimal digits they encode.
 *
 * Node already renders a Buffer as one hex character per nibble, which is
 * exactly the split BCD is defined in terms of. And because every valid BCD
 * nibble is 0-9, the hex character and the decimal digit are the same character.
 * So `toString('hex')` IS the BCD reading — no shifting or masking needed.
 *
 * The two encodings only diverge on nibbles above 9, and those are invalid BCD
 * anyway. There they show up as the letters a-f, which `isValidBcd` rejects.
 *
 * Returns a STRING, not a number. Two reasons, and both matter:
 *
 *  - Leading zeros are part of the identity. Device "008800000001" is not the
 *    same thing as 8800000001, and a number would throw the zeros away.
 *  - A device id is a label, not a quantity. Nothing sensible happens if you
 *    add two of them together, so it should not be a type that allows it.
 */
export function bcdToDigits(bytes: Buffer): string {
  return bytes.toString('hex');
}

/**
 * Are these bytes valid BCD?
 *
 * A nibble can hold 0-15, but a decimal digit is only 0-9. Values 10-15 are
 * fine as hex and are not BCD at all, so a field containing one was either
 * never BCD or is corrupt.
 *
 * Because `bcdToDigits` renders as hex, an invalid nibble arrives as a letter
 * rather than a digit. This test rejects anything that is not all 0-9.
 */
export function isValidBcd(bytes: Buffer): boolean {
  return /^[0-9]*$/.test(bytes.toString('hex'));
}
