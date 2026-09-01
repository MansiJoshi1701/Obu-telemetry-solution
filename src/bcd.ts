/**
 * BCD — binary-coded decimal.
 *
 * A way of storing decimal digits that is easy to read off a display without
 * doing any arithmetic. Each byte holds TWO decimal digits, one in each half:
 *
 *     byte 0x88   ->  high half is 8, low half is 8   ->  the digits "88"
 *     byte 0x01   ->  high half is 0, low half is 1   ->  the digits "01"
 *
 * So the six bytes 00 88 00 00 00 01 are the twelve digits "008800000001".
 *
 * The important consequence: this is NOT the number 0x008800000001. If you read
 * those bytes as an ordinary big-endian integer you get 584115552257, which is
 * a completely different value. BCD has to be read digit by digit.
 *
 * This lives in its own file because BCD is an encoding, not a property of any
 * one message. The frame header uses it for the device id, and the location
 * report uses it again for its timestamp.
 */

/**
 * Read BCD bytes as the decimal digits they encode.
 *
 * Returns a STRING, not a number. Two reasons, and both matter:
 *
 *  - Leading zeros are part of the identity. Device "008800000001" is not the
 *    same thing as 8800000001, and turning it into a number would throw the
 *    zeros away permanently.
 *  - A device id is a label, not a quantity. Nothing sensible happens if you
 *    add two of them together, so it should not be a type that allows it.
 */
export function bcdToDigits(bytes: Buffer): string {
  let digits = '';

  for (const byte of bytes) {
    // `>>> 4` shifts the byte four places right, leaving the high half.
    //   0x88 = 1000 1000  ->  0000 1000 = 8
    digits += (byte >>> 4).toString(10);

    // `& 0x0f` keeps only the low four bits and zeroes the rest.
    //   0x88 = 1000 1000
    //   0x0f = 0000 1111
    //   result 0000 1000 = 8
    digits += (byte & 0x0f).toString(10);
  }

  return digits;
}

/**
 * Are these bytes valid BCD?
 *
 * Each half-byte should be 0-9. A half-byte of 0xA to 0xF is not a decimal
 * digit, so the field was either not BCD or is corrupt. We check rather than
 * assume, because `bcdToDigits` would otherwise cheerfully return "a7" and the
 * problem would surface much later as a strange-looking device id.
 */
export function isValidBcd(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if ((byte >>> 4) > 9) return false;
    if ((byte & 0x0f) > 9) return false;
  }
  return true;
}
