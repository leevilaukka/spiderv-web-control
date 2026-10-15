// Gemini through Google's GenAI SDK, called directly from the browser.
// History is kept by hand, the way the SDK's Chat does it, so a reply that
// doesn't complete never leaves a function call without its response.
import type { Content, GenerateContentConfig, GoogleGenAI, Part } from '@google/genai';
import { type Conversation, type Provider, type Reply, type ReplyOptions, type ToolSpec, type UserTurn, MAX_RETRIES } from './provider';

// Loaded on first use so the SDK stays out of the main bundle.
let SDK: typeof import('@google/genai') | undefined;

const REFUSED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

export class GeminiConversation implements Conversation {
  // Model output is kept exactly as received; its parts carry the thought
  // signatures Gemini needs to continue after a function call.
  private history: Content[] = [];
  private config: GenerateContentConfig;

  constructor(private ai: GoogleGenAI, private model: string, system: string, tools: ToolSpec[]) {
    this.config = {
      systemInstruction: system,
      tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.schema })) }],
    };
  }

  async send(turn: UserTurn, opts: ReplyOptions): Promise<Reply> {
    const parts: Part[] = [
      ...(turn.results ?? []).map((r) => ({
        functionResponse: { ...(r.call.id ? { id: r.call.id } : {}), name: r.call.name, response: r.isError ? { error: r.text } : { output: r.text } },
      })),
      ...(turn.text ? [{ text: turn.text }] : []),
    ];
    const contents: Content[] = [...this.history, { role: 'user', parts }];

    for (let attempt = 0; ; attempt++) {
      const output: Content[] = [];
      let finish: string | undefined;
      let blocked = false;
      let announced = false;
      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents,
        config: { ...this.config, abortSignal: opts.signal },
      });
      for await (const chunk of stream) {
        if (chunk.promptFeedback?.blockReason) blocked = true;
        const candidate = chunk.candidates?.[0];
        const content = candidate?.content;
        if (content?.parts?.length) {
          output.push({ ...content, role: content.role ?? 'model' });
          for (const p of content.parts) {
            if (p.text && !p.thought) opts.onText(p.text);
            if (p.functionCall && !announced) { announced = true; opts.onToolCall(); }
          }
        }
        if (candidate?.finishReason) finish = candidate.finishReason;
      }

      if (blocked || (finish && REFUSED.has(finish))) return { calls: [], stop: 'refused' };
      if (finish === 'MALFORMED_FUNCTION_CALL') {
        if (attempt < MAX_RETRIES) continue;
        throw new Error("Gemini couldn't put together a valid tone. Try again or rephrase.");
      }
      const calls = output.flatMap((c) => c.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      if (finish === 'MAX_TOKENS' && calls.length) return { calls: [], stop: 'truncated' };
      if (!output.length) throw new Error('Gemini returned an empty reply. Try again.');
      this.history = [...contents, ...output];
      return { calls: calls.map((c) => ({ id: c.id ?? '', name: c.name ?? '', input: c.args ?? {} })), stop: 'done' };
    }
  }
}

export const gemini: Provider = {
  id: 'gemini',
  label: 'Gemini (Google)',
  models: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
  ],
  keyName: 'Gemini API key',
  keyPlaceholder: 'AIza…',
  keyUrl: 'https://aistudio.google.com/apikey',

  async start({ apiKey, model, system, tools }) {
    SDK ??= await import('@google/genai');
    return new GeminiConversation(new SDK.GoogleGenAI({ apiKey }), model, system, tools);
  },

  describeError(e) {
    if (!SDK || !(e instanceof SDK.ApiError)) return undefined;
    if (e.status === 401 || e.status === 403) return 'The Gemini API key was rejected. Check it under API key.';
    if (e.status === 429) return 'Rate limited by the Gemini API. Wait a moment and try again.';
    return `Gemini API error ${e.status}: ${e.message}`;
  },
};
