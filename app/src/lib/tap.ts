// Tap tempo: the beat is the average gap between the last few taps, like a
// GX-100's tap. A pause longer than the slowest tempo starts over.
import { MIN_TEMPO, clampTempo } from './tone';

const MAX_TAPS = 5;
const MAX_GAP = 60000 / MIN_TEMPO + 100;

export class TapTempo {
  private times: number[] = [];

  // Returns the tempo once there are two taps in a row, else null.
  tap(now: number): number | null {
    const last = this.times[this.times.length - 1];
    if (last !== undefined && (now - last > MAX_GAP || now <= last)) this.times = [];
    this.times.push(now);
    if (this.times.length > MAX_TAPS) this.times.shift();
    if (this.times.length < 2) return null;
    const gap = (now - this.times[0]) / (this.times.length - 1);
    return clampTempo(60000 / gap);
  }

  get count() { return this.times.length; }
}
