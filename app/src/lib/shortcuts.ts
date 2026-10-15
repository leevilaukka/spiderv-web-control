// Keyboard shortcuts: one fixed key per block, plus shortcuts the user makes
// that switch several blocks and set knobs at once, like the assignable CTL
// switches on a Boss GX-100. Like those, they belong to a preset.
import { type Control, type Slot } from './tone';
import { MsgType } from './protocol/codec';

// Pedalboard keys: fixed per block (not per chain position) so they don't
// move when a preset puts an effect post-amp. Matched by physical key.
export const BLOCK_KEYS: Record<string, string> = {
  Digit1: 'Gate', Digit2: 'Wah', Digit3: 'FX1', Digit4: 'FX2', Digit5: 'FX3', Digit6: 'Amp',
  Digit7: 'StudioCab', Digit8: 'FX4', Digit9: 'PostComp', Digit0: 'PostEQ', Minus: 'VolumePedal',
};

// Each target is the state its block takes while the shortcut is engaged;
// disengaging puts the block in the opposite state. Knobs go to `on` when
// engaged and to `off` when not, like a GX-100 assign's max and min. A toggle
// shortcut flips between the two on each press, a momentary one is engaged
// while held. On a MIDI expression pedal, knobs follow the pedal between
// `off` (heel) and `on` (toe) and the blocks engage once it leaves the heel.
export type Shortcut = {
  id: string;
  name: string;
  key: string; // KeyboardEvent.code, '' for none
  momentary: boolean;
  targets: { sym: string; on: boolean }[];
  knobs: KnobTarget[];
  midi: { cc: number; expression: boolean } | null;
};
export type KnobTarget = { sym: string; param: string; off: number; on: number };

// Keys that move around the page or that a shortcut can't sensibly use.
const RESERVED = new Set([
  'Tab', 'Enter', 'NumpadEnter', 'Escape', 'Space', 'Backspace', 'Delete',
  'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'Fn', 'FnLock',
]);

export type KeyConflict = { reserved: true } | { block: string } | { shortcut: Shortcut } | { control: string } | null;

// `taken` holds keys of app-wide controls (code -> what they do).
export function keyConflict(code: string, shortcuts: Shortcut[], selfId?: string, taken: Record<string, string> = {}): KeyConflict {
  if (RESERVED.has(code) || /^(Shift|Control|Alt|Meta|OS)/.test(code)) return { reserved: true };
  if (BLOCK_KEYS[code]) return { block: BLOCK_KEYS[code] };
  if (taken[code]) return { control: taken[code] };
  const other = shortcuts.find((s) => s.key === code && s.id !== selfId);
  return other ? { shortcut: other } : null;
}

const switchable = (chain: Slot[], sym: string) => chain.find((s) => s.sym === sym && s.enable);

// The knob a target refers to in this preset, if its block's model has it.
export function knobControl(chain: Slot[], sym: string, param: string): Control | undefined {
  const slot = chain.find((s) => s.sym === sym);
  return slot && [...slot.params, ...slot.extras].find((c) => c.sym === param && c.type !== MsgType.Bool);
}

const knobValue = (c: Control, v: number) => {
  v = Math.min(c.max, Math.max(c.min, v));
  return c.type === MsgType.Int ? Math.round(v) : v;
};

const near = (c: Control, v: number) => Math.abs(c.value - v) <= Math.max(1e-3, (c.max - c.min) * 0.005);

// Engaged when every target in this preset is in its engaged state, so the
// light follows changes made elsewhere (block keys, knobs, the amp itself).
export function isEngaged(s: Shortcut, chain: Slot[]): boolean {
  let any = false;
  for (const t of s.targets) {
    const slot = switchable(chain, t.sym);
    if (!slot) continue;
    if (!!slot.enable!.value !== t.on) return false;
    any = true;
  }
  for (const k of s.knobs) {
    const c = knobControl(chain, k.sym, k.param);
    if (!c) continue;
    if (!near(c, knobValue(c, k.on))) return false;
    any = true;
  }
  return any;
}

export type Change = { c: Control; value: number };

// The values that engage or disengage it; anything already in place is left alone.
export function changesFor(s: Shortcut, chain: Slot[], engage: boolean): Change[] {
  return expressionChanges(s, chain, engage ? 1 : 0, engage);
}

