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
import { decodeAlarms, describeStatus } from './flags.ts';
import type { Classification } from './extensions.ts';

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

  // Evidence for storing coordinates as null rather than 0 when there is no fix.
  private locations = 0;
  private unpositioned = 0;

  // Which distinct alarm and status words actually occur. PROTOCOL.md's Known
  // gaps section warns that most documented bits are never set; these two turn
  // that warning into a list we can point at.
  private readonly statusWords = new Map<number, number>();
  private readonly alarmWords = new Map<number, number>();

  // TLV value bytes we split out correctly but did not interpret. Kept apart
  // from undecodedBytes on purpose; see the note where it is incremented.
  private uninterpretedValueBytes = 0;
  private readonly uninterpretedByExtensionId = new Map<number, number>();

  // Every extension id seen, with how often, how the spec classifies it, whether
  // we decoded its value, and how many distinct values it ever took. That last
  // one matters: a field that never changes is not the same as a measurement.
  private readonly extensionIds = new Map<
    number,
    {
      count: number;
      classification: Classification;
      name: string | undefined;
      lengths: Set<number>;
      distinctValues: Set<string>;
    }
  >();

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

  /** A payload that did not survive the transport checks. */
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

    if (decoded.value?.type === 'location') {
      this.locations++;
      if (!decoded.value.status.positioned) this.unpositioned++;
      RunReport.add(this.statusWords, decoded.value.statusWord, 1);
      RunReport.add(this.alarmWords, decoded.value.alarmWord, 1);

      for (const item of decoded.value.extensions) {
        let seen = this.extensionIds.get(item.id);
        if (seen === undefined) {
          seen = {
            count: 0,
            classification: item.classification,
            name: item.decoded?.name,
            lengths: new Set<number>(),
            distinctValues: new Set<string>(),
          };
          this.extensionIds.set(item.id, seen);
        }
        seen.count++;
        seen.lengths.add(item.length);
        seen.distinctValues.add(item.raw.toString('hex'));

        // An item with no decoder is structurally accounted for -- we know its
        // id, its length and its value bytes -- but its MEANING is unknown. Those
        // bytes are counted separately from undecodedBytes rather than folded
        // into it, because the two are different admissions:
        //
        //   undecodedBytes         we could not account for these bytes at all
        //   uninterpretedValueBytes  we know exactly what these bytes are and
        //                            where they sit, but not what they mean
        if (item.decoded === undefined) {
          this.uninterpretedValueBytes += item.raw.length;
          RunReport.add(this.uninterpretedByExtensionId, item.id, item.raw.length);
        }
      }
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

    // Two different admissions, reported separately rather than added together.
    // undecodedBytes  = bytes with no account at all.
    // uninterpreted   = bytes we located exactly but whose meaning is unknown.
    if (this.uninterpretedValueBytes > 0) {
      console.log(
        `  uninterpreted bytes  ${this.uninterpretedValueBytes}` +
          ` (TLV values split out correctly, meaning not decoded)`,
      );
      console.log(
        `  fully explained      ${this.undecodedBytes + this.uninterpretedValueBytes}` +
          ` bytes are NOT claimed as understood`,
      );
    }

    if (this.registrations > 0) {
      console.log(
        `  blank registrations  ${this.blankRegistrations} of ${this.registrations}` +
          ` (identifying fields stripped by anonymisation, per the brief)`,
      );
    }

    if (this.locations > 0) {
      console.log(
        `  no GPS fix           ${this.unpositioned} of ${this.locations} locations` +
          ` (coordinates stored as null, not 0)`,
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

    // PROTOCOL.md's Known gaps section warns that most documented status and
    // alarm bits are never set. Listing every distinct word that actually occurs
    // turns that warning into something specific we can point at.
    if (this.statusWords.size > 0) {
      console.log('\n  --- status words seen ---');
      for (const [word, n] of [...this.statusWords].sort((a, b) => b[1] - a[1])) {
        console.log(
          `  0x${word.toString(16).toUpperCase().padStart(8, '0')}  ${String(n).padStart(5)}  ` +
            describeStatus(word).join(' '),
        );
      }

      console.log('\n  --- alarm words seen ---');
      for (const [word, n] of [...this.alarmWords].sort((a, b) => b[1] - a[1])) {
        const names = decodeAlarms(word);
        console.log(
          `  0x${word.toString(16).toUpperCase().padStart(8, '0')}  ${String(n).padStart(5)}  ` +
            (names.length === 0 ? 'no alarms' : names.join(' ')),
        );
      }
    }

    if (this.extensionIds.size > 0) {
      console.log('\n  --- location extension items ---');
      console.log('  id    count  len  distinct  uninterp  spec            decoded as');
      for (const [id, e] of [...this.extensionIds].sort((a, b) => a[0] - b[0])) {
        const uninterp = this.uninterpretedByExtensionId.get(id) ?? 0;
        console.log(
          '  0x' +
            id.toString(16).toUpperCase().padStart(2, '0') +
            String(e.count).padStart(7) +
            [...e.lengths].join('/').padStart(5) +
            String(e.distinctValues.size).padStart(10) +
            (uninterp === 0 ? '         -' : String(uninterp).padStart(10)) +
            '  ' +
            e.classification.padEnd(14) +
            '  ' +
            (e.name ?? '-- value not decoded --'),
        );
      }

      // A field that never changes is not the same thing as a measurement.
      // Listing them here is the evidence for that claim in NOTES.md.
      const constant = [...this.extensionIds].filter(([, e]) => e.distinctValues.size === 1);
      console.log(
        `\n  ${constant.length} of ${this.extensionIds.size} extension ids never vary: ` +
          constant.map(([id]) => '0x' + id.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      );
    }

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
