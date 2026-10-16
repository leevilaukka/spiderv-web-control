// Transport for a phone (or any browser) controlling the amp through another
// browser that is connected to it: SysEx travels over a WebSocket relay
// (remote-relay.ts) to that browser's hub (hub.ts). Works without Web MIDI,
// so iPhones can be remotes too.
import type { Bytes } from './codec';
import type { Transport } from './client';

// Messages between the host page and a remote, besides SysEx.
export type AppMessage = { t: string; [k: string]: unknown };

const HELLO_TIMEOUT = 6000;

export const relayUrl = (params: Record<string, string>) =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/spiderv-remote?${new URLSearchParams(params)}`;

export class RemoteTransport implements Transport {
  label = '';
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};
  // The host's greeting: its amp's label and the shared app state.
  hello: AppMessage = { t: 'hello' };
  private appHandler: ((m: AppMessage) => void) | null = null;
  private backlog: AppMessage[] = [];
  private closing = false;

  private constructor(private ws: WebSocket) {}

  static connect(code: string): Promise<RemoteTransport> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl({ role: 'remote', code }));
      } catch (e) {
        return reject(new Error(`Couldn't reach the computer (${(e as Error).message}).`));
      }
      const t = new RemoteTransport(ws);
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail("The computer didn't answer. Is the app still open there?"), HELLO_TIMEOUT);
      ws.onmessage = (e) => {
        let m: AppMessage;
        try { m = JSON.parse(e.data); } catch { return; }
        if (!settled) {
          if (m.t !== 'hello') return;
          settled = true;
          clearTimeout(timer);
          t.hello = m;
          t.label = String(m.label ?? 'Spider V');
          resolve(t);
          return;
        }
        if (m.t === 'sysex' && Array.isArray(m.data)) t.onsysex(m.data as Bytes);
        else if (m.t === 'gone') t.ondisconnect(new Error(String(m.reason ?? 'The amp was disconnected from the computer.')));
        else if (t.appHandler) t.appHandler(m);
        else t.backlog.push(m);
      };
      ws.onclose = (e) => {
        if (!settled) return fail(closeReason(e, code));
        if (!t.closing) t.ondisconnect(new Error(closeReason(e, code)));
      };
    });
  }

  // Handles app messages (state updates); ones that arrived earlier are passed on first.
  onapp(fn: (m: AppMessage) => void) {
    this.appHandler = fn;
    for (const m of this.backlog.splice(0)) fn(m);
  }

  post(m: AppMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  send(bytes: Bytes) { this.post({ t: 'sysex', data: bytes }); }

  async close() {
    this.closing = true;
    this.ws.close();
  }
}

function closeReason(e: CloseEvent, code: string): string {
  if (e.code === 4004) return `No computer is sharing an amp with code ${code}. Check the code, or turn on sharing on the computer.`;
  if (e.code === 4002) return 'The computer stopped sharing the amp.';
  if (e.reason) return `Connection closed: ${e.reason}.`;
  return 'Lost the connection to the computer.';
}
