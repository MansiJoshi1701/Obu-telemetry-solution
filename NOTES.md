# NOTES

Working notes, written as the parser is built. Every number below is produced by
`npm run parse` or was measured with a throwaway script against the same data —
none of it is read off the specification.

**Status: Part 1 complete.** All four documented message types decode, the alarm
and status words are expanded into named flags, and the location report's
extension items are split into id, length and value with the documented ids
decoded. Parts 2 and 3 are not built; the design work for Part 2 and the volume
arithmetic are at the end of this file. Tests are out of scope by agreement.

---

## Decisions that needed a judgement call

### Null padding on the manufacturer id — going beyond what the spec states

`PROTOCOL.md` marks exactly two registration fields as null-padded:

```
| 9  | 20 | Terminal model, ASCII, null-padded |
| 29 | 7  | Terminal id, ASCII, null-padded    |
```

It says nothing about padding for **manufacturer id** (offset 4, 5 bytes) or the
**registration plate** (offset 37, variable). We strip trailing nulls from all
four anyway. The reasoning:

- Manufacturer id is **fixed-width**. A 5-byte slot holding a 3-character id has
  two bytes that must contain *something*, because the field cannot shrink
  without moving every offset after it. The spec does not name the filler, but
  null is the convention it states two rows below, in the same table, for the
  same message. Reading those bytes as content would produce an id that prints
  correctly and never compares equal to itself.
- The plate is variable-length and runs to the end of the body, so there is
  nothing to pad. Stripping there is a no-op, kept only for uniformity.

**This is inference, not instruction.** We cannot settle it from the data,
because every registration body in these captures is entirely zero bytes, so
both readings give the same empty string. Recording it here because a decision
made on reasoning rather than evidence should be visible.

We do **not** trim whitespace. The spec never mentions space padding and there is
no evidence of any, so trimming would have been unfounded tidying.

### Why stripping matters at all

Without it, a 20-byte field of nulls decodes to a 20-character string rather than
an empty one, and the "all identifying fields blank" check would report **0 of
392** instead of 392 of 392 — the exact opposite of the truth, with no error
raised anywhere.

### Plate colour is excluded from the "blank" test

The spec gives plate colour `0` a real meaning: *no plate assigned yet*. So a
zero there is a measurement, not a missing value, and it is deliberately not part
of `isBlankRegistration`. Every other zero in these bodies is the anonymisation.

### Rejecting non-frames by requiring `0x7E` at both ends

`PROTOCOL.md` warns that other traffic reaches this port and that it contains
`0x7E` bytes. We require the marker at the **start and end** of a payload rather
than scanning for markers anywhere, which is what stops the parser syncing onto
that traffic and inventing frames from it.

---

## Findings from the data

### Check-code failures: none

All 4,950 well-formed frames verify. The rejection path is implemented but
**never exercised by this data**, and with tests out of scope it is unexercised
full stop. Worth saying plainly rather than implying it was validated.

Confidence that the unescaping is right rests on something stronger than a
self-written test: **2,124 frames (42.9%) contain at least one escape** — 1,837
`7D 02` and 303 `7D 01`, so both branches are covered — and every one passes a
check code the *device* computed over the unescaped bytes. A round-trip test
would only have proved our own two functions agreed with each other.

### 19 payloads are not JT/T 808 at all

All in `data/day1/capture-14.log`. They begin `160301…`, a TLS record header
(content type 22 handshake, version 3.1) — internet hosts finding the open port
and attempting a TLS `ClientHello`. Neither day-2 capture contains any.

### Three message ids appear in no vendor document

| Id | Count | What it appears to be |
|---|---|---|
| `0x0B12` | 278 | Body is the ASCII text `{"ES":1}\n` — JSON, byte-identical every time |
| `0x0FF0` | 3 | Not decoded |
| `0x0107` | 2 | Not decoded |

These are kept as verified frames with the body reported as undecoded. They
account for the 2,665 undecoded bytes. What follows is what we found by looking
at them, not what the parser claims to know -- none of it is implemented.

**`0x0FF0` — 3 frames, 24 bytes each, from devices `…0004` and `…0008`.**
The first 12 bytes read as two valid BCD `YYMMDDhhmmss` timestamps:

| t1 | t2 | arrived | tail |
|---|---|---|---|
| 26-08-04 07:45:24 | 26-08-04 13:28:47 | 13:28:51 | all zero |
| 26-08-04 08:01:12 | 26-08-04 13:38:51 | 13:38:54 | all zero |
| 26-08-04 07:43:18 | 26-08-04 14:26:27 | 14:26:29 | `0x3A` at offset 19 |

