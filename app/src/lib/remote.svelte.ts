// Remote control: a phone uses the amp connected to this computer's browser.
// The computer shares its connection through the relay in the dev server
// (remote-relay.ts); phones join with a pairing code, usually by scanning a
// QR code. Each phone runs the whole app against a port of the computer's
// hub (protocol/hub.ts), and the browsers keep the shortcuts and channels in
// step (amp.shared()).
import { type SharedState, amp } from './amp.svelte';
import type { HubPort } from './protocol/hub';
import { type AppMessage, RemoteTransport, relayUrl } from './protocol/remote';
import { keepAwake } from './keepawake.svelte';

const STORAGE_KEY = 'spiderv.remote';
const RETRY_MS = 3000;

// keepAwake: a phone used as a remote keeps its screen on.
type Settings = { share: boolean; code: string; lastJoined: string; keepAwake: boolean };
type Info = { addresses: string[]; port: number; https: boolean; lan: boolean };

function load(): Settings {
  const s: Settings = { share: false, code: '', lastJoined: '', keepAwake: true };
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    s.share = !!v.share;
    if (typeof v.code === 'string') s.code = v.code;
    if (typeof v.lastJoined === 'string') s.lastJoined = v.lastJoined;
    if (typeof v.keepAwake === 'boolean') s.keepAwake = v.keepAwake;
  } catch {}
  if (!/^[A-Z0-9]{4,12}$/.test(s.code)) s.code = newCode();
  return s;
}

// No 0/O or 1/I, so it can be typed from a glance.
function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

class Remote {
  settings = $state<Settings>(load());
  dialogOpen = $state(false);
  // Sharing (this computer): relay connection state and joined phones.
  online = $state(false);
  shareError = $state('');
  phones = $state(0);
  info = $state<Info | null>(null);
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ports = new Map<number, HubPort>();
  // The shared state as last sent or received, so taking over another
  // browser's state isn't sent back to it.
  private lastJson = '';

  constructor() {
    $effect.root(() => {
      // Share while connected to an amp, if sharing is on.
      $effect(() => {
        const want = this.settings.share && amp.status === 'ready' && !!amp.hub;
        if (want && !this.ws) this.open();
        else if (!want && this.ws) this.close();
      });
      // Phone: keep the screen on from the first connection, also while
      // reconnecting after a dropout.
      $effect(() => {
        if (this.settings.keepAwake && amp.remoteCode) keepAwake.enable();
        else keepAwake.disable();
      });
      // Phone: listen to the computer once connected.
      $effect(() => {
        const t = amp.status === 'ready' ? amp.client?.transport : null;
        if (t instanceof RemoteTransport) t.onapp((m) => this.fromPeer(m));
      });
      // Both: send shortcut and channel changes to the other browsers.
      $effect(() => {
        if (amp.status !== 'ready' || !(amp.remoteCode || this.online)) return;
        const json = JSON.stringify(amp.shared());
        if (json === this.lastJson) return;
        this.lastJson = json;
        this.broadcast({ t: 'state', state: JSON.parse(json) });
      });
    });
    amp.presetWritten = (index) => this.broadcast({ t: 'written', index });
  }

  update(patch: Partial<Settings>) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
  }

  // A new code disconnects the phones that used the old one.
  newCode() {
    this.close();
    this.update({ code: newCode() });
  }

  // ------------------------------------------------------------ this computer shares its amp

  async loadInfo() {
    try {
      const r = await fetch('/spiderv-remote/info');
      this.info = r.ok ? await r.json() : null;
    } catch {
      this.info = null;
    }
  }

  // Links a phone can open, one per network address of this computer.
  links(): string[] {
    const i = this.info;
    if (!i) return [];
    const proto = i.https ? 'https' : 'http';
    return i.addresses.map((a) => `${proto}://${a}:${i.port}/?remote=${this.settings.code}`);
  }

  private open() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.shareError = '';
    const ws = new WebSocket(relayUrl({ role: 'host', code: this.settings.code }));
    this.ws = ws;
    ws.onopen = () => {
      this.online = true;
      this.lastJson = '';
    };
    ws.onmessage = (e) => {
      let m: AppMessage & { id?: number; from?: number };
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'join' && typeof m.id === 'number') this.phoneJoined(m.id);
      else if (m.t === 'leave' && typeof m.id === 'number') this.phoneLeft(m.id);
      else if (typeof m.from === 'number') this.fromPhone(m.from, m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      const wasOnline = this.online;
      this.dropPhones();
      this.ws = null;
      this.online = false;
      if (e.code === 4001) {
        this.shareError = 'Another tab or browser took over sharing with this code.';
        this.update({ share: false });
        return;
      }
      this.shareError = wasOnline
        ? 'Lost the connection to the relay; retrying…'
        : "Couldn't start sharing. Remote control needs the app's dev server (bun run dev:remote); retrying…";
      this.retry = setTimeout(() => {
        this.retry = null;
        if (this.settings.share && amp.status === 'ready' && !this.ws) this.open();
      }, RETRY_MS);
    };
  }

  private close() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    this.dropPhones();
    this.online = false;
    ws?.close();
  }

  private post(m: AppMessage & { to: number }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private phoneJoined(id: number) {
    const hub = amp.hub;
    if (!hub) return;
    this.ports.get(id)?.close();
    const port = hub.port(`Remote ${id}`);
    port.onsysex = (data) => this.post({ to: id, t: 'sysex', data });
    port.ondisconnect = () => this.post({ to: id, t: 'gone', reason: 'The amp was disconnected from the computer.' });
    this.ports.set(id, port);
    this.phones = this.ports.size;
    this.post({ to: id, t: 'hello', label: amp.label, state: amp.shared() });
  }

  private phoneLeft(id: number) {
    this.ports.get(id)?.close();
    this.ports.delete(id);
    this.phones = this.ports.size;
  }

  private dropPhones() {
    for (const p of this.ports.values()) p.close();
    this.ports.clear();
    this.phones = 0;
  }

  private fromPhone(id: number, m: AppMessage) {
    if (m.t === 'sysex' && Array.isArray(m.data)) {
      this.ports.get(id)?.send(m.data as number[]);
      return;
    }
    this.fromPeer(m);
    // Pass it on to the other phones.
    const { from: _, ...rest } = m as AppMessage & { from?: number };
    for (const other of this.ports.keys()) if (other !== id) this.post({ ...rest, to: other });
  }

  // ------------------------------------------------------------ this page is a remote

  async join(code: string) {
    code = normalizeCode(code);
    if (!code) return;
    this.update({ lastJoined: code });
    if (new URLSearchParams(location.search).get('remote') !== code) {
      history.replaceState(null, '', `?remote=${code}`);
    }
    this.lastJson = '';
    await amp.connect({ remote: code });
  }

  // ------------------------------------------------------------ both

  private fromPeer(m: AppMessage) {
    if (m.t === 'state' && m.state) {
      amp.applyShared(m.state as SharedState);
      this.lastJson = JSON.stringify(amp.shared());
    } else if (m.t === 'written' && typeof m.index === 'number') {
      amp.reloadName(m.index).catch(() => {});
    }
  }

  private broadcast(m: AppMessage) {
    const t = amp.client?.transport;
    if (t instanceof RemoteTransport) t.post(m);
    else for (const id of this.ports.keys()) this.post({ ...m, to: id });
  }
}

export const remote = new Remote();
