// Turns a parsed preset + the amp's symbol table + the model catalog into an
// editable view of the signal chain.
import { type Block, type Preset, MsgType, SymbolTable, VType } from 'spiderv-protocol/codec';

// The model catalog: display names, parameter names and ranges, and which
// models each slot takes. It comes from Line 6's Spider Remote app, so it
// isn't part of this project; the user loads it (catalog.svelte.ts). Without
// it, names are made from the amp's symbols and models can't be changed.
export type CatalogParam = { sym: string; name: string; min: number; max: number; def: number | boolean; type: number };
export type CatalogModel = { name: string; short: string; group: string; params: CatalogParam[] };
export type Catalog = {
  source?: string;
  models: Record<string, CatalogModel>;
  lists: Record<'amp' | 'fx' | 'reverb' | 'wah' | 'cab', { category: string; models: string[] }[]>;
};
export const EMPTY_CATALOG: Catalog = { models: {}, lists: { amp: [], fx: [], reverb: [], wah: [], cab: [] } };

export let catalog: Catalog = EMPTY_CATALOG;
export function setCatalog(c: Catalog | null) { catalog = c ?? EMPTY_CATALOG; }
export const hasCatalog = () => catalog !== EMPTY_CATALOG;

// Checks the shape of a catalog read from a file or another browser.
export function validCatalog(v: unknown): v is Catalog {
  const c = v as Catalog;
  return !!c && typeof c === 'object' && !!c.models && typeof c.models === 'object' && !!c.lists
    && (['amp', 'fx', 'reverb', 'wah', 'cab'] as const).every((k) => Array.isArray(c.lists[k]))
    && Object.values(c.models).every((m) => m && typeof m.name === 'string' && Array.isArray(m.params));
}

export type ModelList = keyof Catalog['lists'];

// A value the user can change. `obj`/`ctrl` address it in Get/SetDspModelParam;
// `state` is the key under which the preset dump stores it.
export type Control = {
  key: string;
  sym: string; // control symbol, stable across presets (e.g. "Drive", "ChannelVolume")
  label: string;
  obj: number;
  ctrl: number;
  state: number;
  type: MsgType;
  value: number;
  min: number;
  max: number;
  def?: number;
  unit?: 'db' | 'bpm' | '';
};

export type Slot = {
  sym: string;
  label: string;
  id: number;
  model: number;
  modelSym: string;
  modelName: string;
  shortName: string;
  group: string;
  list?: ModelList;
  enable?: Control;
  params: Control[];
  extras: Control[]; // mix, pre/post, channel volume, early reflections...
  mic?: number;
  // Tempo sync of delays and modulations (SyncSelect): 0 = off, else a note
  // value (NOTES). `synced` is the knob it replaces while on (Time, Speed or
  // Freq), and `note` the value to turn sync back on with.
  sync?: { c: Control; synced?: string; note: number };
};

// Tempo-sync note values, SyncSelect 1..14, in the order Line 6's app shows
// them for delays; for modulations it reverses them, so 1 is a whole note.
export const NOTES = [
  '1/32', '1/16 triplet', '1/16', '1/16 dotted', '1/8 triplet', '1/8', '1/8 dotted',
  '1/4 triplet', '1/4', '1/4 dotted', '1/2 triplet', '1/2', '1/2 dotted', '1/1',
];
export const SYNC_PARAM = 'SyncSelect';
const DEFAULT_NOTE = 6;

// Note values for a block, shortest first: SyncSelect value and label.
export function noteChoices(group: string): { value: number; label: string }[] {
  const values = NOTES.map((_, i) => i + 1);
  return (group === 'mod' ? values.reverse() : values).map((value) => ({ value, label: noteName(value, group) }));
}

export const noteName = (value: number, group: string) =>
  NOTES[group === 'mod' ? NOTES.length - value : value - 1] ?? String(value);

export const MIN_TEMPO = 30, MAX_TEMPO = 240;
export const clampTempo = (bpm: number) => Math.round(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, bpm)) * 10) / 10;

// The editor shows 0..1 knobs as 0 to 10.
export const displayScale = (c: { min: number; max: number }) => (c.min === 0 && c.max === 1 ? 10 : 1);

