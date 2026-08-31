# JT/T 808 — protocol reference for this exercise

Relevant parts of the protocol required for the exercise. Please read the last section, **Known gaps** also.

---

## Transport

The OBU opens a plain TCP connection to the server and sends frames. A frame is
delimited by the marker byte `0x7E` at each end.

```
7E │ message id │ body attributes │ device id │ serial │ body │ check │ 7E
   │ 2 bytes    │ 2 bytes         │ 6 bytes   │ 2 B    │ n B  │ 1 B   │
```

All multi-byte integers are **big-endian**.

| Field | Notes |
|---|---|
| Message id | Identifies the type of the message. Message types listed below. |
| Body attributes | Bits 0–9: body length, counted **after** unescaping. Bits 10–12: encryption selector — `0` means the body is not encrypted, `1` means it is encrypted with RSA; no other value is defined. Bit 13: sub-package flag. Bits 14–15 reserved. |
| Device id | 6 bytes, **BCD** — two decimal digits per byte, left-padded. |
| Serial | Message serial number, incremented by the device. |
| Body   | The actual message. Content depends on the type of the message. |
| Check | 8-bit XOR of every byte from the first byte of the message id through the last byte of the body. The markers are excluded and the check byte itself is excluded. It is computed on the **unescaped** message — see Escaping below. |

### Escaping

`0x7E` marks the start and end of a frame, so that value cannot be allowed to
appear anywhere inside one. The sender therefore substitutes two bytes for it
before transmitting, and because the substitute marker `0x7D` now needs
protecting too, it gets the same treatment:

| Real byte | Sent on the wire as |
|---|---|
| `0x7E` | `0x7D 0x02` |
| `0x7D` | `0x7D 0x01` |

The receiver reverses this. **Unescape first, then do everything else.** The
check code, the body length in the body attributes, and every field offset in
this document all refer to the unescaped message. If you compute the check code
over the bytes exactly as they appear in the log, it will fail on every frame
that contains an escape.

A heartbeat with no escaping in it, to establish the baseline:

```
7E 0002 0000 008800000001 00BC 37 7E
   ^msg ^attr ^device     ^ser  ^check

message id 0x0002, body length 0, device 008800000001, serial 0x00BC
XOR of 0002 0000 008800000001 00BC = 0x37, which matches the check byte.
```

The same message type from another device, where the serial number happens to be
`0x007E`:

```
wire bytes       : 7E 0002 0000 008800000003 00 7D 02 F7 7E
after unescaping :    0002 0000 008800000003 00 7E    F7

The serial number is 0x007E. That 0x7E byte was sent as 7D 02 so it could
not be mistaken for a frame marker.

XOR over 0002 0000 008800000003 007E = 0xF7, matching the check byte.
Over the raw wire bytes you would get 0xF6 instead, and the frame would
look corrupt.
```

The check byte itself gets escaped when it needs to be, so a frame can legitimately
end with `7D 01 7E`:

```
wire bytes       : 7E 0002 0000 008800000004 00F3 7D 01 7E
after unescaping :    0002 0000 008800000004 00F3 7D

Here the check byte is 0x7D, sent as 7D 01. Counting backwards from the
closing marker to find it would give you 0x01, which is wrong.
```

Two consequences worth planning for: the length of a frame on the wire is not the
length of the message, and you cannot locate the check byte by counting backwards
from the closing marker until after you have unescaped.

## Messages Types

| Id | Name | Body |
|---|---|---|
| `0x0002` | Terminal heartbeat | Empty. |
| `0x0100` | Terminal registration | See below. |
| `0x0102` | Terminal authentication | Authentication code, ASCII. |
| `0x0200` | Location report | See below. |

The server is expected to answer registration with `0x8100` and everything else
with a general response `0x8001`. **The server that produced these captures did
not answer anything.** You are not asked to write a server, but it is worth
knowing when you look at the data.

### `0x0100` registration body

| Offset | Length | Field |
|---|---|---|
| 0 | 2 | Province id |
| 2 | 2 | City id |
| 4 | 5 | Manufacturer id, ASCII |
| 9 | 20 | Terminal model, ASCII, null-padded |
| 29 | 7 | Terminal id, ASCII, null-padded |
| 36 | 1 | Plate colour. `0` means no plate assigned yet. |
| 37 | .. | Registration plate, ASCII |

### `0x0200` location body

| Offset | Length | Field | Units |
|---|---|---|---|
| 0 | 4 | Alarm word | bit flags, see below |
| 4 | 4 | Status word | bit flags, see below |
| 8 | 4 | Latitude | degrees × 10⁶ |
| 12 | 4 | Longitude | degrees × 10⁶ |
| 16 | 2 | Altitude | metres |
| 18 | 2 | Speed | 1/10 km/h |
| 20 | 2 | Heading | degrees, 0 = north, clockwise |
| 22 | 6 | Timestamp | BCD `YYMMDDhhmmss` |
| 28 | .. | Extension items | see below |

