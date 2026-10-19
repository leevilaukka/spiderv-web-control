// Tap tempo and tempo-sync note values.
import { expect, test } from 'bun:test';
import { TapTempo } from '../app/src/lib/tap';
import { MAX_TEMPO, MIN_TEMPO, noteChoices, noteName } from '../app/src/lib/tone';

test('taps set the tempo from the average gap', () => {
  const t = new TapTempo();
  expect(t.tap(1000)).toBeNull();
  expect(t.tap(1500)).toBe(120);
  expect(t.tap(2010)).toBe(118.8); // 1010 ms over two gaps
  // Only the last five taps count.
  for (const at of [2510, 3010, 3510, 4010]) t.tap(at);
  expect(t.tap(4510)).toBe(120);
});

test('a long pause starts over, and tempos stay in range', () => {
  const t = new TapTempo();
  t.tap(0);
  t.tap(500);
  expect(t.tap(5000)).toBeNull();
  expect(t.tap(5050)).toBe(MAX_TEMPO);
  const slow = new TapTempo();
  slow.tap(0);
  expect(slow.tap(2050)).toBe(MIN_TEMPO);
});

test('note values follow Line 6: delays count up, modulations down', () => {
  expect(noteName(9, 'delay')).toBe('1/4');       // verified by ear: 1 s at 60 BPM
  expect(noteName(7, 'delay')).toBe('1/8 dotted');
  expect(noteName(1, 'mod')).toBe('1/1');
  expect(noteName(14, 'mod')).toBe('1/32');
  expect(noteChoices('mod')[0]).toEqual({ value: 14, label: '1/32' });
  expect(noteChoices('delay')[0]).toEqual({ value: 1, label: '1/32' });
});

test('the simulated amp keeps the tempo and sync settings', async () => {
  const { SpiderV } = await import('spiderv-protocol/client');
  const { MockTransport } = await import('../app/src/lib/protocol/mock');
  const { PresetKey, MsgType, typed } = await import('spiderv-protocol/codec');
  const { buildChain } = await import('../app/src/lib/tone');
  const session = (await import('./fixtures/spiderv20-mkii-session.json')).default;
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  await amp.setTempo(132.5);
  expect((await amp.readPreset()).header[PresetKey.Tempo]).toBe(132.5);
  const fx3 = buildChain(await amp.readPreset(), amp.symbols!).find((s) => s.sym === 'FX3')!;
  await amp.setParam(fx3.sync!.c.obj, fx3.sync!.c.ctrl, typed(MsgType.Int, 0));
  expect(buildChain(await amp.readPreset(), amp.symbols!).find((s) => s.sym === 'FX3')!.sync!.c.value).toBe(0);
});
