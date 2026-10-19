<script lang="ts">
  // The preset's tempo with a tap switch, like a GX-100's CTL set to tap.
  // The LED blinks on the beat. Styled as a footswitch by Shortcuts.
  import { amp } from '../amp.svelte';
  import { controls } from '../controls.svelte';
  import { keyLabel } from '../keys.svelte';
  import { MAX_TEMPO, MIN_TEMPO } from '../tone';

  let { variant = 'bar' }: { variant?: 'bar' | 'strip' | 'big' } = $props();

  const key = $derived(controls.settings.tapKey);
  const shown = (bpm: number) => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

  function onkeydown(e: KeyboardEvent) {
    if (!key || e.code !== key || amp.tempo === null) return;
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
  <div class="fsw tempo {variant}">
    <button
      class="fsw-press"
      aria-label="Tap tempo, {shown(bpm)} BPM"
      aria-keyshortcuts={key ? keyLabel(key) : undefined}
      title="Tap at least twice to set the tempo{key ? ` (key ${keyLabel(key)})` : ''}"
      onpointerdown={tapDown}
      onclick={tapClick}
    >
      {#key bpm}<span class="led" style:--beat="{60 / bpm}s" aria-hidden="true"></span>{/key}
      <span class="what">
        <span class="name">Tap</span>
        {#if variant !== 'bar'}<span class="bpm">{shown(bpm)}{variant === 'big' ? ' BPM' : ''}</span>{/if}
      </span>
    </button>
    {#if variant === 'bar'}
      <label class="field">
        <input
          type="number"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step="1"
          value={shown(bpm)}
          style:width="{shown(bpm).length + 0.4}ch"
          aria-label="Tempo in BPM"
          onchange={typed}
          onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <span>BPM</span>
      </label>
      {#if key}<kbd class="key" aria-hidden="true">{keyLabel(key)}</kbd>{/if}
    {/if}
  </div>
{/if}

<style>
  .tempo { width: 170px; }
  .tempo.strip { width: auto; }
  .tempo.big { width: auto; }
  .fsw-press { align-self: stretch; }
  .bar .fsw-press { padding-right: 0; }
  .fsw-press:active { background: var(--panel); }
  .led {
    flex: none;
    width: 12px;
    height: 12px;
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
  .what { display: grid; line-height: 1.2; }
  .name { font-size: 14px; font-weight: 600; }
  .bpm { font: 600 12px var(--mono); color: var(--muted); }
  /* The tempo reads like the switch's caption but can be typed into. */
  .field {
    position: absolute;
    left: 38px;
    bottom: 11px;
    display: flex;
    align-items: baseline;
    gap: 4px;
    font: 600 12px var(--mono);
    color: var(--muted);
  }
  input {
    margin: 0 -2px;
    padding: 0 2px;
    font: inherit;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 4px;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  input:hover, input:focus { color: var(--text); background: var(--panel); }
  input::-webkit-inner-spin-button, input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .bar .what { align-self: flex-start; margin-top: 10px; }
  .key {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    padding: 0 5px;
    font: 600 11px/16px var(--mono);
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    pointer-events: none;
  }
  .strip .led { width: 10px; height: 10px; }
  .strip .what { display: flex; align-items: baseline; gap: 8px; }
  .big .led { width: 16px; height: 16px; }
  .big .name { font-size: 17px; font-weight: 700; }
</style>
