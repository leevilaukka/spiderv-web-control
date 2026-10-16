// Production server: serves the built app (dist/) and the remote-control
// relay. The amp itself is reached by the browser over Web MIDI, so this
// server never needs USB access; it is what the container runs.
//
//   PORT       port to listen on (default 8080)
//   HOST       address to bind (default 0.0.0.0, reachable from phones)
//   DIST       the built app (default: dist next to this file)
//   CERT_DIR   folder with cert.pem and key.pem: serve HTTPS, which phones
//              need for Web MIDI and for keeping the screen on
//   PUBLIC_ADDRESSES  addresses to show phones (see relay.ts)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { RELAY_PATH, createRelay } from './relay.ts';

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const dist = resolve(process.env.DIST || join(import.meta.dirname, 'dist'));
const certDir = process.env.CERT_DIR;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No built app in ${dist}. Run \`bun run build\` first, or set DIST.`);
  process.exit(1);
}

const relay = createRelay();

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === RELAY_PATH + '/info') return relay.info(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let file: string;
  try {
    file = normalize(join(dist, decodeURIComponent(url.pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.writeHead(403).end();
    return;
  }
  let stat = existsSync(file) ? statSync(file) : null;
  if (stat?.isDirectory()) {
    file = join(file, 'index.html');
    stat = existsSync(file) ? statSync(file) : null;
  }
  if (!stat?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': stat.size,
    'x-content-type-options': 'nosniff',
    // Built assets have content hashes in their names; the rest may change.
    'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

let https = false;
let server;
if (certDir) {
  const cert = join(certDir, 'cert.pem'), key = join(certDir, 'key.pem');
  if (!existsSync(cert) || !existsSync(key)) {
    console.error(`CERT_DIR is set, but ${cert} or ${key} is missing.`);
    process.exit(1);
  }
  server = createHttps({ cert: readFileSync(cert), key: readFileSync(key) }, handle);
  https = true;
} else {
  server = createHttp(handle);
}
relay.attach(server);
server.listen(port, host, () => {
  const proto = https ? 'https' : 'http';
  console.log(`Spider V Web Control on ${proto}://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ (serving ${dist})`);
  if (!https) console.log('Phones get the screen-on feature fully only over HTTPS: set CERT_DIR to serve it.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