// Chain slots in display order, with the GuitarProc controls that belong to them.
// `group` colours the block when the catalog doesn't say what its model is.
const SLOTS: { sym: string; label: string; list?: ModelList; group?: string; enable?: string; extras?: [string, string][] }[] = [
  { sym: 'Gate', label: 'Gate', enable: 'GateEnable' },
  { sym: 'Wah', label: 'Wah', list: 'wah', group: 'wah', enable: 'WahEnable' },
  { sym: 'FX1', label: 'FX 1', list: 'fx', group: 'stomp', enable: 'FX1Enable', extras: [['FX1Mix', 'Mix'], ['FX1Post', 'Post amp']] },
  { sym: 'FX2', label: 'FX 2', list: 'fx', group: 'mod', enable: 'FX2Enable', extras: [['FX2Mix', 'Mix'], ['FX2Post', 'Post amp']] },
  { sym: 'FX3', label: 'FX 3', list: 'fx', group: 'delay', enable: 'FX3Enable', extras: [['FX3Mix', 'Mix'], ['FX3Post', 'Post amp']] },
  { sym: 'Amp', label: 'Amp', list: 'amp', group: 'amp', enable: 'AmpEnable', extras: [['ChannelVolume', 'Volume']] },
  { sym: 'StudioCab', label: 'Cab', list: 'cab', group: 'cab', enable: 'CabEnable' },
  { sym: 'FX4', label: 'Reverb', list: 'reverb', group: 'reverb', enable: 'FX4Enable', extras: [['FX4Mix', 'Mix'], ['FX4Post', 'Post amp']] },
  { sym: 'PostComp', label: 'Comp', enable: 'PostCompEnable' },
  { sym: 'PostEQ', label: 'EQ', enable: 'PostEQEnable' },
  { sym: 'VolumePedal', label: 'Volume', enable: 'VolumePedalEnable', extras: [['VolumePost', 'Post amp']] },
];

export const MICS = [
  { suffix: '57OnAxis', label: 'SM57 on axis' },
  { suffix: '57OffAxis', label: 'SM57 off axis' },
  { suffix: '421', label: 'MD421 dynamic' },
  { suffix: 'U67', label: 'U67 condenser' },
];

export function splitCab(sym: string): { cab: string; mic: number } {
  for (const [i, m] of MICS.entries()) if (sym.endsWith(m.suffix)) return { cab: sym.slice(0, -m.suffix.length), mic: i };
  return { cab: sym, mic: -1 };
}

const msgType = (t: VType) => (t === VType.Float ? MsgType.Float : t === VType.Bool ? MsgType.Bool : MsgType.Int);

// "LowShelfFreqState" -> "Low Shelf Freq", "4x12Green25sStudio" -> "4x12 Green 25s Studio",
// "Line6Vetta" -> "Line 6 Vetta". Names without the model catalog are made this way.
export const humanize = (s: string) => s.replace(/State$/, '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z]{2})(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ');

export function shortModelName(sym: string): string {
  const m = catalog.models[sym] ?? catalog.models[splitCab(sym).cab];
  return (m?.short ?? modelName(sym)).replace(/ Studio$/, '');
}

export function modelName(sym: string): string {
  const m = catalog.models[sym];
  if (m) return m.name;
  const { cab, mic } = splitCab(sym);
  if (mic >= 0) return catalog.models[cab]?.name ?? humanize(cab);
  return humanize(sym);
}

