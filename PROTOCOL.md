# Line 6 Spider V USB protocol

Notes from reverse-engineering the USB control protocol of the Line 6 Spider V
(verified live on a Spider V 20 MkII, firmware 2.0.1; cross-checked against a
capture of Spider V Remote talking to a Spider V 30 MkI, firmware 2.02).

Sources:

- USB capture from [stric9r/Line6-FBV3-Clone](https://github.com/stric9r/Line6-FBV3-Clone) (Spider V Remote ↔ Spider V 30).
- Command names and the handshake algorithm from the symbols in `libParkerRemoteNdk.so`
  inside Line 6's *Spider Remote* Android app (2.0.5). "Parker" is the Spider V's code name;
  the protocol classes are `ToneMatchEdit_Remote` and `ToneMatchLibrarian_Remote`.
- Live experiments with `tools/spiderv-cli.ts`.

## Transport

The amp is a class-compliant USB device (`0e41:506f` for the Spider V 20 MkII) with
a USB-MIDI interface and a 16-bit stereo 48 kHz audio interface. On Linux it appears
as an ALSA raw MIDI port (`Spider V 20 MIDI 1`), so any MIDI API works. All control
traffic is SysEx.

## Identity

Standard MIDI identity request `F0 7E 7F 06 01 F7` returns:

```
F0 7E 7F 06 02 | 00 01 0C | 22 00 | 05 00 | 30 00 01 02 F7
                 Line 6     family  member  version
```

followed by an extended identity: `F0 00 01 0C 22 05 7E 7F 06 02 "L6ImageType:main\0L6Version:2.0.1.0.0\0" F7`.

Spider V 30 MkI reports member `00`; Spider V 20 MkII reports `05`.

## Packet framing

```
F0 00 01 0C <family> <member> 4D <channel> <seq> <o2> <o1> <o0> <packed payload> F7
```

- `family member`: from the identity reply (`22 05` here). Using the wrong member
  makes the amp ignore the packet.
- `channel`: `0` = editor (live tone editing), `1` = librarian (presets).
- `seq`: 7-bit counter per channel and direction. The amp doesn't check it.
- `o2 o1 o0`: offset of this packet's last payload byte within the message,
  `(o2 << 8) | (o1 << 4) | o0` (`o2` is 7 bits wide, `o1`/`o0` are nibbles).
  Messages over 256 bytes arrive as several packets sharing one `seq`
  (the 22 KB symbol table comes as 87 packets).
- Payload: 8-to-7 bit packing. Each group of 7 bytes is preceded by a byte
  carrying their high bits, with **bit 6 for the first byte**. The last group is zero-padded.

## Messages

Every message, in both directions, is little-endian:

```
u32 command (host → amp) / kind (amp → host)
u32 body length
... body
```

Amp → host kinds: `1` = reply to the last request on that channel, `3` = event,
`4` = parameter changed. Replies to commands that can fail start with an `i32`
status (`0` OK, `-1` bad argument, `-6` not authenticated, `-7` handshake mismatch).
Send one request per channel at a time and wait for its reply. The amp must be drained:
it stops responding if its output isn't read.

### Handshake

1. `ch0 GetVersion (0x01)` → `u32` (`0x02010030` on fw 2.0.1)
2. `ch0 GetSymbolTableSize (0x02)` → `u32` size
3. `ch0 GetSymbolTable (0x03)` → the symbol table (see below)
4. `ch0 Handshake (0x04)` with body `le32(CRC32(symbol table))` → status `0`

The CRC is standard CRC-32 (zlib). The handshake proves the client uses the
firmware's own ID map. Old MkI firmware accepted any token; MkII firmware
replies `-7` to a wrong one, and then every other command returns `-6`.

### Editor commands (channel 0)

| cmd | name | body | reply |
|---|---|---|---|
| 01 | GetVersion | — | u32 |
| 02 | GetSymbolTableSize | — | u32 |
| 03 | GetSymbolTable | — | bytes |
| 04 | Handshake | u32 crc | status |
| 05 | GetNumAddressableSlots | — | |
| 06 | GetAddressableSlots | | |
| 07 | QueryCurrentDspModel | slot | status, model |
| 08 | LoadDspModel | slot, model | status (block params reset to defaults) |
| 09 | GetDspModelParam | obj, param | status, type, value |
| 0A | SetDspModelParam | obj, param, type, value | status |
| 0B | RegisterDspEvent | | |
| 0C | UnregisterDspEvent | | |
| 0D | BindTweakParam | | |
| 0E | SetGlobalTempo | f32 bpm | status |
| 0F | GetDirtyState | — | u8 (1 = edit buffer modified) |
| 10 | GetFbvConnectivityStatus | — | |
| 11 | GetPersistentSysParam | key | status, type, value (key 9 = current preset index) |
| 12 | SetPersistentSysParam | | |
| 13 | SetPresetPSKeyParam | | |
| 14 | GetPresetPSKeyParam | | |
| 15 | GetSystemSetting | | |
| 16 | SetSystemSetting | | |

Typed values in commands 09/0A/11 and in parameter-change messages are
`u32 type, 4 bytes value`, where type `2` = int, `3` = bool, `4` = f32.

### Librarian commands (channel 1)

| cmd | name | body | reply |
|---|---|---|---|
| 01 | GetVersion | — | u32 |
| 05 | GetNumPresets | — | u32 (128) |
| 06 | GetPresetName | | |
| 07 | GetPresetUUID | | |
| 08 | GetPresetChecksum | | |
| 09 | MovePresetFiles | | |
| 0A | GetPresetFileSize | | |
| 0B | GetPresetFile | i32 index (-1 = edit buffer) | status, preset file |
| 0C | SetPresetFile | i32 index (-1 = edit buffer), u32 length, preset file | status |
| 0D | LoadHardwarePreset | index | status |
| 0E | GetPresetInfo | index | 20 bytes metadata, u32 length, name |

`SetPresetFile` is how Spider Remote saves (`A36EditBufferContext::savePresetToDevice`)
and renames presets, and how it pushes whole tones into the edit buffer (index -1).
The preset file is the same byte stream `GetPresetFile` returns after its status word.
The app waits 300 ms after a write. With its `bool` argument set, the app's
`SetPresetFile` sends command `0x0F` instead (used only for metadata updates).

### Events (amp → host)

- Kind `4`: `obj, param, type, value`. The MkI sent these for knob turns on the amp.
- Kind `3`: `[2, -1, 2, 1]` about two seconds after the edit buffer changes.

## Symbol table

```
u32 count
u32 total size
count × { u32 string offset, u32 hash, u32 length }
string pool (NUL-terminated)
```

An ID is the entry index. Everything is addressed by these IDs: blocks (`Amp` = 0x2a,
`FX1`…`FX4`, `Gate`, `Wah`, `StudioCab`, `Air`, `PostComp`, `PostEQ`, `VolumePedal`,
root `GuitarProc` = 0x374), models (`DoubleVerb`, `TapeEcho`, …) and parameters.
Stored parameters are named `<X>State` (e.g. `BassState`). **Get, set and change
notifications use the matching `<X>` ID** (e.g. `Bass`). Cab models are
`<cab>Studio<mic>` with mic `57OnAxis`, `57OffAxis`, `421` or `U67`.

On/off, mix and routing live on `GuitarProc`: `FX1Enable`, `FX1Mix`, `FX1Post`,
`AmpEnable`, `CabEnable`, `GateEnable`, `WahEnable`, `ChannelVolume`, …

## Serialized presets

Body of `GetPresetFile`: a status word (`0`), then the preset file, a flat stream of entries:

```
u32 key, u16 type, value
```

with type `0` none, `1` bool (u32), `2` int (u32), `3` f32, `4` string (u32 length incl. NUL + bytes), `7` ID ref (u32).
Keys with the high bit set are structural:

| key | meaning |
|---|---|
| 0x80000000 | section version |
| 0x80000001 | section magic (`PRSP` metadata, `GTRT` tone) |
| 0x80000002 | section end |
| 0x80000003 | block start (value = block ID) |
| 0x80000004 | block end |
| 0x80000005 | model ID |
| 0x80000006 | parameter count |

`PRSP` holds the preset metadata, written by `L6A36Preset::SerializeMetaData`:
key `0` name and `75` label (strings, truncated to 63 bytes), `1`/`2` CustomTone
tone id (`tnid`, low/high 32 bits), `3` tempo, `4`/`5` root block and flow model.
Other tone-file metadata (author, band, song, style) isn't stored on the amp. `GTRT` holds the `GuitarProc` block
with its own parameters and one child block per slot.

## Tone files (JSON)

Line 6's apps share and export tones as JSON (`L6EdLibPresetV5::DumpToJson`).
Spider V Remote and CustomTone use the `.svl6p` extension; the Android app names
shared files `L6Preset.l6t`. Spider V Remote's files add `"schema": "L6Preset"` at the
top level and `device_version` (firmware, e.g. `0x01020000`) next to `device`, write
`@enabled`/`@post` as JSON booleans, and carry extra metadata (`band`, `song`, `style`, …):

```json
{
  "version": 5,
  "data": {
    "meta": { "name": "Arachnid Rhythm", "author": "Line 6", "application": "Spider Remote", ... },
    "device": 2228226,
    "tone": {
      "amp":    { "@model": "BritPlexiJumpLead", "Bass": 0.57, "Drive": 0.795, "@volume": 0.52 },
      "cab":    { "@model": "4x12Green25sStudio", "@mic": 2, "Level": 0 },
      "fx1":    { "@model": "ClassicDistortion", "@enabled": 1, "@mix": 1, "@post": 0, ... },
      "global": { "@tempo": 142.563, "@tweakgroup": "fx3", ... }
    }
  }
}
```

`device` is `(family << 16) | member`. Groups map to blocks: `gate` Gate, `wah` Wah,
`fx1`–`fx3` FX1–FX3, `reverb` FX4, `amp` Amp, `cab` StudioCab (+ `Level` on `Air`),
`compressor` PostComp, `eq` PostEQ, `volume` VolumePedal. Plain keys are parameter
control names. `@enabled`/`@mix`/`@post`/`@mixtype` map to the `GuitarProc`
controls `<prefix>Enable`/`Mix`/`Post`/`MixType`, amp `@volume` to `ChannelVolume`,
and cab `@model` + `@mic` to the model `<cab><mic suffix>`.
