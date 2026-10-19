#!/usr/bin/env bun
// Command-line access to a Spider V through an ALSA raw MIDI device.
//
//   bun tools/spiderv-cli.ts [--dev /dev/snd/midiC8D0] [-v] <command>
//
// Commands:
//   info                          handshake, print identity and version
//   names                         list preset names
//   dump [index] [--json]         print a preset (default: edit buffer)
//   load <index>                  load preset <index> (0-based)
//   get <obj> <param>             read a parameter (ids or symbol names)
//   set <obj> <param> <value> [int|bool]   set a parameter
//   model <slot> <model>          load a model into a slot
//   symbols                       print the firmware's symbol table
//   listen                        print everything the amp sends
//   import <tone file>           apply a .svl6p/.json tone to the edit buffer
//   backup <file.json>           save every preset slot (raw) to a file
//   restore <file.json> <slot>   write one slot back from a backup file
//   save <slot> [name]           save the edit buffer to a slot (overwrites it!)
//   record <file.json>            save symbol table, names and current preset
//   raw <ch> <cmd> [u32 words...] send a raw command, print the reply
import fs from 'node:fs';
import { SpiderV, type Transport } from 'spiderv-protocol/client';
import { type Block, type Bytes, Channel, MsgType, SymbolTable, VType, i32, le32, toHex, typed, LibrarianCmd, blockId, modelId, paramId } from 'spiderv-protocol/codec';
import { applyImport, planImport, readToneFile } from '../app/src/lib/presetfile';

class RawMidiTransport implements Transport {
  label: string;
  onsysex: (b: Bytes) => void = () => {};
  ondisconnect: (e?: unknown) => void = () => {};
  private fd: number;
  private timer: ReturnType<typeof setInterval>;
  private buf: Bytes = [];

  // Non-blocking polling: blocking reads on a rawmidi node tie up a thread
  // and keep the process alive.
  constructor(path: string) {
    this.label = `rawmidi ${path}`;
    try {
      this.fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EBUSY') {
        throw new Error(`${path} is in use by another program. If the web app was open, close its tab (Chromium keeps the MIDI port until then).`);
      }
      throw e;
    }
    const chunk = Buffer.alloc(4096);
    // ALSA only starts the input substream on the first read; the amp replies
    // within milliseconds, so anything arriving before that would be lost.
    this.read(chunk);
    this.timer = setInterval(() => { while (this.read(chunk) > 0); }, 2);
  }

  private read(chunk: Buffer): number {
    let n = 0;
    try { n = fs.readSync(this.fd, chunk, 0, chunk.length, null); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') { clearInterval(this.timer); this.ondisconnect(e); }
      return 0;
    }
    for (const b of chunk.subarray(0, n)) {
      if (b === 0xf0) this.buf = [];
      if (b & 0x80 && b !== 0xf0 && b !== 0xf7 && b < 0xf8) { this.buf = []; continue; }
      this.buf.push(b);
      if (b === 0xf7 && this.buf[0] === 0xf0) { this.onsysex(this.buf); this.buf = []; }
    }
    return n;
  }

  send(bytes: Bytes) {
    const b = Buffer.from(bytes);
    for (let off = 0; off < b.length;) {
      try { off += fs.writeSync(this.fd, b, off); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e; }
    }
  }

  async close() { clearInterval(this.timer); fs.closeSync(this.fd); }
}

function findDevice(): string {
  const cards = fs.readFileSync('/proc/asound/cards', 'utf8');
  const m = cards.match(/^\s*(\d+)\s+\[[^\]]*\]:.*\n.*Spider V/m);
  if (!m) throw new Error('No Spider V in /proc/asound/cards; pass --dev /dev/snd/midiCxD0');
  return `/dev/snd/midiC${m[1]}D0`;
}

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args.splice(i, 1)[0] : undefined; };
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const dev = opt('--dev') ?? findDevice();
const verbose = !!flag('-v');
const json = !!flag('--json');
const [cmd = 'info', ...rest] = args;

