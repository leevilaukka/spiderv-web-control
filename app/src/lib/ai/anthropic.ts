// Claude through the Anthropic SDK, called directly from the browser.
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessageParam, BetaTool, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { type Conversation, type Provider, type Reply, type ReplyOptions, type ToolSpec, type UserTurn, MAX_RETRIES } from './provider';

// Loaded on first use so the SDK stays out of the main bundle.
let SDK: typeof Anthropic | undefined;

export class ClaudeConversation implements Conversation {
  // Append-only: replies are sent back exactly as received.
  private history: BetaMessageParam[] = [];
  private tools: BetaTool[];

  constructor(private client: Anthropic, private model: string, private system: string, tools: ToolSpec[]) {
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as BetaTool['input_schema'], eager_input_streaming: true }));
  }

  async send(turn: UserTurn, opts: ReplyOptions): Promise<Reply> {
    const content: BetaContentBlockParam[] = [
      ...(turn.results ?? []).map((r) => ({ type: 'tool_result' as const, tool_use_id: r.call.id, content: r.text, is_error: r.isError })),
      ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
    ];
    const messages: BetaMessageParam[] = [...this.history, { role: 'user', content }];
    for (let attempt = 0; ; attempt++) {
      let reply;
      try {
        reply = await this.stream(messages, opts);
      } catch (e) {
        // Tool input streams unvalidated, and the SDK rejects input it can't
        // parse at all. That is worth another try; API errors aren't.
        if (opts.signal.aborted || !SDK || e instanceof SDK.APIError || attempt >= MAX_RETRIES) throw e;
        continue;
      }
      const calls = reply.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      if (reply.stop_reason === 'refusal') return { calls: [], stop: 'refused' };
      if (reply.stop_reason === 'max_tokens' && calls.length) return { calls: [], stop: 'truncated' };
      this.history = [...messages, { role: 'assistant', content: reply.content }];
      return { calls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input })), stop: 'done' };
    }
  }

  private stream(messages: BetaMessageParam[], opts: ReplyOptions) {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 64000,
        // On a safety decline, retry on the fallback model Anthropic recommends.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: this.system,
        tools: this.tools,
        messages,
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => opts.onText(delta));
    stream.on('streamEvent', (e) => {
      if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') opts.onToolCall();
    });
    return stream.finalMessage();
  }
}

export const anthropic: Provider = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
  keyName: 'Anthropic API key',
  keyPlaceholder: 'sk-ant-…',
  keyUrl: 'https://console.anthropic.com/settings/keys',

  async start({ apiKey, model, system, tools }) {
    SDK ??= (await import('@anthropic-ai/sdk')).default;
    return new ClaudeConversation(new SDK({ apiKey, dangerouslyAllowBrowser: true }), model, system, tools);
  },

  describeError(e) {
    if (!SDK) return undefined;
    if (e instanceof SDK.AuthenticationError) return 'The Anthropic API key was rejected. Check it under API key.';
    if (e instanceof SDK.PermissionDeniedError) return `This API key can't use this model: ${e.message}`;
    if (e instanceof SDK.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.';
    if (e instanceof SDK.APIConnectionError) return "Couldn't reach the Anthropic API. Check your connection.";
    if (e instanceof SDK.APIError) return `Anthropic API error${e.status ? ` ${e.status}` : ''}: ${e.message}`;
    return undefined;
  },
};
