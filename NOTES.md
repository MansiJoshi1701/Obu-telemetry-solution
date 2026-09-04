# NOTES

Working notes, written as the parser is built. Every number below is produced by
`npm run parse` or was measured with a throwaway script against the same data —
none of it is read off the specification.

**Status: Part 1 decoding complete (steps 1-8 of 9).** All four documented
message types decode, the alarm and status words are expanded into named flags,
and the location report's extension items are split into id, length and value
with the documented ids decoded.

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

These are kept as verified frames with the body reported as undecoded. We have
not guessed at field layouts for them. They account for 2,665 bytes, which is the
floor the undecoded count can reach once the location decoder lands.

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

## Not done

- Steps 6-8: the `0x0200` location body — fixed fields, alarm and status bit
  flags, coordinate conversion, and the extension items.
- Step 9: the final tally and a `0x0FF0` / `0x0107` write-up.
- Part 2 (store) and Part 3 (render).
- Tests, which are out of scope for this submission by agreement.
