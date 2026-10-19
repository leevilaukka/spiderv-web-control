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
    return { ch, inCh, first, last };
  });

  // The blocks sit in three groups: before the amp, the amp and its cab, and
  // after the amp. Grid columns: a block each, an empty column between
  // groups (which doubles the gap), and the A/B column where the chain splits.
  const ZONES = ['Before amp', 'Amp', 'After amp'];
  const layout = $derived.by(() => {
    const ampAt = ordered.findIndex((s) => s.sym === 'Amp');
    const zones: number[] = ordered.map((s, i) => (s.sym === 'Amp' || s.sym === 'StudioCab' ? 1 : i < ampAt ? 0 : 2));
    const cols: string[] = [];
    const at: number[] = [];
    let letter = 0;
    ordered.forEach((_, i) => {
      if (i > 0 && zones[i] !== zones[i - 1]) cols.push('0px');
      if (split && i === split.first) { cols.push('auto'); letter = cols.length; }
      cols.push('var(--col)');
      at.push(cols.length);
    });
    const groups = ZONES.flatMap((label, z) => {
      const first = zones.indexOf(z);
      return first < 0 ? [] : [{ label, from: at[first], to: at[zones.lastIndexOf(z)] + 1 }];
    });
    return { cols: cols.join(' '), at, letter, groups };
  });
  const col = (i: number) => layout.at[i];
  const rowOf = (c: ChannelId) => (c === 'A' ? 2 : 3);
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

  // Keep the selected block in view, as on phones the row scrolls.
  $effect(() => {
    void amp.selected;
    list?.querySelector('.block.selected')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

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
    // In the play view the number keys pick presets instead.
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
    style:grid-column={column}
    style:grid-row={row}
    class:shared={split && row === '2 / span 2'}
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
        title={code ? `On / off (key ${keyLabel(code)})` : 'On / off'}
        onclick={() => amp.toggle(slot)}
      ><span class="led"></span></button>
      {#if code}<kbd class="key" aria-hidden="true">{keyLabel(code)}</kbd>{/if}
    {/if}
  </li>
{/snippet}

<ol class="chain" class:split={!!split} class:busy={amp.arranging} bind:this={list} style:grid-template-columns={layout.cols} aria-label="Signal chain">
  {#each layout.groups as g (g.label)}
    <li class="group" aria-hidden="true" style:grid-column="{g.from} / {g.to}"><span>{g.label}</span></li>
  {/each}
  {#if drag}
    {#each drag.gaps as x, i (i)}
      <li class="gap" class:at={drag.at === drag.targets[i]} style:left="{x}px" aria-hidden="true"></li>
    {/each}
  {/if}
  {#each ordered as slot, i (slot.sym)}
    {#if split && i === split.first}
      {#each ['A', 'B'] as const as c (c)}
        {@const active = split.ch.active === c}
        <li class="lane" class:active aria-hidden="true" style:grid-column="{layout.letter} / {col(split.last) + 1}" style:grid-row={rowOf(c)}></li>
        <li class="letter-cell" style:grid-column={layout.letter} style:grid-row={rowOf(c)}>
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
          ><span class="led"></span></button>
        {/if}
      </li>
    {:else}
      {@render live(slot, col(i), split ? '2 / span 2' : '2')}
    {/if}
  {/each}
</ol>

<style>
  .chain {
    --col: minmax(86px, 1fr);
    position: relative;
    flex: none;
    list-style: none;
    margin: 0;
    padding: 0 0 4px;
    display: grid;
    grid-template-rows: auto;
    gap: 8px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  /* Group headings: a label and a rule across the group's blocks. */
  .group {
    grid-row: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    white-space: nowrap;
  }
  .group::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .block {
    position: relative;
    min-width: 0;
    height: 112px;
    border-radius: 12px;
    overflow: hidden;
    background: transparent;
    border: 1px solid var(--line);
    scroll-snap-align: start;
    transition: border-color 0.15s, background 0.15s;
  }
  /* The colour strip: full when on, faint when off. */
  .block::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: color-mix(in srgb, var(--c) 30%, transparent);
  }
  .block.on { background: var(--panel-2); }
  .block.on::before { background: var(--c); }
  .block:not(.on) .model { color: var(--muted); }
  .block.selected {
    background: color-mix(in srgb, var(--c) 12%, var(--panel-2));
    border-color: var(--c);
    box-shadow: 0 0 0 1px var(--c);
  }
  .select {
    all: unset;
    box-sizing: border-box;
    display: grid;
    align-content: start;
    gap: 3px;
    width: 100%;
    height: 100%;
    padding: 12px 10px 34px;
    cursor: pointer;
    border-radius: 12px;
  }
  .select:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .slot {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .model {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  /* Off: hollow ring in the block colour. On: filled and glowing. */
  .power {
    position: absolute;
    left: 4px;
    bottom: 4px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }
  .led {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--c) 60%, var(--muted));
  }
  .on .led {
    background: var(--c);
    border-color: var(--c);
    box-shadow: 0 0 9px var(--c);
  }
  .power:focus-visible { outline: 2px solid var(--focus); }
  .key {
    position: absolute;
    right: 8px;
    bottom: 9px;
    font: 600 10px/14px var(--mono);
    color: var(--muted);
    opacity: 0.7;
    pointer-events: none;
  }

  /* Moving blocks. */
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
  .gap {
    position: absolute;
    top: 26px;
    bottom: 4px;
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
  .chain.split { row-gap: 10px; }
  .split .block { z-index: 1; height: 96px; }
  .split .block.shared { align-self: center; }
  .lane {
    margin: -5px -6px;
    border-radius: 15px;
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
  }
  .ghost:hover, .ghost:focus-within { opacity: 0.85; }
  .moved { margin-left: 0.35em; text-transform: none; letter-spacing: 0; }

  /* Phones: a swipeable row of smaller blocks, without group headings. */
  @media (max-width: 760px) {
    .chain { --col: 92px; row-gap: 0; padding: 2px 12px 12px; scrollbar-width: none; scroll-padding: 0 12px; }
    .chain.split { row-gap: 10px; }
    .group { display: none; }
    .block, .split .block { height: 80px; }
    .select { gap: 1px; padding: 9px 8px 8px; }
    .slot { font-size: 10px; }
    .model { font-size: 12px; line-height: 1.2; -webkit-line-clamp: 2; line-clamp: 2; }
    .power { left: auto; right: 0; bottom: 0; width: 36px; height: 32px; border-radius: 0; }
    .led { width: 12px; height: 12px; }
    .key { display: none; }
    .gap { top: 2px; bottom: 12px; }
  }
</style>
