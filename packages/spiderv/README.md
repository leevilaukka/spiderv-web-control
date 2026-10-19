# spiderv-protocol

Client library for Line 6 Spider V guitar amps, speaking the amp's SysEx protocol over USB MIDI.
Reverse-engineered, unofficial and not affiliated with Line 6. Tested with a Spider V 20 MkII on
firmware 2.0.1; other models and firmware may differ, so expect breaking changes before 1.0.

It is the protocol layer of [Spider V Web Control](https://github.com/leevilaukka/spiderv-web-control),
a browser editor for the amp. The wire format is documented in that repository's
[PROTOCOL.md](https://github.com/leevilaukka/spiderv-web-control/blob/main/PROTOCOL.md).

```sh
npm install spiderv-protocol
npm install @julusian/midi   # only for Node and Bun (see "Transports")
```

ESM only, with TypeScript types included.

## Quick start

Node or Bun:

```ts
import { SpiderV } from 'spiderv-protocol/client';
import { NodeMidiTransport } from 'spiderv-protocol/nodemidi';

const amp = new SpiderV(await NodeMidiTransport.connect());
await amp.connect(); // identity, firmware version, symbol-table handshake

console.log(amp.presetCount, 'presets, now on', await amp.currentPresetIndex());
console.log(await amp.presetName(0));

await amp.loadPreset(5);
await amp.setTempo(96);
await amp.close();
```

Browser (Chromium or Chrome; Web MIDI needs a secure context and the user's permission for SysEx):

```ts
import { SpiderV } from 'spiderv-protocol/client';
import { WebMidiTransport } from 'spiderv-protocol/webmidi';

const amp = new SpiderV(await WebMidiTransport.connect());
await amp.connect();
```

Call `connect()` on the client before anything else. The amp answers one request at a time per
channel, so calls made together are queued, not sent in parallel. Failed calls throw `AmpError`
(with the amp's `status` code when it gave one) or time out after a few seconds.

## Imports

| Entry | What it has |
| --- | --- |
| `spiderv-protocol/client` | `SpiderV`, the `Transport` interface, `AmpError`, `LogEntry` |
| `spiderv-protocol/codec` | SysEx framing, message and preset encoding, constants (`MsgType`, `PresetKey`, ...) |
| `spiderv-protocol/hub` | `Hub`: share one amp connection between several clients |
| `spiderv-protocol/webmidi` | `WebMidiTransport` for browsers |
| `spiderv-protocol/nodemidi` | `NodeMidiTransport` for Node and Bun |
| `spiderv-protocol/framing` | `SysexFramer`, for building your own transport |
| `spiderv-protocol` | all of the above |

## The `SpiderV` client

### State after `connect()`

| Property | Meaning |
| --- | --- |
| `presetCount` | number of preset slots (128 on the Spider V 20 MkII) |
| `version` | the amp's protocol version |
| `symbols` | the firmware's `SymbolTable`, mapping names such as parameter and model names to numeric ids |
| `name(id)` | the symbol name for an id (the hex id if unknown), handy for logging |

### Presets

| Method | Does |
| --- | --- |
| `presetName(index)` | name of a slot |
| `loadPreset(index)` | make the amp switch to a slot |
| `currentPresetIndex()` | the slot the amp is on |
| `isDirty()` | whether the edit buffer has unsaved changes |
| `readPreset(index = -1)` | parsed preset; `-1` is the edit buffer (the current tone with unsaved edits) |
| `readPresetData(index = -1)` | the raw preset file bytes |
| `writePresetData(index, data)` | write raw preset bytes to a slot (or `-1` for the edit buffer) |
| `savePreset(index, meta?)` | save the edit buffer to a slot, optionally with a new name or `{ name, label, tnid }`. **Overwrites the slot**; returns its previous contents so you can undo |

### Editing the tone

Parameters and models are addressed by symbol id. Look ids up in `amp.symbols` or take them from
a parsed preset.

```ts
const preset = await amp.readPreset(); // the edit buffer
for (const block of preset.tone?.children ?? []) {
  console.log(amp.name(block.id), '->', amp.name(block.model));
}

// Read and set one knob. obj is a block id, param a parameter id.
const obj = preset.tone!.children[0].id;
const param = amp.symbols!.id('<parameter name>')!; // list the names with amp.symbols.names
const v = await amp.getParam(obj, param);               // { type, value }
await amp.setParam(obj, param, { type: v.type, value: 0.5 });
```

| Method | Does |
| --- | --- |
| `getParam(obj, param)` / `setParam(obj, param, { type, value })` | one parameter, typed with `MsgType.Float`, `Int` or `Bool` |
| `loadModel(slot, model)` | put a model (amp, effect, cab, ...) into a slot of the chain |
| `setTempo(bpm)` | the global tempo |
| `getPresetKey(key)` / `setPresetKey(key, value)` | edit-buffer preset settings that live outside the tone blocks (`PresetKey`: tempo, label, speaker mode, ...) |

Edits go to the amp's edit buffer. Nothing is stored in a slot until you `savePreset`.

### Events

```ts
const off = amp.on('param', (p) => console.log(amp.name(p.obj), amp.name(p.param), p.value));
amp.on('disconnect', () => console.log('amp gone'));
amp.on('log', (e) => console.log(e.dir, e.text)); // every message, in and out
off();
```

| Event | When |
| --- | --- |
| `param` | a knob was turned (or changed) on the amp itself |
| `event` | any other unsolicited message from the amp (raw bytes) |
| `disconnect` | the transport closed or the cable was unplugged |
| `log` | a message was sent or received (`dir` is `in`, `out` or `info`) |

### Faster reconnects

The handshake needs the firmware's symbol table, which is large and slow to download (up to about
30 s). The amp accepts the table only if it matches its own, so you can keep it between runs:

```ts
const amp = new SpiderV(transport, savedTableBytes); // tried before downloading
await amp.connect();
const toSave = amp.symbols!.bytes;                   // store this for next time
```

## Transports

A `Transport` moves SysEx bytes and nothing else, so the client works over anything that can:

```ts
interface Transport {
  label: string;
  onsysex: (bytes: number[]) => void;      // set by the client; call it once per complete F0..F7 message
  ondisconnect: (err?: unknown) => void;   // set by the client; call it when the link drops
  send(bytes: number[]): void;
  close(): Promise<void>;
}
```

- **`WebMidiTransport.connect()`** finds the port named "Spider V ..." and opens it with SysEx.
  Check `WebMidiTransport.supported()` first. It throws a readable error if MIDI access is denied
  or no amp is found.
- **`NodeMidiTransport.connect()`** does the same through
  [`@julusian/midi`](https://www.npmjs.com/package/@julusian/midi), which is an optional peer
  dependency (prebuilt binaries for Linux, macOS and Windows). Without it, `connect()` throws
  with install instructions.
- **Your own**: implement the interface, for example over a raw MIDI device, a WebSocket relay or a
  recording for tests. If your MIDI source hands over arbitrary chunks of bytes, feed them to a
  `SysexFramer` (from `spiderv-protocol/framing`), which calls you back with each complete message.

## Sharing one amp: `Hub`

Only one program can talk to the amp at a time, and the amp's replies do not say who asked. `Hub`
sits on the real transport and hands out ports that look like transports of their own. It sends
the requests one by one and routes each reply back to whoever asked. Unsolicited events go to
every port.

```ts
import { Hub } from 'spiderv-protocol/hub';

const hub = new Hub(await NodeMidiTransport.connect());
const a = new SpiderV(hub.port('local'));
const b = new SpiderV(hub.port('phone'));
await Promise.all([a.connect(), b.connect()]);
```

The web app uses this to let phones control the amp through the browser it is plugged into.

## Lower level: `codec`

`codec` has the pure functions and constants the client is built on, with no I/O:
`encodeSysex`/`parseSysex`, `pack7`/`unpack7` (the 7-bit packing MIDI needs), `crc32`,
`parsePreset`, `parseEntries`/`serializeEntries`, `setPresetMeta`, `SymbolTable` and the
`Channel`, `EditorCmd`, `LibrarianCmd`, `MsgType` and `PresetKey` tables. Use it for offline work
such as reading preset dumps, or to send commands the client has no method for with
`amp.request(...)`.

## Not included

The model catalog (names, value ranges and descriptions of the amp, effect and cab models) is
Line 6's and is not part of this package. The amp does not report knob ranges itself. Apps need
to load a catalog extracted from your own copy of Line 6's Spider V Remote app. See the web app's
README for how it does that.

## Safety

- `savePreset`, `writePresetData` and `loadPreset` change what is stored or playing on the amp.
  Read a slot with `readPresetData` and keep it before overwriting.
- The protocol is reverse-engineered. Test new commands on a preset you can lose, and don't send
  raw commands you don't understand.

## Licence

MIT. Line 6 and Spider V are trademarks of their owners; this project is not affiliated with or
endorsed by Line 6.
