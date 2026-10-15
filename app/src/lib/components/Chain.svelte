<script lang="ts">
  import { amp } from '../amp.svelte';
  import type { Slot } from '../tone';
  import { groupColor } from '../colors';

  const isPost = (s: Slot) => !!s.extras.find((c) => c.label === 'Post amp')?.value;

  // Signal order: pre-amp effects, amp + cab, post-amp effects.
  const ordered = $derived.by(() => {
    const by = (sym: string) => amp.chain.find((s) => s.sym === sym);
    const fx = ['FX1', 'FX2', 'FX3', 'FX4'].map(by).filter((s): s is Slot => !!s);
    const vol = by('VolumePedal');
    return [
      by('Gate'), by('Wah'), ...fx.filter((s) => !isPost(s)), vol && !isPost(vol) ? vol : undefined,
      by('Amp'), by('StudioCab'),
      ...fx.filter(isPost), by('PostComp'), by('PostEQ'), vol && isPost(vol) ? vol : undefined,
    ].filter((s): s is Slot => !!s);
  });

  // Pedalboard keys: fixed per block (not per chain position) so they don't
  // move when a preset puts an effect post-amp. Matched by physical key.
  const KEYS: Record<string, string> = {
    Digit1: 'Gate', Digit2: 'Wah', Digit3: 'FX1', Digit4: 'FX2', Digit5: 'FX3', Digit6: 'Amp',
    Digit7: 'StudioCab', Digit8: 'FX4', Digit9: 'PostComp', Digit0: 'PostEQ', Minus: 'VolumePedal',
  };
  const codeOf = Object.fromEntries(Object.entries(KEYS).map(([code, sym]) => [sym, code]));

  // What the Minus key prints on the user's layout (e.g. "+" on Nordic ones).
  let minusLabel = $state('-');
  (navigator as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard
    ?.getLayoutMap()
    .then((m) => (minusLabel = m.get('Minus') ?? '-'))
    .catch(() => {});
  const keyLabel = (code: string) => (code === 'Minus' ? minusLabel : code.slice(5));

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    const slot = amp.chain.find((s) => s.sym === KEYS[e.code]);
    if (!slot?.enable) return;
    e.preventDefault();
    amp.toggle(slot);
  }
</script>

<svelte:window {onkeydown} />

<ol class="chain" aria-label="Signal chain">
  {#each ordered as slot (slot.sym)}
    {@const on = !!slot.enable?.value}
    {@const code = codeOf[slot.sym]}
    <li class="block" class:on class:selected={amp.selected === slot.sym} style:--c={groupColor(slot.group)}>
      <button class="select" onclick={() => (amp.selected = slot.sym)} aria-current={amp.selected === slot.sym}>
        <span class="slot">{slot.label}</span>
        <span class="model">{slot.shortName}</span>
      </button>
      {#if slot.enable}
        <button
          class="power"
          aria-label="{slot.label} {on ? 'on' : 'off'}"
          aria-pressed={on}
          aria-keyshortcuts={code ? keyLabel(code) : undefined}
          title={code ? `Toggle (key ${keyLabel(code)})` : undefined}
          onclick={() => amp.toggle(slot)}
        ></button>
        {#if code}<kbd class="key" aria-hidden="true">{keyLabel(code)}</kbd>{/if}
      {/if}
    </li>
  {/each}
</ol>

<style>
  .chain {
    list-style: none;
    margin: 0;
    padding: 4px 0 12px;
    display: flex;
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .block {
    position: relative;
    flex: 1 1 0;
    min-width: 86px;
    max-width: 140px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-top: 4px solid color-mix(in srgb, var(--c) 30%, transparent);
    scroll-snap-align: start;
    transition: border-color 0.15s, background 0.15s;
  }
  .block:not(.on) { background: transparent; }
  .block:not(:last-child)::after {
    content: '';
    position: absolute;
    right: -13px;
    top: 50%;
    width: 12px;
    height: 2px;
    background: var(--line);
  }
  .block.on { border-top-color: var(--c); }
  .block:not(.on) .model { color: var(--muted); }
  .block.selected {
    border-color: var(--c);
    box-shadow: 0 0 0 1px var(--c);
  }
  .select {
    all: unset;
    box-sizing: border-box;
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 10px 9px 26px;
    cursor: pointer;
    border-radius: 10px;
  }
  .select:focus-visible { outline: 2px solid var(--focus); }
  .slot {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .model {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    min-height: 2.5em;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  /* Off: hollow ring in the block colour. On: filled and glowing. */
  .power {
    position: absolute;
    left: 10px;
    bottom: 8px;
    width: 13px;
    height: 13px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--c) 60%, var(--muted));
    background: transparent;
    cursor: pointer;
  }
  .power::before {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .on .power {
    background: var(--c);
    border-color: var(--c);
    box-shadow: 0 0 9px var(--c);
  }
  .power:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .key {
    position: absolute;
    right: 8px;
    bottom: 6px;
    min-width: 1.5em;
    padding: 0 4px;
    font: 600 11px/16px var(--mono);
    text-align: center;
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    pointer-events: none;
  }
  .on .key { color: var(--text); }
</style>
