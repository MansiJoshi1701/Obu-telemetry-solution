/**
 * The program you actually run:  npm run parse
 *
 * This is the only file that knows the order the steps happen in, and it should
 * read as a description of that order and nothing else. Each numbered module
 * does one job; the counting and printing live in 05-report.ts.
 *
 *   01-logReader   text file      ->  byte payloads
 *   02-transport   byte payload   ->  unescaped, check-verified message
 *   03-header      message        ->  header fields + body
 *   04-bodies      body           ->  decoded fields, per message id
 *   05-report      all of it      ->  the tally the brief asks for
 */

import { readCaptureFile } from './01-logReader.ts';
import { readFrame } from './02-transport.ts';
import { decodeHeader } from './03-header.ts';
import { decodeBody } from './04-bodies.ts';
import { RunReport } from './05-report.ts';

// The dataset. Not a default and not a configurable input — these three files
// are the entire data source the exercise provides, listed explicitly so it is
// obvious what was parsed to produce the numbers below.
const CAPTURE_FILES = [
  'data/day1/capture-14.log',
  'data/day2/capture-13.log',
  'data/day2/capture-14.log',
];

const report = new RunReport();

for (const file of CAPTURE_FILES) {
  report.startFile(file);

  for (const record of readCaptureFile(file).records) {
    report.countPayload();

    // Step 2: is it a frame, does it unescape, does the check code match?
    const frame = readFrame(record.rawBytes);
    if (frame.kind !== 'ok') {
      report.frameRejected(frame, `${record.sourceFile}:${record.lineNumber}`);
      continue;
    }

    // Step 3: split the 12-byte header from the body.
    const parsed = decodeHeader(frame.frame.content);
    if (parsed.kind !== 'ok') {
      report.headerRejected(parsed);
      continue;
    }

    // Step 4 onwards: decode the body according to the message id.
    const decoded = decodeBody(parsed.header, parsed.body);
    report.frameDecoded(parsed.header, parsed.body, decoded);
  }

  report.endFile();
}

report.print();
