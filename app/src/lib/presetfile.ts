// Tone files: the JSON format ("version": 5) used by Line 6's Spider Remote
// apps for shared/exported tones (L6EdLibPresetV5::DumpToJson; Spider V
// Remote saves .svl6p files), plus the raw binary the amp returns from
// GetPresetFile. The format is detected from the content, not the extension.
//
// Importing turns a file into a list of edits for the amp's edit buffer;
// nothing is written to the amp's preset memory.
import { type Block, type Bytes, type Preset, MsgType, PresetKey, SymbolTable, VType, parsePreset } from './protocol/codec';
import type { SpiderV } from './protocol/client';
import { MICS, SYNC_PARAM, catalog, splitCab } from './tone';

export type ToneGroup = Record<string, number | string | boolean>;
export const TONE_EXTRAS_KEY = 'spiderv-web-control';
export type ToneFile = {
  version: 5;
  schema?: 'L6Preset';
  data: {
    meta: { name: string; author?: string; application?: string; modifieddate?: number; appversion?: number; tnid?: number; [k: string]: unknown };
    device?: number;
    device_version?: number;
    tone: Record<string, ToneGroup>;
  };
  // This app's shortcuts and channels of the tone (channels.ts), outside
  // Line 6's part of the file.
  [TONE_EXTRAS_KEY]?: unknown;
};

// File group -> amp block, and the prefix of its GuitarProc controls
// (@enabled -> <prefix>Enable, @mix -> <prefix>Mix, ...).
const GROUPS: Record<string, { block: string; prefix: string; postPrefix?: string }> = {
  gate: { block: 'Gate', prefix: 'Gate' },
  wah: { block: 'Wah', prefix: 'Wah' },
  fx1: { block: 'FX1', prefix: 'FX1' },
  fx2: { block: 'FX2', prefix: 'FX2' },
  fx3: { block: 'FX3', prefix: 'FX3' },
  amp: { block: 'Amp', prefix: 'Amp' },
  cab: { block: 'StudioCab', prefix: 'Cab' },
  reverb: { block: 'FX4', prefix: 'FX4' },
  compressor: { block: 'PostComp', prefix: 'PostComp' },
  eq: { block: 'PostEQ', prefix: 'PostEQ' },
  volume: { block: 'VolumePedal', prefix: 'VolumePedal', postPrefix: 'Volume' },
};
const ROOT = 'GuitarProc';

export type ImportOp =
  | { kind: 'model'; obj: number; model: number; label: string }
  | { kind: 'param'; obj: number; ctrl: number; type: MsgType; value: number; label: string }
  | { kind: 'tempo'; bpm: number; label: string }
  | { kind: 'presetKey'; key: number; type: MsgType; value: number; label: string };

export type ImportPlan = {
  name: string;
  author: string;
  label?: string;
  tnid?: number;
  ops: ImportOp[];
  skipped: string[];
  warnings: string[];
};

// ------------------------------------------------------------------ reading

export function readToneFile(bytes: Bytes, st: SymbolTable): ToneFile {
  const text = new TextDecoder().decode(new Uint8Array(bytes)).trim();
  if (text.startsWith('{')) {
    let json: ToneFile;
    try { json = JSON.parse(text); } catch (e) { throw new Error(`Not a valid tone file: ${(e as Error).message}`); }
    if (json?.version !== 5 || !json.data?.tone) {
      throw new Error(`Unsupported tone file (version ${json?.version ?? 'unknown'}); expected a version 5 Spider V tone.`);
    }
    return json;
  }
  // Raw preset binary, as returned by GetPresetFile.
  let preset: Preset;
  try { preset = parsePreset(bytes); } catch { throw new Error('Unrecognised file: expected a Spider V tone (.svl6p, .l6t or .json) or a preset dump.'); }
  if (!preset.tone) throw new Error('This preset file contains no tone.');
  return toToneFile(preset, st);
}

// A setting's value type from the catalog; without one, from the edit
// buffer (`stored`, when the block keeps its model), else a true/false in
// the file means a switch and anything else a knob.
const typeOf = (model: string, param: string, raw: unknown, stored?: VType): MsgType => {
  const t = catalog.models[model]?.params.find((p) => p.sym === param)?.type;
  if (t !== undefined) return t === 0 ? MsgType.Int : t === 2 ? MsgType.Bool : MsgType.Float;
  if (stored !== undefined) return stored === VType.Int ? MsgType.Int : stored === VType.Bool ? MsgType.Bool : MsgType.Float;
  return typeof raw === 'boolean' ? MsgType.Bool : MsgType.Float;
};

const num = (v: unknown) => (typeof v === 'boolean' ? Number(v) : Number(v));

