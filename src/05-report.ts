/**
 * Collecting the numbers, and printing them.
 *
 * The brief asks the parser to say, for the whole dataset: how many frames it
 * saw, how many it decoded, how many failed the check code, and how many bytes
 * it could not account for. This file owns all of that.
 *
 * Why a class here, when every other file is plain functions:
 *
 * A class earns its place when data and behaviour belong together AND the data
 * changes over time. That is exactly this: a set of running totals that get
 * updated 4,950 times and then printed once. Everywhere else in this project a
 * function takes bytes and returns a value, remembering nothing — and a class
 * there would be a function wearing a costume.
 *
 * Keeping the totals in here rather than in index.ts also means index.ts stays
 * a description of the pipeline, which is the one thing it should be.
 */

import type { FrameResult } from './02-transport.ts';
import type { FrameHeader, HeaderResult } from './03-header.ts';
import type { DecodedBody } from './04-bodies.ts';
import { formatMessageId } from './03-header.ts';
import { messageName, isBlankRegistration } from './04-bodies.ts';

export class RunReport {
  // ---- transport ---------------------------------------------------------
  private payloads = 0;
  private framesVerified = 0;
  private notFrames = 0;
  private badEscapes = 0;
  private checkFailures = 0;

  // ---- header ------------------------------------------------------------
  private headersTooShort = 0;
  private badDeviceIds = 0;
  private lengthMismatches = 0;
  private encrypted = 0;
  private subPackaged = 0;

  // ---- body --------------------------------------------------------------
  private bodiesDecoded = 0;
  private bodiesWithoutDecoder = 0;
  private undecodedBytes = 0;

  // The brief warns that registration bodies decode to blanks because the
  // identifying fields were stripped during anonymisation. These two turn that
  // warning into something we measured rather than something we assumed.
  private registrations = 0;
  private blankRegistrations = 0;

  // ---- breakdowns --------------------------------------------------------
  //
  // A Map stores values under a key and lets you look them up again. These two
  // exist because the summary numbers alone do not answer all the questions.
  //
  //   framesByMessageId    which kinds of message are in the data, and how many
  //   undecodedByMessageId WHERE the undecoded bytes are, not just how many
  //
  // There is deliberately no per-device breakdown. Part 1 asks for totals "for
  // the whole dataset"; per-device summaries are a Part 3 requirement, and
  // Part 3 is out of scope here.
  private readonly framesByMessageId = new Map<number, number>();
  private readonly undecodedByMessageId = new Map<number, number>();

  // ---- per file ----------------------------------------------------------
  private readonly perFile: { file: string; payloads: number; verified: number }[] = [];
  private currentFile = '';
  private currentFilePayloads = 0;
  private currentFileVerified = 0;

  /** Add `amount` to the number stored under `key`, starting from 0. */
  private static add<K>(counter: Map<K, number>, key: K, amount: number): void {
    counter.set(key, (counter.get(key) ?? 0) + amount);
  }

  startFile(file: string): void {
    this.currentFile = file;
    this.currentFilePayloads = 0;
    this.currentFileVerified = 0;
  }

  endFile(): void {
    this.perFile.push({
      file: this.currentFile,
      payloads: this.currentFilePayloads,
      verified: this.currentFileVerified,
    });
  }

  /** One payload line was read out of a capture file. */
  countPayload(): void {
    this.payloads++;
    this.currentFilePayloads++;
  }

  /** A payload that did not survive step 2. */
  frameRejected(result: FrameResult, where: string): void {
    switch (result.kind) {
      case 'not-a-frame':
        this.notFrames++;
        break;
      case 'bad-escape':
        this.badEscapes++;
        break;
      case 'bad-check':
        this.checkFailures++;
        // The brief: report these, do not silently drop and do not silently
        // accept. Show the first few; a flood would drown the summary.
        if (this.checkFailures <= 5) {
          console.log(
            `  CHECK FAILED ${where} expected 0x${result.expected.toString(16)} ` +
              `got 0x${result.actual.toString(16)}`,
          );
        }
        break;
    }
  }

