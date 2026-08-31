/**
 * The program you actually run.
 *
 *   npm run parse                          reads all three captures
 *   node src/index.ts data/day1/capture-14.log    reads just the one you name
 *
 * Right now it only proves Step 1 works: it reads the files and reports what it
 * found. Decoding arrives in later steps.
 */

import { readCaptureFile } from './logReader.ts';

/** Used when you run the program without naming any files. */
const DEFAULT_FILES = [
  'data/day1/capture-14.log',
  'data/day2/capture-13.log',
  'data/day2/capture-14.log',
];

// process.argv is the list of words typed on the command line. Position 0 is the
// path to node itself and position 1 is the path to this script, so the
// arguments a human actually typed start at position 2.
const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length > 0 ? requestedFiles : DEFAULT_FILES;

let totalRecords = 0;
let totalIgnored = 0;
let totalBytes = 0;

for (const file of files) {
  const { records, ignoredLines } = readCaptureFile(file);

  // Add up the sizes of every payload in this file.
  //
  // `reduce` walks the list carrying a running total: `sum` is the total so far
  // and `record` is the current item. The 0 at the end is where the total starts.
  const bytes = records.reduce((sum, record) => sum + record.rawBytes.length, 0);

  totalRecords += records.length;
  totalIgnored += ignoredLines;
  totalBytes += bytes;

  // padStart lines the numbers up in a column so the output is readable.
  console.log(
    `  ${file.padEnd(28)} ${String(records.length).padStart(5)} payloads  ` +
      `${String(bytes).padStart(7)} bytes  ${ignoredLines} ignored`,
  );
}

console.log(`\n  ${'TOTAL'.padEnd(28)} ${String(totalRecords).padStart(5)} payloads  ` +
  `${String(totalBytes).padStart(7)} bytes  ${totalIgnored} ignored\n`);

// Show one record in full, as a sanity check that the pieces really were pulled
// apart correctly. Reading a number in a summary is not the same as seeing the
// actual thing.
const [firstFile] = files;
if (firstFile !== undefined) {
  const { records } = readCaptureFile(firstFile);
  const first = records[0];

  if (first !== undefined) {
    console.log('  First record in detail:');
    console.log(`    file        ${first.sourceFile}:${first.lineNumber}`);
    console.log(`    arrived at  ${first.arrivedAt.toString()}`);
    console.log(`    from        ${first.peerHost}:${first.peerPort}`);
    console.log(`    bytes       ${first.rawBytes.length}`);

    // .toString('hex') turns the bytes back into readable hex so we can compare
    // against the original line in the log file by eye.
    console.log(`    as hex      ${first.rawBytes.toString('hex').toUpperCase()}`);
    console.log('');
  }
}
