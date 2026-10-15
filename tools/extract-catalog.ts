#!/usr/bin/env bun
// Builds app/src/lib/catalog.json (model display names, parameter names and
// ranges, model lists per slot) from the assets of Line 6's "Spider Remote"
// Android app.
//
//   unzip -o SpiderRemote.apk 'assets/*' -d /tmp/spider-apk
//   bun tools/extract-catalog.ts /tmp/spider-apk/assets
import fs from 'node:fs';
import path from 'node:path';

type RawParam = { symbolicID: string; name?: string; min: unknown; max: unknown; default: unknown; valueType: number };
type RawModel = { symbolicID: string; name?: string; shortname?: string; params: RawParam[] };

const dir = process.argv[2];
if (!dir) throw new Error('usage: extract-catalog.ts <apk assets dir>');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const models: Record<string, unknown> = {};
for (const [file, group] of [
  ['amps.models', 'amp'], ['stomps.models', 'stomp'], ['mod.models', 'mod'], ['delay.models', 'delay'],
  ['reverbs.models', 'reverb'], ['wahs.models', 'wah'], ['cabs.models', 'cab'], ['fixed.models', 'fixed'],
] as const) {
  for (const m of read(file) as RawModel[]) {
    models[m.symbolicID] = {
      name: m.name ?? m.symbolicID,
      short: m.shortname ?? m.name ?? m.symbolicID,
      group,
      params: m.params.filter((p) => p.name).map((p) => ({
        sym: p.symbolicID, name: p.name, min: p.min, max: p.max, def: p.default,
        // 0 = int, 1 = float, 2 = bool, 3 = string
        type: p.valueType,
      })),
    };
  }
}

const lists = (file: string) => Object.entries(read(file) as Record<string, string[]>).map(([category, syms]) => ({ category, models: syms }));

const out = {
  source: 'Line 6 Spider Remote for Android (assets/*.models, *Catalog.json)',
  models,
  lists: {
    amp: lists('AmpCatalog.json'),
    fx: lists('FXCatalog.json'),
    reverb: lists('ReverbCatalog.json'),
    wah: lists('WahCatalog.json'),
    cab: lists('CabCatalog.json'),
  },
};
const dest = new URL('../app/src/lib/catalog.json', import.meta.url);
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${Object.keys(models).length} models to ${dest.pathname}`);
