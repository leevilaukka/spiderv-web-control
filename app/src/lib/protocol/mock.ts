// A simulated Spider V for demo mode and tests. It answers the same commands
// as the real amp, starting from a session recorded with
// `bun tools/spiderv-cli.ts record`.
import {
  type Bytes, type Entry, Channel, EditorCmd, Kind, LibrarianCmd, MetaKey, MsgType, PresetKey, Reassembler, SymbolTable, SysParam, VType,
  crc32, decodeTyped, encodeMessage, encodeSysex, encodeTyped, i32, le32, parseEntries, parseSysex, renamePresetData,
  serializeEntries, u32,
} from './codec';
import type { Transport } from './client';
import { catalog } from '../tone';

export type Session = {
  identity: { family: number; member: number; version: number[] };
  info: Record<string, string>;
  version: number;
  current: number;
  names: string[];
  symbolTable: string; // base64
  editBuffer: string;  // base64 GetPresetFile(-1) reply body
};

const fromB64 = (s: string): Bytes => Array.from(atob(s), (c) => c.charCodeAt(0));

export class MockTransport implements Transport {
  label = 'Demo amp (simulated)';
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};

  private reasm = new Reassembler();
  private seq = [0, 0];
  private device: [number, number];
  private symbols: Bytes;
  private st: SymbolTable;
  private entries: Entry[];
  private slots: Bytes[];
  private authed = false;
  private current: number;
  private dirty = false;
  latency = 4;

  constructor(private session: Session) {
    this.device = [session.identity.family, session.identity.member];
    this.symbols = fromB64(session.symbolTable);
    this.st = new SymbolTable(this.symbols);
    const edit = fromB64(session.editBuffer).slice(4);
    this.entries = parseEntries(edit);
    // Every slot starts as the recorded tone under that slot's name.
    this.slots = session.names.map((n) => renamePresetData(edit, n));
    this.current = session.current;
  }

  async close() {}

  private reply(channel: number, kind: Kind, body: Bytes) {
    const pkts = encodeSysex(this.device, channel, this.seq[channel], encodeMessage(kind, body));
    this.seq[channel] = (this.seq[channel] + 1) & 0x7f;
    setTimeout(() => pkts.forEach((p) => this.onsysex(p)), this.latency);
  }

  send(bytes: Bytes) {
    if (bytes[1] === 0x7e) {
      const { family, member, version } = this.session.identity;
      setTimeout(() => {
        this.onsysex([0xf0, 0x7e, 0x7f, 0x06, 0x02, 0x00, 0x01, 0x0c, family, 0, member, 0, ...version, 0xf7]);
        const info = Object.entries(this.session.info).flatMap(([k, v]) => [...`${k}:${v}`].map((c) => c.charCodeAt(0)).concat(0));
        this.onsysex([0xf0, 0x00, 0x01, 0x0c, family, member, 0x7e, 0x7f, 0x06, 0x02, ...info, 0xf7]);
      }, this.latency);
      return;
    }
    const p = parseSysex(bytes);
    if (p.type !== 'fragment') return;
    for (const m of this.reasm.push(p)) {
      if (m.channel === Channel.Editor) this.editor(m.kind, m.body);
      else this.librarian(m.kind, m.body);
    }
  }

  // Simulates turning a knob on the amp itself.
  turnKnob(obj: number, ctrl: number, value: number) {
    this.store(obj, ctrl, value);
    this.reply(Channel.Editor, Kind.ParamChanged, [...le32(obj), ...le32(ctrl), ...encodeTyped({ type: MsgType.Float, value })]);
  }

  private ok(ch: Channel, body: Bytes = le32(0)) { this.reply(ch, Kind.Reply, body); }
  private err(ch: Channel, status: number) { this.reply(ch, Kind.Reply, le32(status)); }

  private editor(cmd: number, body: Bytes) {
    const ch = Channel.Editor;
    switch (cmd) {
      case EditorCmd.GetVersion: return this.ok(ch, le32(this.session.version));
      case EditorCmd.GetSymbolTableSize: return this.ok(ch, le32(this.symbols.length));
      case EditorCmd.GetSymbolTable: return this.ok(ch, this.symbols);
      case EditorCmd.Handshake:
        this.authed = u32(body, 0) === crc32(this.symbols);
        return this.authed ? this.ok(ch) : this.err(ch, -7);
    }
    if (!this.authed) return this.err(ch, -6);
    switch (cmd) {
      case EditorCmd.GetDirtyState: return this.ok(ch, [this.dirty ? 1 : 0]);
      case EditorCmd.GetPersistentSysParam:
        if (u32(body, 0) === SysParam.CurrentPreset) return this.ok(ch, [...le32(0), ...encodeTyped({ type: MsgType.Int, value: this.current })]);
        return this.err(ch, -1);
      case EditorCmd.GetDspModelParam: {
        const e = this.find(u32(body, 0), u32(body, 4));
        if (!e) return this.err(ch, -1);
        const type = e.type === VType.Float ? MsgType.Float : e.type === VType.Bool ? MsgType.Bool : MsgType.Int;
        return this.ok(ch, [...le32(0), ...encodeTyped({ type, value: e.value as number })]);
      }
      case EditorCmd.SetDspModelParam: {
        const ok = this.store(u32(body, 0), u32(body, 4), decodeTyped(body, 8).value);
        return ok ? this.ok(ch) : this.err(ch, -1);
      }
      case EditorCmd.QueryCurrentDspModel: {
        const i = this.blockIndex(u32(body, 0));
        return i < 0 ? this.err(ch, -1) : this.ok(ch, [...le32(0), ...le32(this.entries[i + 1].value as number)]);
      }
      case EditorCmd.LoadDspModel: return this.loadModel(u32(body, 0), u32(body, 4)) ? this.ok(ch) : this.err(ch, -1);
      case EditorCmd.SetGlobalTempo: {
        const e = this.presetKey(PresetKey.Tempo);
        if (e) e.value = decodeTyped([...le32(MsgType.Float), ...body], 0).value;
        this.dirty = true;
        return this.ok(ch);
      }
      case EditorCmd.GetPresetPSKeyParam: {
        const e = this.presetKey(u32(body, 0));
        if (!e) return this.err(ch, -1);
        const type = e.type === VType.Float ? MsgType.Float : e.type === VType.Bool ? MsgType.Bool : MsgType.Int;
        return this.ok(ch, [...le32(0), ...encodeTyped({ type, value: e.value as number })]);
      }
      case EditorCmd.SetPresetPSKeyParam: {
        const e = this.presetKey(u32(body, 0));
        if (!e) return this.err(ch, -1);
        const v = decodeTyped(body, 4).value;
        e.value = e.type === VType.Float ? v : Math.round(v);
        this.dirty = true;
        return this.ok(ch);
      }
      default: return this.ok(ch);
    }
  }

  // A number-valued entry of the edit buffer's metadata (PRSP) section.
  private presetKey(key: number): Entry | undefined {
    const end = this.entries.findIndex((e) => e.key === MetaKey.SectionEnd);
    return this.entries.slice(0, end < 0 ? undefined : end)
      .find((e) => e.key === key && (e.type === VType.Bool || e.type === VType.Int || e.type === VType.Float));
  }

  private slotName(i: number): string {
    return (parseEntries(this.slots[i]).find((e) => e.key === 0 && e.type === VType.String)?.value as string) ?? '';
  }

  private librarian(cmd: number, body: Bytes) {
    const ch = Channel.Librarian;
    switch (cmd) {
      case LibrarianCmd.GetVersion: return this.ok(ch, le32(this.session.version));
      case LibrarianCmd.GetNumPresets: return this.ok(ch, le32(this.slots.length));
    }
    if (!this.authed) return this.err(ch, -6);
    const index = i32(body, 0);
    const valid = index >= 0 && index < this.slots.length;
    switch (cmd) {
      case LibrarianCmd.GetPresetInfo: {
        if (!valid) return this.err(ch, -1);
        const s = [...this.slotName(index)].map((c) => c.charCodeAt(0)).concat(0);
        return this.ok(ch, [...new Array(20).fill(0), ...le32(s.length), ...s]);
      }
      case LibrarianCmd.LoadHardwarePreset:
        if (!valid) return this.err(ch, -1);
        this.current = index;
        this.dirty = false;
        this.entries = parseEntries(this.slots[index]);
        return this.ok(ch);
      case LibrarianCmd.GetPresetFile:
        if (index === -1) return this.ok(ch, [...le32(0), ...serializeEntries(this.entries)]);
        return valid ? this.ok(ch, [...le32(0), ...this.slots[index]]) : this.err(ch, -1);
      case LibrarianCmd.SetPresetFile: {
        const len = u32(body, 4);
        const data = body.slice(8, 8 + len);
        if (data.length !== len) return this.err(ch, -1);
        try { parseEntries(data); } catch { return this.err(ch, -1); }
        if (index === -1) this.entries = parseEntries(data);
        else if (valid) this.slots[index] = data;
        else return this.err(ch, -1);
        if (index === this.current) this.dirty = false;
        return this.ok(ch);
      }
      default: return this.ok(ch);
    }
  }

  private blockIndex(obj: number) {
    return this.entries.findIndex((e) => e.key === MetaKey.Block && e.value === obj);
  }

  private find(obj: number, ctrl: number): Entry | undefined {
    const state = this.st.stateOf(ctrl);
    let i = this.blockIndex(obj), depth = 0;
    if (i < 0 || state === undefined) return undefined;
    for (i++; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.key === MetaKey.Block) depth++;
      else if (e.key === MetaKey.BlockEnd && depth-- === 0) return undefined;
      else if (depth === 0 && e.key === state) return e;
    }
  }

  private store(obj: number, ctrl: number, value: number): boolean {
    const e = this.find(obj, ctrl);
    if (!e) return false;
    e.value = e.type === VType.Float ? value : Math.round(value);
    this.dirty = true;
    return true;
  }

  // Replaces a block's model and resets its params to the catalog defaults.
  private loadModel(slot: number, model: number): boolean {
    const i = this.blockIndex(slot);
    const sym = this.st.name(model);
    if (i < 0 || !sym) return false;
    const end = this.entries.findIndex((e, j) => j > i && e.key === MetaKey.BlockEnd);
    const cat = catalog.models[sym] ?? catalog.models[sym.replace(/(57OnAxis|57OffAxis|421|U67)$/, '')];
    const params: Entry[] = [];
    // Params the catalog doesn't list (e.g. the volume pedal position) survive
    // reloading the same model.
    const sameModel = this.entries[i + 1]?.value === model;
    const old = sameModel ? this.entries.slice(i + 3, end) : [];
    for (const p of cat?.params ?? []) {
      const state = this.st.id(p.sym + 'State');
      if (p.sym.startsWith('@') || state === undefined) continue;
      const type = p.type === 1 ? VType.Float : p.type === 2 ? VType.Bool : VType.Int;
      params.push({ key: state, type, value: Number(p.def) });
    }
    for (const e of old) if (!params.some((p) => p.key === e.key)) params.push(e);
    this.entries.splice(i + 1, end - i - 1,
      { key: MetaKey.Model, type: VType.Ref, value: model },
      { key: MetaKey.ParamCount, type: VType.Int, value: params.length },
      ...params);
    this.dirty = true;
    return true;
  }
}
