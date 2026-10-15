<script lang="ts">
  // Full-screen performance view with big footswitch buttons. Memory mode
  // picks presets from banks of four, manual mode switches blocks, like the
  // GX-100's two footswitch modes; shortcuts and channels work in both.
  import { amp } from '../amp.svelte';
  import { BANK_SIZE, controls } from '../controls.svelte';
  import { BLOCK_KEYS } from '../shortcuts';
  import { keyLabel } from '../keys.svelte';
  import { groupColor } from '../colors';
  import Shortcuts from './Shortcuts.svelte';

  const LETTERS = 'ABCD';
  const banks = $derived(Math.max(1, Math.ceil(amp.presets.length / BANK_SIZE)));
  let bank = $state(0);
  // The shown bank follows the current preset; arrows browse without loading.
  $effect(() => { if (amp.current >= 0) bank = Math.floor(amp.current / BANK_SIZE); });
  const step = (d: number) => (bank = (bank + d + banks) % banks);
  const codeOf = Object.fromEntries(Object.entries(BLOCK_KEYS).map(([code, sym]) => [sym, code]));
  const blocks = $derived(amp.chain.filter((s) => s.enable));

  // The page behind doesn't scroll while the stage view covers it.
  $effect(() => {
    if (!controls.stage) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  });

  function onkeydown(e: KeyboardEvent) {
    if (!controls.stage || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    if (e.key === 'Escape') { controls.stage = false; return; }
    if (controls.mode !== 'memory' || e.repeat) return;
    const n = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (n && Number(n) <= BANK_SIZE) {
      e.preventDefault();
      const i = bank * BANK_SIZE + Number(n) - 1;
      if (i < amp.presets.length && i !== amp.current) amp.selectPreset(i);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      step(e.code === 'ArrowLeft' ? -1 : 1);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if controls.stage}
  <div class="stage" role="dialog" aria-modal="true" aria-label="Stage view">
    <header>
      <div class="now">
        <span class="num">{amp.current >= 0 ? amp.current + 1 : '–'}</span>
        <div class="title">
          <strong>{amp.imported ? amp.imported.name : amp.presetName}</strong>
          <span>
            {#if amp.current >= 0}Bank {Math.floor(amp.current / BANK_SIZE) + 1} · {LETTERS[amp.current % BANK_SIZE]}{/if}
            {#if amp.dirty || amp.channelsEdited || amp.imported} · not saved{/if}
          </span>
        </div>
      </div>
      <div class="mode" role="radiogroup" aria-label="Footswitch mode">
        <button role="radio" aria-checked={controls.mode === 'memory'} onclick={() => (controls.mode = 'memory')}>Memory</button>
        <button role="radio" aria-checked={controls.mode === 'manual'} onclick={() => (controls.mode = 'manual')}>Manual</button>
      </div>
      <button class="exit" onclick={() => (controls.stage = false)}>Exit <kbd>Esc</kbd></button>
    </header>

    {#if controls.mode === 'memory'}
      <section class="bank" aria-label="Bank {bank + 1}">
        <button class="nav" aria-label="Previous bank" onclick={() => step(-1)}>◀<kbd>←</kbd></button>
        <div class="presets">
          {#each { length: BANK_SIZE } as _, n}
            {@const i = bank * BANK_SIZE + n}
            {#if i < amp.presets.length}
              <button class="preset" class:current={i === amp.current} aria-current={i === amp.current} disabled={amp.loadingPreset} onclick={() => i !== amp.current && amp.selectPreset(i)}>
                <span class="slot">{bank + 1}{LETTERS[n]} · {i + 1}</span>
                <span class="pname">{amp.presets[i] || '…'}</span>
                <kbd>{n + 1}</kbd>
              </button>
            {/if}
          {/each}
        </div>
        <button class="nav" aria-label="Next bank" onclick={() => step(1)}>▶<kbd>→</kbd></button>
      </section>
    {:else}
      <section class="blocks" aria-label="Blocks">
        {#each blocks as slot (slot.sym)}
          {@const on = !!slot.enable?.value}
          <button class="block" class:on style:--c={groupColor(slot.group)} aria-pressed={on} onclick={() => amp.toggle(slot)}>
            <span class="led" aria-hidden="true"></span>
            <span class="bname">{slot.label}</span>
            <span class="model">{slot.shortName}</span>
            {#if codeOf[slot.sym]}<kbd>{keyLabel(codeOf[slot.sym])}</kbd>{/if}
          </button>
        {/each}
      </section>
    {/if}

    <Shortcuts big />
  </div>
{/if}

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 50;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 18px 22px 28px;
    background: var(--bg);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
  }
  .now { flex: 1; display: flex; align-items: center; gap: 14px; min-width: 0; }
  .num {
    flex: none;
    min-width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    padding: 0 8px;
    font: 800 30px/1 var(--mono);
    color: #fff;
    background: var(--accent);
    border-radius: 10px;
  }
  .title { display: grid; min-width: 0; }
  .title strong { font-size: 26px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title span { color: var(--muted); font-size: 14px; }
  button {
    font: inherit;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    cursor: pointer;
    touch-action: manipulation;
  }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .mode { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .mode button { border: 0; border-radius: 0; padding: 9px 16px; font-size: 14px; background: transparent; color: var(--muted); }
  .mode button[aria-checked='true'] { background: var(--panel-2); color: var(--text); font-weight: 600; }
  .exit { padding: 9px 14px; font-size: 14px; display: flex; gap: 8px; align-items: center; }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 0 5px;
    font: 600 12px/18px var(--mono);
    text-align: center;
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .bank { display: flex; gap: 12px; align-items: stretch; }
  .nav { flex: none; width: 64px; display: grid; place-items: center; align-content: center; gap: 8px; font-size: 20px; }
  .presets { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .preset {
    position: relative;
    display: grid;
    align-content: start;
    gap: 6px;
    min-height: 120px;
    padding: 16px;
    text-align: left;
  }
  .preset.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 30%, transparent); }
  .preset .slot { font: 600 13px/1 var(--mono); color: var(--muted); }
  .preset.current .slot { color: var(--accent); }
  .pname { font-size: 20px; font-weight: 700; line-height: 1.2; overflow-wrap: break-word; hyphens: auto; min-width: 0; }
  .preset kbd { position: absolute; right: 12px; bottom: 12px; }
  .blocks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .block {
    position: relative;
    display: grid;
    align-content: start;
    gap: 4px;
    min-height: 100px;
    padding: 14px;
    text-align: left;
    border-top: 5px solid color-mix(in srgb, var(--c) 30%, transparent);
    background: transparent;
  }
  .block.on { background: var(--panel-2); border-top-color: var(--c); }
  .led { width: 16px; height: 16px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--c) 60%, var(--muted)); }
  .block.on .led { background: var(--c); border-color: var(--c); box-shadow: 0 0 10px var(--c); }
  .bname { font-size: 18px; font-weight: 700; }
  .model { font-size: 13px; color: var(--muted); }
  .block kbd { position: absolute; right: 12px; bottom: 12px; }

  @media (max-width: 760px) {
    .stage { padding: 14px 16px 24px; gap: 16px; }
    .presets { grid-template-columns: repeat(2, 1fr); }
    .bank { gap: 8px; }
    .presets { gap: 8px; }
    .nav { width: 36px; }
    .nav kbd { display: none; }
    .preset { min-height: 96px; padding: 12px 12px 32px; }
    .pname { font-size: 16px; }
    .now { flex-basis: 100%; }
    .mode { flex: 1; }
    .mode button { flex: 1; }
    .num { min-width: 52px; height: 52px; font-size: 24px; }
    .title strong { font-size: 20px; }
  }
</style>
