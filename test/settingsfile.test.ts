// App settings files: round trip, files that aren't settings, and presets
// that moved since the export.
import { expect, test } from 'bun:test';
import { movedPresets, readSettingsFile, toSettingsFile } from '../app/src/lib/settingsfile';
import type { Shortcut } from '../app/src/lib/shortcuts';

const solo: Shortcut = {
  id: 's1', name: 'Solo', key: 'KeyQ', momentary: false,
  targets: [{ sym: 'fx2', on: true }],
  knobs: [{ sym: 'Amp', param: 'Volume', off: 0.6, on: 0.75 }],
  midi: { cc: 20, expression: false },
};
const settings = {
  presets: {
    0: { shortcuts: [solo], channels: null },
    5: { shortcuts: [], channels: { groups: ['amp'], active: 'A' as const, other: { amp: { '@model': 'DoubleVerb' } } } },
  },
  names: { 0: 'Clean', 5: 'Lead' },
  controls: { channelKey: 'KeyC', channelCc: 64, midi: true, programChange: false },
  remote: { keepAwake: false },
  assistant: { provider: 'gemini', models: { anthropic: 'a', gemini: 'g' }, recent: [] },
};

test('a settings file reads back as written', () => {
  const read = readSettingsFile(toSettingsFile(settings, 'Spider V 30 MkII', new Date('2026-10-16T12:00:00Z')));
  expect(read).toEqual({ ...settings, amp: 'Spider V 30 MkII', date: '2026-10-16T12:00:00.000Z' });
});

test('other JSON is not a settings file; a newer version is refused', () => {
  expect(readSettingsFile('{"version":5,"data":{}}')).toBeNull();
  expect(readSettingsFile('not json')).toBeNull();
  expect(() => readSettingsFile(JSON.stringify({ format: 'spiderv-web-control/settings', version: 99 }))).toThrow(/newer version/);
});

test('broken preset entries are dropped', () => {
  const read = readSettingsFile(JSON.stringify({
    format: 'spiderv-web-control/settings', version: 1,
    presets: { 0: { name: 'Clean', shortcuts: [solo, { id: 7 }] }, x: { shortcuts: [solo] }, 3: { name: 'Empty', shortcuts: 'no' } },
  }));
  expect(read?.presets).toEqual({ 0: { shortcuts: [solo], channels: null } });
  expect(read?.names).toEqual({ 0: 'Clean' });
  expect(read?.controls).toBeUndefined();
});

test('presets whose slot now holds another preset are pointed out', () => {
  const now = ['Clean ', 'b', 'c', 'd', 'e', 'Rhythm'];
  expect(movedPresets(settings, now)).toEqual([
    'Preset 6 was “Lead” when exported and is “Rhythm” now; check its shortcuts and channels.',
  ]);
  expect(movedPresets(settings, [])).toEqual([]);
});
