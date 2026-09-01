
// Convert BCD bytes to a string of digits.
export function bcdToDigits(bytes: Buffer): string | null {
  const digits = bytes.toString('hex');

  // If the string contains any letters (a-f OR A-F), it is not valid BCD. Return null,
  // Otherwise, return the string of digits.
  return /^[0-9]*$/.test(digits) ? digits : null;
}
