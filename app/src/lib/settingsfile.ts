// App settings files: what this app keeps in the browser next to the amp's
// presets, to back up or move to another browser. That is the shortcuts and
// channels of each preset slot, the controls and MIDI pedal setup, the
// phone's keep-awake choice and the tone assistant's provider, models and
// recent tones. Left out: API keys (files get passed around), the model
// catalog (Line 6's; each browser loads its own), and what belongs to one
// computer, like the amp's cached symbol table, the audio input and the
// remote pairing code.
import { type PresetExtras, readPresetExtras } from './channels';

export const SETTINGS_FORMAT = 'spiderv-web-control/settings';
const VERSION = 1;

// The sections other than presets are in each store's own form; the stores
// check them when they take them over.
export type AppSettings = {
  presets: Record<number, PresetExtras>;
  names: Record<number, string>; // preset names when exported, to spot moved presets
  controls?: unknown;
  remote?: unknown;
  assistant?: unknown;
};

export function toSettingsFile(s: AppSettings, amp: string, date = new Date()): string {
  const presets = Object.fromEntries(Object.entries(s.presets).map(([i, e]) => [i, { name: s.names[Number(i)] ?? '', ...e }]));
  return JSON.stringify({
    format: SETTINGS_FORMAT,
    version: VERSION,
    date: date.toISOString(),
    amp,
    presets,
    controls: s.controls,
    remote: s.remote,
    assistant: s.assistant,
  }, null, 2);
}

// null if the text isn't a settings file (it may be a tone file); throws if
// it is one this version can't read.
export function readSettingsFile(text: string): (AppSettings & { amp: string; date: string }) | null {
  let v: Record<string, unknown>;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || v.format !== SETTINGS_FORMAT) return null;
  if (typeof v.version !== 'number' || v.version > VERSION) {
    throw new Error('This settings file is from a newer version of the app; update the app to import it.');
  }
  const raw = v.presets && typeof v.presets === 'object' ? (v.presets as Record<string, { name?: unknown }>) : {};
  const presets = readPresetExtras(raw);
  const names = Object.fromEntries(
    Object.keys(presets).flatMap((i) => (typeof raw[i]?.name === 'string' ? [[Number(i), raw[i].name as string]] : [])),
  );
  return {
    presets,
    names,
    controls: v.controls,
    remote: v.remote,
    assistant: v.assistant,
    amp: typeof v.amp === 'string' ? v.amp : '',
    date: typeof v.date === 'string' ? v.date : '',
  };
}

// Presets with shortcuts or channels whose slot now holds a preset with
// another name, so they may not fit it.
export function movedPresets(s: Pick<AppSettings, 'presets' | 'names'>, current: string[]): string[] {
  return Object.keys(s.presets).map(Number).flatMap((i) => {
    const was = s.names[i];
    const now = current[i];
    if (!was || now === undefined || was.trim() === now.trim()) return [];
    return [`Preset ${i + 1} was “${was}” when exported and is “${now}” now; check its shortcuts and channels.`];
  });
}
