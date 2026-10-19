<script lang="ts">
  import { amp } from '../amp.svelte';
  import { type Control, type Slot, MICS, isTestingCategory, modelChoices, noteChoices } from '../tone';
  import { MsgType } from 'spiderv-protocol/codec';
  import { groupColor } from '../colors';
  import Knob from './Knob.svelte';
  import Switch from './Switch.svelte';
  import Stepper from './Stepper.svelte';
  import { catalogStore } from '../catalog.svelte';
  import { ui } from '../ui.svelte';

  let { slot }: { slot: Slot } = $props();

  const allChoices = $derived(catalogStore.version >= 0 && slot.list && amp.client?.symbols ? modelChoices(slot.list, amp.client.symbols) : []);
  const testing = $derived(allChoices.filter((g) => isTestingCategory(g.category)));
  const choices = $derived(catalogStore.showTesting ? allChoices : allChoices.filter((g) => !isTestingCategory(g.category)));
  // Without the model catalog the model lists are unknown.
  const noList = $derived(!!slot.list && !choices.length);
  const cab = $derived(slot.sym === 'StudioCab' ? amp.cabOf(slot) : null);
  const cabValue = $derived(cab ? (slot.modelSym === 'NoCabinet' ? '@NoCabinet' : cab.cab) : '');
  const color = $derived(groupColor(slot.group));
  const on = $derived(!!slot.enable?.value);
  const modelCount = $derived(choices.reduce((n, g) => n + g.models.length, 0));

  // The model list belongs to the block it was opened for, so it closes when
  // another block is picked.
  let pickingFor = $state<string | null>(null);
  const picking = $derived(!!slot.list && !noList && pickingFor === slot.sym);
  type Choice = (typeof choices)[number]['models'][number];
  const isCurrent = (m: Choice) => (cab ? m.sym === cabValue : m.id === slot.model);
  function pick(m: Choice) {
    if (cab) amp.changeCab(slot, m.sym, cab.mic);
    else amp.changeModel(slot, m.id);
  }

  let sheet: HTMLDialogElement | undefined = $state();
  $effect(() => {
    if (!sheet) return;
    if (picking && !sheet.open) sheet.showModal();
    else if (!picking && sheet.open) sheet.close();
  });

  // Heading for the block's extra controls (mix/routing, amp output, room).
  const extrasTitle = $derived(
    slot.sym === 'Amp' ? 'Output' : slot.sym === 'StudioCab' ? 'Room' : slot.sym === 'VolumePedal' ? 'Routing' : 'Mix & routing',
  );
  const hasExtras = $derived(!!slot.extras.length || !!cab);
  const byType = (cs: Control[], t: MsgType) => cs.filter((c) => c.type === t);
  const synced = $derived(!!slot.sync && slot.sync.c.value > 0);
  // The knob that tempo sync replaces while it is on.
  const follows = (c: Control) => synced && c.sym === slot.sync?.synced;
</script>

