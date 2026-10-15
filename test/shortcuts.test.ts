// Shortcuts: engaged state, the switches and knob values they send, keys,
// expression pedals, and the tone assistant's set_shortcuts input.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from '../app/src/lib/protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { buildChain } from '../app/src/lib/tone';
import {
  type Shortcut, changesFor, expressionChanges, isEngaged, keyConflict, knobControl, mergeShortcutSpecs, toSpec,
} from '../app/src/lib/shortcuts';

async function chain() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return buildChain(await amp.readPreset(), amp.symbols!);
}

const shortcut = (targets: Shortcut['targets'], extra: Partial<Shortcut> = {}): Shortcut =>
  ({ id: 'a', name: 'Solo', key: 'KeyQ', momentary: false, targets, knobs: [], midi: null, ...extra });

const sent = (cs: ReturnType<typeof changesFor>) => cs.map((x) => [x.c.sym, x.value]);

test('a shortcut is engaged when all its blocks are in their engaged state', async () => {
  const c = await chain();
  const set = (sym: string, on: boolean) => (c.find((s) => s.sym === sym)!.enable!.value = on ? 1 : 0);
  set('FX1', false);
  set('FX4', true);
  const s = shortcut([{ sym: 'FX1', on: true }, { sym: 'FX4', on: true }]);
  expect(isEngaged(s, c)).toBe(false);

  // Engaging only sends the blocks that aren't there yet.
  expect(sent(changesFor(s, c, true))).toEqual([['FX1Enable', 1]]);
  set('FX1', true);
  expect(isEngaged(s, c)).toBe(true);
  expect(sent(changesFor(s, c, false))).toEqual([['FX1Enable', 0], ['FX4Enable', 0]]);

  // A swap: one block on, another off.
  const swap = shortcut([{ sym: 'FX1', on: true }, { sym: 'FX4', on: false }]);
  expect(isEngaged(swap, c)).toBe(false);
  expect(sent(changesFor(swap, c, true))).toEqual([['FX4Enable', 0]]);

  // Blocks the preset doesn't have are skipped; with none left it is never engaged.
  expect(isEngaged(shortcut([{ sym: 'Nope', on: true }]), c)).toBe(false);
  expect(changesFor(shortcut([{ sym: 'Nope', on: true }]), c, true)).toEqual([]);
});

test('knob targets move between their off and on values', async () => {
  const c = await chain();
  const vol = knobControl(c, 'Amp', 'ChannelVolume')!;
  const drive = knobControl(c, 'Amp', 'Gain')!;
  expect(vol.label).toBe('Volume');
  vol.value = 0.5;
  drive.value = 0.3;
  const s = shortcut([], { knobs: [{ sym: 'Amp', param: 'ChannelVolume', off: 0.5, on: 0.7 }, { sym: 'Amp', param: 'Gain', off: 0.3, on: 2 }] });
  expect(isEngaged(s, c)).toBe(false);
  // Values are clamped to the knob's range; ones already in place aren't sent.
  expect(sent(changesFor(s, c, true))).toEqual([['ChannelVolume', 0.7], ['Gain', 1]]);
  expect(changesFor(s, c, false)).toEqual([]);
  vol.value = 0.7001;
  drive.value = 1;
  expect(isEngaged(s, c)).toBe(true);

  // An expression pedal sweeps the knobs and engages the blocks off the heel.
  const wah = shortcut([{ sym: 'Wah', on: true }], { knobs: [{ sym: 'Amp', param: 'ChannelVolume', off: 0.2, on: 0.6 }] });
  c.find((x) => x.sym === 'Wah')!.enable!.value = 0;
  expect(sent(expressionChanges(wah, c, 0.5)).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100])).toEqual([['WahEnable', 1], ['ChannelVolume', 0.4]]);
  expect(sent(expressionChanges(wah, c, 0))).toEqual([['ChannelVolume', 0.2]]);

  // Knobs the current model doesn't have are skipped.
  expect(changesFor(shortcut([], { knobs: [{ sym: 'Amp', param: 'Nope', off: 0, on: 1 }] }), c, true)).toEqual([]);
});

