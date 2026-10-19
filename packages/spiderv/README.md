# spiderv-protocol

Client library for Line 6 Spider V guitar amps, speaking the amp's SysEx protocol over USB MIDI.
Reverse-engineered, unofficial and not affiliated with Line 6. Tested with a Spider V 20 MkII on
firmware 2.0.1; other models and firmware may differ, so expect breaking changes before 1.0.

```ts
import { SpiderV } from 'spiderv-protocol/client';
import { WebMidiTransport } from 'spiderv-protocol/webmidi';
```

- `codec`: SysEx framing, message and preset encoding
- `client`: handshake, request/reply, events, over any `Transport`
- `hub`: lets several clients share one amp connection
- `webmidi`: a `Transport` for browsers
- `nodemidi`: a `Transport` for Node and Bun, over the optional `@julusian/midi` package (`npm install @julusian/midi`)

The model catalog (names and knob ranges) is Line 6's and is not included.
The protocol notes are in the repository's PROTOCOL.md.
