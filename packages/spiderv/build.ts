// Builds the publishable package into dist/: bundled JS, type declarations and a
// package.json whose exports point at them. Publish with `npm publish ./dist`.
import { cp, rm, writeFile } from 'node:fs/promises';

const dir = new URL('./', import.meta.url).pathname;
const dist = dir + 'dist';
const entries = ['index', 'codec', 'client', 'hub', 'webmidi', 'nodemidi', 'framing', 'catalog', 'nodecatalog'];

await rm(dist, { recursive: true, force: true });

const js = await Bun.build({
  entrypoints: entries.map((e) => `${dir}src/${e}.ts`),
  outdir: dist,
  root: dir + 'src',
  target: 'node',
  external: ['@julusian/midi'],
  format: 'esm',
  splitting: true,
});
if (!js.success) { console.error(js.logs.join('\n')); process.exit(1); }

const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', dir + 'tsconfig.json'], { cwd: dir, stdout: 'inherit', stderr: 'inherit' });
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

const { exports: _src, files: _files, scripts: _scripts, devDependencies: _dev, ...pkg } = await Bun.file(dir + 'package.json').json();
const exports: Record<string, { types: string; import: string }> = {};
for (const e of entries) exports[e === 'index' ? '.' : `./${e}`] = { types: `./${e}.d.ts`, import: `./${e}.js` };
await writeFile(dist + '/package.json', JSON.stringify({ ...pkg, main: './index.js', types: './index.d.ts', sideEffects: false, exports }, null, 2) + '\n');
await cp(dir + 'LICENSE', dist + '/LICENSE');
await cp(dir + 'README.md', dist + '/README.md');
console.log('built', dist);
