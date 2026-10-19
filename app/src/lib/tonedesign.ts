// What the tone assistant needs to know about this amp, and the checks its
// proposals go through before they reach the edit buffer. A proposal has the
// shape of a tone file's `tone` object ({ amp: { "@model": ..., Drive: ... } }),
// so it is applied with the same planImport/applyImport path as files.
import { PRESET_NAME_MAX, SymbolTable } from './protocol/codec';
import { type CatalogParam, clampTempo, type ModelList, MICS, NOTES, SYNC_PARAM, catalog, humanize, modelChoices, noteName } from './tone';
import type { ToneFile, ToneGroup } from './presetfile';

type GroupDef = { label: string; list?: ModelList; fixed?: string; keys: Record<string, 'bool' | 'unit' | 'mic' | 'note'> };

// Tempo sync (@temposync, SyncSelect) applies only to models that have it.
const FX_KEYS = { '@enabled': 'bool', '@mix': 'unit', '@post': 'bool', '@temposync': 'bool', [SYNC_PARAM]: 'note' } as const;
const SYNC_KEYS = new Set(['@temposync', SYNC_PARAM]);
const hasSync = (model: string) => !!catalog.models[model]?.params.some((p) => p.sym === SYNC_PARAM);

// Tone file groups in signal-chain order. `keys` are the switches and levels
// that live on GuitarProc rather than on the model.
export const GROUPS: Record<string, GroupDef> = {
  gate: { label: 'Gate', fixed: 'Gate', keys: { '@enabled': 'bool' } },
  wah: { label: 'Wah', list: 'wah', keys: { '@enabled': 'bool' } },
  fx1: { label: 'FX 1', list: 'fx', keys: FX_KEYS },
  fx2: { label: 'FX 2', list: 'fx', keys: FX_KEYS },
  fx3: { label: 'FX 3', list: 'fx', keys: FX_KEYS },
  amp: { label: 'Amp', list: 'amp', keys: { '@enabled': 'bool', '@volume': 'unit' } },
  cab: { label: 'Cab', list: 'cab', keys: { '@enabled': 'bool', '@mic': 'mic' } },
  reverb: { label: 'Reverb', list: 'reverb', keys: FX_KEYS },
  compressor: { label: 'Comp', fixed: 'SharcPodFixedComp', keys: { '@enabled': 'bool' } },
  eq: { label: 'EQ', fixed: 'ParaGraphic4_band', keys: { '@enabled': 'bool' } },
  volume: { label: 'Volume', fixed: 'VolumePedal', keys: { '@enabled': 'bool', '@post': 'bool' } },
};

// Present in tone files but not settable here; dropped without comment so
// echoing back <current_tone> values doesn't produce noise.
const IGNORED = new Set(['@speakermode', '@mixtype']);

// SyncSelect is described once in the instructions rather than per model.
const modelParams = (sym: string): CatalogParam[] =>
  (catalog.models[sym]?.params ?? []).filter((p) => !p.sym.startsWith('@') && !IGNORED.has(p.sym) && p.sym !== SYNC_PARAM);

const available = (list: ModelList, st: SymbolTable) =>
  new Set(modelChoices(list, st).flatMap((c) => c.models.map((m) => m.sym)));

const short = (v: number) => String(Math.round(v * 100) / 100).replace(/^(-?)0\./, '$1.');

function describeParam(p: CatalogParam): string {
  let s = p.sym + (p.name !== p.sym ? ` "${p.name}"` : '');
  if (p.type === 2) return `${s} ${p.def ? 'on' : 'off'}`;
  const min = Number(p.min), max = Number(p.max);
  if (p.type === 0) s += ` ${min}..${max} int`;
  else if (min !== 0 || max !== 1) s += ` ${min}..${max}${min === -96 ? ' dB' : ''}`;
  return `${s} ${short(Number(p.def))}`;
}

