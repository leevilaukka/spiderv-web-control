// Exports and imports the app's own settings (settingsfile.ts), gathered from
// and handed to the stores that keep them.
import { amp } from './amp.svelte';
import { assistant } from './assistant.svelte';
import { controls } from './controls.svelte';
import { remote } from './remote.svelte';
import { download } from './download';
import { type AppSettings, movedPresets, readSettingsFile, toSettingsFile } from './settingsfile';

function collect(): AppSettings {
  const presets = amp.extras;
  const names = Object.fromEntries(Object.keys(presets).flatMap((i) => (amp.presets[+i] ? [[+i, amp.presets[+i]]] : [])));
  return {
    presets,
    names,
    controls: $state.snapshot(controls.settings),
    remote: { keepAwake: remote.settings.keepAwake },
    assistant: assistant.settings,
  };
}

// Sections missing from the file are left as they are.
function apply(s: AppSettings): boolean {
  const current = amp.replaceExtras(s.presets);
  if (s.controls !== undefined) controls.restore(s.controls);
  const keepAwake = (s.remote as { keepAwake?: unknown } | undefined)?.keepAwake;
  if (typeof keepAwake === 'boolean') remote.update({ keepAwake });
  if (s.assistant !== undefined) assistant.restoreSettings(s.assistant);
  return current;
}

const count = (n: number) => `${n} preset${n === 1 ? '' : 's'}`;

export function exportSettings() {
  const s = collect();
  download(toSettingsFile(s, amp.label), `spiderv-settings-${new Date().toISOString().slice(0, 10)}.json`);
  amp.notice = {
    kind: 'ok',
    text: `Exported the app settings, with shortcuts or channels for ${count(Object.keys(s.presets).length)}. API keys are not included.`,
    details: [],
  };
}

// Imports a settings file, or hands anything else to the tone import, so
// either can be dropped on the page.
export async function importFile(file: File) {
  let s: ReturnType<typeof readSettingsFile>;
  try {
    s = readSettingsFile(await file.text());
  } catch (e) {
    amp.notice = { kind: 'error', text: (e as Error).message, details: [] };
    return;
  }
  if (!s) return amp.importTone(file);
  const previous = collect();
  const current = apply(s);
  amp.notice = {
    kind: 'ok',
    text: `Imported the app settings from ${file.name}, with shortcuts or channels for ${count(Object.keys(s.presets).length)}.`,
    details: [
      ...(s.amp && s.amp !== amp.label ? [`Exported from ${s.amp}${s.date ? ` on ${s.date.slice(0, 10)}` : ''}.`] : []),
      ...movedPresets(s, amp.presets),
      ...(current ? [] : ["The tone in the edit buffer isn't saved, so it keeps its own shortcuts and channels until you load a preset."]),
    ],
    undo: async () => {
      apply(previous);
      amp.notice = { kind: 'ok', text: 'Restored the app settings from before the import.', details: [] };
    },
  };
}
