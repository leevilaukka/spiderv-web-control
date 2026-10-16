// Tone assistant: a chat with a language model that designs tones and applies
// them to the amp's edit buffer through the apply_tone tool, and sets up
// multi-block shortcuts and channels A/B through set_shortcuts and set_channels. Runs entirely in
// the browser with the user's own API key for the chosen provider.
import { amp } from './amp.svelte';
import { anthropic } from './ai/anthropic';
import { gemini } from './ai/gemini';
import type { Conversation, Provider, ProviderId, ToolCall, ToolResult, ToolSpec, UserTurn } from './ai/provider';
import type { ToneFile } from './presetfile';
import { PRESET_NAME_MAX } from './protocol/codec';
import { type Change, GROUPS, MIC_NAMES, catalogPrompt, checkTone, diffTones } from './tonedesign';
import { type Shortcut, GROUP_BLOCKS, mergeShortcutSpecs, toSpec } from './shortcuts';
import { shortcuts } from './shortcuts.svelte';
import { controls } from './controls.svelte';
import { completeGroups, pickGroups } from './channels';

export const PROVIDERS: Provider[] = [anthropic, gemini];
const MAX_TURNS = 6; // model calls per user message
const RECENT_KEY = 'spiderv.ai.recent';
const RECENT_MAX = 10;

// A tone the assistant applied, as the whole edit buffer afterwards, so it
// can be brought back after a misclick or a preset change.
export type RecentTone = { time: number; name: string; prompt: string; file: ToneFile };

const parseRecent = (list: unknown): RecentTone[] =>
  Array.isArray(list) ? list.filter((r) => r?.file?.version === 5 && r.file.data?.tone).slice(0, RECENT_MAX) : [];

function loadRecent(): RecentTone[] {
  try { return parseRecent(JSON.parse(load(RECENT_KEY) || '[]')); } catch { return []; }
}

// What a settings file holds of the assistant; API keys stay in the browser.
type AssistantSettings = { provider: ProviderId; models: Record<ProviderId, string>; recent: RecentTone[] };

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tone'; name: string; text: string; details: string[]; changes: Change[]; ok: boolean }
  | { kind: 'card'; title: string; text: string; lines: { key?: string; text: string }[]; details: string[]; ok: boolean }
  | { kind: 'error'; text: string };

// Only "@model" is typed; checkTone checks the rest. Kept to the JSON Schema
// subset every provider accepts.
const groupSchema = (group: string) => ({
  type: 'object',
  description: GROUPS[group].fixed ? `Fixed block (${GROUPS[group].fixed}).` : 'Settings for this block.',
  properties: { '@model': { type: 'string', description: GROUPS[group].fixed ? 'May be omitted.' : 'Model id from the catalog.' } },
  additionalProperties: true,
});

const APPLY_TONE: ToolSpec = {
  name: 'apply_tone',
  description:
    "Loads a tone into the amp's edit buffer so the guitarist hears it right away. Takes the same groups as <current_tone>. " +
    'Groups you leave out stay as they are; settings you leave out within a group keep their current value, or the model default when the model changes. ' +
    'Returns what was applied and anything that was ignored or clamped.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: `Preset name, at most ${PRESET_NAME_MAX} characters.` },
      tone: {
        type: 'object',
        properties: Object.fromEntries(Object.keys(GROUPS).map((g) => [g, groupSchema(g)])),
      },
    },
    required: ['name', 'tone'],
  },
};

