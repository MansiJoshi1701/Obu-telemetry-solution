/**
 * The extension items at the tail of a location report.
 *
 * From offset 28 to the end of the body, a 0x0200 carries a sequence of items in
 * TLV form — Tag, Length, Value:
 *
 *     01 04 0002ED94   03 02 0064   31 01 0A   ...
 *     ^  ^  └value─┘   ^  ^  └──┘   ^  ^  └┘
 *     id len           id len       id len
 *
 * One byte of id, one byte of length, then that many bytes of value, running
 * back to back until the body is exhausted. The length byte is what makes this
 * work: without it, the parser would have no way to know where one value ends and the next begins. 
 * The brief warns that the devices are not always honest about the length, 
 * so the parser must be prepared to stop early and report any remaining
 *
 * The brief is specific about what to do here: split every item into id, length
 * and value, decode the values for the ids PROTOCOL.md documents, and keep the
 * rest as raw bytes rather than discarding them.
 */

/** What PROTOCOL.md says about an id — three different claims, not two. */
export type Classification =
  /** Listed in the spec's Table 27. */
  | 'documented'
  /** Inside a range the spec explicitly marks Reserved: 0x05-0x10, 0x14-0x24. */
  | 'reserved'
  /** Inside the 0xE1-0xFF area the spec leaves free for implementers. */
  | 'custom-area'
  /** Mentioned nowhere in the spec at all. */
  | 'unknown';

export interface ExtensionValue {
  readonly name: string;
  readonly value: number;
  readonly unit?: string;
}

export interface ExtensionItem {
  readonly id: number;
  readonly length: number;
  readonly raw: Buffer; // The value bytes, always kept, whether or not we understood them.
  readonly decoded: ExtensionValue | undefined; // Filled in only for ids the spec documents AND whose length matches.
  readonly classification: Classification;
}

/**
 * Decoders for the ids PROTOCOL.md documents with a defined value layout.
 *
 * Each checks the length before reading. A device sending id 0x01 with length 2
 * instead of 4 would otherwise throw inside readUInt32BE and cost us the whole
 * frame over one malformed item. Returning undefined keeps the item — with its
 * raw bytes — and simply leaves the value uninterpreted.
 */
const DECODERS: Readonly<Record<number, (v: Buffer) => ExtensionValue | undefined>> = {
  0x01: (v) =>
    v.length === 4 ? { name: 'mileage', value: v.readUInt32BE(0) / 10, unit: 'km' } : undefined,
  0x02: (v) =>
    v.length === 2 ? { name: 'fuel', value: v.readUInt16BE(0) / 10, unit: 'L' } : undefined,
  0x03: (v) =>
    v.length === 2
      ? { name: 'recorder-speed', value: v.readUInt16BE(0) / 10, unit: 'km/h' }
      : undefined,
  0x04: (v) =>
    v.length === 2 ? { name: 'manual-alarm-id', value: v.readUInt16BE(0) } : undefined,
  0x25: (v) =>
    v.length === 4 ? { name: 'extended-signal-status', value: v.readUInt32BE(0) } : undefined,
  0x2a: (v) => (v.length === 2 ? { name: 'io-status', value: v.readUInt16BE(0) } : undefined),
  0x2b: (v) =>
    v.length === 4 ? { name: 'analogue-inputs', value: v.readUInt32BE(0) } : undefined,
  0x30: (v) =>
    v.length === 1 ? { name: 'wireless-signal-strength', value: v.readUInt8(0) } : undefined,
  0x31: (v) => (v.length === 1 ? { name: 'gnss-satellites', value: v.readUInt8(0) } : undefined),
};

/**
 * Ids the spec lists but whose value layout we deliberately do not decode.
 *
 * 0x11, 0x12 and 0x13 are alarm-detail structures, and 0xE0 is described only as
 * "custom, length-prefixed". They are documented as EXISTING, which is different
 * from being documented well enough to decode. We do not want to guess their internals
 * so their raw bytes are kept and their values left alone.
 */
const DOCUMENTED_BUT_NOT_DECODED = new Set([0x11, 0x12, 0x13, 0xe0]);

/**
 * Which of the four buckets an id falls into.
 *
 * The brief insists these are different findings: "the document reserves this id"
 * and "the document has never heard of this id" are different claims about what
 * the vendor knew. Collapsing both into one "unknown" bucket throws away the more
 * interesting half.
 */
export function classify(id: number): Classification {
  if (id in DECODERS || DOCUMENTED_BUT_NOT_DECODED.has(id)) return 'documented';
  if ((id >= 0x05 && id <= 0x10) || (id >= 0x14 && id <= 0x24)) return 'reserved';
  if (id >= 0xe1 && id <= 0xff) return 'custom-area';
  return 'unknown';
}

export interface ExtensionParse {

  readonly items: readonly ExtensionItem[];
  readonly trailingBytes: number; //Bytes at the tail too short or too inconsistent to form a complete item.
}

export function parseExtensions(tail: Buffer): ExtensionParse {
  const items: ExtensionItem[] = [];
  let offset = 0;

  while (offset < tail.length) {

    // Need at least the id and length bytes before we can go any further.
    if (offset + 2 > tail.length) break;

    const id = tail.readUInt8(offset);
    const length = tail.readUInt8(offset + 1);

    // A length that runs past the end of the body means either we have lost sync
    // or the device lied about the size. Stop rather than read out of bounds,
    // and let the remaining bytes be counted as unaccounted for.
    if (offset + 2 + length > tail.length) break;

    const raw = tail.subarray(offset + 2, offset + 2 + length);

    items.push({
      id,
      length,
      raw,
      // `?.` here means "call this only if a decoder exists for the id".
      decoded: DECODERS[id]?.(raw),
      classification: classify(id),
    });

    // Step over id, length, and the value: 2 + length bytes in total.
    offset += 2 + length;
  }

  return { items, trailingBytes: tail.length - offset };
}
