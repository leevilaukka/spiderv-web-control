// Tone assistant proposals: catalog checks and application to the simulated amp.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from '../app/src/lib/protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { applyImport, planImport, toToneFile } from '../app/src/lib/presetfile';
import { catalogPrompt, checkTone, diffTones } from '../app/src/lib/tonedesign';
import { buildChain } from '../app/src/lib/tone';

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return amp;
}

test('the catalog prompt lists models with parameters and defaults', async () => {
  const amp = await connect();
  const prompt = catalogPrompt(amp.symbols!);
  expect(prompt).toContain('- BlackfaceLux "Test Blackface Lux": Bass .5, Mid .5, Treble .5, Drive .5, Presence .5');
  expect(prompt).toContain('- gate (Test Noise Gate): Thresh "Threshold" -96..0 dB -48, Decay .5');
  expect(prompt).not.toContain('SyncSelect');
  expect(prompt).toContain('- TapeEcho "Test Tape Echo" [sync]: ');
  // Models listed under several categories appear once.
  expect(prompt.match(/^- BlackfaceLux /gm)).toHaveLength(1);
  expect(catalogPrompt(amp.symbols!)).toBe(prompt);
});

test('a proposal is checked, clamped and applied', async () => {
  const amp = await connect();
  const current = toToneFile(await amp.readPreset(), amp.symbols!);
  const { file, problems } = checkTone({
    name: '  Jazz Clean  ',
    tone: {
      amp: { '@model': 'BlackfaceLux', Drive: 1.4, Bass: 0.6, '@volume': 0.7, Wattage: 3 },
      cab: { '@model': '1x12BlackfaceStudio', '@mic': 3.4, Level: 0.2 },
      reverb: { '@model': 'LuxSpring', '@enabled': true, '@mix': 0.3, Time: 0.6 },
      gate: { '@enabled': 0, Thresh: -70 },
      fx1: { '@model': 'NoSuchPedal' },
      fx2: { '@enabled': false, SyncSelect: 4 },
      fx3: { '@model': 'TapeEcho', '@temposync': true, SyncSelect: 16 },
      looper: {},
    },
  }, amp.symbols!, current);

  expect(file.data.meta.name).toBe('Jazz Clean');
  expect(file.data.tone.amp).toEqual({ '@model': 'BlackfaceLux', Drive: 1, Bass: 0.6, '@volume': 0.7 });
  expect(file.data.tone.cab['@mic']).toBe(3);
  expect(file.data.tone.gate).toEqual({ '@model': 'Gate', '@enabled': false, Thresh: -70 });
  // No model given: keeps the current one, whose tempo sync settings apply.
  expect(file.data.tone.fx2).toEqual({ '@model': current.data.tone.fx2['@model'], '@enabled': false, SyncSelect: 4 });
  expect(file.data.tone.fx3).toEqual({ '@model': 'TapeEcho', '@temposync': true, SyncSelect: 14 });
  expect(file.data.tone.fx1).toBeUndefined();
  expect(problems).toEqual([
    'amp.Drive: 1.4 is outside 0..1; used 1.',
    'amp.Wattage: Test Blackface Lux has no such setting; ignored.',
    'cab.@mic: 3.4 is outside 0..3 (whole numbers); used 3.',
    'fx1: this amp has no fx model "NoSuchPedal"; left unchanged.',
    'fx3.SyncSelect: 16 is outside 1..14 (whole numbers); used 14.',
    'Unknown group "looper".',
  ]);

  const plan = planImport(file, amp.symbols!, await amp.readPreset());
  expect(plan.skipped).toEqual([]);
  expect(await applyImport(amp, plan)).toEqual([]);
  const chain = buildChain(await amp.readPreset(), amp.symbols!);
  const ampSlot = chain.find((s) => s.sym === 'Amp')!;
  expect(ampSlot.modelSym).toBe('BlackfaceLux');
  expect(ampSlot.params.find((p) => p.label === 'Drive')!.value).toBeCloseTo(1);
  expect(chain.find((s) => s.sym === 'StudioCab')!.modelSym).toBe('1x12BlackfaceStudioU67');
  expect(chain.find((s) => s.sym === 'FX4')!.enable!.value).toBe(1);
});

test('a proposal without a tone is rejected', async () => {
  const amp = await connect();
  expect(() => checkTone({ name: 'x' }, amp.symbols!)).toThrow('"tone"');
  expect(checkTone({ name: 'x', tone: {} }, amp.symbols!).problems).toEqual(['Nothing to apply.']);
});

test('changes between two tones read like the editor', async () => {
  const amp = await connect();
  const before = toToneFile(await amp.readPreset(), amp.symbols!);
  const after = structuredClone(before);
  const t = after.data.tone;
  t.amp = { '@model': 'BlackfaceLux', Drive: 0.75, Bass: 0.5, '@volume': t.amp['@volume'] };
  t.reverb = { ...t.reverb, '@enabled': !t.reverb['@enabled'], '@mix': Number(t.reverb['@mix']) + 0.2 };
  t.gate = { ...t.gate, Thresh: -60 };
  t.cab = { ...t.cab, '@mic': 3 };
  t.fx3 = { ...t.fx3, '@temposync': true, SyncSelect: 7 };
  const changes = diffTones(before, after);
  const amps = changes.filter((c) => c.block === 'Amp').map((c) => c.text);
  expect(amps[0]).toMatch(/ → Test Blackface Lux$/);
  expect(amps.slice(1)).toEqual(['Drive 7.5', 'Bass 5.0']); // volume unchanged
  const mix = Number(before.data.tone.reverb['@mix']);
  expect(changes.filter((c) => c.block === 'Reverb').map((c) => c.text)).toEqual([
    before.data.tone.reverb['@enabled'] ? 'switched off' : 'switched on',
    `Mix ${(mix * 10).toFixed(1)} → ${((mix + 0.2) * 10).toFixed(1)}`,
  ]);
  expect(changes.find((c) => c.block === 'Gate')!.text).toMatch(/^Threshold -?\d+\.\d dB → -60\.0 dB$/);
  expect(changes.find((c) => c.block === 'Cab')!.text).toMatch(/^Mic .* → U67 condenser$/);
  expect(changes.filter((c) => c.block === 'FX 3').map((c) => c.text)).toEqual(['Note 1/2 → 1/8 dotted']); // already synced
  expect(diffTones(before, structuredClone(before))).toEqual([]);
});
