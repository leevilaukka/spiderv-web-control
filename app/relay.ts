// Relay for remote control: the browser connected to the amp ("host") and
// phones ("remotes") meet here over WebSockets, by a pairing code. The relay
// only passes JSON messages along; the host's page does all the work. Used
// by the dev server (remote-relay.ts) and the production server (server.ts).
//
//   /spiderv-remote?role=host&code=…    the host; a new host with the same code replaces the old one
//   /spiderv-remote?role=remote&code=…  a phone; the host is told {t:'join'|'leave', id}
//   host → {to: id, …} goes to that phone; phone → {…} reaches the host as {from: id, …}
//   /spiderv-remote/info                this machine's LAN addresses, for the link the host shows
//
// PUBLIC_ADDRESSES (comma-separated) overrides the addresses shown, e.g. in a
// container on a bridge network, whose own addresses phones can't reach.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Http2SecureServer } from 'node:http2';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

export const RELAY_PATH = '/spiderv-remote';
// Container and VM bridges, which phones can't reach.
const VIRTUAL = /^(docker|br-|veth|virbr|cni|podman|vmnet|vboxnet)/;

type Session = { host: WebSocket; remotes: Map<number, WebSocket> };

export function createRelay() {
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 << 20 });
  let nextId = 1;
  let bound: Server | Http2SecureServer | null = null;

  function onConnection(ws: WebSocket, url: URL) {
    const role = url.searchParams.get('role');
    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return ws.close(4000, 'bad code');

    if (role === 'host') {
      const old = sessions.get(code);
      const s: Session = { host: ws, remotes: old?.remotes ?? new Map() };
      sessions.set(code, s);
      if (old) old.host.close(4001, 'replaced by another host');
      // Phones that stayed connected through a host reload join again.
      for (const id of s.remotes.keys()) send(ws, { t: 'join', id });
      ws.on('message', (data) => {
        const msg = parse(data);
        if (!msg || typeof msg.to !== 'number') return;
        const { to, ...rest } = msg;
        const r = s.remotes.get(to);
        if (r) send(r, rest);
      });
      ws.on('close', () => {
        if (sessions.get(code) !== s || s.host !== ws) return;
        sessions.delete(code);
        for (const r of s.remotes.values()) r.close(4002, 'the computer stopped sharing');
      });
    } else if (role === 'remote') {
      const s = sessions.get(code);
      if (!s) return ws.close(4004, 'no computer is sharing with this code');
      const id = nextId++;
      s.remotes.set(id, ws);
      send(s.host, { t: 'join', id });
      ws.on('message', (data) => {
        const msg = parse(data);
        const cur = sessions.get(code);
        if (msg && cur?.remotes.get(id) === ws) send(cur.host, { ...msg, from: id });
      });
      ws.on('close', () => {
        const cur = sessions.get(code);
        if (cur?.remotes.get(id) !== ws) return;
        cur.remotes.delete(id);
        send(cur.host, { t: 'leave', id });
      });
    } else {
      ws.close(4000, 'bad role');
    }
  }

  // Handles WebSocket upgrades to the relay path; others (like Vite's HMR
  // socket) are left to their own handlers.
  function attach(httpServer: Server | Http2SecureServer | null) {
    bound = httpServer;
    httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== RELAY_PATH) return;
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, url));
    });
  }

  function info(req: IncomingMessage, res: ServerResponse) {
    const addr = bound?.address();
    const https = (req.socket as { encrypted?: boolean }).encrypted === true;
    const fromEnv = (process.env.PUBLIC_ADDRESSES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const lan = fromEnv.length ? fromEnv : Object.entries(networkInterfaces())
      .filter(([name]) => !VIRTUAL.test(name))
      .flatMap(([, list]) => list ?? [])
      .filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
    // The port the browser used, which is the one to give phones too even
    // when a container maps it to another port inside.
    const hostPort = Number(/:(\d+)$/.exec(req.headers.host ?? '')?.[1]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      addresses: lan,
      port: hostPort || (addr && typeof addr === 'object' ? addr.port : https ? 443 : 80),
      https,
      // Other machines can connect only when bound to all interfaces (vite --host).
      lan: !!addr && typeof addr === 'object' && !/^(127\.|::1$|::ffff:127\.)/.test(addr.address),
    }));
  }

  return { attach, info };
}

function parse(data: unknown): Record<string, unknown> & { to?: unknown } | null {
  try {
    const v = JSON.parse(String(data));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
