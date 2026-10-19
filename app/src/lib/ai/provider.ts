// What the tone assistant needs from a model provider: a conversation that
// streams replies and asks for tool calls. Each provider keeps the history in
// its own wire format.

export type ToolSpec = { name: string; description: string; schema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; input: unknown };
export type ToolResult = { call: ToolCall; text: string; isError: boolean };

// A user turn: new text, results for the tool calls of the previous reply,
// or both (results left over from an interrupted turn go first).
export type UserTurn = { text?: string; results?: ToolResult[] };

export type Reply = {
  calls: ToolCall[];
  // 'refused': declined for safety reasons; 'truncated': cut off in the middle of a tool call.
  stop: 'done' | 'refused' | 'truncated';
};

export type ReplyOptions = {
  signal: AbortSignal;
  onText: (delta: string) => void;
  // Thought summaries, for providers that return them.
  onThought?: (delta: string) => void;
  onToolCall: () => void;
};

export interface Conversation {
  // Sends a turn and streams the reply. The turn and reply join the history
  // only when the reply is 'done'; after a throw, 'refused' or 'truncated'
  // the conversation is as it was before.
  send(turn: UserTurn, opts: ReplyOptions): Promise<Reply>;
}

export type ProviderId = 'anthropic' | 'gemini';

export type Provider = {
  id: ProviderId;
  label: string;
  models: { id: string; label: string }[];
  keyName: string;
  keyPlaceholder: string;
  keyUrl: string;
  start(opts: { apiKey: string; model: string; system: string; tools: ToolSpec[] }): Promise<Conversation>;
  // A readable message for errors from this provider's API, if it is one.
  describeError(e: unknown): string | undefined;
};

export const MAX_RETRIES = 2; // for replies with unparseable tool calls
