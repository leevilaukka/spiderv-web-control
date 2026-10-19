<script lang="ts">
  // Footswitch-style buttons for tap tempo, the channel switch and the preset's
  // shortcuts. `bar` is the footer on wide screens, `strip` the row under a
  // phone's editor and `big` the phone's play view. Only one is on screen at
  // a time, and it handles the keys.
  import { amp } from '../amp.svelte';
  import { shortcuts } from '../shortcuts.svelte';
  import { type Shortcut, knobControl } from '../shortcuts';
  import { displayScale } from '../tone';
  import { keyLabel } from '../keys.svelte';
  import Channels from './Channels.svelte';
  import Tempo from './Tempo.svelte';
  import { controls } from '../controls.svelte';

  type Variant = 'bar' | 'strip' | 'big';
  let { variant = 'bar' }: { variant?: Variant } = $props();

  const slotOf = (sym: string) => amp.chain.find((s) => s.sym === sym);
  const knobText = (k: Shortcut['knobs'][number]) => {
    const c = knobControl(amp.chain, k.sym, k.param);
    const f = (v: number) => String(Math.round(v * (c ? displayScale(c) : 1) * 10) / 10);
    return `${c?.label ?? k.param} ${f(k.off)}→${f(k.on)}`;
  };
  const describe = (s: Shortcut) => [
    ...s.targets.map((t) => `${slotOf(t.sym)?.label ?? t.sym} ${t.on ? 'on' : 'off'}`),
    ...s.knobs.map((k) => `${slotOf(k.sym)?.label ?? k.sym} ${knobText(k)}`),
  ].join(', ');
  // One line: "FX 1 + FX 3 on, Reverb off, Amp Drive 5→8".
  const summary = (s: Shortcut) => {
    const label = (sym: string) => slotOf(sym)?.label ?? sym;
    const side = (on: boolean) => s.targets.filter((t) => t.on === on).map((t) => label(t.sym)).join(' + ');
    return [
      ...[true, false].flatMap((on) => (side(on) ? [`${side(on)} ${on ? 'on' : 'off'}`] : [])),
      ...s.knobs.map((k) => `${label(k.sym)} ${knobText(k)}`),
    ].join(', ') || 'Nothing assigned yet';
  };

  const ignored = (e: KeyboardEvent) =>
    e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented ||
    !!(e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable], [role="slider"]');

  function onkeydown(e: KeyboardEvent) {
    if (e.repeat || ignored(e) || controls.taken[e.code]) return;
    const s = shortcuts.list.find((x) => x.key === e.code);
    if (!s) return;
    e.preventDefault();
    shortcuts.press(s);
  }

  function onkeyup(e: KeyboardEvent) {
    const s = shortcuts.list.find((x) => x.key === e.code);
    if (s) shortcuts.release(s);
  }

  // Momentary shortcuts follow the pointer or Space/Enter while held.
  const hold = (s: Shortcut) => ({
    onpointerdown: (e: PointerEvent) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); shortcuts.press(s); },
    onpointerup: () => shortcuts.release(s),
    onpointercancel: () => shortcuts.release(s),
    onkeydown: (e: KeyboardEvent) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); shortcuts.press(s); } },
    onkeyup: (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') shortcuts.release(s); },
  });
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => shortcuts.releaseAll()} />