// The models this amp has, with their parameters and defaults. Deterministic
// for a given firmware so the prompt caches.
export function catalogPrompt(st: SymbolTable): string {
  const out: string[] = [];
  const lists: [ModelList, string][] = [['amp', 'amp'], ['cab', 'cab'], ['fx', 'fx1, fx2, fx3'], ['reverb', 'reverb'], ['wah', 'wah']];
  for (const [list, groups] of lists) {
    out.push(`## Models for ${groups}`);
    const seen = new Set<string>();
    for (const { category, models } of modelChoices(list, st)) {
      const fresh = models.filter((m) => !seen.has(m.sym));
      if (!fresh.length) continue;
      out.push(`### ${category}`);
      for (const m of fresh) {
        seen.add(m.sym);
        const params = list === 'cab' ? [] : modelParams(m.sym).map(describeParam);
        out.push(`- ${m.sym} "${m.name}"${hasSync(m.sym) ? ' [sync]' : ''}${params.length ? ': ' + params.join(', ') : ''}`);
      }
    }
    out.push('');
  }
  out.push('## Fixed blocks (no model choice)');
  for (const [group, def] of Object.entries(GROUPS)) {
    if (!def.fixed) continue;
    out.push(`- ${group} (${catalog.models[def.fixed]?.name ?? def.fixed}): ${modelParams(def.fixed).map(describeParam).join(', ')}`);
  }
  return out.join('\n');
}

export const MIC_NAMES = MICS.map((m, i) => `${i} ${m.label}`).join(', ');

