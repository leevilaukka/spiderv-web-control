// Line 6 Spider V USB protocol: SysEx framing, 7-bit packing, message codec,
// CRC32 and the preset ("tone") parser. Transport-agnostic.
// See PROTOCOL.md for the reverse-engineering notes behind this file.

export type Bytes = number[];

export const LINE6_ID = [0x00, 0x01, 0x0c];
export const MSG_TYPE = 0x4d; // 'M': the channelled message stream
export const IDENTITY_REQUEST: Bytes = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

// Two header bytes after the Line 6 ID: device family and member, taken from
// the identity reply (Spider V 30 MkI: 22 00, Spider V 20 MkII: 22 05).
export const DEFAULT_DEVICE: [number, number] = [0x22, 0x00];

export enum Channel { Editor = 0, Librarian = 1 }

// Command IDs, named after the methods of ToneMatchEdit_Remote /
// ToneMatchLibrarian_Remote in Line 6's Android app (libParkerRemoteNdk.so).
export const EditorCmd = {
  GetVersion: 0x01,
  GetSymbolTableSize: 0x02,
  GetSymbolTable: 0x03,
  Handshake: 0x04,             // body: le32 CRC32 of the symbol table
  GetNumAddressableSlots: 0x05,
  GetAddressableSlots: 0x06,
  QueryCurrentDspModel: 0x07,  // body: slot -> model
  LoadDspModel: 0x08,          // body: slot, model
  GetDspModelParam: 0x09,      // body: obj, param -> status, vtype, value
  SetDspModelParam: 0x0a,      // body: obj, param, vtype, value
  RegisterDspEvent: 0x0b,
  UnregisterDspEvent: 0x0c,
  BindTweakParam: 0x0d,
  SetGlobalTempo: 0x0e,        // body: f32 bpm
  GetDirtyState: 0x0f,         // -> u8
  GetFbvConnectivityStatus: 0x10,
  GetPersistentSysParam: 0x11, // body: key -> status, vtype, value
  SetPersistentSysParam: 0x12,
  SetPresetPSKeyParam: 0x13,   // body: PresetKey, vtype, value (edit buffer)
  GetPresetPSKeyParam: 0x14,   // body: PresetKey -> status, vtype, value
  GetSystemSetting: 0x15,
  SetSystemSetting: 0x16,
} as const;

export const LibrarianCmd = {
  GetVersion: 0x01,
  GetSymbolTableSize: 0x02,
  GetSymbolTable: 0x03,
  Handshake: 0x04,
  GetNumPresets: 0x05,
  GetPresetName: 0x06,
  GetPresetUUID: 0x07,
  GetPresetChecksum: 0x08,
  MovePresetFiles: 0x09,
  GetPresetFileSize: 0x0a,
  GetPresetFile: 0x0b,         // body: index (-1 = edit buffer) -> serialized preset
  SetPresetFile: 0x0c,         // body: index (-1 = edit buffer), u32 length, preset file -> status
  LoadHardwarePreset: 0x0d,    // body: index
  GetPresetInfo: 0x0e,         // body: index -> metadata + name
} as const;

// Persistent system parameter keys (GetPersistentSysParam).
export const SysParam = { CurrentPreset: 9 } as const;

// First u32 of a message from the amp.
export enum Kind {
  Reply = 0x01,
  Event = 0x03,        // [2, -1, 2, 1] shortly after edits: edit buffer dirty
  ParamChanged = 0x04, // obj, param, vtype, value
}

// Value types in Get/Set/ParamChanged messages.
export enum MsgType { Int = 2, Bool = 3, Float = 4 }

// Value types inside serialized presets.
export enum VType { None = 0, Bool = 1, Int = 2, Float = 3, String = 4, Ref = 7 }

// Structural keys in serialized presets (high bit set).
export const MetaKey = {
  Version: 0x80000000,
  Magic: 0x80000001,
  SectionEnd: 0x80000002,
  Block: 0x80000003,
  BlockEnd: 0x80000004,
  Model: 0x80000005,
  ParamCount: 0x80000006,
} as const;

// ---------------------------------------------------------------- bytes

export const u32 = (b: Bytes, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const i32 = (b: Bytes, o: number) => u32(b, o) | 0;
export const le32 = (v: number): Bytes => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export function f32(b: Bytes, o: number): number {
  return new DataView(new Uint8Array(b.slice(o, o + 4)).buffer).getFloat32(0, true);
}

export function leF32(v: number): Bytes {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, true);
  return [0, 1, 2, 3].map((i) => dv.getUint8(i));
}

