// Mostly compile-time checks: `bun run typecheck` (tsc over the tests) fails if a line marked as an
// expected error below starts to compile.
import { expect, test } from 'bun:test';
import { SpiderV } from 'spiderv-protocol/client';
import {
  Channel, EditorCmd, LibrarianCmd, MsgType, blockId, decodeTyped, encodeTyped, le32, modelId, numeric, paramId,
  parseSysex, typed, encodeSysex, encodeMessage,
} from 'spiderv-protocol/codec';
import { fromWire, toWire } from '../app/src/lib/protocol/remote';

declare const amp: SpiderV;

// Never called; only here to be type-checked.
async function misuse() {
  const block = blockId(1), param = paramId(2), model = modelId(3);
  await amp.getParam(block, param);
  // @ts-expect-error a model id is not a parameter id
  await amp.getParam(block, model);
  // @ts-expect-error a plain number is not a block id
  await amp.setParam(5, param, typed(MsgType.Float, 1));
  // @ts-expect-error the slot is a block, the model a model
  await amp.loadModel(model, block);
  // @ts-expect-error a librarian command on the editor channel
  await amp.request(Channel.Editor, LibrarianCmd.GetPresetFile);
  // @ts-expect-error an editor command on the librarian channel
  await amp.request(Channel.Librarian, EditorCmd.GetVersion);
  // @ts-expect-error a bare number needs requestRaw
  await amp.request(Channel.Editor, 1);
  await amp.requestRaw(0, 1);
  // @ts-expect-error a bool is a boolean
  const bad: Parameters<typeof amp.setParam>[2] = { type: MsgType.Bool, value: 1 };
  // @ts-expect-error a float is a number
  const bad2: Parameters<typeof amp.setParam>[2] = { type: MsgType.Float, value: true };
  return [bad, bad2];
}
void misuse;

test('bool values are booleans on both sides of the wire', () => {
  const v = typed(MsgType.Bool, 1);
  expect(v).toEqual({ type: MsgType.Bool, value: true });
  expect(numeric(v)).toBe(1);
  expect(decodeTyped(encodeTyped(v), 0)).toEqual(v);
  expect(decodeTyped(encodeTyped(typed(MsgType.Bool, 0)), 0)).toEqual({ type: MsgType.Bool, value: false });
  expect(decodeTyped(encodeTyped(typed(MsgType.Int, -3)), 0)).toEqual({ type: MsgType.Int, value: -3 });
  expect(numeric(decodeTyped(encodeTyped(typed(MsgType.Float, 0.5)), 0))).toBeCloseTo(0.5);
});

test('the library produces Uint8Arrays and accepts plain arrays', () => {
  expect(le32(1)).toBeInstanceOf(Uint8Array);
  expect(encodeMessage(1, [1, 2, 3])).toBeInstanceOf(Uint8Array);
  const packets = encodeSysex([0x22, 0], 0, 0, encodeMessage(1));
  expect(packets[0]).toBeInstanceOf(Uint8Array);
  const parsed = parseSysex(Array.from(packets[0]));
  expect(parsed.type).toBe('fragment');
});

test('SysEx crosses the relay as a JSON array, not an object', () => {
  const bytes = encodeMessage(5, [9, 8, 7]);
  const json = JSON.stringify({ data: toWire(bytes) });
  expect(Array.isArray(JSON.parse(json).data)).toBe(true);
  expect(fromWire(JSON.parse(json).data)).toEqual(bytes);
});