<section class="shortcuts {variant}" aria-label="Footswitches">
  <Tempo {variant} />
  <Channels {variant} />
  {#each shortcuts.list as s (s.id)}
    {@const engaged = shortcuts.engaged(s)}
    <div class="fs" class:engaged>
      <button
        class="press"
        aria-pressed={engaged}
        aria-keyshortcuts={s.key ? keyLabel(s.key) : undefined}
        title="{describe(s)}{s.momentary ? ' while held' : ''}{s.key ? ` (key ${keyLabel(s.key)})` : ''}"
        {...s.momentary ? hold(s) : { onclick: () => shortcuts.press(s) }}
      >
        <span class="led" aria-hidden="true"></span>
        <span class="name">{s.name}{#if variant !== 'strip'}{#if s.momentary}<span class="mode">· hold</span>{/if}{#if s.midi}<span class="mode">· {s.midi.expression ? 'EXP' : 'CC'} {s.midi.cc}</span>{/if}{/if}</span>
        {#if variant === 'bar' && s.key}<kbd class="key" aria-hidden="true">{keyLabel(s.key)}</kbd>{/if}
        {#if variant !== 'strip'}<span class="desc">{summary(s)}</span>{/if}
      </button>
      <button class="edit" aria-label="Edit {s.name}" title="Edit" onclick={() => shortcuts.edit(s)}>✎</button>
    </div>
  {/each}
  <button class="add" onclick={() => shortcuts.create()} title="Switch blocks and knobs with one key or footswitch">
    <span aria-hidden="true">+</span> Shortcut
  </button>
</section>

<style>
  .shortcuts {
    display: flex;
    align-items: stretch;
    gap: 10px;
    min-width: 0;
  }
  /* Shared footswitch look, also used by Tempo and Channels. */
  .shortcuts :global(.fsw) {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    height: 60px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .shortcuts :global(.fsw-press) {
    all: unset;
    box-sizing: border-box;
    flex: 1;
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 0 14px;
    cursor: pointer;
    border-radius: 12px;
    touch-action: manipulation;
    user-select: none;
  }
  .shortcuts :global(.fsw-press:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
  .shortcuts :global(.fsw-edit) {
    all: unset;
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--muted);
    border-radius: 5px;
    cursor: pointer;
  }
  .shortcuts :global(.fsw-edit:hover) { color: var(--text); background: var(--panel); }
  .shortcuts :global(.fsw-edit:focus-visible) { outline: 2px solid var(--focus); }
  /* With a mouse, edit buttons show on hover. */
  @media (hover: hover) {
    .shortcuts :global(.fsw-edit), .edit { opacity: 0; }
    .shortcuts :global(.fsw:hover .fsw-edit), .shortcuts :global(.fsw-edit:focus-visible), .fs:hover .edit, .edit:focus-visible { opacity: 1; }
  }

  .fs {
    position: relative;
    flex: none;
    width: 200px;
    height: 60px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: transparent;
    transition: border-color 0.15s, background 0.15s;
  }
  .fs.engaged {
    background: var(--panel-2);
    border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
  }
  .press {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    align-content: center;
    gap: 4px 10px;
    width: 100%;
    height: 100%;
    padding: 0 14px;
    cursor: pointer;
    border-radius: 12px;
    touch-action: manipulation;
    user-select: none;
  }
  .press:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .led {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent) 60%, var(--muted));
  }
  .engaged .led {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 9px var(--accent);
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mode { font-weight: 400; color: var(--muted); margin-left: 0.35em; }
  .desc {
    grid-column: 2 / -1;
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .key {
    padding: 0 5px;
    font: 600 11px/16px var(--mono);
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .engaged .key { color: var(--text); }
  .edit {
    all: unset;
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--muted);
    border-radius: 5px;
    cursor: pointer;
  }
  .edit:hover { color: var(--text); background: var(--panel-2); }
  .edit:focus-visible { outline: 2px solid var(--focus); }
  .add {
    flex: none;
    height: 60px;
    padding: 0 16px;
    font: inherit;
    font-size: 13px;
    color: var(--muted);
    background: transparent;
    border: 1px dashed var(--line);
    border-radius: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .add:hover { color: var(--text); border-color: var(--muted); }
  .add:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* Phone strip: compact pills in a swipeable row, edit buttons beside the
     name and the add buttons last. */
  .strip { gap: 8px; overflow-x: auto; scrollbar-width: none; }
  .strip :global(.fsw), .strip .fs { height: 48px; }
  .strip :global(.fsw-press) { gap: 8px; }
  .strip .fs { width: auto; display: flex; align-items: center; }
  .strip .press { display: flex; gap: 8px; width: auto; padding-right: 4px; }
  .strip .led { width: 10px; height: 10px; }
  .strip :global(.fsw-edit), .strip .edit { position: static; flex: none; width: 32px; height: 32px; margin-right: 6px; }
  .strip .add { order: 1; height: 48px; padding: 0 14px; }

  /* Phone play view: big switches, two to a row. */
  .big {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .big :global(.fsw), .big .fs { width: auto; height: auto; min-height: 64px; border-radius: 14px; }
  .big .press { grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; padding: 10px 14px; }
  .big .led { width: 16px; height: 16px; grid-row: span 2; }
  .big .name { font-size: 17px; font-weight: 700; }
  .big .desc { grid-column: 2; font-size: 12px; white-space: normal; }
  .big .add { height: auto; min-height: 64px; border-radius: 14px; }
</style>
