// The model catalog is optional: the editor works without it, and it can be
// read from the user's copy of the Spider Remote APK.
import { afterEach, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import session from './fixtures/spiderv20-mkii-session.json';
import testCatalog from './fixtures/test-catalog.json';
import { SpiderV } from '../app/src/lib/protocol/client';
import { MockTransport } from '../app/src/lib/protocol/mock';
import { MsgType } from '../app/src/lib/protocol/codec';
import { type Catalog, buildChain, hasCatalog, modelChoices, setCatalog, validCatalog } from '../app/src/lib/tone';
import { CATALOG_FILES, catalogFromApk } from '../app/src/lib/catalogextract';
import { planImport, toToneFile } from '../app/src/lib/presetfile';

afterEach(() => setCatalog(testCatalog as unknown as Catalog));

async function connect() {
  const mock = new MockTransport(session);
  mock.latency = 0;
  const amp = new SpiderV(mock);
  await amp.connect();
  return amp;
}

test('without a catalog, the chain is named from the amp\'s symbols', async () => {
  const amp = await connect();
  setCatalog(null);
  expect(hasCatalog()).toBe(false);
  const chain = buildChain(await amp.readPreset(), amp.symbols!);
  const slot = (s: string) => chain.find((x) => x.sym === s)!;
  expect(slot('Amp').modelName).toBe('Double Verb');
  expect(slot('Amp').group).toBe('amp');
  expect(slot('FX4').group).toBe('reverb');
  expect(slot('StudioCab').shortName).toBe('2x12 Blackface');
  // Knobs come from the tone itself, 0..1 shown as 0 to 10.
  expect(slot('Amp').params.map((p) => p.label)).toEqual(expect.arrayContaining(['Bass', 'Gain', 'Presence']));
  expect(slot('Amp').params.every((p) => p.min === 0 && p.max === 1)).toBe(true);
  expect(modelChoices('amp', amp.symbols!)).toEqual([]);
});

test('without a catalog, imports take value types from the tone and the file', async () => {
  const amp = await connect();
  const current = await amp.readPreset();
  const file = toToneFile(current, amp.symbols!);
  setCatalog(null);
  file.data.tone.fx3 = { ...file.data.tone.fx3, SyncSelect: 7, '@temposync': true };
  const plan = planImport(file, amp.symbols!, current);
  const typeOf = (label: string) => {
    const o = plan.ops.find((x) => x.label === label);
    return o?.kind === 'param' ? o.type : undefined;
  };
  expect(typeOf('fx3.SyncSelect')).toBe(MsgType.Int); // stored as an int in the edit buffer
  expect(typeOf('amp.Bass')).toBe(MsgType.Float);
});

test('reads the catalog from an APK, also inside an app bundle', async () => {
  // Asset files in the Spider Remote layout, made up for the test.
  const param = (symbolicID: string, name?: string) => ({ symbolicID, name, min: 0, max: 1, default: 0.5, valueType: 1 });
  const assets: Record<string, unknown> = Object.fromEntries(CATALOG_FILES.map((f) => [f, f.endsWith('.models') ? [] : {}]));
  assets['amps.models'] = [{ symbolicID: 'DoubleVerb', name: 'My Verb', shortname: 'Verb', params: [param('Bass', 'Low'), param('Hidden')] }];
  assets['AmpCatalog.json'] = { Clean: ['DoubleVerb'] };
  const apk = zip({
    'AndroidManifest.xml': new Uint8Array(64),
    ...Object.fromEntries(Object.entries(assets).map(([f, v]) => [`assets/${f}`, new TextEncoder().encode(JSON.stringify(v))])),
  });

  for (const file of [apk, zip({ 'manifest.json': new Uint8Array(2), 'com.example.app.apk': apk })]) {
    const c = await catalogFromApk(file);
    expect(validCatalog(c)).toBe(true);
    expect(c.models.DoubleVerb).toEqual({
      name: 'My Verb', short: 'Verb', group: 'amp',
      params: [{ sym: 'Bass', name: 'Low', min: 0, max: 1, def: 0.5, type: 1 }], // unnamed params are left out
    });
    expect(c.lists.amp).toEqual([{ category: 'Clean', models: ['DoubleVerb'] }]);
  }
  await expect(catalogFromApk(zip({ 'other.txt': new Uint8Array(1) }))).rejects.toThrow(/Spider Remote model files/);
  await expect(catalogFromApk(new Uint8Array(100))).rejects.toThrow(/isn't an APK or zip/);
  expect(validCatalog({ models: {} })).toBe(false);
});

// A zip with deflated entries (stored when deflating doesn't help).
function zip(files: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = new Uint8Array(deflateRawSync(data));
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const n = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(10, deflate ? 8 : 0, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, n.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), n, body);
    central.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + body.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