// The values for an expression pedal at `x` (0 heel .. 1 toe).
export function expressionChanges(s: Shortcut, chain: Slot[], x: number, engage = x > 0.02): Change[] {
  const out: Change[] = [];
  for (const t of s.targets) {
    const slot = switchable(chain, t.sym);
    const on = t.on === engage;
    if (slot && !!slot.enable!.value !== on) out.push({ c: slot.enable!, value: on ? 1 : 0 });
  }
  for (const k of s.knobs) {
    const c = knobControl(chain, k.sym, k.param);
    if (!c) continue;
    const value = knobValue(c, k.off + (k.on - k.off) * x);
    if (c.value !== value) out.push({ c, value });
  }
  return out;
}

// ------------------------------------------------------------ tone assistant

// Blocks by the tone file group names the tone assistant uses.
export const GROUP_BLOCKS: Record<string, string> = {
  gate: 'Gate', wah: 'Wah', fx1: 'FX1', fx2: 'FX2', fx3: 'FX3', amp: 'Amp', cab: 'StudioCab',
  reverb: 'FX4', compressor: 'PostComp', eq: 'PostEQ', volume: 'VolumePedal',
};
export const GROUP_OF: Record<string, string> = Object.fromEntries(Object.entries(GROUP_BLOCKS).map(([g, sym]) => [sym, g]));

// Knobs in tone file terms: "@volume" is the amp's channel volume and "@mix"
// an effect's mix, both GuitarProc controls; the rest are model parameters.
const paramOf = (sym: string, name: string) => (name === '@volume' ? 'ChannelVolume' : name === '@mix' ? `${sym}Mix` : name);
const nameOf = (sym: string, param: string) => (param === 'ChannelVolume' ? '@volume' : param === `${sym}Mix` ? '@mix' : param);

// A shortcut as the tone assistant reads and writes it.
export type KnobSpec = { block: string; param: string; off: number; on: number };
export type ShortcutSpec = {
  name: string; key?: string; momentary?: boolean;
  blocks?: Record<string, 'on' | 'off'>;
  knobs?: KnobSpec[];
};

export const toSpec = (s: Shortcut): ShortcutSpec => ({
  name: s.name,
  ...(s.key ? { key: s.key } : {}),
  ...(s.momentary ? { momentary: true } : {}),
  blocks: Object.fromEntries(s.targets.map((t) => [GROUP_OF[t.sym] ?? t.sym, t.on ? 'on' : 'off'])),
  ...(s.knobs.length ? { knobs: s.knobs.map((k) => ({ block: GROUP_OF[k.sym] ?? k.sym, param: nameOf(k.sym, k.param), off: k.off, on: k.on })) } : {}),
});