In all three the second timestamp is 2-4 seconds before the frame arrived, and
the first is early that morning. That is consistent with a session or trip
summary carrying a start time and a current time, and the 12-byte tail with one
non-zero byte in one frame is consistent with counters.

**Consistent with is not the same as confirmed.** Three samples, no vendor
document, and no way to check the reading against anything. Not implemented.

**`0x0107` — 2 frames, 50 and 41 bytes, from devices `…0007` and `…0008`.**
The body walks cleanly as TLV with a one-byte id and a one-byte length — the
same shape as the location report's extension items:

```
id=0x07 len= 1  01
id=0x00 len= 2  0100
id=0x03 len=20  "89910000000000000001"      <- an ICCID
id=0x0A len=10  "DL0PA0001X"                <- a registration plate
id=0x0B len= 1  00
id=0x0C len= 1  00
id=0x0D len= 1  00
```

The evidence for the structure is strong: **two bodies of different lengths, 50
and 41, both consumed exactly, with 0 bytes left over.** A wrong structure would
almost certainly overrun or leave a remainder on at least one of them. The second
frame differs only in `0x0A`, which is 1 zero byte instead of a plate string.

What the ids *mean* is inference from their contents, not from any document, so
the parser does not name them. Both values look like pseudonyms of the kind the
brief describes.

`0x0B12` is also where the escaping shows up most vividly: the closing brace of
the JSON is byte `0x7D`, which is the protocol's own escape marker, so the device
must send it as `7D 01`.

### The protocol defines features this device never uses

Across all 4,950 frames: **0 encrypted bodies, 0 sub-package frames, 0
body-length mismatches, 0 invalid device ids.** Those code paths exist and are
untested by real data.

### All 286 authentication codes are the same string

Every device authenticates with `123456`. Most likely an artifact of the
anonymisation, but it is what the data contains.

### All 392 registration bodies are identical and entirely zero

38 bytes, every byte `0x00`, one distinct body across the whole dataset. The
brief warns about this, and the parser decodes them anyway rather than skipping
them.

### One device is stuck in a registration loop

Device `008800000005` sent **380 frames, all of them `0x0100` registrations** —
no heartbeat, no location, ever. That is 97% of every registration in the
dataset; the other seven devices send between 1 and 3 each.

`PROTOCOL.md` notes the capturing server never answered anything, so this device
is retrying registration forever waiting for an `0x8100` that never arrives. Real
device behaviour, not a parser artifact.

### The device clock and the collector clock share a timezone

Comparing each GPS timestamp against its arrival time, both read as plain
wall-clock readings, the smallest difference is **-2 seconds**. If the GPS
reading were UTC while the collector logged in IST, every difference would sit
near 19,800 seconds. It does not. So whatever zone the collector wrote in, the
device's clock agrees with it.

### Reports arrive long after they were measured

The same comparison has a long tail: median 1,741 s and a maximum of 350,732 s
(about four days) between a GPS timestamp and the arrival of a frame carrying it.
Fresh reports arrive within seconds, so the tail is the device resending buffered
records.

This is direct evidence for the brief's Part 2 warning that the same record
arrives many times and that arrival time is a trap for de-duplication: arrival
time describes the network, not the measurement.

### 148 location reports have no GPS fix

Status bit 1 is clear on 148 of 3,102 location reports, and their coordinate
bytes are zero. The parser stores `null`, not `0`. Storing zero would place those
buses in the Atlantic off Ghana -- a real place on a real map, with no error
raised anywhere.

Decoded positions otherwise fall in a box of roughly 28.5077-28.5710 N,
77.1514-77.2320 E, with a maximum speed of 40 km/h and altitudes near 214 m.
That is Delhi at city-bus speeds, which is what makes the field offsets
believable: one byte of drift would have produced nonsense rather than something
plausible.

### Only 3 status bits and 1 alarm bit are ever set

`PROTOCOL.md` warns in its Known gaps section that "most of the documented status
and alarm bits are never set". Across all 3,102 location reports, the exact
figures are:

| Status word | Count | Bits set |
|---|---|---|
| `0x00040003` | 2952 | acc-on, positioned, gps-in-use |
| `0x00040001` | 146 | acc-on, gps-in-use |
| `0x00040000` | 2 | gps-in-use |
| `0x00040002` | 2 | positioned, gps-in-use |

| Alarm word | Count | Bits set |
|---|---|---|
| `0x00000000` | 2969 | none |
| `0x00000010` | 133 | gnss-module-failure |

So of roughly twenty documented status bits only three ever appear (0, 1 and 18),
and of twenty-eight documented alarm bits only one (bit 4). Every other named
flag in `flags.ts` is a code path this data never exercises.

The two words are consistent with each other: all 133 GNSS-failure reports also
have status bit 1 clear, so the device reports the fault and then declines to
report a position rather than contradicting itself.

