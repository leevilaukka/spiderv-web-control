<script lang="ts">
  // The amp's presets in banks of four, as the amp numbers them (1A–1D, …).
  // `phone` shows each bank as a card with bigger rows.
  import { amp } from '../amp.svelte';
  import { BANK_SIZE, slotName } from '../controls.svelte';

  let { phone = false }: { phone?: boolean } = $props();

  let query = $state('');
  const banks = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out: { n: number; items: { name: string; i: number }[] }[] = [];
    amp.presets.forEach((name, i) => {
      if (q && !name.toLowerCase().includes(q)) return;
      const n = Math.floor(i / BANK_SIZE) + 1;
      if (out.at(-1)?.n !== n) out.push({ n, items: [] });
      out.at(-1)!.items.push({ name, i });
    });
    return out;
  });

  // Bring the current preset into view when it changes.
  let list: HTMLElement | undefined = $state();
  $effect(() => {
    if (amp.current < 0 || !list) return;
    list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  });
</script>

<nav class="presets" class:phone aria-label="Presets">
  {#if phone}
    <div class="head">
      <h2>Presets</h2>
      <span>{amp.presets.length} on the amp</span>
    </div>
  {/if}
  <input
    type="search"
    placeholder={phone ? 'Search presets' : `Search ${amp.presets.length} presets`}
    bind:value={query}
    aria-label="Search presets"
  />
  <div class="banks" bind:this={list}>
    {#each banks as bank (bank.n)}
      <section class="bank" aria-label="Bank {bank.n}">
        <h3>BANK {bank.n}</h3>
        <ol>
          {#each bank.items as p (p.i)}
            {@const current = p.i === amp.current}
            <li>
              <button class:current aria-current={current} disabled={amp.loadingPreset} onclick={() => amp.selectPreset(p.i)}>
                <span class="slot">{slotName(p.i)}</span>
                <span class="name">{p.name || '…'}</span>
                {#if phone && current}<span class="mark" aria-hidden="true">●</span>{/if}
              </button>
            </li>
          {/each}
        </ol>
      </section>
    {:else}
      <p class="none">No preset matches “{query}”.</p>
    {/each}
  </div>
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
  input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .banks {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bank { display: flex; flex-direction: column; }
  h3 {
    margin: 0;
    padding: 2px 10px 4px;
    font: 600 11px var(--mono);
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
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
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    font-weight: 600;
  }
  .current:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
  .slot {
    flex: none;
    width: 2em;
    font: 600 11px var(--mono);
    color: var(--muted);
  }
  .current .slot { color: var(--accent); }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none { margin: 0; padding: 0 10px; font-size: 13px; color: var(--muted); }

  .phone { gap: 12px; }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0 4px;
  }
  h2 { margin: 0; font-size: 26px; font-weight: 750; }
  .head span { font-size: 13px; color: var(--muted); }
  .phone input { font-size: 16px; padding: 11px 14px; border-radius: 12px; }
  .phone .banks { gap: 14px; }
  .phone .bank {
    flex: none;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .phone h3 { padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .phone li + li button { border-top: 1px solid var(--panel-2); }
  .phone button {
    gap: 12px;
    min-height: 52px;
    padding: 0 14px;
    border-radius: 0;
    font-size: 16px;
  }
  .phone .slot { width: 2.2em; font-size: 12px; }
  .mark { font-size: 13px; color: var(--accent); }
</style>
