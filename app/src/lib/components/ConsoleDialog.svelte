<script lang="ts">
  // The protocol console in a window, opened from the amp menu.
  import { ui } from '../ui.svelte';
  import Console from './Console.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!dialog) return;
    if (ui.consoleOpen && !dialog.open) dialog.showModal();
    else if (!ui.consoleOpen && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} aria-labelledby="console-title" onclose={() => (ui.consoleOpen = false)}>
  <header>
    <h2 id="console-title">Protocol console</h2>
    <button aria-label="Close" onclick={() => (ui.consoleOpen = false)}>✕</button>
  </header>
  {#if ui.consoleOpen}
    <div class="body"><Console /></div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(960px, calc(100vw - 32px));
    height: min(640px, calc(100vh - 48px));
    padding: 0;
    flex-direction: column;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  dialog[open] { display: flex; }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }
  h2 { margin: 0; font-size: 16px; }
  button {
    width: 32px;
    height: 32px;
    font: inherit;
    color: var(--muted);
    background: none;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
  }
  button:hover { color: var(--text); background: var(--panel-2); }
  button:focus-visible { outline: 2px solid var(--focus); }
  .body { flex: 1; min-height: 0; padding: 12px 16px; }
</style>
