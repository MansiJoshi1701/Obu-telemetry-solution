# NOTES

Working notes, written as the parser is built. Every number below is produced by
`npm run parse` or was measured with a throwaway script against the same data —
none of it is read off the specification.

**Status: Part 1, steps 1-5 of 9 done.** Registration and the simple bodies are
decoded; the location report (`0x0200`) is not yet.

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

### Device ids

Eight devices, numbered `…0001` and `…0003` through `…0009`. There is no
`…0002`. Expected in pseudonymised data, but noted so the gap is not mistaken
for dropped frames.

---

## Known gaps and assumptions

- **Timezone.** The collector's arrival timestamps carry no timezone, so
  `arrivedAt` is built in the local timezone of whatever machine runs the parser.
  We are not guessing at the real one. This has to be settled before arrival
  times are ever compared against the GPS timestamps inside `0x0200` bodies.
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
