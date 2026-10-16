// Shares one amp connection between several clients: the app on this
// computer and phones using it as a remote control. Each client gets a port
// that looks like a transport of its own. The amp answers one request per
// channel at a time and its replies say nothing about who asked, so the hub
// forwards requests one by one and routes each reply to the port that sent
// the request. Events from the amp go to every port.
import {
  type Bytes, type Message, Channel, DEFAULT_DEVICE, EditorCmd, Kind, LibrarianCmd, Reassembler,
  crc32, encodeMessage, encodeSysex, i32, le32, parseSysex, u32,
} from './codec';
import type { Transport } from './client';

type Job = { port: HubPort; channel: number; cmd: number; body: Bytes; orphaned: boolean; timer?: ReturnType<typeof setTimeout> };

// How long to wait for the amp before moving on to the next request; a bit
// longer than the client waits for the same command.
const timeoutFor = (j: Job) =>
  j.channel === Channel.Editor && j.cmd === EditorCmd.GetSymbolTable ? 31000
    : j.channel === Channel.Librarian && (j.cmd === LibrarianCmd.GetPresetFile || j.cmd === LibrarianCmd.SetPresetFile) ? 16000
      : 5000;

export class HubPort implements Transport {
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};
  readonly reasm = new Reassembler();
  readonly seq = [0, 0];

  constructor(private hub: Hub, public label: string, private closesAmp: boolean) {}

  send(bytes: Bytes) { this.hub.fromPort(this, bytes); }

  async close() {
    this.hub.detach(this);
    if (this.closesAmp) await this.hub.amp.close();
  }
}

export class Hub {
  // The symbol table the amp accepted. Once known, the hub answers symbol
  // table requests and handshakes itself, so that a client with a stale
  // table can't make the amp drop the authentication of the others.
  symbols: Bytes | null = null;
  private ports = new Set<HubPort>();
  private queues: Job[][] = [[], []];
  private busy: (Job | null)[] = [null, null];
  private seq = [0, 0];
  private device: readonly number[] = DEFAULT_DEVICE;
  private reasm = new Reassembler(false);
  private identity: Bytes[] = [];

  constructor(readonly amp: Transport) {
    amp.onsysex = (b) => this.fromAmp(b);
    amp.ondisconnect = (e) => { for (const p of this.ports) p.ondisconnect(e); };
  }

  // closesAmp: closing this port closes the amp connection (the app's own port).
  port(label = this.amp.label, { closesAmp = false } = {}): HubPort {
    const p = new HubPort(this, label, closesAmp);
    this.ports.add(p);
    return p;
  }

  get portCount() { return this.ports.size; }

  detach(port: HubPort) {
    if (!this.ports.delete(port)) return;
    for (const q of this.queues) for (let i = q.length - 1; i >= 0; i--) if (q[i].port === port) q.splice(i, 1);
    for (const j of this.busy) if (j?.port === port) j.orphaned = true;
  }

  // ------------------------------------------------------------ from clients

  fromPort(port: HubPort, bytes: Bytes) {
    if (!this.ports.has(port)) return;
    if (bytes[1] === 0x7e) {
      // Identity request: the amp's answer doesn't change, so answer from the
      // first one.
      if (this.identity.length) for (const b of this.identity) this.deliverRaw(port, b);
      else this.amp.send(bytes);
      return;
    }
    const p = parseSysex(bytes);
    if (p.type !== 'fragment') return;
    for (const m of port.reasm.push(p)) this.request(port, m);
  }

  private request(port: HubPort, m: Message) {
    const { channel, kind: cmd, body } = m;
    if (channel !== Channel.Editor && channel !== Channel.Librarian) return;
    // A client sends one request per channel at a time. A new one means it
    // gave up on the previous (timed out), so drop that or ignore its reply.
    const q = this.queues[channel];
    const queued = q.findIndex((j) => j.port === port);
    if (queued >= 0) q.splice(queued, 1);
    if (this.busy[channel]?.port === port) this.busy[channel]!.orphaned = true;

    if (this.symbols && cmd >= 0x02 && cmd <= 0x04) {
      // GetSymbolTableSize, GetSymbolTable, Handshake (same IDs on both channels)
      const reply = cmd === 0x02 ? le32(this.symbols.length)
        : cmd === 0x03 ? this.symbols
          : le32(u32(body, 0) === crc32(this.symbols) ? 0 : -7);
      this.deliver(port, channel, Kind.Reply, reply);
      return;
    }
    q.push({ port, channel, cmd, body, orphaned: false });
    this.pump(channel);
  }

  private pump(channel: number) {
    if (this.busy[channel]) return;
    const job = this.queues[channel].shift();
    if (!job) return;
    this.busy[channel] = job;
    for (const pkt of encodeSysex(this.device, channel, this.seq[channel], encodeMessage(job.cmd, job.body))) this.amp.send(pkt);
    this.seq[channel] = (this.seq[channel] + 1) & 0x7f;
    job.timer = setTimeout(() => {
      if (this.busy[channel] !== job) return;
      this.busy[channel] = null;
      this.pump(channel);
    }, timeoutFor(job));
  }

  // ------------------------------------------------------------ from the amp

  private fromAmp(bytes: Bytes) {
    const p = parseSysex(bytes);
    if (p.type === 'identity' || p.type === 'info') {
      if (p.type === 'identity') {
        this.identity = [];
        this.device = [p.family & 0x7f, p.member & 0x7f];
      }
      this.identity.push(bytes);
      for (const port of this.ports) this.deliverRaw(port, bytes);
      return;
    }
    if (p.type !== 'fragment') {
      for (const port of this.ports) this.deliverRaw(port, bytes);
      return;
    }
    for (const m of this.reasm.push(p)) {
      if (m.kind !== Kind.Reply) {
        for (const port of this.ports) this.deliver(port, m.channel, m.kind, m.body);
        continue;
      }
      const job = this.busy[m.channel];
      if (!job) continue;
      clearTimeout(job.timer);
      this.busy[m.channel] = null;
      if (!job.orphaned) this.deliver(job.port, m.channel, Kind.Reply, m.body);
      // The amp doesn't report changes made over USB, so tell the other
      // clients about a parameter change: its body is a ParamChanged body.
      const ok = m.body.length < 4 || i32(m.body, 0) >= 0;
      if (ok && m.channel === Channel.Editor && job.cmd === EditorCmd.SetDspModelParam) {
        for (const port of this.ports) if (port !== job.port) this.deliver(port, m.channel, Kind.ParamChanged, job.body);
      }
      this.pump(m.channel);
    }
  }

  // Delivered asynchronously, like a real transport, so a reply never
  // arrives while the client is still sending its request.
  private deliver(port: HubPort, channel: number, kind: number, body: Bytes) {
    const pkts = encodeSysex(this.device, channel, port.seq[channel], encodeMessage(kind, body));
    port.seq[channel] = (port.seq[channel] + 1) & 0x7f;
    for (const b of pkts) this.deliverRaw(port, b);
  }

  private deliverRaw(port: HubPort, bytes: Bytes) {
    queueMicrotask(() => { if (this.ports.has(port)) port.onsysex(bytes); });
  }
}
