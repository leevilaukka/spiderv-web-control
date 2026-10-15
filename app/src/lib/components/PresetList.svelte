<script lang="ts">
  import { amp } from '../amp.svelte';

  let query = $state('');
  const items = $derived(
    amp.presets
      .map((name, i) => ({ name, i }))
      .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase())),
  );
</script>

<nav class="presets" aria-label="Presets">
  <input type="search" placeholder="Search presets" bind:value={query} aria-label="Search presets" />
  <ol>
    {#each items as p (p.i)}
      <li>
        <button
          class:current={p.i === amp.current}
          aria-current={p.i === amp.current}
          disabled={amp.loadingPreset}
          onclick={() => amp.selectPreset(p.i)}
        >
          <span class="num">{p.i + 1}</span>
          <span class="name">{p.name || '…'}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .presets {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 10px;
  }
  input {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover { background: var(--panel-2); }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  button:disabled { cursor: progress; }
  .current {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-weight: 600;
  }
  .current:hover { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .num {
    width: 2.2em;
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
