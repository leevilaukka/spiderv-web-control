// Codec tests against a Spider V Remote <-> Spider V 30 (MkI, fw 2.02) capture.
// Fixture lines: "<time> <-|-> <hex bytes>" from tools/pcap2sysex.py.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type Message, EditorCmd, Kind, LibrarianCmd, MsgType, Reassembler, crc32, decodeParamChange, decodePresetInfo,
  encodeMessage, encodeSysex, encodeTyped, le32, pack7, parsePreset, parseSysex, unpack7,
} from '../app/src/lib/protocol/codec';

const capture = readFileSync(new URL('./fixtures/spiderv30-remote-capture.txt', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => {
    const [, dir, ...hex] = l.trim().split(/\s+/);
    return { out: dir === '->', bytes: hex.map((h) => parseInt(h, 16)) };
  });
const hex = (s: string) => s.trim().split(/\s+/).map((h) => parseInt(h, 16));
const MKI: [number, number] = [0x22, 0x00];

function decodeAll(fromAmp: boolean) {
  const r = new Reassembler();
  const msgs: Message[] = [];
  const other = [];
  for (const c of capture.filter((c) => c.out !== fromAmp)) {
    const p = parseSysex(c.bytes);
    if (p.type === 'fragment') msgs.push(...r.push(p));
    else other.push(p);
  }
  return { msgs, other };
}

test('7-bit packing round-trips and matches the capture', () => {
  const data = Array.from({ length: 300 }, (_, i) => (i * 37) & 0xff);
  expect(unpack7(pack7(data)).slice(0, data.length)).toEqual(data);
  expect(pack7([0xe4, 0x11, 0x6f, 0xc3])).toEqual(hex('48 64 11 6f 43 00 00 00'));
});

test('CRC32 is standard CRC-32', () => {
  expect(crc32([...new TextEncoder().encode('123456789')])).toBe(0xcbf43926);
});

test('encoder reproduces packets sent by Spider V Remote byte-for-byte', () => {
  const sent = new Set(capture.filter((c) => c.out).map((c) => c.bytes.join()));
  const cases: [number, number, number[]][] = [
    [0, 0, encodeMessage(EditorCmd.GetVersion)],
    [1, 3, encodeMessage(LibrarianCmd.GetPresetInfo, le32(0))],
    [1, 2, encodeMessage(LibrarianCmd.GetPresetFile, le32(-1))],
    [0, 3, encodeMessage(EditorCmd.GetFbvConnectivityStatus)],
    [0, 16, [...le32(0x374), ...le32(0x350), ...encodeTyped({ type: MsgType.Bool, value: 0 })]],
  ];
  for (const [ch, seq, msg] of cases) expect(sent.has(encodeSysex(MKI, ch, seq, msg)[0].join())).toBe(true);
});

test('decodes identity and extended info', () => {
  const { other } = decodeAll(true);
  expect(other[0]).toMatchObject({ type: 'identity', family: 0x22, member: 0 });
  expect(other[1]).toMatchObject({ type: 'info', info: { L6ImageType: 'main' } });
});

test('reassembles host messages split across header and body packets', () => {
  const { msgs } = decodeAll(false);
  expect(msgs.find((m) => m.kind === EditorCmd.Handshake)!.body).toEqual([0xe4, 0x11, 0x6f, 0xc3]);
  const set = msgs.find((m) => m.kind === EditorCmd.SetDspModelParam)!;
  expect(decodeParamChange(set.body)).toEqual({ obj: 0x374, param: 0x350, type: MsgType.Bool, value: 0 });
});

test('decodes preset names, a full preset and live parameter changes', () => {
  const { msgs } = decodeAll(true);
  const names = msgs.filter((m) => m.channel === 1 && m.kind === Kind.Reply && m.body.length > 24 && m.body.length < 60)
    .map((m) => decodePresetInfo(m.body).name);
  expect(names).toHaveLength(128);
  expect(names[0]).toBe('Arachnid Rhythm');

  const preset = parsePreset(msgs.find((m) => m.body.length > 1000)!.body);
  expect(preset.name).toBe('O Breakdown');
  expect(preset.sections.map((s) => s.magic)).toEqual(['PRSP', 'GTRT']);
  expect(preset.tone!.id).toBe(0x374);
  expect(preset.tone!.children).toHaveLength(12);

  const change = decodeParamChange(msgs.find((m) => m.kind === Kind.ParamChanged)!.body);
  expect(change).toEqual({ obj: 0x374, param: 0x350, type: MsgType.Float, value: 1 });
});

test('splits long messages into fragments with cumulative offsets', () => {
  const body = Array.from({ length: 600 }, (_, i) => i & 0xff);
  const pkts = encodeSysex(MKI, 1, 5, encodeMessage(0x42, body));
  expect(pkts).toHaveLength(3);
  const r = new Reassembler();
  const out = pkts.flatMap((p) => r.push(parseSysex(p) as never));
  expect(out).toHaveLength(1);
  expect(out[0].body).toEqual(body);
});

test('amp-side reassembly drops an incomplete message instead of merging it', () => {
  const r = new Reassembler(false);
  const short = encodeSysex(MKI, 1, 1, encodeMessage(Kind.Reply, le32(0x80)))[0];
  const truncated = parseSysex(short) as Extract<ReturnType<typeof parseSysex>, { type: 'fragment' }>;
  truncated.payload = truncated.payload.slice(0, 6); // lost tail
  expect(r.push(truncated)).toEqual([]);
  const next = encodeSysex(MKI, 1, 2, encodeMessage(Kind.Reply, le32(7)))[0];
  expect(r.push(parseSysex(next) as never)).toEqual([{ channel: 1, kind: Kind.Reply, body: le32(7) }]);
  expect(r.dropped).toBe(6);
});