export const latin1 = (b: Bytes) => String.fromCharCode(...b);
export const cString = (b: Bytes) => latin1(b).replace(/\0[\s\S]*$/, '');
export const toHex = (b: Bytes) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');

// ---------------------------------------------------------------- CRC32

// Standard reflected CRC-32 (as zlib), used for the handshake.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Bytes): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 7-bit packing

// Each group of up to 7 bytes is preceded by a byte holding their high bits;
// bit 6 belongs to the first byte of the group. Groups are zero-padded.
export function pack7(data: Bytes): Bytes {
  const out: Bytes = [];
  for (let i = 0; i < data.length; i += 7) {
    let hdr = 0;
    const grp: Bytes = [];
    for (let j = 0; j < 7; j++) {
      const b = data[i + j] ?? 0;
      if (b & 0x80) hdr |= 1 << (6 - j);
      grp.push(b & 0x7f);
    }
    out.push(hdr, ...grp);
  }
  return out;
}

export function unpack7(data: Bytes): Bytes {
  const out: Bytes = [];
  for (let i = 0; i < data.length; i += 8) {
    const hdr = data[i];
    for (let j = 1; j < 8 && i + j < data.length; j++) {
      out.push(data[i + j] | ((hdr >> (7 - j)) & 1 ? 0x80 : 0));
    }
  }
  return out;
}

// ---------------------------------------------------------------- framing

const MAX_FRAGMENT = 256;

// Encode a message into SysEx packets. Large messages are split into
// fragments sharing one sequence number; the three bytes after the sequence
// give the offset of the fragment's last byte within the message as
// (b0 << 8) | (b1 << 4) | b2 (b0 is 7 bits, b1/b2 are nibbles).
export function encodeSysex(device: readonly number[], channel: number, seq: number, message: Bytes): Bytes[] {
  const packets: Bytes[] = [];
  for (let start = 0; start < message.length; start += MAX_FRAGMENT) {
    const frag = message.slice(start, start + MAX_FRAGMENT);
    const end = start + frag.length - 1;
    packets.push([
      0xf0, ...LINE6_ID, device[0], device[1], MSG_TYPE,
      channel, seq & 0x7f, (end >> 8) & 0x7f, (end >> 4) & 0x0f, end & 0x0f,
      ...pack7(frag), 0xf7,
    ]);
  }
  return packets;
}

export type Identity = { type: 'identity'; family: number; member: number; version: Bytes };
export type Fragment = { type: 'fragment'; device: [number, number]; channel: number; seq: number; end: number; payload: Bytes };
export type Parsed =
  | Identity
  | Fragment
  | { type: 'info'; device: [number, number]; info: Record<string, string> }
  | { type: 'other'; bytes: Bytes };

export function parseSysex(bytes: ArrayLike<number>): Parsed {
  const b = Array.from(bytes);
  if (b[0] !== 0xf0 || b[b.length - 1] !== 0xf7) return { type: 'other', bytes: b };
  if (b[1] === 0x7e && b[3] === 0x06 && b[4] === 0x02) {
    return { type: 'identity', family: b[8] | (b[9] << 7), member: b[10] | (b[11] << 7), version: b.slice(12, 16) };
  }
  if (b[1] !== 0x00 || b[2] !== 0x01 || b[3] !== 0x0c) return { type: 'other', bytes: b };
  const device: [number, number] = [b[4], b[5]];
  if (b[6] === 0x7e && b[7] === 0x7f && b[8] === 0x06 && b[9] === 0x02) {
    // Extended identity: NUL-separated "key:value" strings.
    const info: Record<string, string> = {};
    for (const s of latin1(b.slice(10, -1)).split('\0')) {
      const k = s.indexOf(':');
      if (k > 0) info[s.slice(0, k)] = s.slice(k + 1);
    }
    return { type: 'info', device, info };
  }
  if (b[6] !== MSG_TYPE) return { type: 'other', bytes: b };
  return {
    type: 'fragment', device, channel: b[7], seq: b[8],
    end: (b[9] << 8) | (b[10] << 4) | b[11],
    payload: unpack7(b.slice(12, -1)),
  };
}

export type Message = { channel: number; kind: number; body: Bytes };

// Reassembles fragments into messages, per channel. The amp splits big
// messages into fragments with one seq and cumulative offsets. A host may
// also send header and body as separate packets with their own seq
// (spanSeq = true, used when decoding host traffic); from the amp, a new seq
// always starts a new message, so leftovers are dropped rather than merged.
export class Reassembler {
  private streams = new Map<number, { buf: Bytes; seq: number; end: number }>();
  dropped = 0;

  constructor(private spanSeq = true) {}

