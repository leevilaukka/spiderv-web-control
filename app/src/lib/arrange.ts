// Where blocks can go in the chain. The Spider V's signal chain is fixed
// except that FX1-FX3, the reverb (FX4) and the volume pedal each sit before
// or after the amp:
//
//   Gate, Wah, [FX1-3 pre], [reverb pre], [volume pre], Amp, Cab,
//   [FX1-3 post], [reverb post], Comp, EQ, [volume post]
//
// FX1-FX3 run in slot order on each side, so effects are reordered by
// moving them between those slots (model and settings together). The reverb
// slot has its own models, so the reverb can only change sides.
import type { Tone } from './channels';
import { GROUP_OF } from './shortcuts';

export const FX_SLOTS = ['FX1', 'FX2', 'FX3'];
export const MOVABLE = new Set([...FX_SLOTS, 'FX4', 'VolumePedal']);

// The chain in signal order, as block names.
export function chainOrder(present: string[], post: Record<string, boolean>): string[] {
  const has = (s: string) => present.includes(s);
  const side = (p: boolean) => (s: string) => has(s) && !!post[s] === p;
  return [
    ...['Gate', 'Wah'].filter(has),
    ...[...FX_SLOTS, 'FX4'].filter(side(false)), ...['VolumePedal'].filter(side(false)),
    ...['Amp', 'StudioCab'].filter(has),
    ...[...FX_SLOTS, 'FX4'].filter(side(true)), ...['PostComp', 'PostEQ'].filter(has), ...['VolumePedal'].filter(side(true)),
  ];
}

// What it takes to make the chain run in `seq` (block names in the order the
// user wants, each standing for the effect now in that block): the
// pre/post side of each movable block, and `moves`, which slot takes the
// effect of which (new slot -> old slot). Null if the order isn't possible.
// `locked` blocks (in channels A/B) must keep their effect and side.
export type Arrangement = { post: Record<string, boolean>; moves: Record<string, string> };

export function arrange(seq: string[], post: Record<string, boolean>, locked: Set<string> = new Set()): Arrangement | null {
  const amp = seq.indexOf('Amp');
  if (amp < 0) return null;
  const isPost = (s: string) => seq.indexOf(s) > amp;
  const fxPre = seq.filter((s) => FX_SLOTS.includes(s) && !isPost(s));
  const fxPost = seq.filter((s) => FX_SLOTS.includes(s) && isPost(s));

  // Slots for the effects: each side's effects take that side's slots in
  // slot order. Of the ways to do that, take the one that moves fewest.
  const slots = FX_SLOTS.filter((s) => seq.includes(s));
  let best: Record<string, string> | null = null, bestMoves = Infinity;
  for (let mask = 0; mask < 1 << slots.length; mask++) {
    const preSlots = slots.filter((_, i) => !(mask & (1 << i)));
    if (preSlots.length !== fxPre.length) continue;
    const postSlots = slots.filter((_, i) => mask & (1 << i));
    const map: Record<string, string> = {};
    preSlots.forEach((slot, i) => (map[slot] = fxPre[i]));
    postSlots.forEach((slot, i) => (map[slot] = fxPost[i]));
    if ([...locked].some((s) => map[s] !== undefined && map[s] !== s)) continue;
    const n = Object.entries(map).filter(([slot, from]) => slot !== from).length;
    if (n < bestMoves) { best = map; bestMoves = n; }
  }
  if (!best) return null;

  const newPost: Record<string, boolean> = {};
  for (const slot of slots) newPost[slot] = isPost(best[slot]);
  for (const s of ['FX4', 'VolumePedal']) if (seq.includes(s)) newPost[s] = isPost(s);
  if ([...locked].some((s) => newPost[s] !== undefined && newPost[s] !== !!post[s])) return null;

  // The order must be one the chain can actually run in.
  const order = chainOrder(seq, newPost).map((s) => (FX_SLOTS.includes(s) ? best![s] : s));
  if (order.join() !== seq.join()) return null;
  const moves = Object.fromEntries(Object.entries(best).filter(([slot, from]) => slot !== from));
  return { post: newPost, moves };
}

// Gap indices (0..n) where `sym` can be dropped into `order`, with the
// resulting arrangement. A gap is a position in the order without `sym`.
export function dropTargets(order: string[], sym: string, post: Record<string, boolean>, locked: Set<string>) {
  const rest = order.filter((s) => s !== sym);
  const out: { gap: number; seq: string[]; arrangement: Arrangement }[] = [];
  for (let gap = 0; gap <= rest.length; gap++) {
    const seq = [...rest.slice(0, gap), sym, ...rest.slice(gap)];
    if (seq.join() === order.join()) continue;
    const arrangement = arrange(seq, post, locked);
    if (arrangement) out.push({ gap, seq, arrangement });
  }
  return out;
}

// The tone after an arrangement: moved effects with all their settings, and
// every movable block on its side.
export function arrangedTone(tone: Tone, a: Arrangement): Tone {
  const out: Tone = {};
  for (const [slot, isPost] of Object.entries(a.post)) {
    const from = GROUP_OF[a.moves[slot] ?? slot];
    if (!tone[from]) continue;
    out[GROUP_OF[slot]] = { ...tone[from], '@post': isPost };
  }
  return out;
}
