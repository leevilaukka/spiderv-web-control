// Tone file import/export against the simulated amp.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import line6Tone from './fixtures/line6-arachnid-rhythm.json';
import { readFileSync } from 'node:fs';
import { SpiderV } from '../app/src/lib/protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { applyImport, planImport, readToneFile, toToneFile } from '../app/src/lib/presetfile';
import { buildChain } from '../app/src/lib/tone';
import { MsgType, PresetKey } from '../app/src/lib/protocol/codec';

const bytesOf = (v: unknown) => [...new TextEncoder().encode(JSON.stringify(v))];

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return amp;
}

test('plans a Line 6 tone file onto this amp', async () => {
  const amp = await connect();
  const plan = planImport(readToneFile(bytesOf(line6Tone), amp.symbols!), amp.symbols!);
  expect(plan.name).toBe('Arachnid Rhythm');
  expect(plan.warnings).toEqual([]);
  expect(plan.ops.filter((o) => o.kind === 'model')).toHaveLength(11);
  // Models already loaded are not reloaded.
  const fixed = planImport(readToneFile(bytesOf(line6Tone), amp.symbols!), amp.symbols!, await amp.readPreset());
  expect(fixed.ops.filter((o) => o.kind === 'model').map((o) => o.label.split(':')[0])).toEqual(['wah', 'fx1', 'fx2', 'fx3', 'amp', 'cab', 'reverb']);
  // Settings without a counterpart on the amp are reported, not guessed.
  expect(plan.skipped).not.toContain('fx2.@temposync');
  expect(plan.skipped).toContain('global.@tweakparam');
  expect(plan.ops.some((o) => o.kind === 'tempo')).toBe(true);
});

test('importing a tone file sets models, parameters and switches', async () => {
  const amp = await connect();
  const plan = planImport(readToneFile(bytesOf(line6Tone), amp.symbols!), amp.symbols!);
  expect(await applyImport(amp, plan)).toEqual([]);

  const chain = buildChain(await amp.readPreset(), amp.symbols!);
  const slot = (s: string) => chain.find((x) => x.sym === s)!;
  expect(slot('Amp').modelSym).toBe('BritPlexiJumpLead');
  expect(slot('Amp').params.find((p) => p.label === 'Bass')!.value).toBeCloseTo(0.57);
  expect(slot('Amp').extras.find((p) => p.label === 'Volume')!.value).toBeCloseTo(0.519649);
  expect(slot('StudioCab').modelSym).toBe('4x12Green25sStudio421'); // @mic 2
  expect(slot('FX4').modelSym).toBe('RichChamber2');
  expect(slot('FX2').enable!.value).toBe(0);
  expect(slot('FX2').extras.find((p) => p.label === 'Mix')!.value).toBeCloseTo(0.434292);
  expect(slot('Gate').params.find((p) => p.label === 'Threshold')!.value).toBeCloseTo(-49.14627);
});

test('export then import reproduces the tone', async () => {
  const source = await connect();
  const exported = toToneFile(await source.readPreset(), source.symbols!, 0x220005);
  expect(exported.data.tone.amp['@model']).toBe('DoubleVerb');

  // Start from a different tone, then import the export.
  const amp = await connect();
  await applyImport(amp, planImport(readToneFile(bytesOf(line6Tone), amp.symbols!), amp.symbols!));
  const plan = planImport(readToneFile(bytesOf(exported), amp.symbols!), amp.symbols!);
  expect(await applyImport(amp, plan)).toEqual([]);

  const again = toToneFile(await amp.readPreset(), amp.symbols!, 0x220005);
  again.data.meta = exported.data.meta;
  expect(again).toEqual(exported);
});

