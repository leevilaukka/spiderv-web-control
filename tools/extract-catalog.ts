#!/usr/bin/env bun
// Builds the model catalog (model display names, parameter names and ranges,
// model lists per slot) from Line 6's "Spider Remote" Android app. The
// catalog isn't part of this project; the app can also load the APK itself.
// Written to app/src/lib/catalog.json (ignored by git), where the app's build
// picks it up, or to the given output file.
//
//   bun tools/extract-catalog.ts SpiderRemote.apk [out.json]
//   bun tools/extract-catalog.ts <unzipped assets dir> [out.json]
import { loadCatalog, saveCatalog } from 'spiderv-protocol/nodecatalog';

const [input, output] = process.argv.slice(2);
if (!input) throw new Error('usage: extract-catalog.ts <SpiderRemote.apk | apk assets dir> [out.json]');

const catalog = await loadCatalog(input);
const dest = output ?? new URL('../app/src/lib/catalog.json', import.meta.url).pathname;
await saveCatalog(catalog, dest);
console.log(`wrote ${Object.keys(catalog.models).length} models to ${dest}`);
