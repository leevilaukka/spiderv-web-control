// Application state: one connected amp, its presets and the current tone.
import { SpiderV, type LogEntry, type Transport } from './protocol/client';
import { type Bytes, type ParamChange, MsgType, i32, le32 } from './protocol/codec';
import { WebMidiTransport } from './protocol/webmidi';
import { Hub } from './protocol/hub';
import { RemoteTransport } from './protocol/remote';
import { catalogStore } from './catalog.svelte';
import { type Control, type Slot, MICS, buildChain, splitCab } from './tone';
import { type ToneFile, applyImport, planImport, readToneFile, toToneFile } from './presetfile';
import type { Shortcut } from './shortcuts';
import { type Channels, type PresetExtras, otherChannel, parsePresetExtras, pickGroups, switchTone } from './channels';
import { type Arrangement, arrangedTone } from './arrange';

const SYMBOLS_KEY = 'spiderv.symbols';
const EXTRAS_KEY = 'spiderv.shortcuts'; // named when it held only shortcuts
const POLL_MS = 1500;
const LOG_LIMIT = 400;

const loadCachedSymbols = (): Bytes | null => {
  try {
    const s = localStorage.getItem(SYMBOLS_KEY);
    return s ? Array.from(atob(s), (c) => c.charCodeAt(0)) : null;
  } catch { return null; }
};
const saveCachedSymbols = (b: Bytes) => {
  try { localStorage.setItem(SYMBOLS_KEY, btoa(String.fromCharCode(...b))); } catch {}
};
const loadExtras = () => {
  try { return parsePresetExtras(localStorage.getItem(EXTRAS_KEY)); } catch { return {}; }
};

// Where the amp connection comes from: Web MIDI, the simulated amp, or
// another browser that shares its amp (remote control, by pairing code).
export type Source = 'midi' | 'demo' | { remote: string };

// What the browsers sharing an amp keep in step (remote.svelte.ts): the
// stored shortcuts and channels of every preset, and those of the tone in
// the edit buffer.
export type SharedState = {
  current: number;
  extras: Record<number, PresetExtras>;
  live: { shortcuts: Shortcut[]; channels: Channels | null; channelsEdited: boolean; imported: Amp['imported'] };
};

export class Amp {
  status = $state<'idle' | 'connecting' | 'ready' | 'error'>('idle');
  error = $state('');
  label = $state('');
  firmware = $state('');
  presets = $state<string[]>([]);
  current = $state(-1);
  dirty = $state(false);
  presetName = $state('');
  chain = $state<Slot[]>([]);
  selected = $state('Amp');
  log = $state<LogEntry[]>([]);
  loadingPreset = $state(false);
  importing = $state<{ name: string; done: number; total: number } | null>(null);
  notice = $state<{ kind: 'ok' | 'error'; text: string; details: string[]; undo?: () => Promise<void> } | null>(null);
  saving = $state(false);
  saveDialogOpen = $state(false);
  // Metadata of the tone file last imported into the edit buffer; Save uses it.
  imported = $state<{ name: string; author: string; label?: string; tnid?: number; file: string } | null>(null);
  // Shortcuts and channels of the tone in the edit buffer. They belong to a
  // preset and are kept in this browser; loading a preset loads its own.
  // Shortcut changes to a saved preset are stored right away, an unsaved
  // tone's when it is saved. Channels are stored when the preset is saved,
  // since the amp's preset holds the settings of the channel active then.
  shortcuts = $state<Shortcut[]>([]);
  channels = $state<Channels | null>(null);
  channelsEdited = $state(false);
  switching = $state(false);
  arranging = $state(false);
  private storedExtras = $state<Record<number, PresetExtras>>(loadExtras());
  // Set while this page is a remote control for another browser's amp.
  remoteCode = $state('');
  // The shared amp connection of this page (not a remote), which phones join.
  hub: Hub | null = null;
  // Called after a preset slot was written, so remotes can re-read its name.
  presetWritten: (index: number) => void = () => {};
  // Edit-buffer state from another browser for a preset this page hasn't
  // caught up with yet; used when it does.
  private pendingLive: SharedState | null = null;

