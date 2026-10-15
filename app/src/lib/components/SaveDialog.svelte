<script lang="ts">
  import { amp } from '../amp.svelte';
  import { PRESET_NAME_MAX } from '../protocol/codec';


  let dialog: HTMLDialogElement | undefined = $state();
  let name = $state('');
  let slot = $state(0);

  $effect(() => {
    if (!dialog) return;
    if (amp.saveDialogOpen && !dialog.open) {
      name = (amp.imported?.name ?? amp.presetName).slice(0, PRESET_NAME_MAX);
      slot = Math.max(0, amp.current);
      dialog.showModal();
    } else if (!amp.saveDialogOpen && dialog.open) {
      dialog.close();
    }
  });

  const target = $derived(amp.presets[slot] ?? '');
  const overwritesOther = $derived(slot !== amp.current);
  const valid = $derived(name.trim().length > 0);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    amp.saveDialogOpen = false;
    await amp.saveTone(slot, name.trim());
  }
</script>

<dialog bind:this={dialog} onclose={() => (amp.saveDialogOpen = false)} aria-labelledby="save-title">
  <form onsubmit={save}>
    <h2 id="save-title">Save preset</h2>
    {#if amp.imported}
      <p class="from">
        Imported from <strong>{amp.imported.file}</strong>{amp.imported.author ? ` by ${amp.imported.author}` : ''}.
        Its name{amp.imported.tnid ? ' and CustomTone id' : ''}{amp.imported.label ? ' and label' : ''} are saved with the preset;
        author and song details aren't stored on the amp.
      </p>
    {/if}
    <label>
      <span>Name</span>
      <input bind:value={name} maxlength={PRESET_NAME_MAX} required spellcheck="false" />
    </label>
    <label>
      <span>Save to</span>
      <select bind:value={slot}>
        {#each amp.presets as p, i}
          <option value={i}>{i + 1}. {p}{i === amp.current ? ' (current)' : ''}</option>
        {/each}
      </select>
    </label>
    <p class="warn">
      This replaces preset {slot + 1}{target ? ` “${target}”` : ''} on the amp{overwritesOther ? ', which is not the preset you started from' : ''}.
      You can undo it right after saving.
    </p>
    <div class="buttons">
      <button type="button" onclick={() => (amp.saveDialogOpen = false)}>Cancel</button>
      <button type="submit" class="primary" disabled={!valid}>Save</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  form {
    display: grid;
    gap: 14px;
    padding: 20px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  input, select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .from {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .from strong { color: var(--text); font-weight: 600; }
  .warn {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
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
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