const SET_SHORTCUTS: ToolSpec = {
  name: 'set_shortcuts',
  description:
    "Creates, replaces or removes the guitarist's shortcuts, buttons in the editor (optionally on a key) that switch several blocks at once. " +
    'A shortcut with the name of an existing one replaces it. Shortcuts not mentioned stay as they are. Returns what was saved and any problems.',
  schema: {
    type: 'object',
    properties: {
      shortcuts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short button label, e.g. "Solo".' },
            key: {
              type: 'string',
              description: 'Key as a KeyboardEvent.code: KeyA..KeyZ, F1..F12, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Numpad0..Numpad9. "" for none; leave out to keep the current key.',
            },
            momentary: { type: 'boolean', description: 'true: engaged only while held. false (default): each press toggles.' },
            blocks: {
              type: 'object',
              description: 'State each block takes while the shortcut is engaged. Blocks left out are not touched.',
              properties: Object.fromEntries(Object.keys(GROUP_BLOCKS).map((g) => [g, { type: 'string', enum: ['on', 'off'] }])),
            },
            knobs: {
              type: 'array',
              description: 'Knobs the shortcut sets: to "on" while engaged, to "off" otherwise. Values in the units of <current_tone>.',
              items: {
                type: 'object',
                properties: {
                  block: { type: 'string', description: 'Group name, e.g. "amp".' },
                  param: { type: 'string', description: 'Setting name as in <current_tone>, e.g. "Drive", "@volume", "@mix".' },
                  off: { type: 'number' },
                  on: { type: 'number' },
                },
                required: ['block', 'param', 'off', 'on'],
              },
            },
          },
          required: ['name'],
        },
      },
      remove: { type: 'array', items: { type: 'string' }, description: 'Names of shortcuts to delete.' },
    },
  },
};

const SET_CHANNELS: ToolSpec = {
  name: 'set_channels',
  description:
    'Sets up channels A and B: two setups of the chosen blocks in one preset that the guitarist switches between with one key. ' +
    'The active channel is the tone on the amp (change it with apply_tone); this sets the blocks and the settings of the other channel. ' +
    'An empty "blocks" removes the channels.',
  schema: {
    type: 'object',
    properties: {
      blocks: { type: 'array', items: { type: 'string', enum: Object.keys(GROUPS) }, description: 'Groups that differ between the channels, e.g. ["amp", "cab"].' },
      other: {
        type: 'object',
        description: 'Settings of the inactive channel, in the format apply_tone takes. Settings left out stay as that channel has them (or as the active channel has them for a new setup); with another model they take its defaults.',
        properties: Object.fromEntries(Object.keys(GROUPS).map((g) => [g, groupSchema(g)])),
      },
    },
    required: ['blocks'],
  },
};

const systemPrompt = (catalog: string) => `You help a guitarist design tones for their Line 6 Spider V amp, from inside a web editor connected to the amp over USB. When they describe a sound (a song, an artist, a style, or just adjectives), choose models and settings from the catalog below and call apply_tone. The tone goes straight into the amp's edit buffer so they can play through it at once; it is stored in a preset only when they press Save in the editor.

Each user message starts with the tone currently on the amp in <current_tone>, in the format apply_tone takes. It reflects knob changes they made since your last turn, so build on it. For tweaks ("more gain", "darker", "less delay"), send only the groups you change. For a new tone, send all ${Object.keys(GROUPS).length} groups and switch off the blocks you don't use with "@enabled": false, so nothing from the previous tone carries over.

Signal chain, in order: ${Object.keys(GROUPS).join(' → ')}. fx1, fx2, fx3 and reverb sit before the amp unless "@post" is true.

Values:
- Knobs are 0..1 unless the catalog gives another range; the editor shows 0..1 as 0 to 10. Catalog entries list each setting with its default; a quoted name is the label the editor shows.
- Every group takes "@enabled" (true/false). fx1, fx2, fx3 and reverb also take "@mix" (0..1) and "@post" (true = after the amp). volume takes "@post". amp takes "@volume", the channel volume (0..1). cab takes "@mic" (${MIC_NAMES}) and "Level", early reflections (0..1).
- Delay times and modulation speeds are knob positions, not milliseconds or hertz. Tempo sync isn't available.
- On the eq, a gain of 0.5 is flat.
- Keep amp "@volume" near its current value unless they ask for a louder or quieter tone, since a jump in level through a speaker is unpleasant.

# Shortcuts

The editor also has shortcuts, like the assignable CTL footswitches on a Boss GX-100: buttons, each optionally on a keyboard key (a foot controller that sends keystrokes can press them), that switch several blocks on or off at once. Each user message lists the current preset's shortcuts in <shortcuts>, in the format set_shortcuts takes. A shortcut is engaged while every block it names is in its listed state. Pressing it engages it if it isn't and otherwise switches each of its blocks to the opposite state; a momentary one is engaged only while held. So {"fx2": "on", "reverb": "on"} brings in delay and reverb for a solo and takes them out again, and {"fx1": "on", "fx3": "off"} swaps fx1 and fx3.

Shortcuts can also set knobs, like a GX-100 assign's min and max: "knobs" go to "on" while engaged and to "off" otherwise, so a solo shortcut might raise amp "@volume" from 0.6 to 0.75 and fx2 "@mix" from 0.1 to 0.35. Use the current values for "off" so the main part sounds as it does now. A shortcut can't change models; that's what channels are for. The guitarist can also put a shortcut on a MIDI expression pedal, which sweeps its knobs between "off" and "on". Like on the GX-100 they belong to the preset: loading another preset brings its own shortcuts, and the shortcuts of a tone you made are stored with it when they press Save. They name blocks by position, so the effect a shortcut needs must be in that slot of the tone. When they ask for one, or for a tone with parts to switch during a song (a boost or delay for solos, a crunch pedal for choruses), set up the tone so the switched blocks hold the right effects, then create the shortcut with set_shortcuts; for a tone, start it in the state for the main part, with the shortcut disengaged. Prefer letter keys near each other (q, w, e, r) unless they ask for others; keys 1-0 and - already switch single blocks. Don't change or remove shortcuts they didn't mention.

# Channels

Channels A and B emulate the GX-100's two amps or two-way chain: the blocks listed in <channels> have two setups that one key switches between, while the other blocks are shared. The Spider V has one amp and one serial chain, so the channels take turns rather than play in parallel. <channels> shows which blocks, which channel is active, and the inactive channel's settings; the active channel is simply the tone on the amp. For "a clean and a lead amp" or "switch between two amps", use set_channels with the amp and cab (and any effects that should differ) and the other channel's settings, and build the active channel with apply_tone. Then tell them to switch with the channel button or its key. Switching between different models reloads them, which may be audible; settings of the same model switch seamlessly. Channels are stored with the preset when they press Save.

After apply_tone returns, tell them in two to four short sentences what you set up and why, and mention anything it reports as ignored or clamped. After set_shortcuts or set_channels, say which key or button does what. Suggest a tweak or two they could ask for. Write plain text without Markdown; the chat panel shows it as is. If a request has nothing to do with guitar tone, say briefly what you can help with.

# Catalog

${catalog}`;

