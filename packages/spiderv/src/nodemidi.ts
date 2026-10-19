// Node transport over @julusian/midi (an optional peer dependency; prebuilt
// RtMidi bindings for Linux, macOS and Windows). Finds the amp by port name.
import type { Bytes } from './codec';
import type { Transport } from './client';
import { SysexFramer } from './framing';

const PORT_MATCH = /spider ?v/i;

// The slice of @julusian/midi used here.
interface MidiPort {
  getPortCount(): number;
  getPortName(i: number): string;
  openPort(i: number): void;
  closePort(): void;
}
interface MidiInput extends MidiPort {
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  on(event: 'message', cb: (deltaTime: number, message: number[]) => void): void;
  removeAllListeners(): void;
}
interface MidiOutput extends MidiPort { send(message: number[]): void }
interface MidiModule { Input: new () => MidiInput; Output: new () => MidiOutput }

const find = (port: MidiPort) => {
  for (let i = 0; i < port.getPortCount(); i++) if (PORT_MATCH.test(port.getPortName(i))) return i;
  return -1;
};

export class NodeMidiTransport implements Transport {
  label: string;
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};
  private framer = new SysexFramer((b) => this.onsysex(b));

  private constructor(private input: MidiInput, private output: MidiOutput, label: string) {
    this.label = label;
    input.on('message', (_dt, msg) => this.framer.push(msg));
  }

  static async connect(): Promise<NodeMidiTransport> {
    let midi: MidiModule;
    try {
      // @ts-ignore optional peer dependency, may not be installed
      const m = await import('@julusian/midi');
      midi = (m.default ?? m) as unknown as MidiModule;
    } catch {
      throw new Error('NodeMidiTransport needs the @julusian/midi package: npm install @julusian/midi');
    }
    const input = new midi.Input(), output = new midi.Output();
    const i = find(input), o = find(output);
    if (i < 0 || o < 0) {
      const names = Array.from({ length: output.getPortCount() }, (_, n) => output.getPortName(n)).join(', ') || 'none';
      throw new Error(`No Spider V found. Is the amp on and connected over USB? (MIDI outputs: ${names})`);
    }
    input.ignoreTypes(false, true, true); // keep SysEx
    const label = output.getPortName(o);
    input.openPort(i);
    output.openPort(o);
    return new NodeMidiTransport(input, output, label);
  }

  send(bytes: Bytes) { this.output.send(bytes); }

  async close() {
    this.input.removeAllListeners();
    try { this.input.closePort(); } catch {}
    try { this.output.closePort(); } catch {}
  }
}
