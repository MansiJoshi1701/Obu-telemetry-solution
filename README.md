# OBU telemetry — Part 1, the parser

Parses JT/T 808 frames captured from bus on-board units, and reports what it
could and could not account for.

**Status: Part 1 in progress.** Steps 1-7 of 9 are done. All four message types
PROTOCOL.md documents now decode, and the location report's alarm and status
words are expanded into named flags. Still to come: the location report's
extension items, which are the bulk of the remaining undecoded bytes.

`NOTES.md` records what was found in the data and which decisions were judgement
calls rather than instructions from the specification.

## Run it with Docker

```bash
docker build -t obu-telemetry .
```

```bash
docker run --rm obu-telemetry
```

## Run it without Docker

Needs Node 22.18 or newer — the TypeScript runs directly, there is no build
step. Check with `node --version`.

```bash
npm run parse
```

To type-check (this is the only thing the dev dependencies are for):

```bash
npm install && npx tsc
```

## What the output means

```
payload lines read   4969   header/hex line pairs found in the logs
frames seen          4950   payloads that were really JT/T 808 frames
bodies decoded       4667   bodies we have a decoder for
no decoder yet        283   the three message ids in no vendor document
check-code failures     0   frames whose XOR check did not match
undecoded bytes    238417   body bytes not yet accounted for
blank registrations       392 of 392, per the brief's warning
no GPS fix                148 of 3102, stored as null rather than 0
anomalies                   only listed when they occur
```

`undecoded bytes` is the number that matters most for this exercise, and it is
meant to be honest rather than zero. It falls again as step 8 lands. The floor is
2,665 — the three message ids that appear in no vendor document, whose bodies we
decline to guess at.

## Layout

Modules are numbered in pipeline order, so the flow is readable top to bottom.
Genuine shared helpers are not numbered.

```
src/
  01-logReader.ts   text file      ->  byte payloads
  02-transport.ts   byte payload   ->  unescaped, check-verified message
  03-header.ts      message        ->  header fields + body
  04-bodies.ts      body           ->  decoded fields, per message id
  05-report.ts      all of it      ->  the run tally
  bcd.ts            binary-coded decimal, used by 03 and 04
  flags.ts          alarm and status bit tables, used by 04
  index.ts          the pipeline, and nothing else
data/               the three capture files
PROTOCOL.md         protocol reference
NOTES.md            findings, judgement calls, known gaps
```

Read `02-transport.ts` first. Everything downstream trusts it silently: if the
unescaping or the check code were wrong, nothing would crash — you would simply
get plausible-looking values that are false.