const load = (key: string) => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};
const store = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
};

class Assistant {
  open = $state(false);
  providerId = $state<ProviderId>((load('spiderv.ai.provider') as ProviderId) || 'anthropic');
  keys = $state<Record<ProviderId, string>>({ anthropic: load('spiderv.ai.key.anthropic'), gemini: load('spiderv.ai.key.gemini') });
  models = $state<Record<ProviderId, string>>({
    anthropic: load('spiderv.ai.model.anthropic') || anthropic.models[0].id,
    gemini: load('spiderv.ai.model.gemini') || gemini.models[0].id,
  });
  items = $state<ChatItem[]>([]);
  busy = $state(false);
  status = $state('');
  recent = $state.raw<RecentTone[]>(loadRecent());
  restoring = $state(false);
  private prompt = ''; // the user message being answered

  private conversation: Conversation | null = null;
  // Results of tool calls that were never sent because the turn was
  // interrupted; every tool call needs one, so they go with the next message.
  private pending: ToolResult[] = [];
  private abort: AbortController | null = null;

  get provider() { return PROVIDERS.find((p) => p.id === this.providerId) ?? anthropic; }
  get model() { return this.models[this.providerId]; }
  get modelLabel() { return this.provider.models.find((m) => m.id === this.model)?.label ?? this.model; }
  get apiKey() { return this.keys[this.providerId]; }

  // Changing provider, model or key starts a new chat; histories are in each
  // provider's own format and don't carry over.
  configure(providerId: ProviderId, model: string, key: string) {
    key = key.trim();
    if (providerId !== this.providerId || model !== this.models[providerId] || key !== this.keys[providerId]) this.reset();
    this.providerId = providerId;
    this.models[providerId] = model;
    this.keys[providerId] = key;
    store('spiderv.ai.provider', providerId);
    store(`spiderv.ai.model.${providerId}`, model);
    store(`spiderv.ai.key.${providerId}`, key);
  }

  get settings(): AssistantSettings {
    return $state.snapshot({ provider: this.providerId, models: this.models, recent: this.recent });
  }

