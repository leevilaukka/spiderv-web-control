<script lang="ts">
  import { amp } from '../amp.svelte';
  import { type Slot, catalog, shortModelName } from '../tone';
  import { groupColor } from '../colors';
  import { BLOCK_KEYS, GROUP_OF } from '../shortcuts';
  import { keyLabel } from '../keys.svelte';
  import { controls } from '../controls.svelte';
  import type { ChannelId } from '../channels';
  import { type Arrangement, MOVABLE, chainOrder, dropTargets } from '../arrange';

  const postSwitch = (s: Slot) => s.extras.find((c) => c.label === 'Post amp');
  const isPost = (s: Slot) => !!postSwitch(s)?.value;

  // Signal order: pre-amp effects, amp + cab, post-amp effects.
  const posts = $derived(Object.fromEntries(amp.chain.filter((s) => postSwitch(s)).map((s) => [s.sym, isPost(s)])));
  const ordered = $derived(
    chainOrder(amp.chain.map((s) => s.sym), posts).map((sym) => amp.chain.find((s) => s.sym === sym)!),
  );

  // With channels A/B the chain splits like the GX-100's divider: blocks in
  // the channels get a lane each (A above B), the rest stay on the main line.
  // The active lane is the live tone; the other shows its stored settings.
  const split = $derived.by(() => {
    const ch = amp.channels;
    if (!ch) return null;
    const inCh = (s: Slot) => ch.groups.includes(GROUP_OF[s.sym]);
    const first = ordered.findIndex(inCh);
    if (first < 0) return null;
    const last = ordered.findLastIndex(inCh);
    // Grid columns: the blocks, plus the A/B column where the chain splits.
    const cols = ordered.map(() => 'minmax(86px, 1fr)');
    cols.splice(first, 0, 'auto');
    return { ch, inCh, first, last, cols: cols.join(' ') };
  });
  const col = (i: number) => (split && i >= split.first ? i + 2 : i + 1);
  const rowOf = (c: ChannelId) => (c === 'A' ? 1 : 2);
  const inactive = $derived(split ? (split.ch.active === 'A' ? 'B' : 'A') : 'B');

  // The inactive channel's version of a block, from its stored settings.
  function ghost(slot: Slot) {
    const g = GROUP_OF[slot.sym];
    const t = split?.ch.other[g] ?? {};
    const model = String(t['@model'] ?? slot.modelSym);
    const post = t['@post'] === undefined || !postSwitch(slot) ? undefined : !!t['@post'];
    return {
      group: g,
      name: model === '@NoCabinet' ? 'No cabinet' : shortModelName(model),
      color: groupColor(catalog.models[model]?.group ?? slot.group),
      on: t['@enabled'] !== false,
      moved: post !== undefined && post !== isPost(slot) ? (post ? 'post' : 'pre') : '',
    };
  }

  async function switchTo(sym: string) {
    await amp.switchChannel();
    amp.selected = sym;
  }

  // ------------------------------------------------------------ moving blocks
  // Effects, the reverb and the volume pedal can be dragged to the places the
  // amp allows (see arrange.ts); Alt+←/→ does the same from the keyboard.
  // Blocks in channels A/B stay put, since each channel keeps its own.

  let list: HTMLOListElement | undefined = $state();
  type Target = { gap: number; seq: string[]; arrangement: Arrangement };
  let drag = $state<{ sym: string; x0: number; y0: number; s0: number; dx: number; dy: number; targets: Target[]; gaps: number[]; at: Target | null } | null>(null);
  let pointerX = 0, scrollFrame = 0;
  let press: { sym: string; x: number; y: number; touch: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
  let suppressClick = false;

  const locked = $derived(new Set(split ? ordered.filter((s) => split!.inCh(s)).map((s) => s.sym) : []));
  const movable = (sym: string) => MOVABLE.has(sym) && !locked.has(sym);
  const order = $derived(ordered.map((s) => s.sym));
  const targetsFor = (sym: string) => dropTargets(order, sym, posts, locked);

  // Where a gap between blocks is, in the list's scrolled coordinates.
  function gapX(rest: string[], gap: number): number {
    const r = (sym: string) => list!.querySelector(`[data-sym="${sym}"]`)!.getBoundingClientRect();
    const x = gap === 0 ? r(rest[0]).left - 6 : gap === rest.length ? r(rest[gap - 1]).right + 6 : (r(rest[gap - 1]).right + r(rest[gap]).left) / 2;
    return x - list!.getBoundingClientRect().left + list!.scrollLeft;
  }

  function start(sym: string, x0: number, y0: number) {
    press = null;
    drag = { sym, x0, y0, s0: list?.scrollLeft ?? 0, dx: 0, dy: 0, targets: targetsFor(sym), gaps: [], at: null };
    pointerX = x0;
    place(sym);
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  // While a drag is held near either end of the chain, keep scrolling it.
  function autoScroll() {
    if (!drag || !list) return;
    const r = list.getBoundingClientRect();
    const edge = 48;
    const speed = pointerX < r.left + edge ? -(r.left + edge - pointerX) : pointerX > r.right - edge ? pointerX - (r.right - edge) : 0;
    if (speed) {
      const before = list.scrollLeft;
      list.scrollLeft += Math.max(-16, Math.min(16, speed / 3));
      if (list.scrollLeft !== before) aim();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  // Picks the allowed gap nearest the pointer.
  function aim() {
    if (!drag || !list) return;
    // The tile scrolls with the list; keep it under the pointer.
    drag.dx = pointerX - drag.x0 + list.scrollLeft - drag.s0;
    place(drag.sym);
    const lr = list.getBoundingClientRect();
    const width = list.querySelector(`[data-sym="${drag.sym}"]`)!.getBoundingClientRect().width;
    const x = pointerX - lr.left + list.scrollLeft;
    let best = -1, dist = Infinity;
    drag.gaps.forEach((g, i) => { const d = Math.abs(g - x); if (d < dist) { dist = d; best = i; } });
    drag.at = best >= 0 && dist < Math.max(90, width) ? drag.targets[best] : null;
  }

  // Positions of the allowed gaps (they move when the list scrolls).
  function place(sym: string) {
    if (!drag || !list) return;
    const rest = order.filter((s) => s !== sym);
    drag.gaps = drag.targets.map((t) => gapX(rest, t.gap));
  }

  function onpointerdown(e: PointerEvent, sym: string) {
    if (e.button !== 0 || !movable(sym) || amp.arranging || amp.switching) return;
    const touch = e.pointerType !== 'mouse';
    press = { sym, x: e.clientX, y: e.clientY, touch };
    // On touch a long press starts the drag, so a swipe still scrolls the chain.
    if (touch) press.timer = setTimeout(() => press && start(press.sym, press.x, press.y), 350);
  }

  function onpointermove(e: PointerEvent) {
    if (press && !drag) {
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (press.touch && far > 8) { clearTimeout(press.timer); press = null; }
      else if (!press.touch && far > 5) start(press.sym, press.x, press.y);
    }
    if (!drag) return;
    drag.dy = e.clientY - drag.y0;
    pointerX = e.clientX;
    aim();
  }

  function onpointerup() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    if (!drag) return;
    cancelAnimationFrame(scrollFrame);
    const at = drag.at;
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false));
    if (at) amp.rearrange(at.arrangement);
  }

  function moveBy(sym: string, dir: -1 | 1) {
    const i = order.indexOf(sym);
    const options = targetsFor(sym).map((t) => ({ t, at: t.seq.indexOf(sym) })).filter((o) => (dir < 0 ? o.at < i : o.at > i));
    if (!options.length) return;
    options.sort((a, b) => (dir < 0 ? b.at - a.at : a.at - b.at));
    amp.rearrange(options[0].t.arrangement);
  }

  function tileKeydown(e: KeyboardEvent, sym: string) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !movable(sym)) return;
    e.preventDefault();
    moveBy(sym, e.key === 'ArrowLeft' ? -1 : 1);
  }

  // A drag mustn't scroll the page on touch screens.
  $effect(() => {
    if (!list) return;
    const el = list;
    const block = (e: TouchEvent) => { if (drag) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  });

  const codeOf = Object.fromEntries(Object.entries(BLOCK_KEYS).map(([code, sym]) => [sym, code]));

  function onkeydown(e: KeyboardEvent) {
    // In the stage view's memory mode the number keys pick presets instead.
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented || controls.memoryKeys) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable]')) return;
    const slot = amp.chain.find((s) => s.sym === BLOCK_KEYS[e.code]);
    if (!slot?.enable) return;
    e.preventDefault();
    amp.toggle(slot);
  }