test('keys used by blocks, app controls, other shortcuts or page navigation conflict', () => {
  const list = [shortcut([], { id: 'x', key: 'KeyQ' })];
  expect(keyConflict('Digit3', list)).toEqual({ block: 'FX1' });
  expect(keyConflict('KeyQ', list)).toEqual({ shortcut: list[0] });
  expect(keyConflict('KeyQ', list, 'x')).toBeNull();
  expect(keyConflict('KeyC', list, undefined, { KeyC: 'the channel switch' })).toEqual({ control: 'the channel switch' });
  expect(keyConflict('Space', list)).toEqual({ reserved: true });
  expect(keyConflict('ShiftLeft', list)).toEqual({ reserved: true });
  expect(keyConflict('PageDown', list)).toBeNull();
});

test('the assistant adds, replaces and removes shortcuts by name', async () => {
  const c = await chain();
  let n = 0;
  const id = () => `new${++n}`;
  const existing = [
    shortcut([{ sym: 'FX2', on: true }], { id: 'old', name: 'Solo', key: 'KeyW', momentary: true, midi: { cc: 20, expression: false } }),
    shortcut([{ sym: 'Wah', on: true }], { id: 'wah', name: 'Wah', key: 'KeyE' }),
  ];
  const r = mergeShortcutSpecs({
    shortcuts: [
      { name: 'solo', blocks: { fx2: 'on', reverb: 'on' }, knobs: [{ block: 'amp', param: '@volume', off: 0.5, on: 0.8 }, { block: 'amp', param: 'Nope', off: 0, on: 1 }] },
      { name: 'Crunch', key: 'r', blocks: { fx1: 'on', bogus: 'on', fx3: 'maybe' } },
      { name: 'Taken', key: 'Digit5', blocks: { gate: 'off' } },
      { name: 'Channel', key: 'c', knobs: [{ block: 'fx1', param: '@mix', off: 0, on: 3 }] },
      { name: 'Empty', blocks: {} },
    ],
    remove: ['WAH', 'missing'],
  }, existing, c, id, { KeyC: 'the channel switch' });

  expect(r.list.map(toSpec)).toEqual([
    { name: 'solo', key: 'KeyW', momentary: true, blocks: { fx2: 'on', reverb: 'on' }, knobs: [{ block: 'amp', param: '@volume', off: 0.5, on: 0.8 }] },
    { name: 'Crunch', key: 'KeyR', blocks: { fx1: 'on' } },
    { name: 'Taken', blocks: { gate: 'off' } },
    { name: 'Channel', blocks: {}, knobs: [{ block: 'fx1', param: '@mix', off: 0, on: 1 }] },
  ]);
  expect(r.list[0].id).toBe('old');
  expect(r.list[0].midi).toEqual({ cc: 20, expression: false });
  expect(r.list[0].knobs[0]).toEqual({ sym: 'Amp', param: 'ChannelVolume', off: 0.5, on: 0.8 });
  expect(r.removed).toEqual(['Wah']);
  expect(r.saved).toHaveLength(4);
  expect(r.notes).toEqual([
    'No shortcut named "missing" to remove.',
    'solo: no knob amp.Nope on the current models; skipped it.',
    'Crunch: unknown block "bogus".',
    'Crunch: fx3 must be "on" or "off".',
    'Taken: Digit5 already switches fx3 on its own, so it has no key.',
    'Channel: fx1.@mix clamped to 0..1.',
    'Channel: KeyC is the key for the channel switch, so it has no key.',
    'Skipped "Empty": it changes nothing.',
  ]);
  expect(() => mergeShortcutSpecs('nope', existing, c, id)).toThrow();
});