  // Takes over settings from a settings file: the provider, models this
  // version still offers, and recent tones. Starts a new chat if the
  // provider or model changes.
  restoreSettings(v: unknown) {
    const s = (v && typeof v === 'object' ? v : {}) as Partial<AssistantSettings>;
    const before = `${this.providerId}/${this.model}`;
    for (const p of PROVIDERS) {
      const m = s.models?.[p.id];
      if (!p.models.some((x) => x.id === m)) continue;
      this.models[p.id] = m!;
      store(`spiderv.ai.model.${p.id}`, m!);
    }
    if (PROVIDERS.some((p) => p.id === s.provider)) {
      this.providerId = s.provider!;
      store('spiderv.ai.provider', s.provider!);
    }
    if (Array.isArray(s.recent)) {
      this.recent = parseRecent(s.recent);
      store(RECENT_KEY, this.recent.length ? JSON.stringify(this.recent) : '');
    }
    if (`${this.providerId}/${this.model}` !== before) this.reset();
  }

  reset() {
    this.stop();
    this.items = [];
    this.conversation = null;
    this.pending = [];
  }

  stop() { this.abort?.abort(); }

  async send(text: string) {
    text = text.trim();
    const st = amp.client?.symbols;
    if (!text || this.busy || !this.apiKey || !st) return;
    this.busy = true;
    this.prompt = text;
    this.items.push({ kind: 'user', text });
    const abort = (this.abort = new AbortController());
    const provider = this.provider;
    let turn: UserTurn = { results: this.pending };
    this.pending = [];
    try {
      this.status = 'Reading the amp…';
      const current = await amp.currentTone();
      const keys = JSON.stringify(shortcuts.list.map(toSpec));
      const ch = amp.channels ? JSON.stringify({ blocks: amp.channels.groups, active: amp.channels.active, other: amp.channels.other }) : 'none';
      turn.text = `<current_tone>\n${JSON.stringify(current.data.tone)}\n</current_tone>\n<shortcuts>\n${keys}\n</shortcuts>\n<channels>\n${ch}\n</channels>\n\n${text}`;
      this.conversation ??= await provider.start({
        apiKey: this.apiKey, model: this.model, system: systemPrompt(catalogPrompt(st)), tools: [APPLY_TONE, SET_SHORTCUTS, SET_CHANNELS],
      });
      for (let i = 0; ; i++) {
        if (i === MAX_TURNS) { this.pending = turn.results ?? []; break; }
        const reply = await this.reply(this.conversation, turn, abort.signal);
        if (reply.stop !== 'done') {
          this.pending = turn.results ?? [];
          this.items.push({
            kind: 'error',
            text: reply.stop === 'refused'
              ? `${this.modelLabel} declined this request. Try describing the sound differently.`
              : 'The reply was cut off before the tone was complete. Try again.',
          });
          break;
        }
        if (!reply.calls.length) break;
        const results: ToolResult[] = [];
        for (const call of reply.calls) results.push(await this.runTool(call));
        turn = { results };
      }
    } catch (e) {
      this.pending = turn.results ?? [];
      if (!abort.signal.aborted) this.items.push({ kind: 'error', text: provider.describeError(e) ?? (e as Error).message });
    } finally {
      this.busy = false;
      this.status = '';
      this.abort = null;
    }
  }

  // One model call; text appears in the chat as it streams in.
  private reply(conversation: Conversation, turn: UserTurn, signal: AbortSignal) {
    this.status = 'Thinking…';
    let entry: { text: string } | null = null;
    return conversation.send(turn, {
      signal,
      onText: (delta) => {
        if (!entry) {
          this.items.push({ kind: 'assistant', text: '' });
          entry = this.items[this.items.length - 1] as { text: string };
          this.status = '';
        }
        entry.text += delta;
      },
      onToolCall: () => { this.status = 'Designing the tone…'; },
    });
  }

