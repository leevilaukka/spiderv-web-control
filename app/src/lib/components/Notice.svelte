<script lang="ts">
  // Progress and results of imports, saves and backups.
  import { amp } from '../amp.svelte';

  let showDetails = $state(false);
  let undoing = $state(false);

  async function undo() {
    const fn = amp.notice?.undo;
    if (!fn) return;
    undoing = true;
    try {
      await fn();
    } catch (e) {
      amp.notice = { kind: 'error', text: `Undo failed: ${(e as Error).message}`, details: [] };
    } finally {
      undoing = false;
    }
  }
</script>

{#if amp.importing}
  <div class="notice" role="status">
    <span class="text">Importing “{amp.importing.name}”… {amp.importing.done}/{amp.importing.total}</span>
    <progress max={amp.importing.total} value={amp.importing.done}></progress>
  </div>
{:else if amp.notice}
  <div class="notice" class:ok={amp.notice.kind === 'ok'} class:error={amp.notice.kind === 'error'} role={amp.notice.kind === 'error' ? 'alert' : 'status'}>
    <span class="text">{amp.notice.text}</span>
    <span class="links">
      {#if amp.imported && amp.notice.kind === 'ok' && !amp.notice.undo}
        <button onclick={() => (amp.saveDialogOpen = true)}>Save to amp…</button>
      {/if}
      {#if amp.notice.undo}
        <button disabled={undoing} onclick={undo}>{undoing ? 'Undoing…' : 'Undo'}</button>
      {/if}
      {#if amp.notice.details.length}
        <button aria-expanded={showDetails} onclick={() => (showDetails = !showDetails)}>{showDetails ? 'Hide details' : 'Details'}</button>
      {/if}
      <button aria-label="Dismiss" onclick={() => { amp.notice = null; showDetails = false; }}>✕</button>
    </span>
    {#if showDetails}
      <ul>
        {#each amp.notice.details as d}<li>{d}</li>{/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin-bottom: 14px;
    padding: 9px 12px;
    font-size: 13px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
  }
  .ok {
    border-color: color-mix(in srgb, var(--g-delay) 45%, var(--line));
    background: color-mix(in srgb, var(--g-delay) 9%, var(--panel));
  }
  .error {
    border-color: color-mix(in srgb, var(--error) 50%, var(--line));
    background: color-mix(in srgb, var(--error) 9%, var(--panel));
  }
  .text { flex: 1 1 320px; }
  .links {
    display: flex;
    gap: 12px;
    margin-left: auto;
  }
  .links button {
    all: unset;
    cursor: pointer;
    color: var(--focus);
    font-size: 13px;
    white-space: nowrap;
  }
  .links button:disabled { opacity: 0.6; cursor: default; }
  .links button:focus-visible { outline: 2px solid var(--focus); }
  progress {
    width: 180px;
    accent-color: var(--accent);
  }
  ul {
    flex-basis: 100%;
    margin: 2px 0 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
</style>