// Checks a proposal against the catalog and this amp's models, clamps
// out-of-range values, and turns it into a tone file. Groups without a
// "@model" keep the model from `current`. Everything that was dropped or
// changed is listed in `problems` so the assistant can correct itself.
export function checkTone(input: unknown, st: SymbolTable, current?: ToneFile): { file: ToneFile; problems: string[] } {
  const spec = input as { name?: unknown; tone?: unknown } | null;
  if (!spec || typeof spec !== 'object' || !spec.tone || typeof spec.tone !== 'object') {
    throw new Error('Expected an object with "name" and "tone".');
  }
  const problems: string[] = [];
  const tone: Record<string, ToneGroup> = {};

  for (const [group, raw] of Object.entries(spec.tone as Record<string, unknown>)) {
    if (group === 'global') {
      // Only the tempo is settable; the speaker mode is echoed in <current_tone> and dropped.
      const bpm = (raw as Record<string, unknown> | null)?.['@tempo'];
      if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0) tone.global = { '@tempo': clampTempo(bpm) };
      else if (bpm !== undefined) problems.push('global.@tempo: expected a number of beats per minute; ignored.');
      continue;
    }
    const def = GROUPS[group];
    if (!def) { problems.push(`Unknown group "${group}".`); continue; }
    if (!raw || typeof raw !== 'object') { problems.push(`${group}: expected an object.`); continue; }
    const values = raw as Record<string, unknown>;

    let model = typeof values['@model'] === 'string' ? (values['@model'] as string) : undefined;
    if (def.fixed) {
      if (model && model !== def.fixed) problems.push(`${group}: has no model choice; used ${def.fixed}.`);
      model = def.fixed;
    } else {
      model ??= current?.data.tone[group]?.['@model'] as string | undefined;
      if (!model) { problems.push(`${group}: "@model" is missing.`); continue; }
      if (!available(def.list!, st).has(model)) { problems.push(`${group}: this amp has no ${def.list} model "${model}"; left unchanged.`); continue; }
    }

    const g: ToneGroup = { '@model': model };
    const params = new Map(modelParams(model).map((p) => [p.sym, p]));
    for (const [key, v] of Object.entries(values)) {
      if (key === '@model' || IGNORED.has(key)) continue;
      const label = `${group}.${key}`;
      const kind = def.keys[key];
      const p = params.get(key);
      if ((!kind && !p) || (SYNC_KEYS.has(key) && !hasSync(model))) {
        problems.push(`${label}: ${catalog.models[model]?.name ?? model} has no such setting; ignored.`);
        continue;
      }
      if (kind === 'bool' || p?.type === 2) {
        if (typeof v !== 'boolean' && v !== 0 && v !== 1) { problems.push(`${label}: expected true or false; ignored.`); continue; }
        g[key] = !!v;
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${label}: expected a number; ignored.`); continue; }
      const [min, max, int] = kind === 'mic' ? [0, MICS.length - 1, true]
        : kind === 'note' ? [1, NOTES.length, true]
        : kind === 'unit' ? [0, 1, false]
        : [Number(p!.min), Number(p!.max), p!.type === 0];
      let n = Math.min(max, Math.max(min, v));
      if (int) n = Math.round(n);
      if (n !== v) problems.push(`${label}: ${v} is outside ${min}..${max}${int ? ' (whole numbers)' : ''}; used ${n}.`);
      g[key] = n;
    }
    tone[group] = g;
  }
  if (!Object.keys(tone).length) problems.push('Nothing to apply.');

  const name = (typeof spec.name === 'string' ? spec.name.trim() : '').slice(0, PRESET_NAME_MAX) || 'New tone';
  return {
    file: {
      version: 5,
      schema: 'L6Preset',
      data: {
        meta: { name, author: 'Tone assistant', application: 'Spider V Web Control', modifieddate: Math.floor(Date.now() / 1000), appversion: 1 },
        tone,
      },
    },
    problems,
  };
}

// ------------------------------------------------------------------ changes

export type Change = { block: string; text: string };

const GROUP_KEY_LABELS: Record<string, string> = {
  '@mix': 'Mix', '@post': 'Position', '@volume': 'Volume', '@mic': 'Mic', '@temposync': 'Tempo sync', [SYNC_PARAM]: 'Note',
};

const modelLabel = (sym: unknown) =>
  sym === '@NoCabinet' ? 'No cabinet' : catalog.models[String(sym)]?.name ?? humanize(String(sym ?? 'none'));

// Formats a value the way the editor's knobs and switches show it.
function formatValue(key: string, v: unknown, p?: CatalogParam, model?: string): string {
  if (key === '@post') return v ? 'after amp' : 'before amp';
  if (key === SYNC_PARAM) return noteName(Number(v), catalog.models[model ?? '']?.group ?? '');
  if (key === '@mic') return MICS[Number(v)]?.label ?? String(v);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  const n = Number(v);
  if (p && Number(p.min) === -96) return `${n.toFixed(1)} dB`;
  if (p?.type === 0) return String(n);
  if (!p || (Number(p.min) === 0 && Number(p.max) === 1)) return (n * 10).toFixed(1);
  return n.toFixed(2);
}

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;

// What differs between two tones, block by block in signal-chain order, in
// the editor's terms. When a block's model changes, its settings are listed
// as they are now rather than as changes from the old model's.
export function diffTones(before: ToneFile, after: ToneFile): Change[] {
  const changes: Change[] = [];
  for (const [group, def] of Object.entries(GROUPS)) {
    const b = before.data.tone[group] ?? {}, a = after.data.tone[group];
    if (!a) continue;
    const push = (text: string) => changes.push({ block: def.label, text });
    if (a['@enabled'] !== undefined && a['@enabled'] !== b['@enabled']) push(a['@enabled'] ? 'switched on' : 'switched off');
    const modelChanged = !def.fixed && a['@model'] !== b['@model'];
    if (modelChanged) push(`${modelLabel(b['@model'])} → ${modelLabel(a['@model'])}`);
    const params = new Map((catalog.models[String(a['@model'])]?.params ?? []).map((p) => [p.sym, p]));
    for (const [key, v] of Object.entries(a)) {
      if (key === '@model' || key === '@enabled' || IGNORED.has(key)) continue;
      const p = params.get(key);
      const old = modelChanged && !def.keys[key] ? undefined : b[key];
      if (old !== undefined && same(old, v)) continue;
      const label = GROUP_KEY_LABELS[key] ?? p?.name ?? humanize(key);
      const m = String(a['@model']);
      push(old === undefined ? `${label} ${formatValue(key, v, p, m)}` : `${label} ${formatValue(key, old, p, m)} → ${formatValue(key, v, p, m)}`);
    }
  }
  const bpm = after.data.tone.global?.['@tempo'], was = before.data.tone.global?.['@tempo'];
  if (typeof bpm === 'number' && bpm !== was) changes.push({ block: 'Tempo', text: `${typeof was === 'number' ? `${was} → ` : ''}${bpm} BPM` });
  return changes;
}