{#snippet knobs(list: Control[], withDefaults: boolean)}
  {#each byType(list, MsgType.Float) as c (c.key)}
    <div class="knob" class:follows={follows(c)} title={follows(c) ? `Tempo sync sets the ${c.label.toLowerCase()} while it is on` : undefined}>
      <Knob value={c.value} min={c.min} max={c.max} def={withDefaults ? c.def : undefined} label={c.label} unit={c.unit} {color} onchange={(v) => amp.set(c, v)} />
    </div>
  {/each}
  {#each byType(list, MsgType.Int) as c (c.key)}
    <div class="wide">
      <Stepper value={c.value} min={c.min} max={c.max} label={c.label === 'Note' ? 'Note (tempo sync)' : c.label} onchange={(v) => amp.set(c, v)} />
    </div>
  {/each}
{/snippet}

{#snippet switches(list: Control[])}
  {#each byType(list, MsgType.Bool) as c (c.key)}
    <div class="switch wide"><Switch checked={!!c.value} label={c.label} onchange={(v) => amp.set(c, v ? 1 : 0)} /></div>
  {/each}
{/snippet}

{#snippet modelList()}
  <div class="choices">
    {#each choices as group (group.category)}
      <div class="category">
        <h4>{group.category}</h4>
        {#each group.models as m (m.sym)}
          {@const current = isCurrent(m)}
          <button class="choice" class:current aria-pressed={current} onclick={() => pick(m)}>
            {m.name}<span class="dot" aria-hidden="true">●</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
  {#if testing.length}
    <button class="testing" onclick={() => catalogStore.setShowTesting(!catalogStore.showTesting)}>
      {catalogStore.showTesting ? 'Hide' : 'Show'} Line 6's test {testing.length === 1 ? 'list' : 'lists'}: {testing.map((g) => g.category).join(', ')}
    </button>
  {/if}
{/snippet}

<section class="editor" class:off={slot.enable && !on} style:--c={color} aria-labelledby="slot-title">
  <header>
    <div class="title">
      <span class="slot"><span class="swatch" aria-hidden="true"></span>{slot.label}</span>
      {#if slot.list && !noList}
        <button class="model" id="slot-title" aria-expanded={picking} onclick={() => (pickingFor = picking ? null : slot.sym)}>
          {slot.modelName}<span class="change">{ui.narrow ? '▾' : picking ? 'Close ▴' : 'Change ▾'}</span>
        </button>
      {:else}
        <h2 class="model" id="slot-title">{slot.modelName}</h2>
      {/if}
      {#if noList}
        <button class="catalog" onclick={() => (catalogStore.dialogOpen = true)}>Load the model list…</button>
      {/if}
    </div>
    {#if slot.enable}
      <button class="power" role="switch" aria-checked={on} aria-label="{slot.label} on" onclick={() => amp.toggle(slot)}>
        <span class="state">{on ? 'On' : 'Off'}</span>
        <span class="track" aria-hidden="true"><span class="thumb"></span></span>
      </button>
    {/if}
  </header>

  {#if picking && !ui.narrow}
    <div class="picker">
      <div class="picker-head">
        <span>{slot.label} {cab ? 'cabinets' : 'models'} · {modelCount} available</span>
        <button class="done" onclick={() => (pickingFor = null)}>Done</button>
      </div>
      {@render modelList()}
    </div>
  {/if}

  {#if cab && amp.speakerFullRange === false}
    <p class="note">Classic speaker mode plays through the woofer only, voiced for this amp, and ignores the cabinet and mic. Choose Full Range to hear them.</p>
  {/if}

  <div class="body" class:with-extras={hasExtras}>
    <div class="main">
      {#if slot.params.length}
        <div class="controls">{@render knobs(slot.params, true)}{@render switches(slot.params)}</div>
      {:else if !hasExtras && !slot.sync}
        <p class="empty">This block has no adjustable settings.</p>
      {/if}

      {#if slot.sync}
        {@const sync = slot.sync}
        <div class="sync">
          <Switch checked={synced} label="Tempo sync" onchange={(v) => amp.setSync(slot, v)} />
          <select
            aria-label="Note value"
            disabled={!synced}
            value={synced ? sync.c.value : sync.note}
            onchange={(e) => amp.setNote(slot, Number(e.currentTarget.value))}
          >
            {#each noteChoices(slot.group) as n (n.value)}
              <option value={n.value}>{n.label}</option>
            {/each}
          </select>
          {#if synced && amp.tempo !== null}<span class="at">at {amp.tempo} BPM</span>{/if}
        </div>
      {/if}
    </div>

    {#if hasExtras}
      <div class="extras">
        <h3>{extrasTitle}</h3>
        {#if cab}
          <div class="fields">
            {#if amp.speakerFullRange !== null}
              <label class="field">
                <span>Speaker</span>
                <select value={amp.speakerFullRange ? 'full' : 'classic'} onchange={(e) => amp.setSpeakerMode(e.currentTarget.value === 'full')}>
                  <option value="classic">Classic</option>
                  <option value="full">Full Range</option>
                </select>
              </label>
            {/if}
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
          </div>
        {/if}
        {@render switches(slot.extras)}
        {#if byType(slot.extras, MsgType.Float).length || byType(slot.extras, MsgType.Int).length}
          <div class="controls">{@render knobs(slot.extras, false)}</div>
        {/if}
      </div>
    {/if}
  </div>
</section>

{#if ui.narrow}
  <dialog bind:this={sheet} class="sheet" aria-label="{slot.label} model" onclose={() => (pickingFor = null)} onclick={(e) => { if (e.target === sheet) pickingFor = null; }}>
    {#if picking}
      <div class="sheet-head">
        <div class="sheet-title">
          <span>{slot.label} {cab ? 'cabinet' : 'model'}</span>
          <strong>{slot.modelName}</strong>
        </div>
        <button class="done primary" onclick={() => (pickingFor = null)}>Done</button>
      </div>
      <div class="sheet-body">{@render modelList()}</div>
    {/if}
  </dialog>
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--line);
  }
  .title {
    flex: 1;
    display: grid;
    justify-items: start;
    gap: 2px;
    min-width: 0;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--c);
  }
  .model {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    padding: 0;
    max-width: 100%;
    font: inherit;
    font-size: 22px;
    font-weight: 650;
    line-height: 1.2;
    color: var(--text);
    text-align: left;
    background: none;
    border: 0;
  }
  button.model { cursor: pointer; border-radius: 6px; }
  button.model:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  .change { flex: none; font-size: 13px; font-weight: 400; color: var(--muted); }
  button.model:hover .change { color: var(--text); }
  .catalog {
    margin-top: 6px;
    font: inherit;
    font-size: 13px;
    color: var(--accent);
    background: none;
    border: 1px dashed var(--line);
    border-radius: 8px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .catalog:hover { border-color: var(--accent); }
  .catalog:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* On/off: a pill with the state and a switch in the block colour. */
  .power {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
    font: inherit;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 20px;
    cursor: pointer;
  }
  .power:hover { border-color: var(--muted); }
  .power:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .state { font-size: 13px; font-weight: 600; color: var(--muted); }
  .track {
    position: relative;
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: var(--knob-track);
    transition: background 0.15s;
  }
  .thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--text);
    transition: transform 0.15s;
  }
  .power[aria-checked='true'] .state { color: var(--text); }
  .power[aria-checked='true'] .track { background: var(--c); }
  .power[aria-checked='true'] .thumb { transform: translateX(18px); }

  .picker {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 24px 20px;
    background: color-mix(in srgb, var(--bg) 50%, var(--panel));
    border-bottom: 1px solid var(--line);
  }
  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--muted);
  }
  .done {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .done:hover { border-color: var(--muted); }
  .done:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 18px;
  }
  .category { display: flex; flex-direction: column; gap: 4px; }
  h4 {
    margin: 0;
    padding: 0 10px 4px;
    font-size: 11px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .choice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    font: inherit;
    font-size: 14px;
    text-align: left;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
  }
  .choice:hover { background: var(--panel-2); }
  .choice:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .choice .dot { color: transparent; font-size: 12px; }
  .testing {
    align-self: flex-start;
    margin-top: 8px;
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--muted);
    background: none;
    border: 0;
    text-decoration: underline;
    cursor: pointer;
  }
  .testing:hover { color: var(--text); }
  .testing:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .choice.current {
    font-weight: 600;
    background: color-mix(in srgb, var(--c) 16%, transparent);
    border-color: var(--c);
  }
  .choice.current .dot { color: var(--c); }

  .note {
    margin: 0;
    padding: 14px 24px 0;
    color: var(--muted);
    font-size: 13px;
  }
  .body {
    display: grid;
    gap: 32px;
    padding: 28px 24px;
    transition: opacity 0.15s;
  }
  .body.with-extras { grid-template-columns: minmax(0, 1fr) auto; }
  .editor.off .body { opacity: 0.45; }
  .main { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 20px 24px;
  }
  .knob { transition: opacity 0.15s; }
  .knob.follows { opacity: 0.4; }
  .switch {
    display: flex;
    align-items: center;
    min-height: 32px;
  }
  .sync {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
  }
  .at { font-size: 13px; color: var(--muted); }
  .extras {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-left: 32px;
    border-left: 1px solid var(--line);
  }
  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .fields { display: grid; gap: 10px; }
  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    max-width: 100%;
  }
  .field select { width: 180px; }
  select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  select:disabled { opacity: 0.6; }
  .empty {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }

  /* Phones: model list in a bottom sheet, knobs three to a row. */
  .sheet {
    width: 100vw;
    max-width: 100vw;
    max-height: 78vh;
    margin: auto 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    color: var(--text);
    background: var(--panel);
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 20px 20px 0 0;
    overscroll-behavior: contain;
  }
  .sheet:not([open]) { display: none; }
  .sheet::backdrop { background: rgb(0 0 0 / 0.6); }
  .sheet-head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  .sheet-title { display: grid; min-width: 0; line-height: 1.25; }
  .sheet-title span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .sheet-title strong { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .done.primary {
    height: 40px;
    padding: 0 18px;
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
    border-radius: 12px;
  }
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px calc(28px + env(safe-area-inset-bottom));
  }
  .sheet .choices { display: flex; flex-direction: column; gap: 12px; }
  .sheet .category { gap: 4px; }
  .sheet h4 { padding: 6px; }
  .sheet .choice { min-height: 48px; padding: 0 14px; font-size: 16px; border-radius: 12px; }

  @media (max-width: 760px) {
    .editor { border-radius: 18px; }
    header { gap: 12px; padding: 14px 16px; }
    .slot { gap: 7px; }
    .swatch { width: 9px; height: 9px; }
    .model { font-size: 19px; gap: 6px; }
    .change { font-size: 12px; }
    .power { padding: 8px 4px; background: none; border: 0; }
    .state { display: none; }
    .track { width: 48px; height: 28px; border-radius: 14px; }
    .thumb { width: 22px; height: 22px; }
    .power[aria-checked='true'] .thumb { transform: translateX(20px); }
    .note { padding: 12px 16px 0; }
    .body, .body.with-extras { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0; }
    .main { gap: 14px; padding: 18px 8px; }
    .main:empty { display: none; }
    .controls {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px 4px;
    }
    .controls .wide, .main > .controls > .switch { grid-column: 1 / -1; justify-self: start; padding: 0 8px; }
    .sync { padding: 0 8px; }
    .extras { padding: 12px 16px 16px; border-left: 0; border-top: 1px solid var(--line); gap: 8px; }
    .extras .controls { margin: 0 -8px; }
    .switch { min-height: 44px; }
    .field select { width: 100%; }
  }
</style>
