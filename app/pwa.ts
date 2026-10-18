// Offline app: after a build, writes dist/sw.js, the service worker in
// service-worker.js with the list of every built file and a version made from
// their contents. Installed on a phone, the app then starts with no network
// and no computer. The page registers it in src/lib/pwa.svelte.ts.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

const SW = 'sw.js';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'spiderv-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    writeBundle() {
      const files = walk(outDir).map((f) => relative(outDir, f).replaceAll('\\', '/')).filter((f) => f !== SW).sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const source = readFileSync(new URL('service-worker.js', import.meta.url), 'utf8');
      writeFileSync(join(outDir, SW), [
        `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 12))};`,
        `const FILES = ${JSON.stringify(files)};`,
        source,
      ].join('\n'));
    },
  };
}
