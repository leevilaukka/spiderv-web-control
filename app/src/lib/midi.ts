// MIDI pedal messages from raw bytes. Ports only deliver whole, valid
// messages, but the devtools console can pass anything, so anything that
// isn't exactly a control change or a program change is turned away rather
// than guessed at (a program change of -1 would otherwise reach the amp).
export type PedalMessage =
  | { kind: 'cc'; cc: number; value: number }
  | { kind: 'program'; program: number };

const isData = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) < 0x80;

export function pedalMessage(data: ArrayLike<unknown>): PedalMessage | null {
  const [status, d1, d2, ...more] = Array.from(data);
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 0x80 || status > 0xff || more.length) return null;
  const type = status & 0xf0;
  if (type === 0xb0 && isData(d1) && isData(d2)) return { kind: 'cc', cc: d1, value: d2 };
  if (type === 0xc0 && isData(d1) && d2 === undefined) return { kind: 'program', program: d1 };
  return null;
}
