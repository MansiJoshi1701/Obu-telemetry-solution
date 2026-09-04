/**
 * Reading the collector's log files.
 *
 * This file's only job is to turn the received text into a list of records with real
 * bytes in them.
 */

import { readFileSync } from 'node:fs';


// A single payload the collector received, alongwith the metadata that came with it.
export interface CaptureRecord {
  
  readonly sourceFile: string;  //Which file this came from, so later error messages can point at it.

  readonly lineNumber: number; //Line number of the hex line (1-based)

  readonly arrivedAt: Date; //When the bytes reached the collector, in the computer's local timezone.

  readonly peerHost: string;  //The IP address the bytes came from, e.g. "203.0.113.10"

  readonly peerPort: number; //The TCP port on the sender's side, e.g. 20600

  readonly rawBytes: Buffer; //The actual bytes the collector received (converted from the hex text in the log file)
}

// What one file produced: all the records, plus a count of what we ignored. */
export interface ReadResult {
  readonly records: readonly CaptureRecord[];

  readonly ignoredLines: number; //How many lines we could not parse as a header or payload
}

/**
 * Matches a header line and pulls the useful pieces out of it.
 *
 * Reading it left to right against `31-Jul-2026 14:01:32: 203.0.113.10:20600-`
 *
 *   ^                start of the line
 *   (\d{2})          31        two digits  -> day
 *   -
 *   ([A-Za-z]{3})    Jul       three letters -> month name
 *   -
 *   (\d{4})          2026      four digits -> year
 *   \s+              one or more spaces
 *   (\d{2}):(\d{2}):(\d{2})    14:01:32  -> hour, minute, second
 *   :\s*             the colon after the time, then optional spaces
 *   ([0-9a-fA-F.:]+) 203.0.113.10  -> the sender's address. The character set
 *                                     allows dots, colons and hex digits so an
 *                                     IPv6 address would match too.
 *   :
 *   (\d+)            20600     -> the sender's port
 *   -\s*$            the trailing dash, then end of line
 *
 * Each pair of round brackets is a "capture group". They are numbered from 1 in
 * the order the opening brackets appear, and we pull their text out below.
 */
const HEADER_PATTERN =
  /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):\s*([0-9a-fA-F.:]+):(\d+)-\s*$/;

/** A payload line is hexadecimal and nothing else. */
const HEX_PATTERN = /^[0-9a-fA-F]+$/;


//Month name to the number JavaScript's Date wants. JavaScript months are 0-based.
const MONTH_NUMBERS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};


// Read a single log file and return the records it produced, plus a count of what we ignored.
export function readCaptureFile(path: string): ReadResult {
  // Whole file into memory: fine for these 1.1 MB captures, but at 3300 buses (~2 GB/day) this would need streaming.
  const text = readFileSync(path, 'utf8');

  // Split into lines. The pattern \r?\n handles both Windows line endings
  // (\r\n) and Unix ones (\n), so the same code works wherever the file is from.
  const lines = text.split(/\r?\n/);

  const records: CaptureRecord[] = [];
  let ignoredLines = 0;

  // A normal counting loop, because we sometimes need to skip an extra line.
  // When we successfully read a header AND its payload we have consumed two
  // lines, so we bump `index` an extra time at the bottom of the loop body.
  for (let index = 0; index < lines.length; index++) {
    
    const headerLine = lines[index] ?? ''; //if the left side is null or undefined, use '' instead.

    if (headerLine.trim() === '') continue; //If header is blank, skip to the next line without counting it as ignored.

    // Try to match the header pattern with the current line.
    const match = HEADER_PATTERN.exec(headerLine.trim());

    if (match === null) {
      // Not a header line. Probably collector's own chatter, count it and move on.
      ignoredLines++;
      continue;
    }

    // A header should be followed by its payload on the very next line.
    const payloadLine = (lines[index + 1] ?? '').trim();

    // Three ways the payload can be unusable:
    //   - it is missing entirely (header was the last line of the file)
    //   - it contains something other than hex digits
    //   - it has an odd number of digits, so it cannot be whole bytes
    //     (every byte is exactly two hex digits)
    if (
      payloadLine === '' ||
      !HEX_PATTERN.test(payloadLine) ||
      payloadLine.length % 2 !== 0
    ) {
      ignoredLines++;
      continue;
    }

    // Pull the capture groups out by position. The leading comma skips match[0],
    // which is the whole matched line rather than one of our groups.
    const [, day, monthName, year, hour, minute, second, host, port] = match;

    // Convert the month name to a number.
    const month = MONTH_NUMBERS[monthName!.toLowerCase()];

    // A three-letter sequence that is not a real month name.
    if (month === undefined) {
      ignoredLines++;
      continue;
    }

    records.push({
      sourceFile: path,

      // +2 because array indexes start at 0 but humans count lines from 1, and
      // the payload is one line below the header we matched.
      lineNumber: index + 2,

      
      // Note: this builds the date in the computer's LOCAL timezone
      arrivedAt: new Date(+year!, month, +day!, +hour!, +minute!, +second!),

      peerHost: host!,
      peerPort: +port!,

      // Convert the hex TEXT into real bytes. The string "7E01" is four
      // characters; the Buffer it produces is two bytes, 0x7E and 0x01.
      rawBytes: Buffer.from(payloadLine, 'hex'),
    });

    // We used two lines, not one. Skip past the payload so the next turn of the
    // loop starts at the following header.
    index++;
  }

  return { records, ignoredLines };
}