  private async runTool(call: ToolCall): Promise<ToolResult> {
    const result = (text: string, isError = false): ToolResult => ({ call, text, isError });
    if (call.name === SET_SHORTCUTS.name) return this.setShortcuts(call);
    if (call.name === SET_CHANNELS.name) return this.setChannels(call);
    if (call.name !== APPLY_TONE.name) return result(`Unknown tool ${call.name}.`, true);
    let checked: ReturnType<typeof checkTone>;
    let before: ToneFile;
    try {
      // Read again: an earlier call in this turn may have changed the tone.
      before = await amp.currentTone();
      checked = checkTone(call.input, amp.client!.symbols!, before);
    } catch (e) {
      return result(`${(e as Error).message} Received: ${JSON.stringify(call.input)}`, true);
    }
    const { file, problems } = checked;
    const name = file.data.meta.name;
    if (!Object.keys(file.data.tone).length) {
      this.items.push({ kind: 'tone', name, ok: false, text: 'Nothing could be applied.', details: problems, changes: [] });
      return result(['Nothing was applied.', ...problems].join('\n'), true);
    }
    this.status = 'Applying to the amp…';
    try {
      const { applied, failed, plan, after, changes } = await this.applyAndDiff(file, before);
      const notes = [...problems, ...plan.warnings, ...failed.map((l) => `Failed on the amp: ${l}`), ...plan.skipped.map((l) => `Not supported: ${l}`)];
      if (!after) notes.push("Couldn't re-read the tone afterwards; press Re-read tone in the amp menu.");
      else if (applied) this.remember(name, after);
      this.items.push({
        kind: 'tone', name, ok: !failed.length,
        text: `${applied} setting${applied === 1 ? '' : 's'} applied${notes.length ? `, ${notes.length} note${notes.length === 1 ? '' : 's'}` : ''}`,
        details: notes, changes,
      });
      this.status = 'Thinking…';
      return result([`Applied "${name}": ${applied} settings sent to the amp.`, ...notes].join('\n'));
    } catch (e) {
      this.items.push({ kind: 'tone', name, ok: false, text: `Couldn't apply: ${(e as Error).message}`, details: problems, changes: [] });
      return result(`Applying failed: ${(e as Error).message}`, true);
    }
  }

  private setShortcuts(call: ToolCall): ToolResult {
    let merged: ReturnType<typeof mergeShortcutSpecs>;
    try {
      merged = mergeShortcutSpecs(call.input, $state.snapshot(shortcuts.list), amp.chain, () => shortcuts.newId(), controls.taken);
    } catch (e) {
      return { call, text: `${(e as Error).message} Received: ${JSON.stringify(call.input)}`, isError: true };
    }
    const { list, saved, removed, notes } = merged;
    const changed = saved.length + removed.length > 0;
    if (changed) shortcuts.replace(list);
    const blocks = (s: Shortcut) => {
      const spec = toSpec(s);
      return [
        ...Object.entries(spec.blocks ?? {}).map(([g, v]) => `${GROUPS[g]?.label ?? g} ${v}`),
        ...(spec.knobs ?? []).map((k) => `${GROUPS[k.block]?.label ?? k.block} ${k.param} ${k.off}→${k.on}`),
      ].join(', ') + (s.momentary ? ' (while held)' : '');
    };
    this.items.push({
      kind: 'card', title: 'Shortcuts', ok: changed,
      text: [saved.length && `${saved.length} saved`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean).join(', ') || 'Nothing changed',
      lines: saved.map((s) => ({ key: s.key, text: `${s.name}: ${blocks(s)}` })),
      details: notes,
    });
    const lines = [
      ...saved.map((s) => `Saved "${s.name}"${s.key ? ` on ${s.key}` : ' without a key'}: ${blocks(s)}.`),
      ...removed.map((n) => `Removed "${n}".`),
      ...notes,
    ];
    return { call, text: changed ? lines.join('\n') : ['Nothing changed.', ...lines].join('\n'), isError: !changed };
  }

