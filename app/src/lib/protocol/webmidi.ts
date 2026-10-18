// Web MIDI transport. The Spider V is a class-compliant USB-MIDI device, so
// the OS exposes it as a MIDI port ("Spider V 20 MIDI 1" on Linux/ALSA).
import type { Bytes } from './codec';
import type { Transport } from './client';

const PORT_MATCH = /spider ?v/i;

export class WebMidiTransport implements Transport {
  label: string;
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};

  private constructor(private access: MIDIAccess, private input: MIDIInput, private output: MIDIOutput) {
    this.label = output.name ?? 'MIDI';
  }

  static isAmp(port: MIDIPort) { return PORT_MATCH.test(port.name ?? ''); }

  static supported() { return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator; }

  static async connect(): Promise<WebMidiTransport> {
    if (!WebMidiTransport.supported()) throw new Error('This browser has no Web MIDI. Use Chromium or Chrome.');
    let access: MIDIAccess;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (e) {
      throw new Error(`MIDI access was denied (${(e as Error).message}). Allow MIDI with SysEx for this site.`);
    }
    const pick = <T extends MIDIPort>(ports: Iterable<T>) => [...ports].find(WebMidiTransport.isAmp);
    const input = pick(access.inputs.values()), output = pick(access.outputs.values());
    if (!input || !output) {
      const names = [...access.outputs.values()].map((p) => p.name).join(', ') || 'none';
      throw new Error(`No Spider V found. Is the amp on and connected over USB? (MIDI outputs: ${names})`);
    }
    const t = new WebMidiTransport(access, input, output);
    await t.open();
    return t;
  }

  private async open() {
    await this.input.open();
    await this.output.open();
    this.input.onmidimessage = (e) => { if (e.data) this.receive(e.data); };
    this.access.onstatechange = (e) => {
      const port = (e as MIDIConnectionEvent).port;
      if (port?.id === this.output.id && port.state === 'disconnected') this.ondisconnect();
    };
  }

  // An event may carry several SysEx messages (or realtime bytes between
  // them); hand each complete F0..F7 run over separately.
  private rx: Bytes = [];
  private receive(data: Uint8Array) {
    for (const b of data) {
      if (b >= 0xf8) continue; // realtime
      if (b === 0xf0) this.rx = [];
      else if (b & 0x80 && b !== 0xf7) { this.rx = []; continue; }
      this.rx.push(b);
      if (b === 0xf7) {
        if (this.rx[0] === 0xf0) this.onsysex(this.rx);
        this.rx = [];
      }
    }
  }

  send(bytes: Bytes) { this.output.send(bytes); }

  async close() {
    this.input.onmidimessage = null;
    this.access.onstatechange = null;
    await this.input.close().catch(() => {});
    await this.output.close().catch(() => {});
  }
}