  push(frag: Fragment): Message[] {
    let st = this.streams.get(frag.channel);
    if (!st) this.streams.set(frag.channel, (st = { buf: [], seq: -1, end: -1 }));
    if (frag.seq !== st.seq && !this.spanSeq && st.buf.length) {
      this.dropped += st.buf.length;
      st.buf = [];
    }
    const start = frag.seq === st.seq ? st.end + 1 : 0;
    st.buf.push(...frag.payload.slice(0, Math.max(0, frag.end + 1 - start)));
    st.seq = frag.seq;
    st.end = frag.end;
    const out: Message[] = [];
    while (st.buf.length >= 8) {
      const len = u32(st.buf, 4);
      if (st.buf.length < 8 + len) break;
      const m = st.buf.splice(0, 8 + len);
      out.push({ channel: frag.channel, kind: u32(m, 0), body: m.slice(8) });
    }
    return out;
  }
}

// ---------------------------------------------------------------- messages

export const encodeMessage = (cmd: number, body: Bytes = []): Bytes => [...le32(cmd), ...le32(body.length), ...body];

export type TypedValue = { type: MsgType; value: number };

export function encodeTyped({ type, value }: TypedValue): Bytes {
  return [...le32(type), ...(type === MsgType.Float ? leF32(value) : le32(value | 0))];
}

export function decodeTyped(b: Bytes, o: number): TypedValue {
  const type = u32(b, o) as MsgType;
  return { type, value: type === MsgType.Float ? f32(b, o + 4) : i32(b, o + 4) };
}

export type ParamChange = { obj: number; param: number } & TypedValue;

export function decodeParamChange(body: Bytes): ParamChange {
  return { obj: u32(body, 0), param: u32(body, 4), ...decodeTyped(body, 8) };
}

// GetPresetInfo reply body: 20 bytes of metadata, then a length-prefixed name.
export function decodePresetInfo(body: Bytes): { meta: Bytes; name: string } {
  return { meta: body.slice(0, 20), name: cString(body.slice(24, 24 + u32(body, 20))) };
}

// ---------------------------------------------------------------- presets

export type Entry = { key: number; type: VType; value: number | string | null };
export type Block = { id: number; model: number; params: Entry[]; children: Block[] };
export type Section = { version: number; magic: string; root: Block | null; params: Entry[] };
export type Preset = { name: string; header: Record<number, Entry['value']>; sections: Section[]; tone: Block | null };

// Parse the typed key/value stream of a preset file (GetPresetFile reply
// without its leading status word; also what SetPresetFile takes).
export function parseEntries(data: Bytes): Entry[] {
  let p = 0;
  const entries: Entry[] = [];
  while (p + 6 <= data.length) {
    const key = u32(data, p);
    const type = (data[p + 4] | (data[p + 5] << 8)) as VType;
    p += 6;
    let value: Entry['value'] = null;
    if (type === VType.Bool || type === VType.Int || type === VType.Ref) { value = i32(data, p); p += 4; }
    else if (type === VType.Float) { value = f32(data, p); p += 4; }
    else if (type === VType.String) {
      const n = u32(data, p);
      value = cString(data.slice(p + 4, p + 4 + n));
      p += 4 + n;
    } else if (type !== VType.None) {
      throw new Error(`unknown value type ${type} at offset ${p - 6}`);
    }
    entries.push({ key, type, value });
  }
  return entries;
}

export function serializeEntries(entries: Entry[]): Bytes {
  const out: Bytes = [];
  for (const e of entries) {
    out.push(...le32(e.key), e.type & 0xff, e.type >> 8);
    if (e.type === VType.Float) out.push(...leF32(e.value as number));
    else if (e.type === VType.String) {
      const s = [...(e.value as string)].map((c) => c.charCodeAt(0) & 0xff).concat(0);
      out.push(...le32(s.length), ...s);
    } else if (e.type !== VType.None) out.push(...le32(e.value as number));
  }
  return out;
}

// Spider Remote truncates names (and labels) to 63 bytes before saving.
export const PRESET_NAME_MAX = 63;

// Preset metadata stored on the amp (PRSP section of a preset file). The
// same keys address Get/SetPresetPSKeyParam; the tone-file "global" names
// are from ParamIDToPSKey in Line 6's app.
export const PresetKey = {
  Name: 0, ToneIdLow: 1, ToneIdHigh: 2,
  Tempo: 3,        // @tempo
  TweakGroup: 4,   // @tweakgroup (block ID)
  TweakParam: 5,   // @tweakparam (control ID)
  TweakMin: 7,     // @tweakmin
  TweakMax: 8,     // @tweakmax
  Pedal2Assign: 9, // @pedal2assign
  SpeakerMode: 74, // @speakermode: bool, false = Classic, true = Full Range (firmware 2.00+)
  Label: 75,
} as const;

