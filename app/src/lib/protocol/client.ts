// Session client: handshake, request/reply on the two channels, events.
import {
  type Bytes, type Identity, type Message, type ParamChange, type Preset, type TypedValue,
  Channel, DEFAULT_DEVICE, EditorCmd, IDENTITY_REQUEST, Kind, LibrarianCmd, MsgType, Reassembler, SymbolTable, SysParam,
  crc32, decodeParamChange, decodePresetInfo, decodeTyped, encodeMessage, encodeSysex, encodeTyped, parseEntries, setPresetMeta, type PresetMeta,
  i32, le32, leF32, parsePreset, parseSysex, toHex, u32,
} from './codec';

export interface Transport {
  label: string;
  onsysex: (bytes: Bytes) => void;
  ondisconnect: (err?: unknown) => void;
  send(bytes: Bytes): void;
  close(): Promise<void>;
}

export type LogEntry = { t: number; dir: 'in' | 'out' | 'info'; text: string; raw?: Bytes };

export class AmpError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

const REPLY_TIMEOUT = 4000;
const hex = (v: number) => '0x' + (v >>> 0).toString(16);

type Pending = { resolve: (m: Message) => void; timer: ReturnType<typeof setTimeout> };

export interface ClientEvents {
  log: LogEntry;
  param: ParamChange;
  event: number[];
  disconnect: unknown;
}

export class SpiderV {
  device: readonly number[] = DEFAULT_DEVICE;
  identity: Identity | null = null;
  info: Record<string, string> = {};
  version = 0;
  presetCount = 0;
  symbols: SymbolTable | null = null;

  private seq = [0, 0];
  private queues: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  private pending: (Pending | null)[] = [null, null];
  private reasm = new Reassembler(false);
  private listeners: { [K in keyof ClientEvents]?: ((v: ClientEvents[K]) => void)[] } = {};

  // symbolTable: a previously fetched table to try before downloading one.
  constructor(readonly transport: Transport, private cachedSymbols: Bytes | null = null) {
    transport.onsysex = (b) => this.onSysex(b);
    transport.ondisconnect = (e) => this.emit('disconnect', e);
  }

  on<K extends keyof ClientEvents>(type: K, fn: (v: ClientEvents[K]) => void): () => void {
    const list = (this.listeners[type] ??= []) as ((v: ClientEvents[K]) => void)[];
    list.push(fn);
    return () => list.splice(list.indexOf(fn), 1);
  }

  private emit<K extends keyof ClientEvents>(type: K, v: ClientEvents[K]) {
    for (const fn of this.listeners[type] ?? []) (fn as (v: ClientEvents[K]) => void)(v);
  }

  private log(dir: LogEntry['dir'], text: string, raw?: Bytes) {
    this.emit('log', { t: Date.now(), dir, text, raw });
  }

  name(id: number) { return this.symbols?.name(id) ?? hex(id); }

  // ------------------------------------------------------------ receive

  private onSysex(bytes: Bytes) {
    const p = parseSysex(bytes);
    if (p.type === 'identity') {
      this.identity = p;
      this.device = [p.family & 0x7f, p.member & 0x7f];
      this.log('in', `identity: family ${hex(p.family)} member ${hex(p.member)}`, bytes);
    } else if (p.type === 'info') {
      this.info = p.info;
      this.log('in', `info: ${Object.entries(p.info).map(([k, v]) => `${k}=${v}`).join(' ')}`, bytes);
    } else if (p.type === 'fragment') {
      const dropped = this.reasm.dropped;
      const msgs = this.reasm.push(p);
      if (this.reasm.dropped !== dropped) this.log('info', `dropped ${this.reasm.dropped - dropped} bytes of an incomplete message on ch${p.channel}`);
      for (const m of msgs) this.onMessage(m, bytes);
    } else {
      this.log('in', 'unrecognised sysex', bytes);
    }
  }

  private onMessage(m: Message, raw: Bytes) {
    if (m.kind === Kind.ParamChanged) {
      const c = decodeParamChange(m.body);
      this.log('in', `changed ${this.name(c.obj)}.${this.name(c.param)} = ${fmt(c.value)}`, raw);
      this.emit('param', c);
      return;
    }
    if (m.kind === Kind.Event) {
      const words = [0, 4, 8, 12].map((o) => i32(m.body, o));
      this.log('in', `event [${words.join(', ')}]`, raw);
      this.emit('event', words);
      return;
    }
    const pend = this.pending[m.channel];
    const short = m.body.length <= 16 ? ': ' + toHex(m.body) : ` (${m.body.length} bytes)`;
    this.log('in', `ch${m.channel} reply${short}`, raw);
    if (pend) {
      this.pending[m.channel] = null;
      clearTimeout(pend.timer);
      pend.resolve(m);
    }
  }

