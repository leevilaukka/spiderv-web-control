// Builds standalone executables of the production server (app/server.ts) with
// the built app (app/dist) embedded, so it runs without Bun or Docker.
//
//   bun tools/build-exe.ts [target...]    e.g. bun-linux-x64 bun-windows-x64
//
// With no targets it builds for this machine. Run `bun run build` first.
// Executables land in dist-exe/.
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dist = join(root, 'app/dist');
const work = join(root, '.cache/exe');
const out = join(root, 'dist-exe');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let files: string[];
try {
  files = walk(dist);
} catch {
  console.error(`No built app in ${dist}. Run \`bun run build\` first.`);
  process.exit(1);
}

// The entry imports every file of dist/ as an embedded file, tells the
// server where each one is, and then starts the server.
mkdirSync(work, { recursive: true });
const entry = join(work, 'entry.ts');
const rel = (path: string) => JSON.stringify(relative(work, path).replaceAll('\\', '/'));
writeFileSync(entry, [
  ...files.map((f, i) => `import f${i} from ${rel(f)} with { type: 'file' };`),
  `(globalThis as any).spidervEmbeddedApp = {`,
  ...files.map((f, i) => `  ${JSON.stringify('/' + relative(dist, f).replaceAll('\\', '/'))}: f${i},`),
  `};`,
  `await import(${rel(join(root, 'app/server.ts'))});`,
  '',
].join('\n'));

const targets = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const target of targets.length ? targets : [undefined]) {
  const name = `spiderv-web-control${target ? '-' + target.replace(/^bun-/, '') : ''}`;
  const args = ['build', '--compile', '--minify', entry, '--outfile', join(out, name)];
  if (target) args.push(`--target=${target}`);
  console.log(`Building ${name}`);
  const proc = Bun.spawnSync(['bun', ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
}