const cacheFile = new URL('../.cache/symboltable.bin', import.meta.url);
let cached: Bytes | null = null;
try { cached = [...fs.readFileSync(cacheFile)]; } catch {}

let transport: RawMidiTransport;
try {
  transport = new RawMidiTransport(dev);
} catch (e) {
  console.error('error:', (e as Error).message);
  process.exit(1);
}
const amp = new SpiderV(transport, cached);
amp.on('log', (e) => {
  if (verbose || cmd === 'listen' || cmd === 'raw') console.error(`${e.dir === 'out' ? '->' : '<-'} ${e.text}${verbose && e.raw ? '\n   ' + toHex(e.raw) : ''}`);
});

const hex = (v: number) => '0x' + v.toString(16);
const num = (s: string): number => {
  if (/^(0x[0-9a-f]+|\d+)$/i.test(s)) return Number(s);
  const v = amp.symbols?.id(s);
  if (v === undefined) throw new Error(`unknown symbol ${s}`);
  return v;
};
// The CLI takes raw ids and symbol names; the typed ids are asserted here.
const id = num;
const block = (s: string) => blockId(num(s));
const model = (s: string) => modelId(num(s));
const param = (s: string) => paramId(num(s));

try {
  await amp.connect();
  if (amp.symbols) {
    fs.mkdirSync(new URL('.', cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, Buffer.from(amp.symbols.bytes));
  }
  console.log(`connected via ${amp.transport.label}: ${JSON.stringify(amp.info)} version ${hex(amp.version)}, ${amp.presetCount} presets`);

  switch (cmd) {
    case 'info': console.log(`current preset: ${await amp.currentPresetIndex()}, dirty: ${await amp.isDirty()}`); break;
    case 'names':
      for (let i = 0; i < amp.presetCount; i++) console.log(String(i).padStart(3), await amp.presetName(i));
      break;
    case 'dump': {
      const p = await amp.readPreset(rest[0] ? Number(rest[0]) : -1);
      if (json) console.log(JSON.stringify(p, null, 1));
      else printPreset(p.name, p.header, p.tone, amp.symbols!);
      break;
    }
    case 'load': {
      await amp.loadPreset(Number(rest[0]));
      const p = await amp.readPreset();
      printPreset(p.name, p.header, p.tone, amp.symbols!);
      break;
    }
    case 'get': console.log(await amp.getParam(block(rest[0]), param(rest[1]))); break;
    case 'set': {
      const type = rest[3] === 'int' ? MsgType.Int : rest[3] === 'bool' ? MsgType.Bool : MsgType.Float;
      await amp.setParam(block(rest[0]), param(rest[1]), typed(type, Number(rest[2])));
      console.log('ok', await amp.getParam(block(rest[0]), param(rest[1])));
      break;
    }
    case 'model': await amp.loadModel(block(rest[0]), model(rest[1])); console.log('ok'); break;
    case 'symbols': amp.symbols!.names.forEach((n, i) => console.log(hex(i).padEnd(6), n)); break;
    case 'listen':
      console.log('listening, Ctrl-C to quit');
      await new Promise(() => {});
      break;
    case 'import': {
      const before = await amp.readPreset();
      const plan = planImport(readToneFile([...fs.readFileSync(rest[0])], amp.symbols!), amp.symbols!, before);
      console.log(`importing "${plan.name}": ${plan.ops.length} ops, skipped: ${plan.skipped.join(', ') || 'none'}`);
      const t0 = Date.now();
      const failed = await applyImport(amp, plan);
      console.log(`applied in ${Date.now() - t0} ms, failed: ${failed.join(', ') || 'none'}`);
      const p = await amp.readPreset();
      printPreset(p.name, p.header, p.tone, amp.symbols!);
      break;
    }
    case 'backup': {
      const presets = [];
      for (let i = 0; i < amp.presetCount; i++) {
        const r = await amp.request(Channel.Librarian, LibrarianCmd.GetPresetFile, le32(i), { timeout: 10000 });
        if (i32(r.body, 0) < 0) throw new Error(`reading preset ${i} failed (status ${i32(r.body, 0)})`);
        presets.push({ index: i, name: await amp.presetName(i), data: Buffer.from(r.body.slice(4)).toString('base64') });
      }
      fs.writeFileSync(rest[0], JSON.stringify({ info: amp.info, date: new Date().toISOString(), presets }, null, 1));
      console.log(`backed up ${presets.length} presets to ${rest[0]}`);
      break;
    }
    case 'restore': {
      const backup = JSON.parse(fs.readFileSync(rest[0], 'utf8'));
      const slot = Number(rest[1]);
      const entry = backup.presets.find((p: { index: number }) => p.index === slot);
      if (!entry) throw new Error(`slot ${slot} not in backup`);
      const data = [...Buffer.from(entry.data, 'base64')];
      const before = await amp.readPresetData(slot);
      await amp.writePresetData(slot, data);
      const after = await amp.readPresetData(slot);
      const same = after.length === data.length && after.every((b, i) => b === data[i]);
      console.log(`slot ${slot}: wrote ${data.length} bytes (was ${before.length}), read back ${same ? 'identical' : 'DIFFERENT'}; name now "${await amp.presetName(slot)}"`);
      break;
    }
    case 'save': {
      const slot = Number(rest[0]);
      const previous = await amp.savePreset(slot, rest[1]);
      fs.mkdirSync(new URL('../backups/', import.meta.url), { recursive: true });
      const undo = new URL(`../backups/slot${slot}-before-save-${Date.now()}.bin`, import.meta.url);
      fs.writeFileSync(undo, Buffer.from(previous));
      console.log(`saved to slot ${slot} as "${await amp.presetName(slot)}"; previous contents in ${undo.pathname}`);
      break;
    }
    case 'record': {
      const names: string[] = [];
      for (let i = 0; i < amp.presetCount; i++) names.push(await amp.presetName(i));
      const current = await amp.currentPresetIndex();
      const r = await amp.request(Channel.Librarian, LibrarianCmd.GetPresetFile, le32(-1));
      fs.writeFileSync(rest[0], JSON.stringify({
        identity: amp.identity, info: amp.info, version: amp.version, current, names,
        symbolTable: Buffer.from(amp.symbols!.bytes).toString('base64'),
        editBuffer: Buffer.from(r.body).toString('base64'),
      }, null, 1));
      console.log(`wrote ${rest[0]}`);
      break;
    }
    case 'raw': {
      const r = await amp.requestRaw(Number(rest[0]), Number(rest[1]), rest.slice(2).flatMap((w) => le32(Number(w))));
      console.log(`reply kind ${r.kind}, ${r.body.length} bytes\n${toHex(r.body)}`);
      break;
    }
    default: throw new Error(`unknown command ${cmd}`);
  }
} catch (e) {
  console.error('error:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await amp.close();
}

function printPreset(name: string, header: object, tone: Block | null, st: SymbolTable) {
  const nm = (i: number) => `${st.name(i) ?? '?'}(${hex(i)})`;
  console.log(`preset "${name}" header ${JSON.stringify(header)}`);
  const walk = (b: Block, d: number) => {
    console.log(`${'  '.repeat(d)}${nm(b.id)} model ${nm(b.model)}`);
    for (const p of b.params) {
      const v = p.type === VType.Float ? (p.value as number).toFixed(4) : p.value;
      console.log(`${'  '.repeat(d + 1)}${nm(p.key)} ${VType[p.type]} ${v}`);
    }
    b.children.forEach((c) => walk(c, d + 1));
  };
  if (tone) walk(tone, 0);
}
