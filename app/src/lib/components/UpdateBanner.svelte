<script lang="ts">
  // Offers a new version of the app once it has downloaded (pwa.svelte.ts).
  // Reloading reconnects the amp, so it waits for the user.
  import { pwa } from '../pwa.svelte';
</script>

{#if pwa.updateReady}
  <div class="update" role="status">
    <span>A new version of the app is ready.</span>
    <button onclick={() => pwa.reload()}>Reload</button>
    <button aria-label="Later" title="Later" onclick={() => pwa.dismiss()}>✕</button>
  </div>
{/if}

<style>
  .update {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: calc(100vw - 32px);
    padding: 9px 12px;
    font-size: 13px;
    color: var(--text);
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
  }
  button {
    all: unset;
    cursor: pointer;
    color: var(--focus);
    white-space: nowrap;
  }
  button:focus-visible { outline: 2px solid var(--focus); }
</style>