  /** A frame that verified but whose header would not parse. */
  headerRejected(result: HeaderResult): void {
    this.framesVerified++;
    this.currentFileVerified++;
    if (result.kind === 'too-short') this.headersTooShort++;
    else if (result.kind === 'bad-device-id') this.badDeviceIds++;
  }

  /** A frame that made it all the way through. */
  frameDecoded(header: FrameHeader, body: Buffer, decoded: DecodedBody): void {
    this.framesVerified++;
    this.currentFileVerified++;

    RunReport.add(this.framesByMessageId, header.messageId, 1);

    if (header.encryption !== 0) this.encrypted++;
    if (header.isSubPackage) this.subPackaged++;

    // The header declares a body length; we sliced one independently. They
    // should agree, and a mismatch would mean the framing was wrong.
    if (body.length !== header.declaredBodyLength) this.lengthMismatches++;

    if (decoded.value === null) this.bodiesWithoutDecoder++;
    else this.bodiesDecoded++;

    if (decoded.value?.type === 'registration') {
      this.registrations++;
      if (isBlankRegistration(decoded.value)) this.blankRegistrations++;
    }

    if (decoded.undecodedBytes > 0) {
      this.undecodedBytes += decoded.undecodedBytes;
      RunReport.add(this.undecodedByMessageId, header.messageId, decoded.undecodedBytes);
    }
  }

  print(): void {
    for (const f of this.perFile) {
      console.log(
        `  ${f.file.padEnd(28)} ${String(f.payloads).padStart(5)} payloads  ` +
          `${String(f.verified).padStart(5)} frames`,
      );
    }

    console.log('\n  --- run summary ---');
    console.log(`  payload lines read   ${this.payloads}`);
    console.log(`  frames seen          ${this.framesVerified}`);
    console.log(`  bodies decoded       ${this.bodiesDecoded}`);
    console.log(`  no decoder yet       ${this.bodiesWithoutDecoder}`);
    console.log(`  check-code failures  ${this.checkFailures}`);
    console.log(`  undecoded bytes      ${this.undecodedBytes}`);

    if (this.registrations > 0) {
      console.log(
        `  blank registrations  ${this.blankRegistrations} of ${this.registrations}` +
          ` (identifying fields stripped by anonymisation, per the brief)`,
      );
    }

    // Anything below is only worth a line when it actually happened. Printing a
    // column of permanent zeros buries the one number that ever changes.
    const anomalies: string[] = [];
    if (this.notFrames > 0) anomalies.push(`${this.notFrames} not a frame`);
    if (this.badEscapes > 0) anomalies.push(`${this.badEscapes} bad escape`);
    if (this.headersTooShort > 0) anomalies.push(`${this.headersTooShort} header too short`);
    if (this.badDeviceIds > 0) anomalies.push(`${this.badDeviceIds} bad device id`);
    if (this.lengthMismatches > 0) anomalies.push(`${this.lengthMismatches} body length mismatch`);
    if (this.encrypted > 0) anomalies.push(`${this.encrypted} encrypted`);
    if (this.subPackaged > 0) anomalies.push(`${this.subPackaged} sub-packaged`);

    console.log(
      `  anomalies            ${anomalies.length === 0 ? 'none' : anomalies.join(', ')}`,
    );

    console.log('\n  --- message types ---');
    for (const [id, count] of [...this.framesByMessageId].sort((a, b) => b[1] - a[1])) {
      // A name means PROTOCOL.md documents this id. No name means it appears in
      // no vendor document we hold — a finding, not a gap in the parser.
      const name = messageName(id) ?? 'NOT IN PROTOCOL.md';
      const undecoded = this.undecodedByMessageId.get(id) ?? 0;
      console.log(
        `  ${formatMessageId(id)}  ${String(count).padStart(5)}  ${name.padEnd(20)}` +
          (undecoded > 0 ? `${undecoded} bytes undecoded` : ''),
      );
    }

    console.log('');
  }
}