  // ------------------------------------------------------------ send

  private sendPackets(channel: number, msg: Bytes) {
    for (const pkt of encodeSysex(this.device, channel, this.seq[channel], msg)) this.transport.send(pkt);
    this.seq[channel] = (this.seq[channel] + 1) & 0x7f;
  }

  // One request per channel is in flight at a time; later calls queue.
  request(channel: Channel, cmd: number, body: Bytes = [], { timeout = REPLY_TIMEOUT, text = '' } = {}): Promise<Message> {
    const label = text || `ch${channel} cmd ${hex(cmd)}${body.length ? ' ' + toHex(body) : ''}`;
    const run = () => new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending[channel] = null;
        reject(new AmpError(`timeout waiting for reply to: ${label}`));
      }, timeout);
      this.pending[channel] = { resolve, timer };
      this.log('out', label);
      this.sendPackets(channel, encodeMessage(cmd, body));
    });
    const p = this.queues[channel].then(run, run);
    this.queues[channel] = p.catch(() => {});
    return p;
  }

  // Requests whose reply starts with a status word; throws if it is negative.
  private async checked(channel: Channel, cmd: number, body: Bytes = [], opts?: { timeout?: number; text?: string }) {
    const r = await this.request(channel, cmd, body, opts);
    const status = r.body.length >= 4 ? i32(r.body, 0) : 0;
    if (status < 0) throw new AmpError(`${opts?.text ?? hex(cmd)} failed (status ${status})`, status);
    return r;
  }

  // ------------------------------------------------------------ session

  private async identify() {
    const before = this.identity;
    this.log('out', 'identity request');
    this.transport.send(IDENTITY_REQUEST);
    for (let i = 0; i < 30 && this.identity === before; i++) await sleep(50);
  }

  private async handshake(table: Bytes) {
    const r = await this.request(Channel.Editor, EditorCmd.Handshake, le32(crc32(table)), { text: 'handshake' });
    return i32(r.body, 0);
  }

  async fetchSymbolTable(): Promise<Bytes> {
    const size = u32((await this.request(Channel.Editor, EditorCmd.GetSymbolTableSize)).body, 0);
    const r = await this.request(Channel.Editor, EditorCmd.GetSymbolTable, [], { timeout: 30000, text: 'get symbol table' });
    if (r.body.length !== size) throw new AmpError(`symbol table: expected ${size} bytes, got ${r.body.length}`);
    return r.body;
  }

  // Startup: the handshake proves we use the firmware's own symbol table
  // (the reply is -7 when the CRC does not match).
  async connect(): Promise<void> {
    await this.identify();
    this.version = u32((await this.request(Channel.Editor, EditorCmd.GetVersion)).body, 0);
    let table = this.cachedSymbols;
    let status = table ? await this.handshake(table) : -1;
    if (status !== 0) {
      table = await this.fetchSymbolTable();
      status = await this.handshake(table);
      if (status !== 0) throw new AmpError(`amp rejected handshake (status ${status})`, status);
    }
    this.symbols = new SymbolTable(table!);
    await this.request(Channel.Librarian, LibrarianCmd.GetVersion);
    this.presetCount = u32((await this.request(Channel.Librarian, LibrarianCmd.GetNumPresets)).body, 0);
  }

  async close() { await this.transport.close(); }

  // ------------------------------------------------------------ presets

  async presetName(index: number): Promise<string> {
    const r = await this.request(Channel.Librarian, LibrarianCmd.GetPresetInfo, le32(index));
    return decodePresetInfo(r.body).name;
  }

  async loadPreset(index: number) {
    await this.checked(Channel.Librarian, LibrarianCmd.LoadHardwarePreset, le32(index), { text: `load preset ${index}` });
  }

  // index -1 = the edit buffer (current tone, including unsaved edits)
  // Raw preset file (index -1 = edit buffer). The amp answers -1 while it is
  // busy (e.g. right after model changes), so retry a few times.
  async readPresetData(index = -1): Promise<Bytes> {
    const delays = [150, 400, 800, 1500];
    for (let attempt = 0; ; attempt++) {
      const r = await this.request(Channel.Librarian, LibrarianCmd.GetPresetFile, le32(index), { timeout: 10000, text: `read preset ${index}` });
      const status = i32(r.body, 0);
      if (status >= 0 && r.body.length > 4) return r.body.slice(4);
      if (attempt >= delays.length) throw new AmpError(`read preset failed (status ${status})`, status);
      this.log('info', `read preset returned status ${status}, retrying in ${delays[attempt]} ms`);
      await sleep(delays[attempt]);
    }
  }

  async readPreset(index = -1): Promise<Preset> {
    return parsePreset([0, 0, 0, 0, ...(await this.readPresetData(index))]);
  }

  // Writes a preset file to a slot in the amp's memory (or -1: the edit
  // buffer). This is how Spider Remote saves: SetPresetFile(index, data).
  async writePresetData(index: number, data: Bytes) {
    if (!(index === -1 || (index >= 0 && index < this.presetCount))) throw new AmpError(`invalid preset slot ${index}`);
    parseEntries(data); // refuse to send anything that doesn't parse
    await this.checked(Channel.Librarian, LibrarianCmd.SetPresetFile, [...le32(index), ...le32(data.length), ...data],
      { timeout: 15000, text: `write preset ${index} (${data.length} bytes)` });
    await sleep(300); // the official app waits after a write, too
  }

  // Saves the edit buffer to a slot, optionally with new metadata (name,
  // label, CustomTone id). Returns the slot's previous contents for undo.
  async savePreset(index: number, meta: string | PresetMeta = {}): Promise<Bytes> {
    let data = await this.readPresetData(-1);
    data = setPresetMeta(data, typeof meta === 'string' ? { name: meta } : meta);
    const previous = await this.readPresetData(index);
    await this.writePresetData(index, data);
    return previous;
  }

  async currentPresetIndex(): Promise<number> {
    const r = await this.checked(Channel.Editor, EditorCmd.GetPersistentSysParam, le32(SysParam.CurrentPreset), { text: 'get current preset' });
    return decodeTyped(r.body, 4).value;
  }

  async isDirty(): Promise<boolean> {
    const r = await this.request(Channel.Editor, EditorCmd.GetDirtyState, [], { text: 'get dirty state' });
    return r.body[0] === 1;
  }

  // ------------------------------------------------------------ editing

  async getParam(obj: number, param: number): Promise<TypedValue> {
    const r = await this.checked(Channel.Editor, EditorCmd.GetDspModelParam, [...le32(obj), ...le32(param)],
      { text: `get ${this.name(obj)}.${this.name(param)}` });
    return decodeTyped(r.body, 4);
  }

  async setParam(obj: number, param: number, v: TypedValue) {
    await this.checked(Channel.Editor, EditorCmd.SetDspModelParam, [...le32(obj), ...le32(param), ...encodeTyped(v)],
      { text: `set ${this.name(obj)}.${this.name(param)} = ${fmt(v.value)}${v.type === MsgType.Float ? '' : ` (${MsgType[v.type]})`}` });
  }

  async loadModel(slot: number, model: number) {
    await this.checked(Channel.Editor, EditorCmd.LoadDspModel, [...le32(slot), ...le32(model)],
      { text: `load model ${this.name(model)} into ${this.name(slot)}` });
  }

  async setTempo(bpm: number) {
    await this.checked(Channel.Editor, EditorCmd.SetGlobalTempo, leF32(bpm), { text: `set tempo ${bpm}` });
  }

  // Edit-buffer preset settings outside the tone blocks (PresetKey).
  async getPresetKey(key: number): Promise<TypedValue> {
    const r = await this.checked(Channel.Editor, EditorCmd.GetPresetPSKeyParam, le32(key), { text: `get preset key ${key}` });
    return decodeTyped(r.body, 4);
  }

  async setPresetKey(key: number, v: TypedValue) {
    await this.checked(Channel.Editor, EditorCmd.SetPresetPSKeyParam, [...le32(key), ...encodeTyped(v)],
      { text: `set preset key ${key} = ${fmt(v.value)}${v.type === MsgType.Float ? '' : ` (${MsgType[v.type]})`}` });
  }
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
