/**
 * The program you actually run:  npm run parse
 *
 * This is the only file that knows the order the steps happen in. Each step
 * lives in its own module and does one job; this file wires them together.
 *
 * So far: step 1 (read the log) feeds step 2 (verify the frame).
 */

import { readCaptureFile } from './logReader.ts';
import { readFrame, unescape, checksum } from './transport.ts';

// The dataset. Not a default and not a configurable input — these three files
// are the entire data source the exercise provides, listed explicitly so it is
// obvious what was parsed to produce the numbers below.
const CAPTURE_FILES = [
  'data/day1/capture-14.log',
  'data/day2/capture-13.log',
  'data/day2/capture-14.log',
];

// Running totals for the whole run.
let payloads = 0;
let verified = 0;
let notFrames = 0;
let badEscapes = 0;
let badChecks = 0;

// We keep a couple of interesting examples to print at the end, because a
// number in a summary is not the same as seeing the actual bytes.
let escapedExample: Buffer | undefined;

for (const file of CAPTURE_FILES) {
  const { records } = readCaptureFile(file);

  // Per-file counters, so the summary shows which file the oddities are in.
  let fileVerified = 0;
  let fileRejected = 0;

  for (const record of records) {
    payloads++;

    const result = readFrame(record.rawBytes);

    // `result.kind` decides which shape `result` has. TypeScript will not let us
    // read `result.expected` until we are inside the 'bad-check' branch, which
    // is exactly what stops us from silently ignoring a failure.
    switch (result.kind) {
      case 'ok':
        verified++;
        fileVerified++;

        // Hold on to the first frame that actually contained an escape, so we
        // can show the before/after below.
        if (escapedExample === undefined && record.rawBytes.includes(0x7d)) {
          escapedExample = record.rawBytes;
        }
        break;

      case 'not-a-frame':
        notFrames++;
        fileRejected++;
        break;

      case 'bad-escape':
        badEscapes++;
        fileRejected++;
        break;

      case 'bad-check':
        // The brief: report these, do not silently drop and do not silently
        // accept. Printing every one would be noise if there were thousands, so
        // we count them and show the first few.
        badChecks++;
        fileRejected++;
        if (badChecks <= 5) {
          console.log(
            `  CHECK FAILED ${record.sourceFile}:${record.lineNumber} ` +
              `expected 0x${result.expected.toString(16).padStart(2, '0')} ` +
              `got 0x${result.actual.toString(16).padStart(2, '0')}`,
          );
        }
        break;
    }
  }

  console.log(
    `  ${file.padEnd(28)} ${String(records.length).padStart(5)} payloads  ` +
      `${String(fileVerified).padStart(5)} verified  ${fileRejected} rejected`,
  );
}

console.log('\n  --- transport summary ---');
console.log(`  payloads read        ${payloads}`);
console.log(`  frames verified      ${verified}`);
console.log(`  not a frame          ${notFrames}`);
console.log(`  bad escape sequence  ${badEscapes}`);
console.log(`  check-code failures  ${badChecks}`);

// Show one real escaped frame, so the escaping is visible rather than just
// asserted in a comment.
if (escapedExample !== undefined) {
  const inner = escapedExample.subarray(1, escapedExample.length - 1);
  const message = unescape(inner);

  console.log('\n  --- a real frame that contains an escape ---');
  console.log(`  on the wire     ${escapedExample.toString('hex').toUpperCase()}`);
  console.log(`  unescaped       ${message?.toString('hex').toUpperCase()}`);
  console.log(
    `  length          ${inner.length} bytes on the wire -> ` +
      `${message?.length} bytes of message`,
  );
}

// The worked example from PROTOCOL.md, checked against our own code.
// "XOR of 0002 0000 008800000001 00BC = 0x37, which matches the check byte."
const specExample = Buffer.from('0002000000880000000100BC', 'hex');
console.log(
  `  PROTOCOL.md baseline heartbeat checksum: ` +
    `0x${checksum(specExample).toString(16)} (spec says 0x37)\n`,
);
