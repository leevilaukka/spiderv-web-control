<script lang="ts">
  // Save button plus a menu for tone files and backups.
  import { amp } from '../amp.svelte';
  import { importFile } from '../settings.svelte';
  import Menu from './Menu.svelte';
  import SaveDialog from './SaveDialog.svelte';

  let input: HTMLInputElement | undefined = $state();
  const busy = $derived(!!amp.importing || amp.saving);

  function picked(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    if (file) importFile(file);
    el.value = '';
  }
</script>

<div class="actions">
  <button class="save" disabled={busy} onclick={() => (amp.saveDialogOpen = true)}>
    {amp.saving ? 'Saving…' : 'Save…'}
  </button>
  <Menu label="Tone file and backup options" title="Import, export, back up">
    {#snippet button()}<span aria-hidden="true">⋯</span>{/snippet}
    {#snippet children(close)}
      <button class="item" role="menuitem" disabled={busy} onclick={() => { close(); input?.click(); }}>
        Import tone…
        <small>.svl6p or .json; you can also drop a file on the page</small>
      </button>
      <button class="item" role="menuitem" disabled={busy} onclick={() => { close(); amp.exportTone(); }}>
        Export tone
        <small>Download the current tone as .svl6p</small>
      </button>
      <button class="item" role="menuitem" disabled={busy} onclick={() => { close(); amp.backupPresets(); }}>
        Back up all presets
        <small>Download all {amp.presets.length} presets as one file</small>
      </button>
    {/snippet}
  </Menu>
  <input bind:this={input} type="file" accept=".svl6p,.slv6p,.l6t,.json,.bin,application/json" onchange={picked} hidden />
</div>

<SaveDialog />

<style>
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .save {
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 6px 14px;
    cursor: pointer;
  }
  .save:disabled { opacity: 0.6; cursor: default; }
  .save:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
