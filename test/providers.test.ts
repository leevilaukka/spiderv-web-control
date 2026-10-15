// Tone assistant provider adapters against fake API clients: what they send,
// and that only completed replies join the history.
import { expect, test } from 'bun:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { GoogleGenAI } from '@google/genai';
import { ClaudeConversation } from '../app/src/lib/ai/anthropic';
import { GeminiConversation } from '../app/src/lib/ai/gemini';
import type { ReplyOptions, ToolSpec } from '../app/src/lib/ai/provider';

const tool: ToolSpec = { name: 'apply_tone', description: 'Applies a tone.', schema: { type: 'object' } };
const opts = (text: string[] = []): ReplyOptions => ({ signal: new AbortController().signal, onText: (d) => text.push(d), onToolCall: () => {} });
const call = { id: 'c1', name: 'apply_tone', input: { name: 'Jazz', tone: {} } };

function fakeGemini(replies: { parts: object[]; finishReason: string }[][]) {
  const requests: { contents: unknown[]; config: Record<string, unknown> }[] = [];
  const ai = {
    models: {
      generateContentStream: async (params: { contents: unknown[]; config: Record<string, unknown> }) => {
        requests.push(structuredClone({ contents: params.contents, config: { ...params.config, abortSignal: undefined } }));
        const chunks = replies.shift()!;
        return (async function* () {
          for (const c of chunks) yield { candidates: [{ content: { role: 'model', parts: c.parts }, finishReason: c.finishReason || undefined }] };
        })();
      },
    },
  };
  return { ai: ai as unknown as GoogleGenAI, requests };
}

test('gemini: function calls round-trip with their thought signatures', async () => {
  const { ai, requests } = fakeGemini([
    [
      { parts: [{ text: 'Going for a ', thought: false }, { text: 'thinking…', thought: true }], finishReason: '' },
      { parts: [{ functionCall: { id: 'g1', name: 'apply_tone', args: { name: 'Jazz' } }, thoughtSignature: 'sig' }], finishReason: 'STOP' },
    ],
    [{ parts: [{ text: 'Done.' }], finishReason: 'STOP' }],
  ]);
  const conv = new GeminiConversation(ai, 'gemini-test', 'system', [tool]);
  const text: string[] = [];
  const reply = await conv.send({ text: 'jazz please' }, opts(text));
  expect(text).toEqual(['Going for a ']);
  expect(reply).toEqual({ stop: 'done', calls: [{ id: 'g1', name: 'apply_tone', input: { name: 'Jazz' } }] });
  expect(requests[0].config.systemInstruction).toBe('system');
  expect(requests[0].config.tools).toEqual([{ functionDeclarations: [{ name: 'apply_tone', description: 'Applies a tone.', parametersJsonSchema: { type: 'object' } }] }]);

  await conv.send({ results: [{ call: reply.calls[0], text: 'Applied.', isError: false }] }, opts());
  const contents = requests[1].contents as { role: string; parts: Record<string, unknown>[] }[];
  expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'model', 'user']);
  expect(contents[2].parts[0]).toEqual({ functionCall: { id: 'g1', name: 'apply_tone', args: { name: 'Jazz' } }, thoughtSignature: 'sig' });
  expect(contents[3].parts).toEqual([{ functionResponse: { id: 'g1', name: 'apply_tone', response: { output: 'Applied.' } } }]);
});

test('gemini: refusals and malformed calls are not kept', async () => {
  const { ai, requests } = fakeGemini([
    [{ parts: [{ text: 'no' }], finishReason: 'SAFETY' }],
    [{ parts: [{ text: 'x' }], finishReason: 'MALFORMED_FUNCTION_CALL' }],
    [{ parts: [{ text: 'ok' }], finishReason: 'STOP' }],
    [{ parts: [{ text: 'ok' }], finishReason: 'STOP' }],
  ]);
  const conv = new GeminiConversation(ai, 'gemini-test', 'system', [tool]);
  expect((await conv.send({ text: 'a' }, opts())).stop).toBe('refused');
  // Retried after the malformed call, then kept.
  expect(await conv.send({ text: 'b', results: [{ call: { ...call, id: '' }, text: 'bad', isError: true }] }, opts())).toEqual({ stop: 'done', calls: [] });
  expect(requests).toHaveLength(3);
  await conv.send({ text: 'c' }, opts());
  const contents = requests[3].contents as { role: string; parts: Record<string, unknown>[] }[];
  expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  // No id on the call: none on the response either.
  expect(contents[0].parts).toEqual([{ functionResponse: { name: 'apply_tone', response: { error: 'bad' } } }, { text: 'b' }]);
});

function fakeClaude(replies: { content: object[]; stop_reason: string }[]) {
  const requests: { messages: unknown[]; fallbacks?: unknown; tools: unknown[] }[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: unknown[]; fallbacks?: unknown; tools: unknown[] }) => {
          requests.push(structuredClone(params));
          return { on() {}, finalMessage: async () => replies.shift()! };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

test('claude: tool results go back with the call id; refusals are not kept', async () => {
  const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'apply_tone', input: { name: 'Jazz' } };
  const { client, requests } = fakeClaude([
    { content: [{ type: 'text', text: 'Here' }, toolUse], stop_reason: 'tool_use' },
    { content: [], stop_reason: 'refusal' },
    { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' },
  ]);
  const conv = new ClaudeConversation(client, 'claude-test', 'system', [tool]);
  const reply = await conv.send({ text: 'jazz' }, opts());
  expect(reply).toEqual({ stop: 'done', calls: [{ id: 'toolu_1', name: 'apply_tone', input: { name: 'Jazz' } }] });
  expect(requests[0].fallbacks).toBe('default');
  expect(requests[0].tools).toEqual([{ name: 'apply_tone', description: 'Applies a tone.', input_schema: { type: 'object' }, eager_input_streaming: true }]);

  const results = [{ call: reply.calls[0], text: 'Applied.', isError: false }];
  expect((await conv.send({ results }, opts())).stop).toBe('refused');
  // The refused turn is gone; its results go out again with the next message.
  await conv.send({ results, text: 'next' }, opts());
  const messages = requests[2].messages as { role: string; content: unknown }[];
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(messages[2].content).toEqual([
    { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Applied.', is_error: false },
    { type: 'text', text: 'next' },
  ]);
});
