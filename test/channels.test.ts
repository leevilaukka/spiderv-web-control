// Channels A/B: what a switch sends, switching on the simulated amp, and
// storage of per-preset extras.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from '../app/src/lib/protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { applyImport, planImport, toToneFile } from '../app/src/lib/presetfile';
import { completeGroups, parsePresetExtras, pickGroups, readExtras, switchTone } from '../app/src/lib/channels';

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return amp;
}

test('a switch sends only what differs, or a whole block when its model changes', () => {
  const current = {
    amp: { '@model': 'DoubleVerb', Drive: 0.3, Bass: 0.5, '@enabled': true },
    cab: { '@model': 'Blackface2x12', '@mic': 0, Level: 0.2 },
    fx1: { '@model': 'Screamer', Drive: 0.5 },
  };
  const target = {
    amp: { '@model': 'DoubleVerb', Drive: 0.8, Bass: 0.5, '@enabled': true },
    cab: { '@model': 'Blackface2x12', '@mic': 2, Level: 0.2 },
    fx1: { '@model': 'Screamer', Drive: 0.5 },
  };
  expect(switchTone(current, target)).toEqual({
    amp: { '@model': 'DoubleVerb', Drive: 0.8 },
    cab: { '@model': 'Blackface2x12', '@mic': 2, Level: 0.2 },
  });
  const other = { amp: { '@model': 'BritPlexi45', Drive: 0.9 } };
  expect(switchTone(current, other)).toEqual(other);
});

test('a partial setup is completed from the current one', () => {
  const current = { amp: { '@model': 'DoubleVerb', Drive: 0.3, Bass: 0.5, '@enabled': true, '@volume': 0.6 } };
  expect(completeGroups(current, { amp: { Drive: 0.9 } })).toEqual({ amp: { '@model': 'DoubleVerb', Drive: 0.9, Bass: 0.5, '@enabled': true, '@volume': 0.6 } });
  expect(completeGroups(current, { amp: { '@model': 'BritPlexi45', Drive: 0.9 } }))
    .toEqual({ amp: { '@enabled': true, '@volume': 0.6, '@model': 'BritPlexi45', Drive: 0.9 } });
});

test('switching channels on the amp swaps the chosen blocks and back', async () => {
  const amp = await connect();
  const st = amp.symbols!;
  const read = async () => toToneFile(await amp.readPreset(), st).data.tone;
  const a = await read();
  const groups = ['amp', 'fx1'];

  // Channel B: another amp model and different fx1 settings.
  const b = completeGroups(pickGroups(a, groups), { amp: { '@model': 'BritPlexi45', Gain: 0.9 }, fx1: { ...a.fx1, '@enabled': !a.fx1['@enabled'] } });
  const go = async (target: typeof a) => {
    const preset = await amp.readPreset();
    const file = toToneFile(preset, st);
    file.data.tone = switchTone(file.data.tone, target);
    expect(await applyImport(amp, planImport(file, st, preset))).toEqual([]);
  };
  await go(b);
  const onB = await read();
  expect(onB.amp['@model']).toBe('BritPlexi45');
  expect(onB.amp.Gain).toBeCloseTo(0.9, 5);
  expect(onB.fx1['@enabled']).toBe(!a.fx1['@enabled']);
  expect(onB.reverb).toEqual(a.reverb); // shared blocks are untouched

  await go(pickGroups(a, groups));
  expect(await read()).toEqual(a);
});

test('stored extras are read back per preset, including the older shortcut-only form', () => {
  const s = { id: 'a', name: 'Solo', key: 'KeyQ', momentary: false, targets: [{ sym: 'FX1', on: true }], knobs: [], midi: null };
  const channels = { groups: ['amp', 'bogus'], active: 'B', other: { amp: { '@model': 'DoubleVerb' }, fx1: { '@model': 'Screamer' } } };
  const stored = {
    1: [s, null],
    2: { shortcuts: [{ ...s, knobs: [{ sym: 'Amp', param: 'Drive', off: 0, on: 'x' }], midi: { cc: 4, expression: 1 } }], channels },
    3: { shortcuts: [], channels: { groups: [], active: 'A', other: {} } },
    x: [s],
  };
  expect(parsePresetExtras(JSON.stringify(stored))).toEqual({
    1: { shortcuts: [s], channels: null },
    2: { shortcuts: [{ ...s, midi: { cc: 4, expression: true } }], channels: { groups: ['amp'], active: 'B', other: { amp: { '@model': 'DoubleVerb' } } } },
  });
  expect(parsePresetExtras('[1]')).toEqual({});
  expect(parsePresetExtras('not json')).toEqual({});
  expect(parsePresetExtras(null)).toEqual({});
});

test("a tone file's shortcuts and channels read back, dropping what doesn't fit", () => {
  const channels = { groups: ['amp', 'nope'], active: 'B', other: { amp: { '@model': 'DoubleVerb', Drive: 0.3 }, nope: {} } };
  expect(readExtras({ shortcuts: 'x', channels })).toEqual({
    shortcuts: [],
    channels: { groups: ['amp'], active: 'B', other: { amp: { '@model': 'DoubleVerb', Drive: 0.3 } } },
  });
  expect(readExtras(null)).toEqual({ shortcuts: [], channels: null });
});
