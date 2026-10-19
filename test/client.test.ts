// Client + view-model tests against a simulated amp seeded from a recorded
// Spider V 20 MkII (fw 2.0.1) session.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from 'spiderv-protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { MsgType, blockId, crc32, typed } from 'spiderv-protocol/codec';
import { buildChain, modelChoices } from '../app/src/lib/tone';

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return { amp, mock };
}

test('handshake authenticates with the CRC32 of the symbol table', async () => {
  const { amp } = await connect();
  expect(amp.device).toEqual([0x22, 0x05]);
  expect(amp.presetCount).toBe(128);
  expect(amp.symbols!.name(0x2a)).toBe('Amp');

  // A cached table is used directly; a stale one falls back to downloading.
  const good = new SpiderV(new MockTransport(session), amp.symbols!.bytes);
  await good.connect();
  const stale = new SpiderV(new MockTransport(session), [1, 2, 3]);
  await stale.connect();
  expect(crc32(stale.symbols!.bytes)).toBe(crc32(amp.symbols!.bytes));
});

test('builds a named signal chain from the edit buffer', async () => {
  const { amp } = await connect();
  const chain = buildChain(await amp.readPreset(), amp.symbols!);
  expect(chain.map((s) => s.sym)).toEqual(['Gate', 'Wah', 'FX1', 'FX2', 'FX3', 'Amp', 'StudioCab', 'FX4', 'PostComp', 'PostEQ', 'VolumePedal']);
  const amp_ = chain.find((s) => s.sym === 'Amp')!;
  expect(amp_.modelName).toBe('Test Double Verb');
  expect(amp_.params.map((p) => p.label)).toEqual(['Bass', 'Mid', 'Treble', 'Gain', 'Presence']);
  expect(amp_.extras.map((p) => p.label)).toEqual(['Volume']);
  for (const s of chain) expect(s.enable, s.sym).toBeDefined();
  const cab = chain.find((s) => s.sym === 'StudioCab')!;
  expect(cab.mic).toBeGreaterThanOrEqual(0);
  expect(cab.extras.map((p) => p.label)).toContain('Early reflections');
});

test('sets parameters, toggles blocks and changes models', async () => {
  const { amp } = await connect();
  let chain = buildChain(await amp.readPreset(), amp.symbols!);
  const bass = chain.find((s) => s.sym === 'Amp')!.params[0];
  await amp.setParam(bass.obj, bass.ctrl, typed(bass.type, 0.25));
  const reverb = chain.find((s) => s.sym === 'FX4')!;
  await amp.setParam(reverb.enable!.obj, reverb.enable!.ctrl, { type: MsgType.Bool, value: false });

  const hall = modelChoices('reverb', amp.symbols!).flatMap((c) => c.models).find((m) => m.sym === 'MediumHall')!;
  await amp.loadModel(reverb.id, hall.id);

  chain = buildChain(await amp.readPreset(), amp.symbols!);
  expect(chain.find((s) => s.sym === 'Amp')!.params[0].value).toBeCloseTo(0.25);
  const fx4 = chain.find((s) => s.sym === 'FX4')!;
  expect(fx4.enable!.value).toBe(0);
  expect(fx4.modelName).toBe('Test Medium Hall');
  expect(await amp.isDirty()).toBe(true);
});

test('loads presets and reports knob turns on the amp', async () => {
  const { amp, mock } = await connect();
  await amp.loadPreset(5);
  expect(await amp.currentPresetIndex()).toBe(5);
  expect((await amp.readPreset()).name).toBe(session.names[5]);
  const changes: unknown[] = [];
  amp.on('param', (c) => changes.push(c));
  mock.turnKnob(blockId(0x2a), amp.symbols!.param('Drive')!, 0.9);
  await new Promise((r) => setTimeout(r, 10));
  expect(changes).toEqual([{ obj: 0x2a, param: amp.symbols!.param('Drive'), type: MsgType.Float, value: expect.closeTo(0.9) }]);
});
