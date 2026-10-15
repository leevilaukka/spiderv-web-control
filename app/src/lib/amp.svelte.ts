// Application state: one connected amp, its presets and the current tone.
import { SpiderV, type LogEntry, type Transport } from './protocol/client';
import { type Bytes, type ParamChange, MsgType, i32, le32 } from './protocol/codec';
import { WebMidiTransport } from './protocol/webmidi';
import { type Control, type Slot, MICS, buildChain, splitCab } from './tone';
import { applyImport, planImport, readToneFile, toToneFile } from './presetfile';

const SYMBOLS_KEY = 'spiderv.symbols';
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

  client: SpiderV | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private outbox = new Map<string, { c: Control; value: number }>();
  private pumping = false;
  private lastLocalEdit = 0;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;

  get demo() { return this.label.startsWith('Demo'); }

  async connect(demo = false) {
    this.status = 'connecting';
    this.error = '';
    // A dropped reply during startup is rare but possible; one retry fixes it.
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (await this.tryConnect(demo, attempt === 2)) return;
    }
  }

  private async tryConnect(demo: boolean, last: boolean): Promise<boolean> {
    try {
      let t: Transport;
      if (demo) {
        const [{ MockTransport }, session] = await Promise.all([
          import('./protocol/mock'),
          import('../../../test/fixtures/spiderv20-mkii-session.json'),
        ]);
        t = new MockTransport(session.default);
      } else {
        t = await WebMidiTransport.connect();
      }
      const client = new SpiderV(t, demo ? null : loadCachedSymbols());
      client.on('log', (e) => {
        this.log.push(e);
        if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
      });
      client.on('param', (c) => this.onParamChanged(c));
      client.on('event', () => this.scheduleResync());
      client.on('disconnect', () => this.disconnected('The amp was disconnected.'));
      this.client = client;
      await client.connect();
      if (!demo) saveCachedSymbols(client.symbols!.bytes);
      this.label = t.label;
      this.firmware = client.info.L6Version ?? '';
      this.current = await client.currentPresetIndex();
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
    this.status = msg ? 'error' : 'idle';
    this.error = msg;
    this.chain = [];
    this.presets = [];
  }

  private async loadNames() {
    const c = this.client!;
    const names: string[] = new Array(c.presetCount).fill('');
    this.presets = names;
    for (let i = 0; i < c.presetCount && this.client === c; i++) {
      this.presets[i] = await c.presetName(i);
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
    if (!c || this.loadingPreset || this.importing || this.saving || this.outbox.size) return;
    try {
      const idx = await c.currentPresetIndex();
      if (idx !== this.current) {
        this.current = idx;
        this.imported = null;
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

  // ------------------------------------------------------------ tone files

  // Applies a tone file to the edit buffer, one model/parameter at a time.
  async importTone(file: File) {
    const c = this.client;
    if (!c?.symbols || this.importing) return;
    this.notice = null;
    try {
      const bytes = [...new Uint8Array(await file.arrayBuffer())];
      const plan = planImport(readToneFile(bytes, c.symbols), c.symbols, await c.readPreset());
      this.importing = { name: plan.name, done: 0, total: plan.ops.length };
      const failed = await applyImport(c, plan, (done) => {
        this.lastLocalEdit = Date.now();
        if (this.importing) this.importing.done = done;
      });
      let refreshError = '';
      await this.refresh().catch((e) => { refreshError = (e as Error).message; });
      const applied = plan.ops.length - failed.length;
      this.imported = { name: plan.name, author: plan.author, label: plan.label, tnid: plan.tnid, file: file.name };
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
    } finally {
      this.importing = null;
      this.lastLocalEdit = Date.now();
    }
  }

  // ------------------------------------------------------------ saving

  // Writes the edit buffer to a preset slot on the amp, then loads that
  // preset so the amp shows it as saved. Keeps the overwritten preset so the
  // save can be undone.
  async saveTone(index: number, name: string) {
    const meta = { name, ...(this.imported ? { label: this.imported.label, tnid: this.imported.tnid } : {}) };
    const c = this.client;
    if (!c || this.saving) return;
    this.saving = true;
    this.notice = null;
    const oldName = this.presets[index] ?? '';
    try {
      await this.flushEdits();
      const previous = await c.savePreset(index, meta);
      this.imported = null;
      await c.loadPreset(index);
      this.current = index;
      this.presets[index] = await c.presetName(index);
      await this.refresh();
      this.notice = {
        kind: 'ok',
        text: `Saved “${this.presets[index]}” to preset ${index + 1}` + (oldName && oldName !== this.presets[index] ? `, replacing “${oldName}”.` : '.'),
        details: [],
        undo: async () => {
          await c.writePresetData(index, previous);
          await c.loadPreset(index);
          this.current = index;
          this.presets[index] = await c.presetName(index);
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
    const c = this.client;
    if (!c?.symbols) return;
    try {
      const preset = await c.readPreset();
      const id = c.identity ? (c.identity.family << 16) | c.identity.member : undefined;
      const json = JSON.stringify(toToneFile(preset, c.symbols, id, c.version));
      download(json, `${(preset.name || 'tone').replace(/[^\w\- ]+/g, '_').trim()}.svl6p`);
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
