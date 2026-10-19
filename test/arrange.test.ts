// Moving blocks around the chain: which places are allowed, the fewest slot
// moves to get there, and applying it on the simulated amp.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from 'spiderv-protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { applyImport, planImport, toToneFile } from '../app/src/lib/presetfile';
import { switchTone } from '../app/src/lib/channels';
import { arrange, arrangedTone, chainOrder, dropTargets } from '../app/src/lib/arrange';

const ALL = ['Gate', 'Wah', 'FX1', 'FX2', 'FX3', 'FX4', 'VolumePedal', 'Amp', 'StudioCab', 'PostComp', 'PostEQ'];
const post = { FX1: false, FX2: true, FX3: false, FX4: true, VolumePedal: true };
const order = chainOrder(ALL, post);

test('the chain order follows the pre/post switches', () => {
  expect(order).toEqual(['Gate', 'Wah', 'FX1', 'FX3', 'Amp', 'StudioCab', 'FX2', 'FX4', 'PostComp', 'PostEQ', 'VolumePedal']);
});

test('reordering effects moves them between slots, as few as possible', () => {
  // FX3's effect before FX1's: swap the two slots.
  expect(arrange(['Gate', 'Wah', 'FX3', 'FX1', 'Amp', 'StudioCab', 'FX2', 'FX4', 'PostComp', 'PostEQ', 'VolumePedal'], post))
    .toEqual({ post: { FX1: false, FX2: true, FX3: false, FX4: true, VolumePedal: true }, moves: { FX1: 'FX3', FX3: 'FX1' } });
  // FX2's effect to the front, pre amp: FX1..FX3 all pre, in the new order.
  expect(arrange(['Gate', 'Wah', 'FX2', 'FX1', 'FX3', 'Amp', 'StudioCab', 'FX4', 'PostComp', 'PostEQ', 'VolumePedal'], post))
    .toEqual({ post: { FX1: false, FX2: false, FX3: false, FX4: true, VolumePedal: true }, moves: { FX1: 'FX2', FX2: 'FX1' } });
  // FX1's effect after the amp, before FX2's: only the side changes.
  expect(arrange(['Gate', 'Wah', 'FX3', 'Amp', 'StudioCab', 'FX1', 'FX2', 'FX4', 'PostComp', 'PostEQ', 'VolumePedal'], post))
    .toEqual({ post: { FX1: true, FX2: true, FX3: false, FX4: true, VolumePedal: true }, moves: {} });
});

test('fixed blocks and slot rules limit where a block can go', () => {
  const gaps = (sym: string, locked = new Set<string>()) => dropTargets(order, sym, post, locked).map((t) => t.seq.indexOf(sym));
  // An effect: anywhere among the effects on either side, not before the wah,
  // between amp and cab, or after a side's reverb.
  expect(gaps('FX1')).toEqual([3, 5, 6]);
  // The reverb only after the effects of a side; the volume pedal only last on a side.
  expect(gaps('FX4')).toEqual([4]);
  expect(gaps('VolumePedal')).toEqual([4]);
  // A block in channels A/B keeps its effect, so others can't take its slot.
  expect(gaps('FX1', new Set(['FX3']))).toEqual([5, 6]);
  expect(arrange(['Gate', 'Wah', 'FX1', 'FX3', 'Amp', 'PostComp', 'StudioCab', 'FX2', 'FX4', 'PostEQ', 'VolumePedal'], post)).toBeNull();
});

test('an arrangement is applied to the amp, settings and all', async () => {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  const st = amp.symbols!;
  const preset = await amp.readPreset();
  const before = toToneFile(preset, st).data.tone;
  const p = Object.fromEntries(['fx1', 'fx2', 'fx3', 'reverb', 'volume'].map((g, i) => [['FX1', 'FX2', 'FX3', 'FX4', 'VolumePedal'][i], !!before[g]['@post']]));
  const now = chainOrder(ALL, p);
  // Move FX3's effect to the very first effect position.
  const target = dropTargets(now, 'FX3', p, new Set()).find((t) => t.seq.indexOf('FX3') === 2)!;
  const file = toToneFile(preset, st);
  file.data.tone = switchTone(before, arrangedTone(before, target.arrangement));
  expect(await applyImport(amp, planImport(file, st, preset))).toEqual([]);
  const after = toToneFile(await amp.readPreset(), st).data.tone;
  const moved = Object.entries(target.arrangement.moves);
  expect(moved.length).toBeGreaterThan(0);
  for (const [slot, from] of moved) {
    const g = { FX1: 'fx1', FX2: 'fx2', FX3: 'fx3' }[slot]!, f = { FX1: 'fx1', FX2: 'fx2', FX3: 'fx3' }[from]!;
    const { '@post': _a, ...a } = after[g];
    const { '@post': _b, ...b } = before[f];
    expect(a).toEqual(b);
  }
});
