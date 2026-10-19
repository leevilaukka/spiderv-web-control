<script lang="ts">
  // Button with a popover panel; closes on outside click or Escape.
  import type { Snippet } from 'svelte';

  let { label, title, align = 'right', button, children }: {
    label: string;
    title?: string;
    align?: 'left' | 'right';
    button?: Snippet;
    children: Snippet<[() => void]>;
  } = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  const close = () => (open = false);

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (root && !root.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="menu" bind:this={root}>
  <button class="trigger" aria-label={label} {title} aria-haspopup="true" aria-expanded={open} onclick={() => (open = !open)}>
    {#if button}{@render button()}{:else}{label}{/if}
  </button>
  {#if open}
    <div class="panel" class:left={align === 'left'} role="menu">
      {@render children(close)}
    </div>
  {/if}
</div>

<style>
  .menu { position: relative; }
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 36px;
    min-width: 36px;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .trigger:hover { border-color: var(--muted); }
  .trigger:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 300px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    display: grid;
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
  }
  .panel.left { right: auto; left: 0; }
  .panel :global(.item) {
    all: unset;
    box-sizing: border-box;
    display: grid;
    gap: 1px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  .panel :global(.item small) { color: var(--muted); font-size: 12px; }
  .panel :global(.item:hover), .panel :global(.item:focus-visible) { background: var(--panel-2); }
  .panel :global(.item:disabled) { opacity: 0.5; cursor: default; }
  .panel :global(.item.sep) { border-top: 1px solid var(--line); border-radius: 0 0 6px 6px; margin-top: 4px; }
  .panel :global(.meta) {
    padding: 6px 10px 8px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
  }
</style>
