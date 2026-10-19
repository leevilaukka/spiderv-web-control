<script lang="ts">
  // The preset's tempo with a tap switch, like a GX-100's CTL set to tap.
  // The LED blinks on the beat. `big` is the stage view's copy, which leaves
  // the key to the one on the main page.
  import { amp } from '../amp.svelte';
  import { controls } from '../controls.svelte';
  import { keyLabel } from '../keys.svelte';
  import { MAX_TEMPO, MIN_TEMPO } from '../tone';

  let { big = false }: { big?: boolean } = $props();

  const key = $derived(controls.settings.tapKey);
  const shown = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

  function onkeydown(e: KeyboardEvent) {
    if (big || !key || e.code !== key || amp.tempo === null) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable], [role="slider"]')) return;
    e.preventDefault();
    amp.tap(e.timeStamp);
  }

  // Taps count when the finger lands; keyboard and assistive-technology
  // activations arrive as clicks without a pointer (detail 0).
  const tapDown = (e: PointerEvent) => { if (e.button === 0) amp.tap(e.timeStamp); };
  const tapClick = (e: MouseEvent) => { if (e.detail === 0) amp.tap(e.timeStamp); };

  function typed(e: Event & { currentTarget: HTMLInputElement }) {
    const v = e.currentTarget.valueAsNumber;
    if (Number.isFinite(v)) amp.setTempo(v);
    else if (amp.tempo !== null) e.currentTarget.value = shown(amp.tempo);
  }
</script>

<svelte:window {onkeydown} />

{#if amp.tempo !== null}
  {@const bpm = amp.tempo}
  <div class="tempo" class:big>
    <button
      class="tap"
      aria-label="Tap tempo, {shown(bpm)} BPM"
      aria-keyshortcuts={key ? keyLabel(key) : undefined}
      title="Tap at least twice to set the tempo{key ? ` (key ${keyLabel(key)})` : ''}"
      onpointerdown={tapDown}
      onclick={tapClick}
    >
      {#key bpm}<span class="led" style:--beat="{60 / bpm}s" aria-hidden="true"></span>{/key}
      <span class="what">
        <span class="name">Tap</span>
        {#if big}<span class="bpm">{shown(bpm)} <small>BPM</small></span>{:else}<span class="sub">Tempo</span>{/if}
      </span>
    </button>
    {#if !big}
      <label class="field">
        <input
          type="number"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step="1"
          value={shown(bpm)}
          aria-label="Tempo in BPM"
          onchange={typed}
          onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <span>BPM</span>
      </label>
    {/if}
    {#if key}<kbd class="key" aria-hidden="true">{keyLabel(key)}</kbd>{/if}
  </div>
{/if}

<style>
  .tempo {
    position: relative;
    display: flex;
    align-items: stretch;
    width: 168px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel-2);
  }
  .tap {
    all: unset;
    box-sizing: border-box;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 4px 9px 10px;
    cursor: pointer;
    border-radius: 10px 0 0 10px;
    touch-action: manipulation;
    user-select: none;
  }
  .tap:active { background: var(--panel); }
  .tap:focus-visible { outline: 2px solid var(--focus); }
  .led {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--knob-track);
    animation: beat var(--beat) steps(1, end) infinite;
  }
  @keyframes beat {
    0% { background: var(--error); box-shadow: 0 0 8px var(--error); }
    20% { background: var(--knob-track); box-shadow: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .led { animation: none; }
  }
  .what { display: grid; line-height: 1.25; }
  .name { font-size: 13px; font-weight: 600; }
  .sub { font-size: 11px; color: var(--muted); }
  .field {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 14px 0;
    font-size: 11px;
    color: var(--muted);
  }
  input {
    width: 52px;
    font: 600 14px var(--mono);
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 4px;
    text-align: right;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input::-webkit-inner-spin-button, input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .key {
    position: absolute;
    right: 8px;
    bottom: 7px;
    min-width: 1.5em;
    padding: 0 4px;
    font: 600 11px/16px var(--mono);
    text-align: center;
    color: var(--text);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    pointer-events: none;
  }
  .big { width: 100%; }
  .big .tap { padding: 18px; gap: 14px; border-radius: 10px; }
  .big .led { width: 18px; height: 18px; }
  .big .name { font-size: 20px; }
  .big .bpm { font: 600 18px var(--mono); }
  .big .bpm small { font-family: inherit; font-size: 12px; font-weight: 400; color: var(--muted); }
</style>