// `current` (the edit buffer) lets the plan skip reloading models that are
// already in place, which would otherwise reset those blocks first.
export function planImport(file: ToneFile, st: SymbolTable, current?: Preset): ImportPlan {
  const ops: ImportOp[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const root = st.id(ROOT);
  const tone = file.data.tone;

  const family = (file.data.device ?? 0) >> 16;
  if (family && family !== 0x22) warnings.push(`This tone was made for another device (id 0x${file.data.device!.toString(16)}); some settings may not fit.`);
  if (root === undefined) throw new Error('The amp has no GuitarProc block.');

  // Speaker mode is a preset setting; Line 6's catalog lists it under the
  // cab, their files put it in "global".
  let speaker: { value: number; label: string } | undefined;

  const currentModel = new Map((current?.tone?.children ?? []).map((b) => [b.id, b.model]));
  const kept = new Set<number>(); // blocks whose model stays, so their stored types apply

  const rootParam = (name: string, value: number, type: MsgType, label: string) => {
    const ctrl = st.id(name);
    if (ctrl === undefined) { skipped.push(label); return; }
    ops.push({ kind: 'param', obj: root, ctrl, type, value, label });
  };

  // Models first: loading a model resets that block's parameters.
  const models: Record<string, string> = {};
  for (const [group, def] of Object.entries(GROUPS)) {
    const g = tone[group];
    const obj = st.id(def.block);
    if (!g || obj === undefined) continue;
    let model = String(g['@model'] ?? '');
    if (!model) continue;
    let modelSym = model;
    if (group === 'cab') {
      if (model === '@NoCabinet') modelSym = 'NoCabinet';
      else {
        const mic = MICS[num(g['@mic'] ?? 0)] ?? MICS[0];
        modelSym = splitCab(model).mic >= 0 ? model : model + mic.suffix;
      }
    }
    const id = st.id(modelSym);
    if (id === undefined) { warnings.push(`${group}: this amp has no model "${model}"; kept the current one.`); continue; }
    models[group] = model;
    if (currentModel.get(obj) === id) { kept.add(obj); continue; }
    ops.push({ kind: 'model', obj, model: id, label: `${group}: ${catalog.models[model]?.name ?? model}` });
  }

  for (const [group, def] of Object.entries(GROUPS)) {
    const g = tone[group];
    const obj = st.id(def.block);
    if (!g || obj === undefined) continue;
    const model = models[group];
    // Tempo sync off is SyncSelect 0 on the amp; the file keeps the note.
    const syncOff = '@temposync' in g && !g['@temposync'];
    const entries = Object.entries(g);
    if (syncOff && !(SYNC_PARAM in g) && catalog.models[model]?.params.some((p) => p.sym === SYNC_PARAM)) entries.push([SYNC_PARAM, 0]);
    for (const [key, raw] of entries) {
      const label = `${group}.${key}`;
      const value = key === SYNC_PARAM && syncOff ? 0 : num(raw);
      switch (key) {
        case '@model': case '@mic': case '@temposync': continue;
        case '@speakermode': speaker = { value, label }; continue;
        case '@enabled': rootParam(`${def.prefix}Enable`, value ? 1 : 0, MsgType.Bool, label); continue;
        case '@post': rootParam(`${def.postPrefix ?? def.prefix}Post`, value ? 1 : 0, MsgType.Bool, label); continue;
        case '@mix': rootParam(`${def.prefix}Mix`, value, MsgType.Float, label); continue;
        case '@mixtype': rootParam(`${def.prefix}MixType`, value, MsgType.Int, label); continue;
        case '@volume': rootParam('ChannelVolume', value, MsgType.Float, label); continue;
      }
      if (key.startsWith('@') || Number.isNaN(value)) { skipped.push(label); continue; }
      if (!model) { skipped.push(label); continue; }
      // Cab "Level" (early reflections) lives on the hidden Air block.
      const target = group === 'cab' && key === 'Level' ? st.id('Air') : obj;
      const ctrl = st.id(key);
      if (ctrl === undefined || target === undefined) { skipped.push(label); continue; }
      const stored = kept.has(obj)
        ? current?.tone?.children.find((b) => b.id === obj)?.params.find((p) => p.key === st.id(key + 'State'))?.type
        : undefined;
      ops.push({ kind: 'param', obj: target, ctrl, type: group === 'cab' ? MsgType.Float : typeOf(model, key, raw, stored), value, label });
    }
  }

  for (const [key, raw] of Object.entries(tone.global ?? {})) {
    if (key === '@tempo' && Number(raw) > 0) ops.push({ kind: 'tempo', bpm: Number(raw), label: 'global.@tempo' });
    else if (key === '@speakermode' && !Number.isNaN(num(raw))) speaker = { value: num(raw), label: 'global.@speakermode' };
    else skipped.push(`global.${key}`);
  }
  // Spider V Remote writes 0 (Classic) or 1 (Full Range); amps without the
  // setting (firmware before 2.00) refuse it, which lists it as failed.
  if (speaker) {
    ops.push({ kind: 'presetKey', key: PresetKey.SpeakerMode, type: MsgType.Bool, value: speaker.value >= 0.5 ? 1 : 0, label: speaker.label });
  }
  for (const group of Object.keys(tone)) if (!GROUPS[group] && group !== 'global') skipped.push(group);

  const meta = file.data.meta ?? { name: '' };
  return {
    name: meta.name || 'Untitled',
    author: meta.author ?? '',
    label: typeof meta.label === 'string' ? meta.label : undefined,
    tnid: typeof meta.tnid === 'number' ? meta.tnid : undefined,
    ops, skipped, warnings,
  };
}

// Runs the plan against the amp. Returns the labels of operations that failed.
export async function applyImport(amp: SpiderV, plan: ImportPlan, progress?: (done: number) => void): Promise<string[]> {
  const failed: string[] = [];
  for (const [i, op] of plan.ops.entries()) {
    try {
      if (op.kind === 'model') await amp.loadModel(op.obj, op.model);
      else if (op.kind === 'param') await amp.setParam(op.obj, op.ctrl, { type: op.type, value: op.value });
      else if (op.kind === 'presetKey') await amp.setPresetKey(op.key, { type: op.type, value: op.value });
      else await amp.setTempo(op.bpm);
    } catch {
      failed.push(op.label);
    }
    progress?.(i + 1);
  }
  return failed;
}

// ------------------------------------------------------------------ writing

// Converts a preset read from the amp into a version 5 tone file.
// Matches what Spider V Remote writes to .svl6p files.
export function toToneFile(preset: Preset, st: SymbolTable, device?: number, firmware?: number): ToneFile {
  const tone: Record<string, ToneGroup> = {};
  const root = preset.tone!;
  const rootState = new Map(root.params.map((p) => [st.name(p.key), p.value]));
  const blocks = new Map<string, Block>(root.children.map((b) => [st.name(b.id) ?? '', b]));
  const fromRoot = (name: string) => rootState.get(name + 'State');

  for (const [group, def] of Object.entries(GROUPS)) {
    const b = blocks.get(def.block);
    if (!b) continue;
    const g: ToneGroup = {};
    const modelSym = st.name(b.model) ?? '';
    if (group === 'cab') {
      const { cab, mic } = splitCab(modelSym);
      g['@model'] = modelSym === 'NoCabinet' ? '@NoCabinet' : cab;
      if (mic >= 0) g['@mic'] = mic;
      const level = blocks.get('Air')?.params.find((p) => st.name(p.key) === 'LevelState');
      if (level) g.Level = level.value as number;
    } else {
      g['@model'] = modelSym;
    }
    for (const p of b.params) {
      const n = st.name(p.key);
      // Skip state without a matching control (e.g. a bare "State" entry).
      const ctrl = n?.endsWith('State') ? n.slice(0, -5) : '';
      if (!ctrl || st.id(ctrl) === undefined) continue;
      if (ctrl === SYNC_PARAM) {
        // Spider Remote's form: a sync switch and a note (1..14) kept while off.
        const v = p.value as number;
        const def = Number(catalog.models[modelSym]?.params.find((x) => x.sym === SYNC_PARAM)?.def ?? 6);
        g['@temposync'] = v > 0;
        g[ctrl] = v > 0 ? v : def;
        continue;
      }
      g[ctrl] = p.type === VType.Float ? round(p.value as number) : (p.value as number);
    }
    const extras: [string, string][] = [
      ['@enabled', `${def.prefix}Enable`], ['@post', `${def.postPrefix ?? def.prefix}Post`],
      ['@mix', `${def.prefix}Mix`], ['@mixtype', `${def.prefix}MixType`],
    ];
    if (group === 'amp') extras.push(['@volume', 'ChannelVolume']);
    for (const [key, name] of extras) {
      const v = fromRoot(name);
      if (typeof v !== 'number') continue;
      g[key] = key === '@enabled' || key === '@post' ? !!v : Number.isInteger(v) ? v : round(v);
    }
    tone[group] = g;
  }
  const global: ToneGroup = {};
  const tempo = preset.header[PresetKey.Tempo];
  if (typeof tempo === 'number' && tempo > 0) global['@tempo'] = round(tempo);
  const speaker = preset.header[PresetKey.SpeakerMode];
  if (typeof speaker === 'number') global['@speakermode'] = speaker ? 1 : 0;
  if (Object.keys(global).length) tone.global = global;

  return {
    version: 5,
    schema: 'L6Preset',
    data: {
      meta: {
        name: preset.name,
        author: '',
        application: 'Spider V Web Control',
        modifieddate: Math.floor(Date.now() / 1000),
        appversion: 1,
      },
      device,
      ...(firmware ? { device_version: firmware & 0xffff0000 } : {}),
      tone,
    },
  };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