// Keys the assistant may assign, as KeyboardEvent.code; a single letter also works.
const KEY_CODE = /^(Key[A-Z]|Digit\d|Minus|F([1-9]|1\d|2[0-4])|Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End|Insert|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal)|Bracket(Left|Right)|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|Equal)$/;
export function keyCode(name: string): string | null {
  if (/^[a-z]$/i.test(name)) return 'Key' + name.toUpperCase();
  return KEY_CODE.test(name) ? name : null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Merges a set_shortcuts call into the list. A shortcut named like an
// existing one replaces it, keeping its key, mode and MIDI unless given.
// Knobs are checked against `chain`, the tone in the edit buffer.
export function mergeShortcutSpecs(input: unknown, list: Shortcut[], chain: Slot[], newId: () => string, taken: Record<string, string> = {}) {
  if (!input || typeof input !== 'object') throw new Error('Expected an object with "shortcuts" and/or "remove".');
  const { shortcuts = [], remove = [] } = input as { shortcuts?: unknown; remove?: unknown };
  if (!Array.isArray(shortcuts) || !Array.isArray(remove)) throw new Error('"shortcuts" and "remove" must be arrays.');
  let out = [...list];
  const saved: Shortcut[] = [], removed: string[] = [], notes: string[] = [];

  for (const name of remove) {
    const s = typeof name === 'string' ? out.find((x) => sameName(x.name, name)) : undefined;
    if (!s) { notes.push(`No shortcut named ${JSON.stringify(name)} to remove.`); continue; }
    out = out.filter((x) => x !== s);
    removed.push(s.name);
  }

  for (const spec of shortcuts as Partial<ShortcutSpec>[]) {
    const name = typeof spec?.name === 'string' ? spec.name.trim().slice(0, 40) : '';
    if (!name) { notes.push(`Skipped a shortcut without a name: ${JSON.stringify(spec)}`); continue; }
    const targets: Shortcut['targets'] = [];
    for (const [group, v] of Object.entries((spec.blocks && typeof spec.blocks === 'object' ? spec.blocks : {}) as Record<string, unknown>)) {
      const sym = GROUP_BLOCKS[group.toLowerCase()];
      const on = v === 'on' || v === true ? true : v === 'off' || v === false ? false : undefined;
      if (!sym) notes.push(`${name}: unknown block "${group}".`);
      else if (on === undefined) notes.push(`${name}: ${group} must be "on" or "off".`);
      else if (!targets.some((t) => t.sym === sym)) targets.push({ sym, on });
    }
    const knobs: KnobTarget[] = [];
    for (const k of (Array.isArray(spec.knobs) ? spec.knobs : []) as Partial<KnobSpec>[]) {
      const sym = GROUP_BLOCKS[String(k?.block ?? '').toLowerCase()];
      const param = sym ? paramOf(sym, String(k.param ?? '')) : '';
      const c = sym ? knobControl(chain, sym, param) : undefined;
      if (!c) { notes.push(`${name}: no knob ${k?.block}.${k?.param} on the current models; skipped it.`); continue; }
      if (typeof k.off !== 'number' || typeof k.on !== 'number') { notes.push(`${name}: ${k.block}.${k.param} needs numbers for "off" and "on".`); continue; }
      const off = knobValue(c, k.off), on = knobValue(c, k.on);
      if (off !== k.off || on !== k.on) notes.push(`${name}: ${k.block}.${k.param} clamped to ${c.min}..${c.max}.`);
      if (!knobs.some((x) => x.sym === sym && x.param === param)) knobs.push({ sym, param, off, on });
    }
    if (!targets.length && !knobs.length) { notes.push(`Skipped "${name}": it changes nothing.`); continue; }

    const existing = out.find((x) => sameName(x.name, name));
    const id = existing?.id ?? newId();
    let key = existing?.key ?? '';
    if (typeof spec.key === 'string') {
      const code = spec.key ? keyCode(spec.key) : '';
      const conflict = code ? keyConflict(code, out, id, taken) : null;
      if (code === null) notes.push(`${name}: key "${spec.key}" can't be used, so it has no key.`);
      else if (conflict && 'block' in conflict) notes.push(`${name}: ${code} already switches ${GROUP_OF[conflict.block]} on its own, so it has no key.`);
      else if (conflict && 'shortcut' in conflict) notes.push(`${name}: ${code} is already used by "${conflict.shortcut.name}", so it has no key.`);
      else if (conflict && 'control' in conflict) notes.push(`${name}: ${code} is the key for ${conflict.control}, so it has no key.`);
      else if (conflict) notes.push(`${name}: ${code} is reserved, so it has no key.`);
      key = code && !conflict ? code : '';
    }
    const s: Shortcut = {
      id, name, key, targets, knobs,
      momentary: typeof spec.momentary === 'boolean' ? spec.momentary : !!existing?.momentary,
      midi: existing?.midi ?? null,
    };
    out = existing ? out.map((x) => (x === existing ? s : x)) : [...out, s];
    saved.push(s);
  }
  return { list: out, saved, removed, notes };
}

// ------------------------------------------------------------ storage

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Shortcuts as stored by an earlier session, dropping anything malformed.
export function parseShortcuts(list: unknown): Shortcut[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((s): Shortcut[] => {
    if (!s || typeof s.id !== 'string' || !Array.isArray(s.targets)) return [];
    const targets = s.targets
      .filter((t: unknown): t is { sym: string; on: boolean } =>
        !!t && typeof (t as { sym: unknown }).sym === 'string' && typeof (t as { on: unknown }).on === 'boolean')
      .map(({ sym, on }: { sym: string; on: boolean }) => ({ sym, on }));
    const knobs = (Array.isArray(s.knobs) ? s.knobs : [])
      .filter((k: Partial<KnobTarget> | null) => k && typeof k.sym === 'string' && typeof k.param === 'string' && isNum(k.off) && isNum(k.on))
      .map(({ sym, param, off, on }: KnobTarget) => ({ sym, param, off, on }));
    const midi = s.midi && isNum(s.midi.cc) ? { cc: s.midi.cc, expression: !!s.midi.expression } : null;
    return [{ id: s.id, name: String(s.name ?? ''), key: typeof s.key === 'string' ? s.key : '', momentary: !!s.momentary, targets, knobs, midi }];
  });
}
