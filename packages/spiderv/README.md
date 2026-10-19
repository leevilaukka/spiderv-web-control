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
| `spiderv-protocol/catalog` | the model catalog types, `catalogFromApk`, `buildCatalog`, `validCatalog`, lookups |
| `spiderv-protocol/nodecatalog` | `loadCatalog(path)` and `saveCatalog` for Node and Bun |
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
import { typed, MsgType } from 'spiderv-protocol/codec';

const preset = await amp.readPreset(); // the edit buffer
for (const block of preset.tone?.children ?? []) {
  console.log(amp.name(block.id), '->', amp.name(block.model));
}

// Read and set one knob. obj is a block id, param a parameter id.
const obj = preset.tone!.children[0].id;                 // a BlockId
const param = amp.symbols!.param('<parameter name>')!;   // a ParamId; list the names with amp.symbols.names
const switchParam = amp.symbols!.param('<a bool parameter>')!;
const v = await amp.getParam(obj, param);                // { type: Float, value: 0.42 }
await amp.setParam(obj, param, typed(MsgType.Float, 0.5));
await amp.setParam(obj, switchParam, { type: MsgType.Bool, value: false }); // bool parameters take booleans
```

| Method | Does |
| --- | --- |
| `getParam(obj, param)` / `setParam(obj, param, { type, value })` | one parameter, typed with `MsgType.Float`, `Int` or `Bool` |
| `loadModel(slot, model)` | put a model (amp, effect, cab, ...) into a slot of the chain |
| `setTempo(bpm)` | the global tempo |
| `getPresetKey(key)` / `setPresetKey(key, value)` | edit-buffer preset settings that live outside the tone blocks (`PresetKey`: tempo, label, speaker mode, ...) |

Edits go to the amp's edit buffer. Nothing is stored in a slot until you `savePreset`.

### Types

The API is typed so the common mix-ups don't compile:

- **Values.** A `TypedValue` is `{ type: Float | Int, value: number }` or `{ type: Bool, value: boolean }`.
  `typed(type, number)` builds one from a number (non-zero is `true` for bools) and `numeric(v)` gives
  the number back.
- **Ids.** Symbol ids come in four kinds, `BlockId`, `ModelId`, `ParamId` and `StateId`, and a
  function takes only the right kind: `setParam(BlockId, ParamId, ...)`, `loadModel(BlockId, ModelId)`.
  Get them from the symbol table (`symbols.block(name)`, `.model(name)`, `.param(name)`, `.state(name)`),
  from a parsed preset (`block.id`, `block.model`) or from `param` events. If you hold a plain number,
  tag it with `blockId(n)`, `modelId(n)`, `paramId(n)` or `stateId(n)`. `symbols.id(name)` gives an
  untagged `SymbolId`, which is only good for lookups like `amp.name(id)`.
- **Commands.** `EditorCmd` and `LibrarianCmd` values are different types, and `request(channel, cmd)`
  only takes a command with its own channel (`request(Channel.Editor, EditorCmd.GetVersion)`).
  For a command this library doesn't know yet, use `requestRaw(channel, cmd, body)` with plain numbers.
  The request body is raw bytes; the methods above build and read the bodies for you.
- **Bytes.** Everything the library hands you is a `Uint8Array`. Anything that only reads bytes
  accepts any array-like of numbers, so plain arrays work too. (`JSON.stringify` turns a `Uint8Array`
  into an object, so convert with `Array.from` before sending bytes through JSON.)

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
  onsysex: (bytes: ArrayLike<number>) => void; // set by the client; call it once per complete F0..F7 message
  ondisconnect: (err?: unknown) => void;   // set by the client; call it when the link drops
  send(bytes: Uint8Array): void;
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

## The model catalog

The client doesn't need it, but it is what turns symbols into something a person can read:
display names ("Line 6 Vetta"), knob names, ranges and defaults, and the list of models each slot
accepts. The amp doesn't report knob ranges itself.

The catalog is Line 6's data and is **not part of this package**. You build it once from your own
copy of Line 6's Spider V Remote Android app (the APK, or an `.xapk`/`.apks` bundle or a zip of its
assets):

```ts
import { loadCatalog, saveCatalog } from 'spiderv-protocol/nodecatalog';

const catalog = await loadCatalog('SpiderRemote.apk'); // also takes a folder of assets, or a saved .json
await saveCatalog(catalog, 'catalog.json');            // next time: loadCatalog('catalog.json')
```

In a browser (or anywhere you already have the bytes), use the platform-neutral entry, which has
no Node dependency:

```ts
import { catalogFromApk, validCatalog } from 'spiderv-protocol/catalog';

const catalog = await catalogFromApk(new Uint8Array(await file.arrayBuffer())); // a File from <input type=file>
```

Then look things up by symbol name, the same names the amp's symbol table uses:

```ts
import { modelName, modelParams, paramInfo } from 'spiderv-protocol/catalog';

modelName(catalog, 'Line6Vetta');                 // display name, or undefined
modelParams(catalog, 'Line6Vetta');               // [{ sym, name, min, max, def, type }, ...]
paramInfo(catalog, 'Line6Vetta', 'Drive');        // one parameter's range and default
catalog.lists.amp;                                // [{ category, models: [symbol, ...] }, ...] for the amp slot
```

`catalog.lists` has `amp`, `fx`, `reverb`, `wah` and `cab`. `validCatalog(x)` checks the shape of a
catalog loaded from JSON. Keep the generated `catalog.json` out of anything you publish or commit.

## Safety

- `savePreset`, `writePresetData` and `loadPreset` change what is stored or playing on the amp.
  Read a slot with `readPresetData` and keep it before overwriting.
- The protocol is reverse-engineered. Test new commands on a preset you can lose, and don't send
  raw commands you don't understand.

## Licence

MIT. Line 6 and Spider V are trademarks of their owners; this project is not affiliated with or
endorsed by Line 6.