  client: SpiderV | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private outbox = new Map<string, { c: Control; value: number }>();
  private pumping = false;
  private lastLocalEdit = 0;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;

  get demo() { return this.label.startsWith('Demo'); }

  async connect(source: Source = 'midi') {
    this.status = 'connecting';
    this.error = '';
    // A dropped reply during startup is rare but possible; one retry fixes it.
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (await this.tryConnect(source, attempt === 2)) return;
    }
  }

  private async tryConnect(source: Source, last: boolean): Promise<boolean> {
    const demo = source === 'demo';
    let hub: Hub | null = null;
    try {
      let t: Transport;
      if (typeof source === 'object') {
        const rt = await RemoteTransport.connect(source.remote);
        // The computer's model catalog, if it has one; else this browser's.
        catalogStore.restore();
        if (rt.hello.catalog) catalogStore.useRemote(rt.hello.catalog);
        t = rt;
      } else {
        if (demo) await catalogStore.useDemo();
        else catalogStore.restore();
        if (demo) {
          const [{ MockTransport }, session] = await Promise.all([
            import('./protocol/mock'),
            import('../../../test/fixtures/spiderv20-mkii-session.json'),
          ]);
          t = new MockTransport(session.default);
        } else {
          t = await WebMidiTransport.connect();
        }
        // Phones can join later through the hub.
        hub = new Hub(t);
        t = hub.port(t.label, { closesAmp: true });
      }
      const client = new SpiderV(t, demo ? null : loadCachedSymbols());
      client.on('log', (e) => {
        this.log.push(e);
        if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
      });
      client.on('param', (c) => this.onParamChanged(c));
      client.on('event', () => this.scheduleResync());
      client.on('disconnect', (e) => this.disconnected((e as Error | undefined)?.message || 'The amp was disconnected.'));
      this.client = client;
      await client.connect();
      if (!demo && !t.label.startsWith('Demo')) saveCachedSymbols(client.symbols!.bytes);
      if (hub) hub.symbols = client.symbols!.bytes;
      this.hub = hub;
      this.remoteCode = typeof source === 'object' ? source.remote : '';
      this.label = t.label;
      this.firmware = client.info.L6Version ?? '';
      this.current = await client.currentPresetIndex();
      this.loadExtras();
      if (t instanceof RemoteTransport && t.hello.state) this.applyShared(t.hello.state as SharedState);
      await this.refresh();
      this.status = 'ready';
      this.loadNames();
      this.pollTimer = setInterval(() => this.poll(), POLL_MS);
      return true;
    } catch (e) {
      await this.client?.close().catch(() => {});
      this.client = null;
      if (last) {
        this.status = 'error';
        this.error = (e as Error).message;
      }
      return false;
    }
  }

  async disconnect() {
    await this.client?.close().catch(() => {});
    this.disconnected('');
  }

  private disconnected(msg: string) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.client = null;
    this.hub = null;
    this.pendingLive = null;
    this.status = msg ? 'error' : 'idle';
    this.error = msg;
    this.chain = [];
    this.presets = [];
    this.shortcuts = [];
    this.channels = null;
  }

  async reloadName(index: number) {
    if (this.client && index >= 0 && index < this.presets.length) this.presets[index] = await this.client.presetName(index);
  }

  private async loadNames() {
    const c = this.client!;
    const names: string[] = new Array(c.presetCount).fill('');
    this.presets = names;
    try {
      for (let i = 0; i < c.presetCount && this.client === c; i++) {
        this.presets[i] = await c.presetName(i);
      }
    } catch (e) {
      if (this.client === c) this.report(e);
    }
  }

  // Re-reads the edit buffer.
  async refresh() {
    const c = this.client!;
    const p = await c.readPreset();
    this.presetName = p.name;
    this.chain = buildChain(p, c.symbols!);
    this.dirty = await c.isDirty();
  }

  async selectPreset(i: number) {
    if (!this.client) return;
    this.loadingPreset = true;
    try {
      await this.client.loadPreset(i);
      this.current = i;
      this.imported = null;
      this.loadExtras();
      await this.refresh();
    } catch (e) {
      this.report(e);
    } finally {
      this.loadingPreset = false;
    }
  }

  // Detects preset changes and edits made on the amp itself.
  private async poll() {
    const c = this.client;
    if (!c || this.loadingPreset || this.importing || this.saving || this.switching || this.arranging || this.outbox.size) return;
    try {
      const idx = await c.currentPresetIndex();
      if (idx !== this.current) {
        this.current = idx;
        this.imported = null;
        this.loadExtras();
        await this.refresh();
      } else {
        this.dirty = await c.isDirty();
      }
    } catch (e) {
      this.report(e);
    }
  }

  // ------------------------------------------------------------ editing

  // Updates the UI immediately; sends are coalesced per control so dragging
  // a knob never queues more than one pending value.
  set(c: Control, value: number) {
    this.lastLocalEdit = Date.now();
    c.value = value;
    this.outbox.set(c.key, { c, value });
    this.dirty = true;
    this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.outbox.size && this.client) {
        const [key, { c, value }] = this.outbox.entries().next().value!;
        this.outbox.delete(key);
        await this.client.setParam(c.obj, c.ctrl, { type: c.type, value }).catch((e) => this.report(e));
      }
    } finally {
      this.pumping = false;
    }
  }

  toggle(slot: Slot) {
    if (slot.enable) this.set(slot.enable, slot.enable.value ? 0 : 1);
  }

  async changeModel(slot: Slot, model: number) {
    if (!this.client || model === slot.model) return;
    try {
      await this.client.loadModel(slot.id, model);
      await this.refresh();
    } catch (e) {
      this.report(e);
    }
  }

  async changeCab(slot: Slot, cab: string, mic: number) {
    const st = this.client?.symbols;
    if (!st) return;
    const id = cab === '@NoCabinet' ? st.id('NoCabinet') : st.id(cab + MICS[Math.max(0, mic)].suffix);
    if (id !== undefined) await this.changeModel(slot, id);
  }

  cabOf(slot: Slot) { return splitCab(slot.modelSym); }

  // The amp sends an "edit buffer changed" event after edits, including
  // ones made with its own knobs. Re-read the tone then, unless the change
  // was most likely ours.
  private scheduleResync() {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      if (!this.client || this.importing || this.outbox.size || Date.now() - this.lastLocalEdit < 3000) return;
      this.refresh().catch((e) => this.report(e));
    }, 400);
  }

  private onParamChanged(ch: ParamChange) {
    for (const slot of this.chain) {
      for (const c of [slot.enable, ...slot.params, ...slot.extras]) {
        if (c && c.obj === ch.obj && c.ctrl === ch.param) {
          c.value = c.type === MsgType.Float ? ch.value : Math.round(ch.value);
          this.dirty = true;
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------ shortcuts and channels

  // Changes the edit buffer's shortcuts. For a saved preset they are stored
  // right away; for an unsaved tone, when it is saved.
  setShortcuts(list: Shortcut[]) {
    this.shortcuts = list;
    if (!this.imported && this.current >= 0) {
      this.storeExtras(this.current, { shortcuts: list, channels: this.storedExtras[this.current]?.channels ?? null });
    }
  }

  // Sets up, changes or (with null) removes the channels; Save stores them.
  setChannels(ch: Channels | null) {
    this.channels = ch;
    this.channelsEdited = true;
  }

  // Splits the given blocks into channels A and B, both starting as they are now.
  async startChannels(groups: string[]) {
    const tone = (await this.currentTone()).data.tone;
    this.setChannels({ groups, active: 'A', other: pickGroups(tone, groups) });
  }

  // Changes one stored setting of the inactive channel, e.g. a block's "@enabled".
  setOtherSetting(group: string, key: string, value: number | string | boolean) {
    const ch = this.channels;
    if (!ch?.other[group]) return;
    const next = $state.snapshot(ch);
    next.other[group][key] = value;
    this.setChannels(next);
  }

  // Changes which blocks belong to the channels. An added block starts out
  // the same in both channels.
  async setChannelGroups(groups: string[]) {
    const ch = this.channels;
    if (!ch) return;
    if (!groups.length) return this.setChannels(null);
    const tone = (await this.currentTone()).data.tone;
    const other = Object.fromEntries(groups.map((g) => [g, structuredClone($state.snapshot(ch.other[g]) ?? tone[g])]).filter(([, t]) => t));
    this.setChannels({ ...$state.snapshot(ch), groups, other });
  }

  // Switches to the other channel: keeps the active channel's settings as
  // they are now and sends only what differs for the other one.
  async switchChannel() {
    const c = this.client, ch = this.channels;
    if (!c?.symbols || !ch || this.switching || this.importing || this.loadingPreset) return;
    this.switching = true;
    try {
      await this.flushEdits();
      const preset = await c.readPreset();
      const current = toToneFile(preset, c.symbols);
      const file = structuredClone(current);
      file.data.tone = switchTone(current.data.tone, $state.snapshot(ch.other));
      this.lastLocalEdit = Date.now();
      const failed = await applyImport(c, planImport(file, c.symbols, preset));
      this.channels = { ...ch, active: otherChannel(ch.active), other: pickGroups(current.data.tone, ch.groups) };
      this.channelsEdited = true;
      await this.refresh();
      if (failed.length) this.notice = { kind: 'error', text: `Some settings of channel ${this.channels.active} didn't reach the amp.`, details: failed };
    } catch (e) {
      this.report(e);
    } finally {
      this.switching = false;
      this.lastLocalEdit = Date.now();
    }
  }

  // Moves blocks around the chain (see arrange.ts): effects that change slots
  // take their settings along, and shortcuts and the selection follow them.
  // The shortcuts are stored with the tone when it is saved, so discarding
  // the edit brings back both as they were.
  async rearrange(a: Arrangement) {
    const c = this.client;
    if (!c?.symbols || this.arranging || this.switching || this.importing || this.loadingPreset) return;
    this.arranging = true;
    try {
      await this.flushEdits();
      const preset = await c.readPreset();
      const current = toToneFile(preset, c.symbols);
      const file = structuredClone(current);
      file.data.tone = switchTone(current.data.tone, arrangedTone(current.data.tone, a));
      this.lastLocalEdit = Date.now();
      const failed = await applyImport(c, planImport(file, c.symbols, preset));
      const to: Record<string, string> = Object.fromEntries(Object.entries(a.moves).map(([slot, from]) => [from, slot]));
      if (Object.keys(to).length) {
        const follow = (sym: string) => to[sym] ?? sym;
        this.shortcuts = this.shortcuts.map((s) => ({
          ...s,
          targets: s.targets.map((t) => ({ ...t, sym: follow(t.sym) })),
          knobs: s.knobs.map((k) => ({ ...k, sym: follow(k.sym) })),
        }));
        this.selected = follow(this.selected);
      }
      await this.refresh();
      if (failed.length) this.notice = { kind: 'error', text: "Some settings didn't reach the amp while moving blocks.", details: failed };
    } catch (e) {
      this.report(e);
    } finally {
      this.arranging = false;
      this.lastLocalEdit = Date.now();
    }
  }

  private loadExtras() {
    const p = this.pendingLive;
    this.pendingLive = null;
    if (p?.current === this.current) return this.applyLive(p.live);
    const e = $state.snapshot(this.storedExtras[this.current]);
    this.shortcuts = e?.shortcuts ?? [];
    this.channels = e?.channels ?? null;
    this.channelsEdited = false;
  }

  // ------------------------------------------------------------ sharing with remotes

  shared(): SharedState {
    return $state.snapshot({
      current: this.current,
      extras: this.storedExtras,
      live: { shortcuts: this.shortcuts, channels: this.channels, channelsEdited: this.channelsEdited, imported: this.imported },
    });
  }

  // Takes over another browser's state. Its edit-buffer part applies only
  // when both show the same preset; otherwise it waits until this page has
  // noticed the preset change too.
  applyShared(s: SharedState) {
    this.storedExtras = $state.snapshot(s.extras);
    try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(this.storedExtras)); } catch {}
    if (s.current === this.current) {
      this.pendingLive = null;
      this.applyLive(s.live);
    } else {
      this.pendingLive = $state.snapshot(s);
    }
  }

  private applyLive(l: SharedState['live']) {
    this.shortcuts = $state.snapshot(l.shortcuts);
    this.channels = $state.snapshot(l.channels);
    this.channelsEdited = l.channelsEdited;
    this.imported = $state.snapshot(l.imported);
  }

  private storeExtras(index: number, e: PresetExtras) {
    if (e.shortcuts.length || e.channels) this.storedExtras[index] = $state.snapshot(e);
    else delete this.storedExtras[index];
    try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(this.storedExtras)); } catch {}
  }

  // ------------------------------------------------------------ tone files

  async importTone(file: File) {
    const c = this.client;
    if (!c?.symbols || this.importing) return;
    this.notice = null;
    try {
      const bytes = [...new Uint8Array(await file.arrayBuffer())];
      const { plan, applied, failed, refreshError } = await this.applyTone(readToneFile(bytes, c.symbols), file.name);
      this.notice = {
        kind: failed.length || refreshError ? 'error' : 'ok',
        text: `Loaded “${plan.name}”${plan.author ? ` by ${plan.author}` : ''} into the edit buffer: ${applied} settings applied` +
          (plan.skipped.length ? `, ${plan.skipped.length} not supported` : '') + (failed.length ? `, ${failed.length} failed` : '') +
          '. Use Save to store it with the name from the file, or pick a preset to discard it.',
        details: [
          ...(refreshError ? [`Couldn't re-read the tone afterwards (${refreshError}); press Refresh.`] : []),
          ...plan.warnings,
          ...failed.map((l) => `Failed: ${l}`),
          ...(plan.skipped.length ? [`Not supported by this amp: ${plan.skipped.join(', ')}`] : []),
        ],
      };
    } catch (e) {
      this.notice = { kind: 'error', text: (e as Error).message, details: [] };
    }
  }

  // Applies a tone file to the edit buffer, one model/parameter at a time.
  // `file` is the file name it came from, or '' for tones made in the app.
  async applyTone(tone: ToneFile, file: string) {
    const c = this.client;
    if (!c?.symbols) throw new Error('Not connected to an amp.');
    if (this.importing) throw new Error('Another tone is still being applied.');
    try {
      await this.flushEdits();
      const plan = planImport(tone, c.symbols, await c.readPreset());
      this.importing = { name: plan.name, done: 0, total: plan.ops.length };
      const failed = await applyImport(c, plan, (done) => {
        this.lastLocalEdit = Date.now();
        if (this.importing) this.importing.done = done;
      });
      let refreshError = '';
      await this.refresh().catch((e) => { refreshError = (e as Error).message; });
      this.imported = { name: plan.name, author: plan.author, label: plan.label, tnid: plan.tnid, file };
      return { plan, applied: plan.ops.length - failed.length, failed, refreshError };
    } finally {
      this.importing = null;
      this.lastLocalEdit = Date.now();
    }
  }

  // The edit buffer as a tone file, including knob changes still on their way.
  async currentTone(): Promise<ToneFile> {
    const c = this.client;
    if (!c?.symbols) throw new Error('Not connected to an amp.');
    await this.flushEdits();
    const preset = await c.readPreset();
    const id = c.identity ? (c.identity.family << 16) | c.identity.member : undefined;
    return toToneFile(preset, c.symbols, id, c.version);
  }

  // ------------------------------------------------------------ saving

  // Writes the edit buffer to a preset slot on the amp, then loads that
  // preset so the amp shows it as saved. The tone's shortcuts and channels go
  // to that slot too. Keeps what it overwrote so the save can be undone.
  async saveTone(index: number, name: string) {
    const meta = { name, ...(this.imported ? { label: this.imported.label, tnid: this.imported.tnid } : {}) };
    const c = this.client;
    if (!c || this.saving) return;
    this.saving = true;
    this.notice = null;
    const oldName = this.presets[index] ?? '';
    const oldExtras = this.storedExtras[index] ?? { shortcuts: [], channels: null };
    try {
      await this.flushEdits();
      const previous = await c.savePreset(index, meta);
      this.storeExtras(index, { shortcuts: this.shortcuts, channels: this.channels });
      this.channelsEdited = false;
      this.imported = null;
      await c.loadPreset(index);
      this.current = index;
      this.presets[index] = await c.presetName(index);
      this.presetWritten(index);
      await this.refresh();
      this.notice = {
        kind: 'ok',
        text: `Saved “${this.presets[index]}” to preset ${index + 1}` + (oldName && oldName !== this.presets[index] ? `, replacing “${oldName}”.` : '.'),
        details: [],
        undo: async () => {
          await c.writePresetData(index, previous);
          this.storeExtras(index, oldExtras);
          await c.loadPreset(index);
          this.current = index;
          this.loadExtras();
          this.presets[index] = await c.presetName(index);
          this.presetWritten(index);
          await this.refresh();
          this.notice = { kind: 'ok', text: `Restored the previous preset ${index + 1} “${this.presets[index]}”.`, details: [] };
        },
      };
    } catch (e) {
      this.notice = { kind: 'error', text: `Saving failed: ${(e as Error).message}. The preset on the amp was not changed unless the write itself went through; check preset ${index + 1}.`, details: [] };
    } finally {
      this.saving = false;
    }
  }

  // Waits until queued knob changes have reached the amp.
  private async flushEdits() {
    while (this.outbox.size || this.pumping) await new Promise((r) => setTimeout(r, 20));
  }

  // Downloads every preset slot (raw) as one JSON file.
  async backupPresets() {
    const c = this.client;
    if (!c || this.saving) return;
    this.saving = true;
    try {
      const presets = [];
      for (let i = 0; i < c.presetCount; i++) {
        const data = await c.readPresetData(i);
        presets.push({ index: i, name: this.presets[i], data: btoa(String.fromCharCode(...data)) });
      }
      const json = JSON.stringify({ info: c.info, date: new Date().toISOString(), presets });
      download(json, `spiderv-presets-${new Date().toISOString().slice(0, 10)}.json`);
      this.notice = { kind: 'ok', text: `Backed up all ${presets.length} presets.`, details: [] };
    } catch (e) {
      this.notice = { kind: 'error', text: `Backup failed: ${(e as Error).message}`, details: [] };
    } finally {
      this.saving = false;
    }
  }

  // Downloads the current tone as a Spider V Remote tone file (.svl6p).
  async exportTone() {
    if (!this.client?.symbols) return;
    try {
      const tone = await this.currentTone();
      download(JSON.stringify(tone), `${(tone.data.meta.name || 'tone').replace(/[^\w\- ]+/g, '_').trim()}.svl6p`);
    } catch (e) {
      this.notice = { kind: 'error', text: `Export failed: ${(e as Error).message}`, details: [] };
    }
  }

  // ------------------------------------------------------------ console

  async raw(channel: number, cmd: number, words: number[]) {
    if (!this.client) return;
    try {
      const r = await this.client.request(channel, cmd, words.flatMap((w) => le32(w)));
      if (r.body.length >= 4 && i32(r.body, 0) < 0) this.info(`status ${i32(r.body, 0)}`);
    } catch (e) {
      this.report(e);
    }
  }

  private info(text: string) { this.log.push({ t: Date.now(), dir: 'info', text }); }
  private report(e: unknown) { this.info(`error: ${(e as Error).message}`); }
}

function download(text: string, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const amp = new Amp();

// Handy for poking at the protocol from the devtools console.
if (import.meta.env.DEV) (globalThis as unknown as { amp: Amp }).amp = amp;
