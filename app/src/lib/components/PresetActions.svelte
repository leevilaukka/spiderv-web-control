<script lang="ts">
  // Tone file buttons under the preset list. Phones offer a backup instead of
  // an export, which they rarely need.
  import { amp } from '../amp.svelte';
  import { importFile } from '../settings.svelte';
  import { TONE_FILES, pickFile } from '../pickfile';

  let { phone = false }: { phone?: boolean } = $props();
  const busy = $derived(!!amp.importing || amp.saving);
</script>

<div class="actions" class:phone>
  <button disabled={busy} title=".svl6p or .json; you can also drop a file on the page" onclick={() => pickFile(TONE_FILES, importFile)}>
    Import tone…
  </button>
  {#if phone}
    <button disabled={busy} title="Download all {amp.presets.length} presets as one file" onclick={() => amp.backupPresets()}>Back up all</button>
  {:else}
    <button disabled={busy} title="Download the current tone as .svl6p, with its shortcuts and channels" onclick={() => amp.exportTone()}>Export</button>
  {/if}
</div>

<style>
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    flex: 1;
    padding: 7px 0;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--muted); }
  button:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .phone button {
    height: 44px;
    padding: 0;
    font-size: 14px;
    background: var(--panel-2);
    border-radius: 12px;
  }
</style>
