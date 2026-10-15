// App-wide performance controls: the channel switch, the stage view with its
// memory and manual modes, and MIDI pedals (foot controllers and expression
// pedals on any MIDI input other than the amp).
import { amp } from './amp.svelte';
import { shortcuts } from './shortcuts.svelte';

const STORAGE_KEY = 'spiderv.controls';
const AMP_PORT = /spider ?v/i;
export const BANK_SIZE = 4;

type Settings = {
  channelKey: string; // KeyboardEvent.code, '' for none
  channelCc: number | null;
  midi: boolean; // listen to MIDI pedals
  programChange: boolean; // program change messages select presets
};

function load(): Settings {
  const s: Settings = { channelKey: '', channelCc: null, midi: false, programChange: true };
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof v.channelKey === 'string') s.channelKey = v.channelKey;
    if (typeof v.channelCc === 'number') s.channelCc = v.channelCc;
    s.midi = !!v.midi;
    if (typeof v.programChange === 'boolean') s.programChange = v.programChange;
  } catch {}
  return s;
}

class Controls {
  settings = $state<Settings>(load());
  dialogOpen = $state(false);
  stage = $state(false);
  // Memory: keys 1-4 pick a preset in the bank, arrows change banks.
  // Manual: the number keys switch blocks, as outside the stage view.
  mode = $state<'memory' | 'manual'>('memory');
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

  get memoryKeys() { return this.stage && this.mode === 'memory'; }

  // Keys of app-wide controls, for conflict checks.
  get taken(): Record<string, string> {
    return {
      ...(this.settings.channelKey ? { [this.settings.channelKey]: 'the channel switch' } : {}),
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
  receive(data: Uint8Array | number[]) {
    const [status, d1 = 0, d2 = 0] = data;
    const type = status & 0xf0;
    if (type === 0xc0) {
      this.lastMidi = `Program change ${d1 + 1}`;
      if (this.settings.programChange && d1 < amp.presets.length && d1 !== amp.current) amp.selectPreset(d1);
      return;
    }
    if (type !== 0xb0) return;
    this.lastMidi = `CC ${d1} = ${d2}`;
    if (this.learner) {
      const done = this.learner;
      this.stopLearning();
      done(d1);
      return;
    }
    const down = d2 >= 64;
    if (d1 === this.settings.channelCc && down) amp.switchChannel();
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
