// Loads the model catalog from disk, for Node and Bun.
import { type Catalog, buildCatalog, catalogFromApk, validCatalog } from './catalog';

// `path` is one of:
//  - a catalog .json file (made earlier by this function's `save`, or by tools/extract-catalog.ts)
//  - Spider Remote's APK (or .xapk/.apks bundle), or a zip of its assets
//  - a folder with the unzipped asset files
export async function loadCatalog(path: string): Promise<Catalog> {
  const fs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  if ((await fs.stat(path)).isDirectory()) {
    const files = new Map<string, unknown>();
    const read = (f: string) => {
      if (!files.has(f)) throw new Error(`${f} is missing from ${path}.`);
      return files.get(f);
    };
    for (const f of await fs.readdir(path)) {
      if (/\.(models|json)$/.test(f)) files.set(f, JSON.parse(await fs.readFile(nodePath.join(path, f), 'utf8')));
    }
    return buildCatalog(read, 'Line 6 Spider Remote for Android');
  }
  const bytes = new Uint8Array(await fs.readFile(path));
  if (/\.json$/i.test(path)) {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (!validCatalog(v)) throw new Error(`${path} isn't a model catalog.`);
    return v;
  }
  return catalogFromApk(bytes);
}

// Writes a catalog as JSON, so the APK is only needed once.
export async function saveCatalog(catalog: Catalog, path: string) {
  await (await import('node:fs/promises')).writeFile(path, JSON.stringify(catalog));
}
