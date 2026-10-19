<script lang="ts">
  // The view for playing: presets in banks of four, picked with keys 1–4
  // like a GX-100's memory mode, and big switches for the blocks. On phones
  // the footswitches take the blocks' place.
  import { amp } from '../amp.svelte';
  import { BANK_SIZE, slotName } from '../controls.svelte';
  import { BLOCK_KEYS } from '../shortcuts';
  import { keyLabel } from '../keys.svelte';
  import { groupColor } from '../colors';
  import { ui } from '../ui.svelte';
  import { assistant } from '../assistant.svelte';
  import Shortcuts from './Shortcuts.svelte';

  const banks = $derived(Math.max(1, Math.ceil(amp.presets.length / BANK_SIZE)));
  let bank = $state(0);
  // The shown bank follows the current preset; arrows browse without loading.
  $effect(() => { if (amp.current >= 0) bank = Math.floor(amp.current / BANK_SIZE); });
  const step = (d: number) => (bank = (bank + d + banks) % banks);
  const codeOf = Object.fromEntries(Object.entries(BLOCK_KEYS).map(([code, sym]) => [sym, code]));
  const blocks = $derived(amp.chain.filter((s) => s.enable));
  const name = $derived(amp.imported ? amp.imported.name : amp.presetName);
  const pick = (i: number) => { if (i < amp.presets.length && i !== amp.current) amp.selectPreset(i); };

  // Long-pressing a block (or right-clicking it) opens its knobs; a tap
  // still switches it.
  const LONG_PRESS_MS = 500;
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  let swallowClick = false;

  function pressStart(e: PointerEvent, sym: string) {
    swallowClick = false;
    if (e.button !== 0) return;
    cancelPress();
    press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        swallowClick = true; // the release that follows isn't a tap
        navigator.vibrate?.(15);
        ui.edit(sym);
      }, LONG_PRESS_MS),
    };
  }

  // Moving the finger (scrolling) isn't a long press.
  function pressMove(e: PointerEvent) {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function blockClick(slot: (typeof blocks)[number]) {
    if (swallowClick) { swallowClick = false; return; }
    amp.toggle(slot);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    if (e.key === 'Escape') { if (!ui.narrow && !assistant.open) ui.mode = 'edit'; return; }
    if (e.repeat) return;
    const n = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (n && Number(n) <= BANK_SIZE) {
      e.preventDefault();
      pick(bank * BANK_SIZE + Number(n) - 1);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      step(e.code === 'ArrowLeft' ? -1 : 1);
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="play">
  {#if ui.narrow}
    <div class="now">
      <span class="num">{amp.current >= 0 ? amp.current + 1 : '–'}</span>
      <div class="title">
        <strong>{name}</strong>
        <span>
          {#if amp.current >= 0}Bank {Math.floor(amp.current / BANK_SIZE) + 1} · {slotName(amp.current)}{/if}
          {#if amp.dirty || amp.channelsEdited || amp.imported} · not saved{/if}
        </span>
      </div>
    </div>
  {/if}

  <div class="banknav">
    <button class="nav" aria-label="Previous bank" onclick={() => step(-1)}>◀</button>
    <span class="bank">{ui.narrow ? 'BANK' : 'Bank'} {bank + 1}</span>
    <button class="nav" aria-label="Next bank" onclick={() => step(1)}>▶</button>
    {#if !ui.narrow}<span class="hint">Keys 1–{BANK_SIZE} pick a preset · ← → change bank · Esc to edit</span>{/if}
  </div>

  <div class="presets">
    {#each { length: BANK_SIZE } as _, n}
      {@const i = bank * BANK_SIZE + n}
      {#if i < amp.presets.length}
        {@const current = i === amp.current}
        <button class="preset" class:current aria-current={current} aria-keyshortcuts={String(n + 1)} disabled={amp.loadingPreset} onclick={() => pick(i)}>
          <span class="slot">{slotName(i)}{ui.narrow ? '' : ` · ${i + 1}`}</span>
          <span class="pname">{amp.presets[i] || '…'}</span>
        </button>
      {/if}
    {/each}
  </div>

  {#if ui.narrow}
    <h2 class="rule"><span>Footswitches</span></h2>
    <Shortcuts variant="big" />
  {:else}
    <h2 class="rule"><span>Blocks</span></h2>
    <div class="blocks">
      {#each blocks as slot (slot.sym)}
        {@const on = !!slot.enable?.value}
        <button
          class="block"
          class:on
          style:--c={groupColor(slot.group)}
          aria-pressed={on}
          title="Click to switch, long-press or right-click for its knobs"
          onclick={() => blockClick(slot)}
          onpointerdown={(e) => pressStart(e, slot.sym)}
          onpointermove={pressMove}
          onpointerup={cancelPress}
          onpointercancel={cancelPress}
          onpointerleave={cancelPress}
          oncontextmenu={(e) => { e.preventDefault(); cancelPress(); ui.edit(slot.sym); }}
        >
          <span class="led" aria-hidden="true"></span>
          <span class="bname">{slot.label}</span>
          <span class="model">{slot.shortName}</span>
          {#if codeOf[slot.sym]}<kbd aria-hidden="true">{keyLabel(codeOf[slot.sym])}</kbd>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .play {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  button {
    font: inherit;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    cursor: pointer;
    touch-action: manipulation;
  }
  button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .banknav { display: flex; align-items: center; gap: 12px; }
  .nav { flex: none; width: 40px; height: 40px; border-radius: 10px; }
  .nav:hover { border-color: var(--muted); }
  .bank { min-width: 80px; text-align: center; font: 700 15px var(--mono); }
  .hint { font-size: 13px; color: var(--muted); }
  .presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .preset {
    display: grid;
    align-content: space-between;
    gap: 8px;
    min-height: 170px;
    padding: 18px;
    text-align: left;
    border-radius: 14px;
  }
  .preset:hover:not(.current) { border-color: var(--muted); }
  .preset:disabled { cursor: progress; }
  .preset.current {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 0 18px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .slot { font: 600 13px var(--mono); color: var(--muted); }
  .current .slot { color: var(--accent); }
  .pname { font-size: 24px; font-weight: 700; line-height: 1.15; overflow-wrap: break-word; hyphens: auto; min-width: 0; }
  .rule {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 0;
    font-size: 11px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .rule::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .blocks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .block {
    position: relative;
    display: grid;
    align-content: start;
    gap: 6px;
    min-height: 96px;
    padding: 14px;
    text-align: left;
    background: transparent;
    border-top: 4px solid color-mix(in srgb, var(--c) 30%, transparent);
    border-radius: 12px;
    /* No text selection or iOS callout on a long press. */
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .block.on { background: var(--panel-2); border-top-color: var(--c); }
  .led { width: 16px; height: 16px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--c) 60%, var(--muted)); }
  .block.on .led { background: var(--c); border-color: var(--c); box-shadow: 0 0 9px var(--c); }
  .bname { font-size: 18px; font-weight: 700; }
  .model { font-size: 13px; color: var(--muted); }
  kbd {
    position: absolute;
    right: 12px;
    top: 12px;
    font: 600 11px/16px var(--mono);
    padding: 0 5px;
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }

  .now { display: flex; align-items: center; gap: 12px; padding: 0 4px; }
  .num {
    flex: none;
    min-width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    padding: 0 6px;
    font: 800 24px/1 var(--mono);
    color: #fff;
    background: var(--accent);
    border-radius: 12px;
  }
  .title { display: grid; min-width: 0; line-height: 1.2; }
  .title strong { font-size: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title span { font-size: 13px; color: var(--muted); }

  @media (max-width: 760px) {
    .play { gap: 14px; }
    .banknav { gap: 8px; }
    .nav { width: 48px; height: 44px; border-radius: 12px; }
    .bank { flex: 1; font-size: 14px; }
    .presets { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .preset { min-height: 104px; padding: 14px; }
    .slot { font-size: 12px; }
    .pname { font-size: 17px; }
    .rule { margin: 0; }
  }
</style>