export function buildChain(preset: Preset, st: SymbolTable): Slot[] {
  const tone = preset.tone;
  if (!tone) return [];
  const blocks = new Map<string, Block>(tone.children.map((b) => [st.name(b.id) ?? '', b]));
  const rootValues = new Map(tone.params.map((p) => [p.key, p]));

  const rootControl = (ctrlName: string, label: string, key: string): Control | undefined => {
    const ctrl = st.id(ctrlName), state = st.id(ctrlName + 'State');
    const e = state !== undefined ? rootValues.get(state) : undefined;
    if (ctrl === undefined || state === undefined || !e) return undefined;
    const type = msgType(e.type);
    return {
      key, sym: ctrlName, label, obj: tone.id, ctrl, state, type, value: e.value as number,
      min: 0, max: 1, unit: '',
    };
  };

  const slots: Slot[] = [];
  for (const def of SLOTS) {
    const blk = blocks.get(def.sym);
    if (!blk) continue;
    const modelSym = st.name(blk.model) ?? '';
    const cat = catalog.models[def.sym === 'StudioCab' ? splitCab(modelSym).cab : modelSym];
    const values = new Map(blk.params.map((p) => [p.key, p]));
    const used = new Set<number>();
    const params: Control[] = [];

    // Catalog order and names first, then anything else the dump contains.
    for (const cp of cat?.params ?? []) {
      if (cp.sym.startsWith('@')) continue;
      const ctrl = st.id(cp.sym), state = st.id(cp.sym + 'State');
      const e = state !== undefined ? values.get(state) : undefined;
      if (ctrl === undefined || state === undefined || !e) continue;
      used.add(state);
      params.push({
        key: `${blk.id}:${ctrl}`, sym: cp.sym, label: cp.name, obj: blk.id, ctrl, state, type: msgType(e.type),
        value: e.value as number, min: Number(cp.min), max: Number(cp.max), def: Number(cp.def),
        unit: cp.min === -96 ? 'db' : '',
      });
    }
    for (const e of blk.params) {
      const ctrl = st.controlOf(e.key);
      if (used.has(e.key) || ctrl === undefined) continue;
      const float = e.type === VType.Float;
      params.push({
        key: `${blk.id}:${ctrl}`, sym: st.name(ctrl) ?? '', label: humanize(st.name(e.key) ?? ''), obj: blk.id, ctrl, state: e.key,
        type: msgType(e.type), value: e.value as number,
        min: float ? Math.min(0, e.value as number) : 0, max: float ? Math.max(1, e.value as number) : e.type === VType.Bool ? 1 : 16,
      });
    }

    const extras: Control[] = [];
    for (const [name, label] of def.extras ?? []) {
      const c = rootControl(name, label, `${tone.id}:${name}`);
      if (c) extras.push(c);
    }
    let mic: number | undefined;
    if (def.sym === 'StudioCab') {
      mic = splitCab(modelSym).mic;
      const air = blocks.get('Air');
      const level = st.id('Level'), levelState = st.id('LevelState');
      const e = air?.params.find((p) => p.key === levelState);
      if (air && level !== undefined && e) {
        extras.push({ key: `${air.id}:${level}`, sym: 'Level', label: 'Early reflections', obj: air.id, ctrl: level, state: e.key, type: MsgType.Float, value: e.value as number, min: 0, max: 1 });
      }
    }

    // The note picker replaces the bare SyncSelect number.
    let sync: Slot['sync'];
    const si = params.findIndex((c) => c.sym === SYNC_PARAM && c.type === MsgType.Int);
    if (si >= 0) {
      const [c] = params.splice(si, 1);
      const first = params[0]?.sym;
      const note = c.value >= 1 && c.value <= NOTES.length ? c.value : c.def && c.def >= 1 ? c.def : DEFAULT_NOTE;
      sync = { c, synced: first && /^(Time|Speed|Freq)$/.test(first) ? first : undefined, note };
    }

    slots.push({
      sym: def.sym, label: def.label, id: blk.id, model: blk.model, modelSym,
      modelName: modelName(modelSym), shortName: shortModelName(modelSym), group: cat?.group ?? def.group ?? 'fixed', list: def.list,
      enable: def.enable ? rootControl(def.enable, 'On', `${tone.id}:${def.enable}`) : undefined,
      params, extras, mic, sync,
    });
  }
  return slots;
}

// Model choices for a slot, restricted to models this firmware knows. Empty
// without a catalog.
export function modelChoices(list: ModelList, st: SymbolTable): { category: string; models: { sym: string; id: number; name: string }[] }[] {
  return catalog.lists[list].map(({ category, models }) => ({
    category,
    models: models
      .map((sym) => {
        const id = list === 'cab' ? (sym === '@NoCabinet' ? st.id('NoCabinet') : st.id(sym + MICS[0].suffix)) : st.id(sym);
        return { sym, id: id ?? -1, name: list === 'cab' && sym === '@NoCabinet' ? 'No cabinet' : (catalog.models[sym]?.name ?? humanize(sym)) };
      })
      .filter((m) => m.id >= 0),
  }));
}
