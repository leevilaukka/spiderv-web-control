// Channel A/B: two setups of chosen blocks in one preset, switched with one
// key, like the GX-100's two amps or its divider in single mode. The Spider V
// has one amp and one serial chain, so the channels take turns instead of
// playing in parallel. Settings are kept as tone file groups ("amp", "cab",
// "fx1"...), the same form tone files and the tone assistant use.
import type { ToneGroup } from './presetfile';
import { type Shortcut, GROUP_BLOCKS, parseShortcuts } from './shortcuts';

export type ChannelId = 'A' | 'B';
export type Channels = {
  groups: string[]; // the blocks that belong to the channels; the rest are shared
  active: ChannelId;
  other: Record<string, ToneGroup>; // settings of the channel that isn't active
};
export type Tone = Record<string, ToneGroup>;

export const otherChannel = (c: ChannelId): ChannelId => (c === 'A' ? 'B' : 'A');

export const pickGroups = (tone: Tone, groups: string[]): Tone =>
  Object.fromEntries(groups.filter((g) => tone[g]).map((g) => [g, structuredClone(tone[g])]));

// The part of `target` that differs from `current`, to apply with planImport.
// A block whose model changes gets all its settings, since loading a model
// resets them; otherwise only what differs is sent, so switching between two
// setups of the same model is just a few knob changes.
export function switchTone(current: Tone, target: Tone): Tone {
  const out: Tone = {};
  for (const [g, t] of Object.entries(target)) {
    const c = current[g] ?? {};
    if (t['@model'] !== c['@model'] || t['@mic'] !== c['@mic']) { out[g] = { ...t }; continue; }
    const diff: ToneGroup = {};
    for (const [k, v] of Object.entries(t)) if (k !== '@model' && k !== '@mic' && c[k] !== v) diff[k] = v;
    if (!Object.keys(diff).length) continue;
    out[g] = { '@model': t['@model'], ...diff };
    if (t['@mic'] !== undefined) out[g]['@mic'] = t['@mic'];
  }
  return out;
}

// Completes a partial setup (from the tone assistant) from the current one:
// with the same model, settings left out keep their current values; with
// another model they take its defaults, apart from the block's on/off, mix
// and routing.
export function completeGroups(current: Tone, partial: Tone): Tone {
  const out: Tone = {};
  for (const [g, p] of Object.entries(partial)) {
    const c = current[g] ?? {};
    const sameModel = p['@model'] === undefined || p['@model'] === c['@model'];
    const shared = Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('@') && k !== '@model' && k !== '@mic'));
    out[g] = sameModel ? { ...c, ...p } : { ...shared, ...p };
  }
  return out;
}

// ------------------------------------------------------------ storage

// What this app keeps for a preset next to the tone on the amp.
export type PresetExtras = { shortcuts: Shortcut[]; channels: Channels | null };

function parseChannels(v: unknown): Channels | null {
  const c = v as Partial<Channels> | null;
  if (!c || typeof c !== 'object' || !Array.isArray(c.groups) || (c.active !== 'A' && c.active !== 'B')) return null;
  if (!c.other || typeof c.other !== 'object') return null;
  const groups = c.groups.filter((g) => typeof g === 'string' && GROUP_BLOCKS[g]);
  const other = Object.fromEntries(Object.entries(c.other).filter(([g, t]) => groups.includes(g) && t && typeof t === 'object'));
  return groups.length ? { groups, active: c.active, other } : null;
}

// Extras by preset index, as stored by an earlier session. Older versions
// stored only a list of shortcuts per preset.
export function parsePresetExtras(json: string | null): Record<number, PresetExtras> {
  let store: unknown;
  try { store = JSON.parse(json ?? '{}'); } catch { return {}; }
  return readPresetExtras(store);
}

// The same from parsed JSON, such as a settings file's "presets".
export function readPresetExtras(store: unknown): Record<number, PresetExtras> {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {};
  const out: Record<number, PresetExtras> = {};
  for (const [k, v] of Object.entries(store)) {
    if (!/^\d+$/.test(k)) continue;
    const e = Array.isArray(v) ? { shortcuts: parseShortcuts(v), channels: null } : readExtras(v);
    if (e.shortcuts.length || e.channels) out[Number(k)] = e;
  }
  return out;
}

// One preset's extras, such as those a tone file carries.
export function readExtras(v: unknown): PresetExtras {
  const e = v as Partial<PresetExtras> | null;
  return { shortcuts: parseShortcuts(e?.shortcuts), channels: parseChannels(e?.channels) };
}
