// Saving presets (SetPresetFile) against the simulated amp.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from 'spiderv-protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { MsgType, PRESET_NAME_MAX, PresetKey, parseEntries, renamePresetData, serializeEntries, typed } from 'spiderv-protocol/codec';
import { applyImport, planImport, readToneFile } from '../app/src/lib/presetfile';
import { readFileSync } from 'node:fs';

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return amp;
}

test('preset files serialize back byte-for-byte', () => {
  const data = [...Buffer.from(session.editBuffer, 'base64')].slice(4);
  expect(serializeEntries(parseEntries(data))).toEqual(data);
});

test('renaming changes only the name and keeps names printable and short', () => {
  const data = [...Buffer.from(session.editBuffer, 'base64')].slice(4);
  const renamed = parseEntries(renamePresetData(data, 'Tëst\u0001 ' + 'x'.repeat(80)));
  const name = renamed.find((e) => e.key === 0)!.value as string;
  expect(name).toHaveLength(PRESET_NAME_MAX);
  expect(name.startsWith('T?st? ')).toBe(true);
  expect(renamed.filter((e) => e.key !== 0)).toEqual(parseEntries(data).filter((e) => e.key !== 0));
});

test('saves the edit buffer to a slot under a new name, and undo restores it', async () => {
  const amp = await connect();
  const bass = { obj: amp.symbols!.block('Amp')!, ctrl: amp.symbols!.param('Bass')! };
  await amp.setParam(bass.obj, bass.ctrl, typed(MsgType.Float, 0.123));

  const before = await amp.readPresetData(7);
  const previous = await amp.savePreset(7, 'My Tone');
  expect(previous).toEqual(before);
  expect(await amp.presetName(7)).toBe('My Tone');

  await amp.loadPreset(7);
  expect(await amp.isDirty()).toBe(false);
  const saved = await amp.readPreset();
  expect(saved.name).toBe('My Tone');
  const ampBlock = saved.tone!.children.find((b) => b.id === bass.obj)!;
  expect(ampBlock.params.find((p) => p.key === amp.symbols!.stateOf(bass.ctrl))!.value).toBeCloseTo(0.123);

  await amp.writePresetData(7, previous);
  expect(await amp.presetName(7)).toBe(session.names[7]);
  expect(await amp.readPresetData(7)).toEqual(before);
});

test('refuses invalid slots and data that is not a preset', async () => {
  const amp = await connect();
  const data = await amp.readPresetData(-1);
  await expect(amp.writePresetData(128, data)).rejects.toThrow(/invalid preset slot/);
  await expect(amp.writePresetData(-2, data)).rejects.toThrow(/invalid preset slot/);
  await expect(amp.writePresetData(3, [1, 2, 3, 4, 5, 6, 0x63, 0])).rejects.toThrow(/unknown value type/);
});

test('saves an imported tone file under its own name and CustomTone id', async () => {
  const amp = await connect();
  const bytes = [...readFileSync(new URL('./fixtures/test-tone-plexi.svl6p', import.meta.url))];
  const plan = planImport(readToneFile(bytes, amp.symbols!), amp.symbols!, await amp.readPreset());
  await applyImport(amp, plan);
  expect(plan.tnid).toBe(1000042);

  await amp.savePreset(20, { name: plan.name, label: plan.label, tnid: plan.tnid });
  expect(await amp.presetName(20)).toBe('Test Tone:  Plexi Tube Drive'); // 28 chars, double space kept
  const saved = await amp.readPreset(20);
  expect(saved.header[PresetKey.ToneIdLow]).toBe(1000042);
  expect(saved.header[PresetKey.ToneIdHigh]).toBe(0);
  expect(saved.header[PresetKey.Label]).toBe('Clean'); // the file has no label, so it is kept
  const ampBlock = saved.tone!.children.find((b) => b.id === amp.symbols!.block('Amp'))!;
  expect(amp.symbols!.name(ampBlock.model)).toBe('BritPlexiLead100');
});
