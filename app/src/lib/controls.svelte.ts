// App-wide performance controls: the channel switch, tap tempo, banks for
// the play view, and MIDI pedals (foot controllers and expression pedals on
// any MIDI input other than the amp).
import { amp } from './amp.svelte';
import { pedalMessage } from './midi';
import { shortcuts } from './shortcuts.svelte';
import { ui } from './ui.svelte';

const STORAGE_KEY = 'spiderv.controls';
const AMP_PORT = /spider ?v/i;
export const BANK_SIZE = 4;
// A preset's place as the amp shows it: bank number and letter, like 3B.
export const slotName = (i: number) => `${Math.floor(i / BANK_SIZE) + 1}${'ABCD'[i % BANK_SIZE]}`;

type Settings = {
  channelKey: string; // KeyboardEvent.code, '' for none
  channelCc: number | null;
  tapKey: string;
  tapCc: number | null;
  midi: boolean; // listen to MIDI pedals
  programChange: boolean; // program change messages select presets
};

function parse(v: Partial<Settings> | null): Settings {
  const s: Settings = { channelKey: '', channelCc: null, tapKey: '', tapCc: null, midi: false, programChange: true };
  if (!v || typeof v !== 'object') return s;
  const cc = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 128 ? n : null);
  if (typeof v.channelKey === 'string') s.channelKey = v.channelKey;
  s.channelCc = cc(v.channelCc);
  if (typeof v.tapKey === 'string') s.tapKey = v.tapKey;
  s.tapCc = cc(v.tapCc);
  s.midi = !!v.midi;
  if (typeof v.programChange === 'boolean') s.programChange = v.programChange;
  return s;
}

function load(): Settings {
  try { return parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')); } catch { return parse(null); }
}

class Controls {
  settings = $state<Settings>(load());
  dialogOpen = $state(false);
  midiInputs = $state<string[]>([]);
  midiError = $state('');
  lastMidi = $state('');
  learning = $state(false);
  private learner: ((cc: number) => void) | null = null;
  private access: MIDIAccess | null = null;
  private ports: MIDIInput[] = [];

  constructor() {
    if (this.settings.midi) this.startMidi();
  }

  // In the play view keys 1-4 pick a preset in the bank and the arrows
  // change banks, like a GX-100's memory mode.
  get memoryKeys() { return ui.playing; }

  // Keys of app-wide controls, for conflict checks.
  get taken(): Record<string, string> {
    return {
      ...(this.settings.channelKey ? { [this.settings.channelKey]: 'the channel switch' } : {}),
      ...(this.settings.tapKey ? { [this.settings.tapKey]: 'tap tempo' } : {}),
      ...(this.memoryKeys ? { ArrowLeft: 'bank down', ArrowRight: 'bank up' } : {}),
    };
  }

  update(patch: Partial<Settings>) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch {}
    if ('midi' in patch) {
      if (patch.midi) this.startMidi();
      else this.attach();
    }
  }

  // Takes over settings from a settings file.
  restore(v: unknown) {
    this.update(parse(v as Partial<Settings> | null));
  }

  // ------------------------------------------------------------ MIDI pedals

  private async startMidi() {
    this.midiError = '';
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      this.midiError = "This browser doesn't support Web MIDI.";
      return;
    }
    try {
      this.access ??= await navigator.requestMIDIAccess();
    } catch (e) {
      this.midiError = `MIDI access was denied (${(e as Error).message}).`;
      return;
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  // Listens to every input except the amp's, which the amp connection uses.
  private attach() {
    for (const p of this.ports) p.onmidimessage = null;
    this.ports = this.settings.midi && this.access
      ? [...this.access.inputs.values()].filter((p) => p.state === 'connected' && !AMP_PORT.test(p.name ?? ''))
      : [];
    for (const p of this.ports) p.onmidimessage = (e) => { if (e.data) this.receive(e.data); };
    this.midiInputs = this.ports.map((p) => p.name ?? 'MIDI input');
  }

  // Calls back with the next control change number received.
  learn(done: (cc: number) => void) {
    this.learner = done;
    this.learning = true;
  }

  stopLearning() {
    this.learner = null;
    this.learning = false;
  }

  // Footswitches: a toggle shortcut flips on every message of 64 or more (so
  // switches that send 127/0 and ones that send 127 on each press both
  // work); a momentary one follows the value, which also suits latching
  // switches. Expression pedals send 0..127 continuously.
  receive(data: ArrayLike<unknown>) {
    const m = pedalMessage(data);
    if (!m) return;
    if (m.kind === 'program') {
      const p = m.program;
      this.lastMidi = `Program change ${p + 1}`;
      if (this.settings.programChange && p < amp.presets.length && p !== amp.current) amp.selectPreset(p);
      return;
    }
    const { cc: d1, value: d2 } = m;
    this.lastMidi = `CC ${d1} = ${d2}`;
    if (this.learner) {
      const done = this.learner;
      this.stopLearning();
      done(d1);
      return;
    }
    const down = d2 >= 64;
    if (d1 === this.settings.channelCc && down) amp.switchChannel();
    if (d1 === this.settings.tapCc && down) amp.tap();
    for (const s of shortcuts.list) {
      if (s.midi?.cc !== d1) continue;
      if (s.midi.expression) shortcuts.express(s, d2 / 127);
      else if (s.momentary) down ? shortcuts.press(s) : shortcuts.release(s);
      else if (down) shortcuts.press(s);
    }
  }
}

export const controls = new Controls();

// Handy for simulating MIDI pedals from the devtools console.
if (import.meta.env.DEV) (globalThis as unknown as { controls: Controls }).controls = controls;