</script>

<svelte:window {onkeydown} {onpointermove} {onpointerup} onpointercancel={onpointerup} onblur={onpointerup} />

{#snippet live(slot: Slot, column: number, row: string)}
  {@const on = !!slot.enable?.value}
  {@const code = codeOf[slot.sym]}
  {@const canMove = movable(slot.sym)}
  {@const dragging = drag?.sym === slot.sym}
  <li
    class="block"
    class:on
    class:selected={amp.selected === slot.sym}
    class:movable={canMove}
    class:dragging
    data-sym={slot.sym}
    style:--c={groupColor(slot.group)}
    style:transform={dragging ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined}
    onpointerdown={(e) => onpointerdown(e, slot.sym)}
    onclickcapture={(e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }}
    oncontextmenu={(e) => { if (canMove && (press || drag)) e.preventDefault(); }}
    style:grid-column={split ? column : undefined}
    style:grid-row={split ? row : undefined}
    class:shared={split && row === '1 / span 2'}
  >
    <button
      class="select"
      onclick={() => (amp.selected = slot.sym)}
      onkeydown={(e) => tileKeydown(e, slot.sym)}
      aria-current={amp.selected === slot.sym}
      aria-keyshortcuts={canMove ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
      title={canMove ? 'Drag to move it in the chain (or Alt+← →)' : undefined}
    >
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
{/snippet}

<ol class="chain" class:split={!!split} class:busy={amp.arranging} bind:this={list} style:grid-template-columns={split?.cols} aria-label="Signal chain">
  {#if drag}
    {#each drag.gaps as x, i (i)}
      <li class="gap" class:at={drag.at === drag.targets[i]} style:left="{x}px" aria-hidden="true"></li>
    {/each}
  {/if}
  {#each ordered as slot, i (slot.sym)}
    {#if split && i === split.first}
      {#each ['A', 'B'] as const as c (c)}
        {@const active = split.ch.active === c}
        <li class="lane" class:active aria-hidden="true" style:grid-column="{col(split.first) - 1} / {col(split.last) + 1}" style:grid-row={rowOf(c)}></li>
        <li class="letter-cell" style:grid-column={col(split.first) - 1} style:grid-row={rowOf(c)}>
          <button
            class="letter"
            class:active
            disabled={amp.switching}
            aria-pressed={active}
            aria-label="Channel {c}{active ? ' (active)' : ''}"
            title={active ? `Channel ${c} is playing` : `Switch to channel ${c}${controls.settings.channelKey ? ` (key ${keyLabel(controls.settings.channelKey)})` : ''}`}
            onclick={() => !active && amp.switchChannel()}
          >{c}</button>
        </li>
      {/each}
    {/if}
    {#if split?.inCh(slot)}
      {@render live(slot, col(i), String(rowOf(split.ch.active)))}
      {@const g = ghost(slot)}
      <li class="block ghost" class:on={g.on} style:--c={g.color} style:grid-column={col(i)} style:grid-row={rowOf(inactive)}>
        <button class="select" title="Switch to channel {inactive}" onclick={() => switchTo(slot.sym)}>
          <span class="slot">{slot.label}{#if g.moved}<span class="moved">· {g.moved}</span>{/if}</span>
          <span class="model">{g.name}</span>
        </button>
        {#if slot.enable}
          <button
            class="power"
            aria-label="{slot.label} on channel {inactive} {g.on ? 'on' : 'off'}"
            aria-pressed={g.on}
            title="On/off in channel {inactive}"
            onclick={() => amp.setOtherSetting(g.group, '@enabled', !g.on)}
          ></button>
        {/if}
      </li>
    {:else}
      {@render live(slot, col(i), '1 / span 2')}
    {/if}
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

  /* Moving blocks. */
  .chain { position: relative; }
  .block.movable { cursor: grab; -webkit-touch-callout: none; user-select: none; }
  .block.movable .select { cursor: grab; }
  .block.dragging {
    z-index: 5;
    background: var(--panel-2);
    cursor: grabbing;
    opacity: 0.9;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    transition: none;
    pointer-events: none;
  }
  .block.dragging::after { display: none; }
  .gap {
    position: absolute;
    top: 4px;
    bottom: 12px;
    width: 4px;
    margin-left: -2px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    pointer-events: none;
    z-index: 4;
  }
  .gap.at {
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .busy { opacity: 0.7; pointer-events: none; }

  /* Split view for channels A/B. */
  .chain.split {
    display: grid;
    grid-template-rows: auto auto;
    gap: 10px 12px;
  }
  .split .block { min-width: 0; max-width: none; z-index: 1; }
  .split .block.shared { align-self: center; }
  .split .block::after { display: none; }
  .lane {
    margin: -5px -6px;
    border-radius: 13px;
    border: 1px dashed var(--line);
    pointer-events: none;
  }
  .lane.active {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .letter-cell { display: grid; place-items: center; z-index: 1; padding-left: 2px; }
  .letter {
    width: 26px;
    height: 26px;
    padding: 0;
    font: 700 13px/1 var(--mono);
    color: var(--muted);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
  }
  .letter.active {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
    cursor: default;
  }
  .letter:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .ghost {
    opacity: 0.6;
    border-style: dashed;
    border-top-style: solid;
  }
  .ghost:hover, .ghost:focus-within { opacity: 0.85; }
  .moved { margin-left: 0.35em; text-transform: none; letter-spacing: 0; }
</style>