Reserved bits are reported as `reserved-bit-N` rather than dropped, so a device
setting one would be visible. None does.

### Load state cannot be distinguished from "not implemented"

Status bits 8-9 are `00` on every report, which the spec reads as "empty".
Unlike the GPS case there is no second bit saying whether the sensor works, so
"the bus is empty" and "the load sensor is not wired up" are indistinguishable
here. Recorded because it is the same *zero is not a measurement* problem, in a
case where the data cannot settle it.

### Extension items: three different findings, kept apart

Every one of the 3,102 location reports carries the **same 17 extension items**,
in the same order. The brief insists that "the document reserves this id" and
"the document has never heard of this id" are different claims, so the parser
tags them separately:

| Bucket | Ids | Count |
|---|---|---|
| Documented and decoded | `0x01` `0x03` `0x25` `0x30` `0x31` | 5 |
| In a range the spec marks **Reserved** (`0x14`-`0x24`) | `0x14` `0x15` `0x16` `0x17` `0x18` `0x1A` `0x24` | 7 |
| **Mentioned nowhere** in the spec | `0x28` `0x41` `0x42` `0x43` `0x50` | 5 |

The last five fall outside both the reserved ranges *and* the `0xE1`-`0xFF`
custom area the spec leaves free for implementers. The vendor is using id space
the document does not account for at all.

**Documented ids that never appear:** `0x02` fuel, `0x04` manual alarm, `0x11`,
`0x12`, `0x13`, `0x2A`, `0x2B`, `0xE0`. Their decoders are written and completely
untested by real data.

We do not decode `0x11`, `0x12`, `0x13` or `0xE0` even though the spec lists
them: they are documented as *existing* rather than described well enough to
decode, and guessing at their internals is the fabrication the brief warns
against.

### One undocumented field causes nearly all the escaping

Extension `0x41` takes exactly two values, `0x0080` and **`0x007E`**. `0x7E` is
the frame marker, so whenever that field holds `007E` the device must send it as
`7D 02`.

- Location reports containing an escape: **1,820**
- Of those, reports where `0x41` == `007E`: **1,803**

So essentially all the escaping in this dataset traces to one two-byte field that
appears in no vendor document, whose value happens to collide with the frame
delimiter.

### 12 of 17 extension ids never vary

Constant across all 3,102 reports: `0x14` `0x15` `0x16` `0x24` `0x25` = `00000000`,
`0x17` `0x18` `0x43` `0x50` = `0000`, `0x28` `0x30` = `00`, and `0x1A` = `01`.

The sharpest case is **`0x30`, wireless signal strength — documented, decoded,
and always zero.** A device transmitting over a mobile network cannot have zero
signal, so this reads as a field that is not wired up rather than a measurement
of nothing.

That gives three states a Part 2 schema would have to keep apart:

| State | Example |
|---|---|
| measured, varies | `0x01` mileage, 95.2 to 38,598.4 km, 403 distinct values |
| sent but never varies | `0x30` signal strength, always 0 |
| never sent at all | `0x02` fuel, absent entirely |

**Fields that do vary**, and are therefore candidates for a Part 3 time series:
`0x01` mileage (403 distinct, monotonic per device), `0x03` recorder speed (36),
`0x31` satellite count (0-16, 8 distinct), `0x42` (7), `0x41` (2).

### Two byte counts, reported separately

The run reports two numbers rather than one, because they are different
admissions:

- **`undecoded bytes` = 2,665.** Bytes with no account at all -- the bodies of
  the three message ids no vendor document describes.
- **`uninterpreted bytes` = 93,060.** TLV values we located exactly (id, length,
  offset all known, raw bytes kept) but whose meaning we do not know.

Together, **95,725 bytes are not claimed as understood**. Folding them into one
figure would hide the difference between "we could not parse this" and "we parsed
it and cannot read it".

### Device ids

Eight devices, numbered `…0001` and `…0003` through `…0009`. There is no
`…0002`. Expected in pseudonymised data, but noted so the gap is not mistaken
for dropped frames.

---

## Known gaps and assumptions

- **Timezone.** Neither the collector's arrival timestamps nor the device's GPS
  timestamps carry a timezone. We now know the two are in the *same* zone,
  whichever it is (see the finding below), but not which zone that is. The GPS
  timestamp is built with `Date.UTC` so the parsed value is identical on every
  machine rather than varying with the parser's own clock; that is a labelling
  choice for determinism, not a claim about the real zone.
- **Whole files are read into memory.** Fine for these 1.1 MB captures. At the
  fleet scale the brief describes — roughly 39 KB per bus per hour, so about
  2 GB/day across 3,300 buses — this would need to stream instead.
