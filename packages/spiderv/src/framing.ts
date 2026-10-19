// Splits a raw MIDI byte stream into complete SysEx messages. A read may carry
// several messages (or realtime bytes between them); each F0..F7 run is
// handed over separately.
import type { Bytes, ByteLike } from './codec';

export class SysexFramer {
  private rx: number[] = [];
  constructor(private onsysex: (b: Bytes) => void) {}

  push(data: ByteLike) {
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      if (b >= 0xf8) continue; // realtime
      if (b === 0xf0) this.rx = [];
      else if (b & 0x80 && b !== 0xf7) { this.rx = []; continue; }
      this.rx.push(b);
      if (b === 0xf7) {
        if (this.rx[0] === 0xf0) this.onsysex(Uint8Array.from(this.rx));
        this.rx = [];
      }
    }
  }
}
