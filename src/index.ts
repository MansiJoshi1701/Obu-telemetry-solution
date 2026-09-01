/**
 * The program you actually run:  npm run parse
 *
 * This is the only file that knows the order the steps happen in. Each step
 * lives in its own module and does one job; this file wires them together.
 *
 * So far: step 1 (read the log) -> step 2 (verify the frame)
 *      -> step 3 (split the header from the body).
 */

import { readCaptureFile } from './logReader.ts';
import { readFrame, unescape } from './transport.ts';
import { decodeHeader, formatMessageId } from './header.ts';
import { decodeBody, messageName } from './bodies.ts';

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

// Step 3 totals.
let headersDecoded = 0;
let headersTooShort = 0;
let badDeviceIds = 0;
let lengthMismatches = 0;
let encrypted = 0;
let subPackaged = 0;

// Step 4 totals.
let bodiesDecoded = 0;
let bodiesWithoutDecoder = 0;
let undecodedBodyBytes = 0;

// A Map remembers insertion order and lets us count by a key. `Map<number, number>`
// reads as "keys are numbers, values are numbers" — here, message id -> how many.
const countByMessageId = new Map<number, number>();
const countByDevice = new Map<string, number>();

// A Set holds each distinct value once. We use it to show every different
// authentication code in the data, which is also how we would notice if a body
// contained something other than the printable text we expect.
const authCodes = new Set<string>();

// Bytes we could not account for, split by which message id they belonged to,
// so the step 9 tally can say WHERE the undecoded bytes are rather than just
// how many there are.
const undecodedByMessageId = new Map<number, number>();

// We keep an example or two to print at the end, because a number in a summary
// is not the same as seeing the actual bytes.
let escapedExample: Buffer | undefined;
let headerExample: { hex: string; text: string } | undefined;

/** Add one to a counter held in a Map, starting it at 0 if it is not there yet. */
function bump<K>(counter: Map<K, number>, key: K): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

for (const file of CAPTURE_FILES) {
  const { records } = readCaptureFile(file);

  let fileVerified = 0;
  let fileRejected = 0;

  for (const record of records) {
    payloads++;

    const result = readFrame(record.rawBytes);

    // `result.kind` decides which shape `result` has, so we can access the right fields for each case.
    switch (result.kind) {
      case 'ok':
        verified++;
        fileVerified++;

        if (escapedExample === undefined && record.rawBytes.includes(0x7d)) {
          escapedExample = record.rawBytes;
        }

        // ---- step 3 ----------------------------------------------------
        {
          const parsed = decodeHeader(result.frame.content);

          if (parsed.kind === 'too-short') {
            headersTooShort++;
          } else if (parsed.kind === 'bad-device-id') {
            badDeviceIds++;
          } else {
            headersDecoded++;
            bump(countByMessageId, parsed.header.messageId);
            bump(countByDevice, parsed.header.deviceId);

            if (parsed.header.encryption !== 0) encrypted++;
            if (parsed.header.isSubPackage) subPackaged++;

            // Compare the actual body length to the calculated length (from body attributes)
            // A mismatch would mean we had mis-split something.
            if (parsed.body.length !== parsed.header.declaredBodyLength) {
              lengthMismatches++;
            }

            // ---- step 4 ------------------------------------------------
            const decoded = decodeBody(parsed.header, parsed.body);

            if (decoded.value === null) bodiesWithoutDecoder++;
            else bodiesDecoded++;

            if (decoded.value?.type === 'authentication') {
              authCodes.add(decoded.value.authCode);
            }

            if (decoded.undecodedBytes > 0) {
              undecodedBodyBytes += decoded.undecodedBytes;
              undecodedByMessageId.set(
                parsed.header.messageId,
                (undecodedByMessageId.get(parsed.header.messageId) ?? 0) + decoded.undecodedBytes,
              );
            }

            if (headerExample === undefined) {
              const h = parsed.header;
              headerExample = {
                hex: result.frame.content.subarray(0, 12).toString('hex').toUpperCase(),
                text:
                  `messageId=${formatMessageId(h.messageId)} ` +
                  `device=${h.deviceId} serial=${h.serial} ` +
                  `bodyLength=${h.declaredBodyLength} (actual ${parsed.body.length}) ` +
                  `encryption=${h.encryption} subPackage=${h.isSubPackage}`,
              };
            }
          }
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

console.log('\n  --- header summary ---');
console.log(`  headers decoded      ${headersDecoded}`);
console.log(`  too short for header ${headersTooShort}`);
console.log(`  invalid device id    ${badDeviceIds}`);
console.log(`  body length mismatch ${lengthMismatches}`);
console.log(`  encrypted bodies     ${encrypted}`);
console.log(`  sub-package frames   ${subPackaged}`);

console.log('\n  --- body summary ---');
console.log(`  bodies decoded       ${bodiesDecoded}`);
console.log(`  no decoder yet       ${bodiesWithoutDecoder}`);
console.log(`  undecoded body bytes ${undecodedBodyBytes}`);

console.log('\n  --- message types ---');
// Sort by count, highest first, so the common types are at the top.
for (const [id, count] of [...countByMessageId].sort((a, b) => b[1] - a[1])) {
  // A name means PROTOCOL.md documents this id. No name means it appears in no
  // vendor document we hold, which is a finding rather than a parser gap.
  const name = messageName(id) ?? 'NOT IN PROTOCOL.md';
  const undecoded = undecodedByMessageId.get(id) ?? 0;
  console.log(
    `  ${formatMessageId(id)}  ${String(count).padStart(5)}  ${name.padEnd(20)}` +
      (undecoded > 0 ? `${undecoded} bytes undecoded` : ''),
  );
}

if (authCodes.size > 0) {
  console.log(`\n  distinct authentication codes (0x0102): ${[...authCodes].join(', ')}`);
}

console.log('\n  --- devices ---');
for (const [device, count] of [...countByDevice].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${device}  ${String(count).padStart(5)} frames`);
}

// Show one real escaped frame, so the escaping is visible rather than just
// asserted in a comment.
if (escapedExample !== undefined) {
  const inner = escapedExample.subarray(1, escapedExample.length - 1); // original bytes, still escaped, without the 0x7E markers
  const message = unescape(inner); // unescaped bytes

  console.log('\n  --- a real frame that contains an escape ---');
  console.log(`  on the wire     ${escapedExample.toString('hex').toUpperCase()}`);
  console.log(`  unescaped       ${message?.toString('hex').toUpperCase()}`);
  console.log(
    `  length          ${inner.length} bytes on the wire -> ` +
      `${message?.length} bytes of message`,
  );
}

if (headerExample !== undefined) {
  console.log('\n  --- first header, decoded ---');
  console.log(`  bytes   ${headerExample.hex}`);
  console.log(`  fields  ${headerExample.text}\n`);
}