- **`toString('ascii')` masks the high bit** rather than rejecting bytes above
  `0x7F`, so `0xC1` would silently become `"A"`. We do not guard against it; the
  run reports every distinct authentication code seen, which would make such
  corruption visible instead of hidden.

---

## Part 2, designed but not built

Part 2 is not implemented. The brief asks for a schema, a de-duplication key and
the volume arithmetic, so what follows is the design and the evidence for it
rather than a description of code that exists.

### De-duplication key: `(device_id, message_type, gps_timestamp)`

The brief says arrival time and message serial number are both traps. They are,
for opposite reasons, and both are measurable in this data.

**Arrival time fails because it describes the network, not the measurement.**
2,263 of the 4,969 payload lines — 45% — are byte-identical repeats. The same
measurement arriving twice gets two different arrival times, so arrival time
makes duplicates look distinct. It is also not stable across a re-ingest.

**The serial number fails worse, because it makes distinct records look
identical.** Devices reconnect and restart the counter. Measured per device:

| Device | Frames | Distinct serials | Times the serial went *down* |
|---|---|---|---|
| `…0001` | 237 | 160 | 38 |
| `…0003` | 997 | 487 | 104 |
| `…0004` | 874 | 360 | 98 |
| `…0006` | 822 | 406 | 86 |
| `…0008` | 768 | 233 | 85 |
| `…0009` | 712 | 325 | 77 |

A counter that decreases 104 times is not an identifier.

**Tested on the 3,102 location reports:**

| Candidate key | Groups | Groups containing genuinely *different* bodies |
|---|---|---|
| `device + gps_timestamp` | 896 | **0** |
| `device + serial` | 842 | **55** |

`device + serial` would silently merge 55 pairs of real, distinct measurements.
`device + gps_timestamp` merges nothing that differs anywhere in this dataset.

Message type is in the key because a heartbeat and a location report from the
same device in the same second are different facts.

**Unresolved:** heartbeats and registrations carry no GPS timestamp, so this key
does not extend to them. The options are a separate table per message type, or
falling back to a hash of the frame body. Not decided, and it would be dishonest
to present the key as complete when a third of the frames fall outside it.

### Distinguishing "measured as zero" from "never measured"

Three states have to survive into storage, and the data contains all three:

| State | Example | Proposed storage |
|---|---|---|
| Measured, varies | `0x01` mileage, 403 distinct values | a column, `NOT NULL` |
| Measured but constant | `0x30` signal strength, always `0` | a column, value `0` |
| Never sent | `0x02` fuel, absent entirely | `NULL` |
| No fix, so not measurable | lat/lon on 148 reports | `NULL`, never `0` |

The rule: **`NULL` means the device did not tell us; a value means it did.** The
parser already enforces this at the type level — `latitude: number | null` cannot
be read without handling the null case.

Storing the 17 extension items as 17 columns per row would mean writing 12
constant values on every row forever. A key/value child table keyed on
`(device_id, gps_timestamp, extension_id)`, holding the raw bytes plus the
decoded value where we have one, keeps the "never sent" case naturally as an
absent row.

### Volume at 3,300 buses

Measured from the busiest capture hour, `data/day2/capture-14.log`: 3,203
payloads and 275,167 bytes in one hour from 8 devices.

| | |
|---|---|
| Per bus per hour | ~400 frames, ~34 KB |
| Per bus per 16-hour day | ~6,400 frames, ~550 KB |
| 3,300 buses per day | ~21 million frames, ~1.8 GB |
| One year | **~7.7 billion frames, ~660 GB of raw payload** |

Those are pre-de-duplication figures, and 45% of payloads here are exact repeats,
so the stored row count would be nearer 4 billion a year.

**Where the design breaks:**

- Reading whole files into memory, which `01-logReader.ts` does, stops working
  the moment a capture is larger than RAM. It has to become a streaming read.
- A single table at 4 billion rows a year needs time partitioning to keep the
  de-duplication index from dominating write cost. Monthly partitions on
  `gps_timestamp` would keep each index to a workable size.
- The de-duplication check is a lookup on every insert. At 21 million frames a
  day that is the hot path, and it is the first thing that would need batching
  rather than row-at-a-time inserts.
- 12 of 17 extension items never vary. Storing them per row wastes roughly
  70% of the extension table. They belong in a per-device table that records
  the constant, with the child table holding only what changes.

---

## Not done

- Decoding the bodies of `0x0B12`, `0x0FF0` and `0x0107`. What we found by
  inspecting them is written up above; none of it is implemented, because
  naming fields on 2 or 3 samples with no vendor document would be a guess.
- Part 2 (store) and Part 3 (render).
- Tests, which are out of scope for this submission by agreement.
