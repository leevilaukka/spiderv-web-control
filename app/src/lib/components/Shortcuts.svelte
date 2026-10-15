<script lang="ts">
  // Footswitch-style buttons for the channel switch and the preset's
  // shortcuts. `big` is the stage view's copy, which leaves keys and editing
  // to the one on the main page.
  import { amp } from '../amp.svelte';
  import { shortcuts } from '../shortcuts.svelte';
  import { type Shortcut, knobControl } from '../shortcuts';
  import { displayScale } from '../tone';
  import { keyLabel } from '../keys.svelte';
  import { groupColor } from '../colors';
  import ShortcutDialog from './ShortcutDialog.svelte';
  import Channels from './Channels.svelte';
  import { controls } from '../controls.svelte';

  let { big = false }: { big?: boolean } = $props();

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

  const ignored = (e: KeyboardEvent) =>
    e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented ||
    !!(e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable], [role="slider"]');

  function onkeydown(e: KeyboardEvent) {
    if (big || e.repeat || ignored(e) || controls.taken[e.code]) return;
    const s = shortcuts.list.find((x) => x.key === e.code);
    if (!s) return;
    e.preventDefault();
    shortcuts.press(s);
  }

  function onkeyup(e: KeyboardEvent) {
    if (big) return;
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

<section class="shortcuts" class:big aria-label="Shortcuts">
  <Channels {big} />
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
        <span class="name">{s.name}{#if s.momentary}<span class="mode">· hold</span>{/if}{#if s.midi}<span class="mode">· {s.midi.expression ? 'EXP' : 'CC'} {s.midi.cc}</span>{/if}</span>
        <span class="targets">
          {#each s.targets as t (t.sym)}
            {@const slot = slotOf(t.sym)}
            <span class="target" class:off={!t.on} class:missing={!slot?.enable} style:--c={groupColor(slot?.group ?? 'fixed')}>
              {slot?.label ?? t.sym}
            </span>
          {/each}
          {#each s.knobs as k (k.sym + k.param)}
            {@const slot = slotOf(k.sym)}
            <span class="target knob" class:missing={!knobControl(amp.chain, k.sym, k.param)} style:--c={groupColor(slot?.group ?? 'fixed')}>
              {knobText(k)}
            </span>
          {/each}
        </span>
      </button>
      {#if !big}<button class="edit" aria-label="Edit {s.name}" title="Edit" onclick={() => shortcuts.edit(s)}>✎</button>{/if}
      {#if s.key}<kbd class="key" aria-hidden="true">{keyLabel(s.key)}</kbd>{/if}
    </div>
  {/each}
  {#if !big}
    <button class="add" onclick={() => shortcuts.create()}>
      <span><span aria-hidden="true">+</span> Shortcut</span>
      {#if !shortcuts.list.length}<small>Switch blocks and knobs with one key</small>{/if}
    </button>
  {/if}
</section>

{#if !big}<ShortcutDialog />{/if}

<style>
  .shortcuts {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 14px;
  }
  .fs {
    position: relative;
    width: 168px;
    border-radius: 10px;
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
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px 8px;
    width: 100%;
    padding: 9px 30px 9px 10px;
    cursor: pointer;
    border-radius: 10px;
    touch-action: manipulation;
    user-select: none;
  }
  .press:focus-visible { outline: 2px solid var(--focus); }
  .led {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent) 60%, var(--muted));
  }
  .engaged .led {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 9px var(--accent);
  }
  .name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mode { font-weight: 400; color: var(--muted); margin-left: 0.35em; }
  .targets {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-right: 4px;
  }
  /* Filled: switched on when engaged. Outlined and struck: switched off. */
  .target {
    font-size: 11px;
    line-height: 16px;
    padding: 0 6px;
    border-radius: 4px;
    color: var(--text);
    background: color-mix(in srgb, var(--c) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  }
  .target.off {
    background: transparent;
    color: var(--muted);
    text-decoration: line-through;
  }
  .target.missing { opacity: 0.45; }
  .target.knob { background: transparent; border-style: dashed; }

  .big { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .big :global(.ch), .big .fs { width: auto; }
  .big .press { padding: 18px 40px 18px 18px; gap: 10px 12px; }
  .big .led { width: 18px; height: 18px; }
  .big .name { font-size: 20px; }
  .big .target { font-size: 13px; line-height: 20px; }
  .big .key { font-size: 13px; line-height: 20px; right: 12px; bottom: 12px; }
  .edit {
    all: unset;
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    font-size: 13px;
    color: var(--muted);
    border-radius: 5px;
    cursor: pointer;
  }
  .edit:hover { color: var(--text); background: var(--panel-2); }
  .edit:focus-visible { outline: 2px solid var(--focus); }
  .key {
    position: absolute;
    right: 8px;
    bottom: 7px;
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
  .engaged .key { color: var(--text); }
  .add {
    display: grid;
    align-content: center;
    gap: 2px;
    min-height: 58px;
    padding: 8px 14px;
    font: inherit;
    font-size: 13px;
    color: var(--muted);
    background: transparent;
    border: 1px dashed var(--line);
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
  }
  .add:hover { color: var(--text); border-color: var(--muted); }
  .add:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .add small { font-size: 11px; }

  @media (max-width: 760px) {
    .fs { width: calc(50% - 5px); }
  }
</style>
