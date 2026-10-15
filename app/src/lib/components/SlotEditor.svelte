<script lang="ts">
  import { amp } from '../amp.svelte';
  import { type Control, type Slot, MICS, modelChoices } from '../tone';
  import { MsgType } from '../protocol/codec';
  import { groupColor } from '../colors';
  import Knob from './Knob.svelte';
  import Switch from './Switch.svelte';
  import Stepper from './Stepper.svelte';

  let { slot }: { slot: Slot } = $props();

  const choices = $derived(slot.list && amp.client?.symbols ? modelChoices(slot.list, amp.client.symbols) : []);
  const cab = $derived(slot.sym === 'StudioCab' ? amp.cabOf(slot) : null);
  const cabValue = $derived(cab ? (slot.modelSym === 'NoCabinet' ? '@NoCabinet' : cab.cab) : '');
  const color = $derived(groupColor(slot.group));
  const on = $derived(!!slot.enable?.value);

  // Heading for the block's extra controls (mix/routing, amp output, room).
  const extrasTitle = $derived(
    slot.sym === 'Amp' ? 'Output' : slot.sym === 'StudioCab' ? 'Room' : slot.sym === 'VolumePedal' ? 'Routing' : 'Mix & routing',
  );
  const byType = (cs: Control[], t: MsgType) => cs.filter((c) => c.type === t);
</script>

{#snippet controls(list: Control[], withDefaults: boolean)}
  {#each byType(list, MsgType.Float) as c (c.key)}
    <Knob value={c.value} min={c.min} max={c.max} def={withDefaults ? c.def : undefined} label={c.label} unit={c.unit} {color} onchange={(v) => amp.set(c, v)} />
  {/each}
  {#each byType(list, MsgType.Int) as c (c.key)}
    <Stepper value={c.value} min={c.min} max={c.max} label={c.label === 'Note' ? 'Note (tempo sync)' : c.label} onchange={(v) => amp.set(c, v)} />
  {/each}
  {#each byType(list, MsgType.Bool) as c (c.key)}
    <div class="switch"><Switch checked={!!c.value} label={c.label} onchange={(v) => amp.set(c, v ? 1 : 0)} /></div>
  {/each}
{/snippet}

<section class="editor" class:off={slot.enable && !on} style:--c={color} aria-labelledby="slot-title">
  <header>
    {#if slot.enable}
      <button
        class="power"
        class:on
        class:light={slot.group === 'cab' || slot.group === 'wah'}
        aria-pressed={on}
        aria-label="{slot.label} {on ? 'on' : 'off'}"
        onclick={() => amp.toggle(slot)}
      >{on ? 'On' : 'Off'}</button>
    {/if}
    <div class="title">
      <span class="slot">{slot.label}</span>
      <h2 id="slot-title">{slot.modelName}</h2>
    </div>

    <div class="pickers">
      {#if slot.list === 'cab' && cab}
        <label class="field">
          <span>Cabinet</span>
          <select value={cabValue} onchange={(e) => amp.changeCab(slot, e.currentTarget.value, cab.mic)}>
            {#each choices as group}
              {#each group.models as m}
                <option value={m.sym}>{m.name}</option>
              {/each}
            {/each}
          </select>
        </label>
        {#if cab.mic >= 0}
          <label class="field">
            <span>Mic</span>
            <select value={cab.mic} onchange={(e) => amp.changeCab(slot, cab.cab, Number(e.currentTarget.value))}>
              {#each MICS as m, i}
                <option value={i}>{m.label}</option>
              {/each}
            </select>
          </label>
        {/if}
      {:else if slot.list}
        <label class="field">
          <span>Model</span>
          <select value={slot.model} onchange={(e) => amp.changeModel(slot, Number(e.currentTarget.value))}>
            {#each choices as group}
              <optgroup label={group.category}>
                {#each group.models as m}
                  <option value={m.id}>{m.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  </header>

  {#if slot.params.length}
    <div class="controls">{@render controls(slot.params, true)}</div>
  {:else if !slot.extras.length}
    <p class="empty">This block has no adjustable settings.</p>
  {/if}

  {#if slot.extras.length}
    <div class="group" class:alone={!slot.params.length}>
      <h3>{extrasTitle}</h3>
      <div class="controls">{@render controls(slot.extras, false)}</div>
    </div>
  {/if}
</section>

<style>
  .editor {
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--c);
    border-radius: 14px;
    padding: 18px 20px 20px;
  }
  .editor.off .controls { opacity: 0.6; }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px 16px;
    margin-bottom: 20px;
  }
  .power {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    background: var(--panel-2);
    border: 2px solid color-mix(in srgb, var(--c) 55%, var(--line));
    cursor: pointer;
  }
  .power.on {
    color: #fff;
    background: var(--c);
    border-color: var(--c);
    box-shadow: 0 0 14px color-mix(in srgb, var(--c) 60%, transparent);
  }
  /* Light block colours (cab grey, wah yellow) need dark text. */
  .power.on.light { color: #16181b; }
  .power:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  .title {
    flex: 1 1 200px;
    min-width: 0;
  }
  .slot {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  h2 {
    margin: 2px 0 0;
    font-size: 22px;
    font-weight: 650;
    line-height: 1.2;
  }
  .pickers {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 10px;
    width: 240px;
    max-width: 100%;
  }
  select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 16px 10px;
    transition: opacity 0.15s;
  }
  .switch {
    display: flex;
    align-items: center;
    height: 64px;
    padding: 0 8px;
  }
  .group {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .group.alone {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
  h3 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  @media (max-width: 760px) {
    .editor { padding: 16px; }
    .pickers, .field, select { width: 100%; }
  }
</style>