export type PresetMeta = { name?: string; label?: string; tnid?: number };

const cleanText = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').slice(0, PRESET_NAME_MAX);

// Returns preset file bytes with updated metadata. Fields the preset file
// doesn't already contain are left out rather than invented.
export function setPresetMeta(data: Bytes, meta: PresetMeta): Bytes {
  const entries = parseEntries(data);
  // Metadata lives in the first section (PRSP), before its section end.
  const end = entries.findIndex((e) => e.key === MetaKey.SectionEnd);
  const head = end < 0 ? entries : entries.slice(0, end);
  const field = (key: number, type: VType) => head.find((e) => e.key === key && e.type === type);
  if (meta.name !== undefined) {
    const e = field(PresetKey.Name, VType.String);
    if (!e) throw new Error('preset has no name field');
    e.value = cleanText(meta.name);
  }
  if (meta.label !== undefined) {
    const e = field(PresetKey.Label, VType.String);
    if (e) e.value = cleanText(meta.label);
  }
  if (meta.tnid !== undefined && Number.isSafeInteger(meta.tnid) && meta.tnid >= 0) {
    const lo = field(PresetKey.ToneIdLow, VType.Int), hi = field(PresetKey.ToneIdHigh, VType.Int);
    if (lo && hi) {
      lo.value = meta.tnid % 2 ** 32 | 0;
      hi.value = Math.floor(meta.tnid / 2 ** 32) | 0;
    }
  }
  return serializeEntries(entries);
}

export const renamePresetData = (data: Bytes, name: string) => setPresetMeta(data, { name });

// Parse a GetPresetFile reply body (status word + preset file).
export function parsePreset(body: Bytes): Preset {
  const entries = parseEntries(body.slice(4));

  const preset: Preset = { name: '', header: {}, sections: [], tone: null };
  let section: Section | null = null;
  const stack: Block[] = [];
  for (const e of entries) {
    const top = stack[stack.length - 1];
    switch (e.key) {
      case MetaKey.Version:
        section = { version: e.value as number, magic: '', root: null, params: [] };
        break;
      case MetaKey.Magic:
        section!.magic = latin1(le32(e.value as number).reverse());
        preset.sections.push(section!);
        break;
      case MetaKey.SectionEnd: stack.length = 0; break;
      case MetaKey.Block: {
        const blk: Block = { id: e.value as number, model: 0, params: [], children: [] };
        if (top) top.children.push(blk);
        else section!.root = blk;
        stack.push(blk);
        break;
      }
      case MetaKey.Model: top.model = e.value as number; break;
      case MetaKey.ParamCount: break;
      case MetaKey.BlockEnd: stack.pop(); break;
      default:
        if (top) top.params.push(e);
        else if (section?.magic === 'PRSP') {
          preset.header[e.key] = e.value;
          if (e.key === 0 && e.type === VType.String) preset.name = e.value as string;
        } else section?.params.push(e);
    }
  }
  preset.tone = preset.sections.find((s) => s.magic === 'GTRT')?.root ?? null;
  return preset;
}

// ---------------------------------------------------------------- symbol table

// The firmware's ID <-> name map. Layout: u32 count, u32 total size, then
// count x { u32 string offset, u32 hash, u32 length }, then a pool of
// NUL-terminated strings. An ID is the entry's index.
export class SymbolTable {
  readonly names: string[] = [];
  private ids = new Map<string, number>();

  constructor(readonly bytes: Bytes) {
    const n = u32(bytes, 0);
    const pool = 8 + n * 12;
    for (let i = 0; i < n; i++) {
      const off = u32(bytes, 8 + i * 12), len = u32(bytes, 16 + i * 12);
      const name = latin1(bytes.slice(pool + off, pool + off + len));
      this.names.push(name);
      if (!this.ids.has(name)) this.ids.set(name, i);
    }
  }

  name(id: number): string | undefined { return this.names[id]; }
  id(name: string): number | undefined { return this.ids.get(name); }

  // Stored params are named "<X>State"; get/set and notifications use "<X>".
  controlOf(stateId: number): number | undefined {
    const n = this.names[stateId];
    return n?.endsWith('State') ? this.ids.get(n.slice(0, -5)) : undefined;
  }

  stateOf(controlId: number): number | undefined {
    const n = this.names[controlId];
    return n === undefined ? undefined : this.ids.get(n + 'State');
  }
}
