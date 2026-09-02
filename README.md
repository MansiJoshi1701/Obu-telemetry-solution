# OBU telemetry — Part 1, the parser

Parses JT/T 808 frames captured from bus on-board units, and reports what it
could and could not account for.

**Status: Part 1 in progress.** Steps 1-4 of 9 are done: the log files are read,
frames are unescaped and check-verified, headers are decoded, and the
`0x0002` and `0x0102` bodies are decoded. Registration (`0x0100`) and location
(`0x0200`) bodies are not decoded yet, which is why the undecoded byte count is
still large.

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
bodies decoded       1173   bodies we have a decoder for
no decoder yet       3777   bodies awaiting steps 5-8, or undocumented types
check-code failures     0   frames whose XOR check did not match
undecoded bytes    340169   body bytes not yet accounted for
anomalies                   only listed when they occur
```

`undecoded bytes` is the number the exercise turns on, and it is meant to be
honest rather than zero. It falls as steps 5-8 land. The floor is the three
message ids that appear in no vendor document.

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
  bcd.ts            binary-coded decimal, used by 03 and later by 06
  index.ts          the pipeline, and nothing else
data/               the three capture files
PROTOCOL.md         protocol reference
```

Read `02-transport.ts` first. Everything downstream trusts it silently: if the
unescaping or the check code were wrong, nothing would crash — you would simply
get plausible-looking values that are false.
