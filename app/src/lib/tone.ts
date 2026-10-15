// Turns a parsed preset + the amp's symbol table + the model catalog into an
// editable view of the signal chain.
import { type Block, type Preset, MsgType, SymbolTable, VType } from './protocol/codec';
import catalogJson from './catalog.json';

export type CatalogParam = { sym: string; name: string; min: number; max: number; def: number | boolean; type: number };
export type CatalogModel = { name: string; short: string; group: string; params: CatalogParam[] };
type Catalog = {
  models: Record<string, CatalogModel>;
  lists: Record<'amp' | 'fx' | 'reverb' | 'wah' | 'cab', { category: string; models: string[] }[]>;
};
export const catalog = catalogJson as unknown as Catalog;

export type ModelList = keyof Catalog['lists'];

// A value the user can change. `obj`/`ctrl` address it in Get/SetDspModelParam;
// `state` is the key under which the preset dump stores it.
export type Control = {
  key: string;
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
};

// Chain slots in display order, with the GuitarProc controls that belong to them.
const SLOTS: { sym: string; label: string; list?: ModelList; enable?: string; extras?: [string, string][] }[] = [
  { sym: 'Gate', label: 'Gate', enable: 'GateEnable' },
  { sym: 'Wah', label: 'Wah', list: 'wah', enable: 'WahEnable' },
  { sym: 'FX1', label: 'FX 1', list: 'fx', enable: 'FX1Enable', extras: [['FX1Mix', 'Mix'], ['FX1Post', 'Post amp']] },
  { sym: 'FX2', label: 'FX 2', list: 'fx', enable: 'FX2Enable', extras: [['FX2Mix', 'Mix'], ['FX2Post', 'Post amp']] },
  { sym: 'FX3', label: 'FX 3', list: 'fx', enable: 'FX3Enable', extras: [['FX3Mix', 'Mix'], ['FX3Post', 'Post amp']] },
  { sym: 'Amp', label: 'Amp', list: 'amp', enable: 'AmpEnable', extras: [['ChannelVolume', 'Volume']] },
  { sym: 'StudioCab', label: 'Cab', list: 'cab', enable: 'CabEnable' },
  { sym: 'FX4', label: 'Reverb', list: 'reverb', enable: 'FX4Enable', extras: [['FX4Mix', 'Mix'], ['FX4Post', 'Post amp']] },
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

// "LowShelfFreqState" -> "Low Shelf Freq"
export const humanize = (s: string) => s.replace(/State$/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/_/g, ' ');

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
      key, label, obj: tone.id, ctrl, state, type, value: e.value as number,
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
        key: `${blk.id}:${ctrl}`, label: cp.name, obj: blk.id, ctrl, state, type: msgType(e.type),
        value: e.value as number, min: Number(cp.min), max: Number(cp.max), def: Number(cp.def),
        unit: cp.min === -96 ? 'db' : '',
      });
    }
    for (const e of blk.params) {
      const ctrl = st.controlOf(e.key);
      if (used.has(e.key) || ctrl === undefined) continue;
      const float = e.type === VType.Float;
      params.push({
        key: `${blk.id}:${ctrl}`, label: humanize(st.name(e.key) ?? ''), obj: blk.id, ctrl, state: e.key,
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
        extras.push({ key: `${air.id}:${level}`, label: 'Early reflections', obj: air.id, ctrl: level, state: e.key, type: MsgType.Float, value: e.value as number, min: 0, max: 1 });
      }
    }

    slots.push({
      sym: def.sym, label: def.label, id: blk.id, model: blk.model, modelSym,
      modelName: modelName(modelSym), shortName: shortModelName(modelSym), group: cat?.group ?? 'fixed', list: def.list,
      enable: def.enable ? rootControl(def.enable, 'On', `${tone.id}:${def.enable}`) : undefined,
      params, extras, mic,
    });
  }
  return slots;
}

// Model choices for a slot, restricted to models this firmware knows.
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
