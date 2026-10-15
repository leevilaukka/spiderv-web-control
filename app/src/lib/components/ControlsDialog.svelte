<script lang="ts">
  // App-wide controls: the channel switch and MIDI pedals.
  import { controls } from '../controls.svelte';
  import { shortcuts } from '../shortcuts.svelte';
  import { amp } from '../amp.svelte';
  import { keyConflict } from '../shortcuts';
  import { keyLabel } from '../keys.svelte';
  import Switch from './Switch.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let listening = $state(false);
  let keyError = $state('');

  $effect(() => {
    if (!dialog) return;
    if (controls.dialogOpen && !dialog.open) {
      listening = false;
      keyError = '';
      dialog.showModal();
    } else if (!controls.dialogOpen && dialog.open) {
      dialog.close();
    }
  });

  function captureKey(e: KeyboardEvent) {
    if (!listening || e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { listening = false; keyError = ''; return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { controls.update({ channelKey: '' }); listening = false; return; }
    if (/^(Shift|Control|Alt|Meta|OS)/.test(e.code)) return;
    const c = keyConflict(e.code, shortcuts.list, undefined, { ArrowLeft: 'bank down in the stage view', ArrowRight: 'bank up in the stage view' });
    if (!c) {
      controls.update({ channelKey: e.code });
      listening = false;
      keyError = '';
    } else if ('block' in c) {
      keyError = `${keyLabel(e.code)} already switches ${amp.chain.find((s) => s.sym === c.block)?.label ?? c.block}.`;
    } else if ('shortcut' in c) {
      keyError = `${keyLabel(e.code)} is used by the shortcut “${c.shortcut.name}” in this preset.`;
    } else if ('control' in c) {
      keyError = `${keyLabel(e.code)} is ${c.control}.`;
    } else {
      keyError = `${keyLabel(e.code)} can't be used. Try a letter, F-key or Page Up/Down.`;
    }
  }

  function learnChannel() {
    if (controls.learning) return controls.stopLearning();
    controls.learn((cc) => controls.update({ channelCc: cc }));
  }

  function close() {
    controls.stopLearning();
    controls.dialogOpen = false;
  }
</script>

<dialog bind:this={dialog} onclose={close} aria-labelledby="controls-title">
  <div class="body">
    <h2 id="controls-title">Controls and MIDI pedals</h2>

    <section>
      <h3>Channel switch</h3>
      <p>Switches between channels A and B in presets that have them.</p>
      <div class="row">
        <span class="label">Key</span>
        <button class="capture" class:listening onclick={() => { listening = !listening; keyError = ''; }} onkeydown={captureKey} onblur={() => (listening = false)}>
          {#if listening}Press a key…{:else if controls.settings.channelKey}<kbd>{keyLabel(controls.settings.channelKey)}</kbd>{:else}None{/if}
        </button>
        {#if controls.settings.channelKey && !listening}<button class="small" onclick={() => controls.update({ channelKey: '' })}>Clear</button>{/if}
      </div>
      {#if keyError}<p class="error" role="alert">{keyError}</p>{/if}
      <div class="row">
        <span class="label">MIDI</span>
        <button class="capture" class:listening={controls.learning} disabled={!controls.settings.midi} onclick={learnChannel}>
          {#if controls.learning}Press the footswitch…{:else if controls.settings.channelCc !== null}CC {controls.settings.channelCc}{:else}None{/if}
        </button>
        {#if controls.settings.channelCc !== null && !controls.learning}<button class="small" onclick={() => controls.update({ channelCc: null })}>Clear</button>{/if}
      </div>
    </section>

    <section>
      <h3>MIDI pedals</h3>
      <p>
        Foot controllers and expression pedals on any MIDI input other than the amp. Footswitches and pedals are
        assigned to shortcuts in each shortcut's editor.
      </p>
      <Switch checked={controls.settings.midi} label="Listen to MIDI pedals" onchange={(v) => controls.update({ midi: v })} />
      {#if controls.midiError}
        <p class="error" role="alert">{controls.midiError}</p>
      {:else if controls.settings.midi}
        <p>
          {controls.midiInputs.length ? `Listening to ${controls.midiInputs.join(', ')}.` : 'No MIDI inputs found besides the amp. Plug one in; it is picked up automatically.'}
          {#if controls.lastMidi}<br />Last received: <strong>{controls.lastMidi}</strong>{/if}
        </p>
        <label class="check">
          <input type="checkbox" checked={controls.settings.programChange} onchange={(e) => controls.update({ programChange: e.currentTarget.checked })} />
          Program change messages select presets (1–{amp.presets.length || 128})
        </label>
      {/if}
    </section>

    <section>
      <h3>Stage view</h3>
      <p>
        Big footswitch buttons for playing. In memory mode keys 1–4 load the presets of a bank and ← → change banks,
        like the GX-100's memory mode; in manual mode the number keys switch blocks. Shortcuts and the channel switch work in both.
      </p>
    </section>

    <div class="buttons"><button class="primary" onclick={close}>Done</button></div>
  </div>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  .body { display: grid; gap: 18px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  section { display: grid; gap: 8px; }
  p { margin: 0; font-size: 13px; color: var(--muted); }
  p strong { color: var(--text); font-weight: 600; }
  .error { color: var(--error); }
  .row { display: flex; align-items: center; gap: 8px; }
  .label { width: 40px; font-size: 13px; color: var(--muted); }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .check input { accent-color: var(--accent); margin: 0; }
  button {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 14px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.small { font-size: 13px; padding: 4px 10px; }
  .capture { min-width: 130px; text-align: left; }
  .capture.listening { border-color: var(--accent); color: var(--accent); }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 0 5px;
    font: 600 12px/18px var(--mono);
    text-align: center;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .buttons { display: flex; justify-content: flex-end; }
  .primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