  private async setChannels(call: ToolCall): Promise<ToolResult> {
    const fail = (text: string): ToolResult => ({ call, text, isError: true });
    const input = call.input as { blocks?: unknown; other?: unknown } | null;
    if (!input || !Array.isArray(input.blocks)) return fail(`Expected "blocks" as an array. Received: ${JSON.stringify(call.input)}`);
    const groups = input.blocks.filter((g): g is string => typeof g === 'string' && !!GROUPS[g]);
    const bad = input.blocks.filter((g) => !groups.includes(g as string));
    if (!groups.length) {
      amp.setChannels(null);
      this.items.push({ kind: 'card', title: 'Channels', ok: true, text: 'Removed', lines: [], details: [] });
      return { call, text: 'Removed the channels.', isError: false };
    }
    let current, checked;
    try {
      current = await amp.currentTone();
      checked = checkTone({ name: 'other', tone: input.other ?? {} }, amp.client!.symbols!, current);
    } catch (e) {
      return fail(`${(e as Error).message} Received: ${JSON.stringify(call.input)}`);
    }
    const prev = amp.channels ? $state.snapshot(amp.channels) : null;
    const base = { ...pickGroups(current.data.tone, groups), ...pickGroups(prev?.other ?? {}, groups) };
    const given = pickGroups(checked.file.data.tone, groups);
    const other = { ...base, ...completeGroups(base, given) };
    const notes = [
      ...bad.map((g) => `Unknown block ${JSON.stringify(g)}.`),
      ...checked.problems,
      ...Object.keys(checked.file.data.tone).filter((g) => !groups.includes(g)).map((g) => `${g} isn't in "blocks", so its settings were ignored.`),
    ];
    const active = prev?.active ?? 'A';
    amp.setChannels({ groups, active, other });
    const inactive = active === 'A' ? 'B' : 'A';
    const describe = (g: string) => `${GROUPS[g].label}: ${other[g]?.['@model'] ?? '–'}${other[g]?.['@enabled'] === false ? ' (off)' : ''}`;
    this.items.push({
      kind: 'card', title: 'Channels', ok: true,
      text: `${groups.map((g) => GROUPS[g].label).join(', ')} switch between A and B; ${active} is on now`,
      lines: groups.map((g) => ({ text: `${inactive} ${describe(g)}` })),
      details: notes,
    });
    const key = controls.settings.channelKey;
    return {
      call, isError: false,
      text: [
        `Channels set up for ${groups.join(', ')}. Channel ${active} is active (the tone on the amp); channel ${inactive}: ${JSON.stringify(other)}.`,
        key ? `The channel switch is on key ${key}.` : 'The channel switch has no key yet; they can click the A/B button or set a key under Controls.',
        ...notes,
      ].join('\n'),
    };
  }

  // Applies a tone and compares the edit buffer before and after it.
  private async applyAndDiff(file: ToneFile, before: ToneFile) {
    const res = await amp.applyTone(file, '');
    const after = res.refreshError ? null : await amp.currentTone().catch(() => null);
    return { ...res, after, changes: after ? diffTones(before, after) : [] };
  }

  // ------------------------------------------------------------ recent tones

  private remember(name: string, file: ToneFile) {
    file = structuredClone(file);
    file.data.meta = { ...file.data.meta, name, author: 'Tone assistant' };
    this.recent = [{ time: Date.now(), name, prompt: this.prompt, file }, ...this.recent].slice(0, RECENT_MAX);
    store(RECENT_KEY, JSON.stringify(this.recent));
  }

  // Loads a recent tone back into the edit buffer. Doesn't involve the model;
  // the next message shows it the restored tone as <current_tone>.
  async restore(r: RecentTone) {
    if (this.busy || this.restoring) return;
    this.restoring = true;
    try {
      const before = await amp.currentTone();
      const { applied, failed, plan, after, changes } = await this.applyAndDiff(structuredClone(r.file), before);
      const notes = [...plan.warnings, ...failed.map((l) => `Failed on the amp: ${l}`)];
      if (!after) notes.push("Couldn't re-read the tone afterwards; press Re-read tone in the amp menu.");
      this.items.push({
        kind: 'tone', name: r.name, ok: !failed.length,
        text: `Restored from recent tones: ${applied} setting${applied === 1 ? '' : 's'} applied`,
        details: notes, changes,
      });
    } catch (e) {
      this.items.push({ kind: 'error', text: `Couldn't restore “${r.name}”: ${(e as Error).message}` });
    } finally {
      this.restoring = false;
    }
  }

  forget(r: RecentTone) {
    this.recent = this.recent.filter((x) => x !== r);
    store(RECENT_KEY, this.recent.length ? JSON.stringify(this.recent) : '');
  }
}

export const assistant = new Assistant();
