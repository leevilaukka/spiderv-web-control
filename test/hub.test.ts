// Sharing one amp between clients (the app and remote phones) through the hub.
import { expect, test } from 'bun:test';
import session from './fixtures/spiderv20-mkii-session.json';
import { SpiderV } from 'spiderv-protocol/client';
import { Hub } from 'spiderv-protocol/hub';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { type ParamChange, Channel, EditorCmd, LibrarianCmd, MsgType, crc32, typed } from 'spiderv-protocol/codec';
import { buildChain } from '../app/src/lib/tone';

async function setup() {
  const mock = new MockTransport(session);
  mock.latency = 1;
  const hub = new Hub(mock);
  const host = new SpiderV(hub.port(mock.label, { closesAmp: true }));
  await host.connect();
  hub.symbols = host.symbols!.bytes;
  return { mock, hub, host };
}

test('a second client joins without touching the amp handshake', async () => {
  const { hub, host } = await setup();
  // A stale cached table is rejected by the hub, which then serves its own.
  const phone = new SpiderV(hub.port('Remote'), [1, 2, 3]);
  await phone.connect();
  expect(crc32(phone.symbols!.bytes)).toBe(crc32(host.symbols!.bytes));
  expect(phone.device).toEqual(host.device);
  expect(phone.presetCount).toBe(128);
  // The host is still authenticated.
  expect(await host.currentPresetIndex()).toBe(await phone.currentPresetIndex());
});

test('routes replies of concurrent requests to the client that asked', async () => {
  const { hub, host } = await setup();
  const phone = new SpiderV(hub.port('Remote'));
  await phone.connect();
  const [a, b, c, d] = await Promise.all([host.presetName(3), phone.presetName(7), host.readPreset(), phone.presetName(3)]);
  expect(a).toBe(d);
  expect(b).toBe(session.names[7]);
  expect(c.name).toBeTruthy();
});

test('tells the other clients about parameter changes', async () => {
  const { hub, host } = await setup();
  const phone = new SpiderV(hub.port('Remote'));
  await phone.connect();
  const seen: ParamChange[] = [], echoed: ParamChange[] = [];
  host.on('param', (c) => seen.push(c));
  phone.on('param', (c) => echoed.push(c));

  const bass = buildChain(await phone.readPreset(), phone.symbols!).find((s) => s.sym === 'Amp')!.params[0];
  await phone.setParam(bass.obj, bass.ctrl, typed(MsgType.Float, 0.3));
  await Bun.sleep(5);
  expect(seen).toHaveLength(1);
  expect(seen[0].obj).toBe(bass.obj);
  expect(seen[0].param).toBe(bass.ctrl);
  expect(seen[0].value).toBeCloseTo(0.3);
  expect(echoed).toHaveLength(0);
  expect((await host.getParam(bass.obj, bass.ctrl)).value).toBeCloseTo(0.3);
});

test('a client that leaves mid-request does not hold up the others', async () => {
  const { hub, host } = await setup();
  const port = hub.port('Remote');
  const phone = new SpiderV(port);
  await phone.connect();
  const pending = phone.request(Channel.Librarian, LibrarianCmd.GetPresetInfo, [5, 0, 0, 0], { timeout: 200 }).catch(() => 'gone');
  await port.close();
  expect(await pending).toBe('gone');
  expect(await host.presetName(5)).toBe(session.names[5]);
  expect(hub.portCount).toBe(1);
});

test('answers requests itself only once the symbol table is known', async () => {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const hub = new Hub(mock);
  const c = new SpiderV(hub.port());
  // Before the hub knows the table, the handshake reaches the amp.
  await c.connect();
  const r = await c.request(Channel.Editor, EditorCmd.Handshake, [0, 0, 0, 0]);
  expect(r.body).toEqual([0xf9, 0xff, 0xff, 0xff]); // -7 from the amp
});