test('carries the speaker mode (preset key 74) both ways', async () => {
  const amp = await connect();
  // The recorded preset is in Classic; Line 6's file asks for Classic too.
  expect((await amp.getPresetKey(PresetKey.SpeakerMode)).value).toBe(0);
  expect(toToneFile(await amp.readPreset(), amp.symbols!).data.tone.global['@speakermode']).toBe(0);
  const plan = planImport(readToneFile(bytesOf(line6Tone), amp.symbols!), amp.symbols!);
  expect(plan.ops).toContainEqual({ kind: 'presetKey', key: PresetKey.SpeakerMode, type: MsgType.Bool, value: 0, label: 'global.@speakermode' });

  const fullRange = structuredClone(line6Tone);
  fullRange.data.tone.global['@speakermode'] = 1;
  expect(await applyImport(amp, planImport(readToneFile(bytesOf(fullRange), amp.symbols!), amp.symbols!))).toEqual([]);
  expect((await amp.readPreset()).header[PresetKey.SpeakerMode]).toBe(1);
  expect(toToneFile(await amp.readPreset(), amp.symbols!).data.tone.global['@speakermode']).toBe(1);
});

test('reads raw preset dumps and rejects other files', async () => {
  const amp = await connect();
  const raw = [...Buffer.from(session.editBuffer, 'base64')];
  expect(readToneFile(raw, amp.symbols!).data.tone.amp['@model']).toBe('DoubleVerb');
  expect(() => readToneFile(bytesOf({ version: 3, data: {} }), amp.symbols!)).toThrow(/version 3/);
  expect(() => readToneFile([...new TextEncoder().encode('{nope')], amp.symbols!)).toThrow(/Not a valid tone file/);
});

test('imports a .svl6p file in the format Spider V Remote / CustomTone saves', async () => {
  const amp = await connect();
  const bytes = [...readFileSync(new URL('./fixtures/test-tone-plexi.svl6p', import.meta.url))];
  const plan = planImport(readToneFile(bytes, amp.symbols!), amp.symbols!, await amp.readPreset());
  expect(plan.author).toBe('spiderv-web-control');
  expect(await applyImport(amp, plan)).toEqual([]);

  const chain = buildChain(await amp.readPreset(), amp.symbols!);
  const slot = (s: string) => chain.find((x) => x.sym === s)!;
  expect(slot('Amp').modelSym).toBe('BritPlexiLead100');
  expect(slot('FX1').modelSym).toBe('TubeDrive');
  expect(slot('FX1').params.find((p) => p.label === 'Treble')!.value).toBeCloseTo(0.62);
  expect(slot('FX1').enable!.value).toBe(1);    // "@enabled": true
  expect(slot('FX3').enable!.value).toBe(0);    // "@enabled": false
  expect(slot('StudioCab').modelSym).toBe('2x12BlackfaceStudioU67'); // "@mic": 3
  expect(slot('StudioCab').extras.find((p) => p.label === 'Early reflections')!.value).toBeCloseTo(0.315);
  // Tempo sync off is SyncSelect 0 on the amp; on keeps the file's note.
  expect(slot('FX3').sync!.c.value).toBe(0);    // "@temposync": false, "SyncSelect": 10
  expect(slot('FX2').sync!.c.value).toBe(8);    // "@temposync": true, "SyncSelect": 8
  expect(slot('FX3').params.some((p) => p.sym === 'SyncSelect')).toBe(false);
  expect(slot('FX3').sync!.synced).toBe('Time');

  // Exporting writes the same shape back.
  const out = toToneFile(await amp.readPreset(), amp.symbols!, 0x220005, 0x02010030);
  expect(out.schema).toBe('L6Preset');
  expect(out.data.device_version).toBe(0x02010000);
  expect(out.data.tone.fx1['@enabled']).toBe(true);
  expect(out.data.tone.fx1['Drive']).toBeCloseTo(0.71);
  expect(out.data.tone.fx2).toMatchObject({ '@temposync': true, SyncSelect: 8 });
  expect(out.data.tone.fx3).toMatchObject({ '@temposync': false, SyncSelect: 1 }); // the catalog's default note
});