Hemisphere is carried in status bits 2 and 3, not in the sign of the coordinate.

#### Status word bits

| Bit | 0 | 1 |
|---|---|---|
| 0 | ACC off | ACC on |
| 1 | Not positioned | Positioned |
| 2 | North latitude | South latitude |
| 3 | East longitude | West longitude |
| 4 | Operational | Outage |
| 5 | Lat/lon not encrypted | Encrypted by security plugin |
| 8–9 | Load state: 0 empty, 1 half, 2 reserved, 3 full | |
| 10 | Oil path normal | Oil circuit disconnected |
| 11 | Vehicle circuit normal | Vehicle circuit abnormal |
| 12 | OBU door unlocked | OBU door locked |
| 13–17 | Doors 1–5 closed (front, middle, back, driver, custom) | open |
| 18 | GPS not used for fix | GPS used for fix |
| 20 | No GLONASS | Positioning with GLONASS |
| 21 | No Galileo | Positioning with Galileo |

**Bit 1 is the one that decides whether the rest of the position is meaningful.**

#### Alarm word bits

| Bit | Meaning | Bit | Meaning |
|---|---|---|---|
| 0 | Emergency alarm | 19 | Over-time parking |
| 1 | Over-speed | 20 | In/out of area |
| 2 | Fatigue driving | 21 | In/out of route |
| 3 | Danger warning | 22 | Section travel time abnormal |
| 4 | GNSS module failure | 23 | Route deviation |
| 5 | GNSS antenna cut | 24 | Vehicle VSS failure |
| 6 | GNSS antenna short circuit | 25 | Abnormal oil quality |
| 7 | Main power under voltage | 26 | Vehicle stolen |
| 8 | Main power off | 27 | Illegal ignition |
| 9 | BDC failure | 28 | Illegal displacement |
| 10 | TTS module failure | 29 | Collision warning |
| 11 | Camera failure | 30 | Rollover warning |
| 13 | Speed warning | 31 | Illegal door opening |
| 14 | Fatigue driving warning | | |
| 18 | Daily driving time exceeded | | |

Bits not listed are reserved.

#### Location extension items

From offset 28 to the end of the body, the location report carries a sequence of
items. Each is a one-byte **id**, a one-byte **length**, then that many bytes of
value. They run back to back until the body is exhausted.

Documented ids (spec Table 27):

| Id | Length | Meaning |
|---|---|---|
| `0x01` | 4 | Mileage, 1/10 km — the odometer |
| `0x02` | 2 | Fuel quantity, 1/10 L |
| `0x03` | 2 | Speed from the driving recorder, 1/10 km/h |
| `0x04` | 2 | Manual alarm event id |
| `0x11` | 1 or 5 | Over-speed alarm detail |
| `0x12` | 6 | Area/route alarm detail |
| `0x13` | 7 | Route travel-time alarm detail |
| `0x25` | 4 | Extended vehicle signal status bits |
| `0x2A` | 2 | IO status |
| `0x2B` | 4 | Analogue inputs |
| `0x30` | 1 | Wireless signal strength |
| `0x31` | 1 | GNSS satellite count |
| `0xE0` | var | Custom, length-prefixed |

Ranges `0x05`–`0x10` and `0x14`–`0x24` are marked **Reserved** by the
specification. `0xE1`–`0xFF` is a custom area implementers may use freely.

The device may send ids that are in neither category. Treat "the document
reserves this id" and "the document does not mention this id at all" as different
findings — they are different claims about what the vendor knows.

---

## Known gaps

This extract is not the whole protocol, and it does not perfectly describe the
device that produced these captures. Specifically:

- **This document describes more than the device actually sends.** Several
  documented extension items never appear in these captures, and most of the
  documented status and alarm bits are never set. A code path the data never
  exercises is a code path you have not tested — say so in `NOTES.md` rather
  than assuming it works.
- **The device sends things this document does not describe.** That includes
  extension item ids that fall outside both the reserved ranges and the custom
  area, and message ids that appear in no vendor document we hold. Decide what
  your parser does with them and record the decision. As noted above, "the
  document reserves this id" and "the document has never heard of this id" are
  different findings.
- **Not everything arriving on this port is JT/T 808.** `data/day1/capture-14.log`
  contains records from hosts on the internet that found the listening port open.
  They are not frames and must not be decoded as frames. Note that they do
  contain `0x7E` bytes, so a parser that scans for markers without validating
  what it finds will happily sync onto them. The two day 2 captures do not
  contain this traffic.
- **Some of the anomalies in the data are real.** Not every value that looks
  wrong is a bug in your parser. Where something decodes consistently but reads
  implausibly, treat it as a property of the fleet and write it down.

Where the document and the data disagree, **the data wins**. Note it in
`NOTES.md` when it happens; those notes are part of what we are assessing.
