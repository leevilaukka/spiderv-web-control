// The model catalog: display names, parameter names and ranges, and which
// models each slot takes. It comes from Line 6's Spider Remote Android app and
// is not part of this package; build it from the user's own copy of the app
// (model and parameter definitions in *.models, model lists per slot in
// *Catalog.json). Works in browsers, Node and Bun.

export type CatalogParam = { sym: string; name: string; min: number; max: number; def: number | boolean; type: number };
export type CatalogModel = { name: string; short: string; group: string; params: CatalogParam[] };
export type Catalog = {
  source?: string;
  models: Record<string, CatalogModel>;
  lists: Record<'amp' | 'fx' | 'reverb' | 'wah' | 'cab', { category: string; models: string[] }[]>;
};
export const EMPTY_CATALOG: Catalog = { models: {}, lists: { amp: [], fx: [], reverb: [], wah: [], cab: [] } };

// Checks the shape of a catalog read from a file or another program.
export function validCatalog(v: unknown): v is Catalog {
  const c = v as Catalog;
  return !!c && typeof c === 'object' && !!c.models && typeof c.models === 'object' && !!c.lists
    && (['amp', 'fx', 'reverb', 'wah', 'cab'] as const).every((k) => Array.isArray(c.lists[k]))
    && Object.values(c.models).every((m) => m && typeof m.name === 'string' && Array.isArray(m.params));
}

// Lookups by symbol name (the names the amp's symbol table uses).
export const modelName = (c: Catalog, sym: string) => c.models[sym]?.name;
export const modelParams = (c: Catalog, sym: string): CatalogParam[] => c.models[sym]?.params ?? [];
export const paramInfo = (c: Catalog, modelSym: string, paramSym: string) =>
  c.models[modelSym]?.params.find((p) => p.sym === paramSym);

type RawParam = { symbolicID: string; name?: string; min: unknown; max: unknown; default: unknown; valueType: number };
type RawModel = { symbolicID: string; name?: string; shortname?: string; params: RawParam[] };

const MODEL_FILES = [
  ['amps.models', 'amp'], ['stomps.models', 'stomp'], ['mod.models', 'mod'], ['delay.models', 'delay'],
  ['reverbs.models', 'reverb'], ['wahs.models', 'wah'], ['cabs.models', 'cab'], ['fixed.models', 'fixed'],
] as const;
const LIST_FILES = {
  amp: 'AmpCatalog.json', fx: 'FXCatalog.json', reverb: 'ReverbCatalog.json', wah: 'WahCatalog.json', cab: 'CabCatalog.json',
} as const;

// The asset files the catalog is made from.
export const CATALOG_FILES: string[] = [...MODEL_FILES.map(([f]) => f), ...Object.values(LIST_FILES)];

// `read` returns the parsed JSON of an asset file by name.
export function buildCatalog(read: (file: string) => unknown, source: string): Catalog {
  const models: Record<string, CatalogModel> = {};
  for (const [file, group] of MODEL_FILES) {
    for (const m of read(file) as RawModel[]) {
      models[m.symbolicID] = {
        name: m.name ?? m.symbolicID,
        short: m.shortname ?? m.name ?? m.symbolicID,
        group,
        params: m.params.filter((p) => p.name).map((p) => ({
          sym: p.symbolicID, name: p.name!, min: p.min as number, max: p.max as number, def: p.default as number | boolean,
          // 0 = int, 1 = float, 2 = bool, 3 = string
          type: p.valueType,
        })),
      };
    }
  }
  const lists = Object.fromEntries(Object.entries(LIST_FILES).map(([list, file]) => [
    list,
    Object.entries(read(file) as Record<string, string[]>).map(([category, syms]) => ({ category, models: syms })),
  ])) as Catalog['lists'];
  return { source, models, lists };
}

// Reads the catalog from an APK. Also accepts app bundles that wrap the APK
// (.xapk, .apks), and plain zips of the assets.
export async function catalogFromApk(bytes: Uint8Array): Promise<Catalog> {
  const zip = readZip(bytes);
  const asset = (file: string) => [...zip.keys()].find((n) => n === `assets/${file}` || n.endsWith(`/${file}`) || n === file);
  if (CATALOG_FILES.every(asset)) {
    const files = new Map<string, unknown>();
    for (const file of CATALOG_FILES) {
      const text = new TextDecoder().decode(await zip.get(asset(file)!)!());
      try { files.set(file, JSON.parse(text)); } catch { throw new Error(`${file} in the APK isn't valid JSON.`); }
    }
    return buildCatalog((f) => files.get(f), 'Line 6 Spider Remote for Android (loaded from your copy of the app)');
  }
  // A bundle: look inside the APKs it holds, the base one first.
  const inner = [...zip.keys()].filter((n) => n.endsWith('.apk')).sort((a, b) => Number(/base/.test(b)) - Number(/base/.test(a)));
  for (const name of inner) {
    try { return await catalogFromApk(await zip.get(name)!()); } catch {}
  }
  throw new Error("This file doesn't contain the Spider Remote model files. Pick the Spider Remote app's APK.");
}

// Minimal zip reader: the central directory, stored and deflated entries.
function readZip(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This isn't an APK or zip file.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    entries.set(name, async () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`Unsupported compression in ${name}.`);
      const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(out).arrayBuffer());
    });
  }
  return entries;
}
