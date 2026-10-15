<script lang="ts">
  // Creates or edits a multi-block shortcut.
  import { amp } from '../amp.svelte';
  import { shortcuts } from '../shortcuts.svelte';
  import { type Shortcut, keyConflict, knobControl } from '../shortcuts';
  import { type Control, displayScale } from '../tone';
  import { MsgType } from '../protocol/codec';
  import { keyLabel } from '../keys.svelte';
  import { groupColor } from '../colors';
  import { controls } from '../controls.svelte';

  let dialog: HTMLDialogElement | undefined = $state();
  let draft = $state<Shortcut | null>(null);
  let listening = $state(false);
  let keyError = $state('');

  const existing = $derived(!!draft && shortcuts.list.some((s) => s.id === draft!.id));
  const switchable = $derived(amp.chain.filter((s) => s.enable));
  // Blocks the shortcut names that this preset doesn't have; kept as they are.
  const absent = $derived(draft?.targets.filter((t) => !switchable.some((s) => s.sym === t.sym)) ?? []);
  const valid = $derived(!!draft && (draft.targets.length > 0 || draft.knobs.length > 0));
  // Knobs that can be assigned: every non-switch control of the current tone.
  const knobChoices = $derived(amp.chain.map((slot) => ({
    slot,
    controls: [...slot.params, ...slot.extras].filter((c) => c.type !== MsgType.Bool),
  })));
  const labelOf = (sym: string) => amp.chain.find((s) => s.sym === sym)?.label ?? sym;
  // Rounded like the knobs show them; a value left as it is keeps its full precision.
  const show = (c: Control | undefined, v: number) => Math.round(v * (c ? displayScale(c) : 1) * 10) / 10;

  function addKnob(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const [sym, param] = el.value.split('|');
    el.value = '';
    const c = knobControl(amp.chain, sym, param);
    if (!draft || !c || draft.knobs.some((k) => k.sym === sym && k.param === param)) return;
    draft.knobs.push({ sym, param, off: c.value, on: c.value });
  }

  function setKnob(i: number, end: 'off' | 'on', text: string) {
    const k = draft?.knobs[i];
    const c = k && knobControl(amp.chain, k.sym, k.param);
    const v = Number(text);
    if (!k || Number.isNaN(v)) return;
    const raw = c ? v / displayScale(c) : v;
    k[end] = c ? Math.min(c.max, Math.max(c.min, c.type === MsgType.Int ? Math.round(raw) : raw)) : raw;
  }

  function learnMidi() {
    if (controls.learning) return controls.stopLearning();
    controls.learn((cc) => { if (draft) draft.midi = { cc, expression: draft.midi?.expression ?? false }; });
  }

  $effect(() => {
    if (!dialog) return;
    if (shortcuts.editing && !dialog.open) {
      draft = shortcuts.editing;
      listening = false;
      keyError = '';
      dialog.showModal();
    } else if (!shortcuts.editing && dialog.open) {
      dialog.close();
    }
  });

  const stateOf = (sym: string) => draft?.targets.find((t) => t.sym === sym);

  function setTarget(sym: string, v: 'skip' | 'on' | 'off') {
    if (!draft) return;
    const rest = draft.targets.filter((t) => t.sym !== sym);
    draft.targets = v === 'skip' ? rest : [...rest, { sym, on: v === 'on' }];
    // Keep chain order so the buttons list blocks the way the chain does.
    const order = amp.chain.map((s) => s.sym);
    draft.targets.sort((a, b) => order.indexOf(a.sym) - order.indexOf(b.sym));
  }

  function captureKey(e: KeyboardEvent) {
    if (!listening || !draft) return;
    if (e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { listening = false; keyError = ''; return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { draft.key = ''; listening = false; keyError = ''; return; }
    if (/^(Shift|Control|Alt|Meta|OS)/.test(e.code)) return;
    const c = keyConflict(e.code, shortcuts.list, draft.id, controls.taken);
    if (!c) {
      draft.key = e.code;
      listening = false;
      keyError = '';
    } else if ('block' in c) {
      keyError = `${keyLabel(e.code)} already switches ${amp.chain.find((s) => s.sym === c.block)?.label ?? c.block} on its own.`;
    } else if ('shortcut' in c) {
      keyError = `${keyLabel(e.code)} is used by “${c.shortcut.name}”.`;
    } else if ('control' in c) {
      keyError = `${keyLabel(e.code)} is the key for ${c.control}.`;
    } else {
      keyError = `${keyLabel(e.code)} can't be used. Try a letter, F-key, arrow or Page Up/Down.`;
    }
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!draft || !valid) return;
    const name = draft.name.trim() ||
      [...draft.targets.map((t) => labelOf(t.sym)), ...draft.knobs.map((k) => knobControl(amp.chain, k.sym, k.param)?.label ?? k.param)].join(' + ');
    controls.stopLearning();
    shortcuts.save({ ...$state.snapshot(draft), name });
    shortcuts.editing = null;
  }

  function remove() {
    controls.stopLearning();
    if (draft) shortcuts.remove(draft.id);
    shortcuts.editing = null;
  }
</script>

<dialog bind:this={dialog} onclose={() => { controls.stopLearning(); shortcuts.editing = null; }} aria-labelledby="shortcut-title">
  {#if draft}
    <form onsubmit={save}>
      <h2 id="shortcut-title">{existing ? 'Edit shortcut' : 'New shortcut'}</h2>
      <label class="field">
        <span>Name</span>
        <input bind:value={draft.name} maxlength="40" placeholder="e.g. Solo" spellcheck="false" />
      </label>

      <div class="field">
        <span id="key-label">Key</span>
        <div class="row">
          <button
            type="button"
            class="capture"
            class:listening
            aria-labelledby="key-label"
            aria-describedby="key-help"
            onclick={() => { listening = !listening; keyError = ''; }}
            onkeydown={captureKey}
            onblur={() => (listening = false)}
          >
            {#if listening}Press a key…{:else if draft.key}<kbd>{keyLabel(draft.key)}</kbd>{:else}None{/if}
          </button>
          {#if draft.key && !listening}
            <button type="button" class="small" onclick={() => draft && (draft.key = '')}>Clear</button>
          {/if}
        </div>
        <small id="key-help" class:error={!!keyError} role={keyError ? 'alert' : undefined}>
          {keyError || 'Click, then press the key. A foot controller or page-turner pedal that sends keys works too.'}
        </small>
      </div>

      <fieldset class="field">
        <legend>Action</legend>
        <div class="row">
          <label class="radio"><input type="radio" name="mode" value={false} bind:group={draft.momentary} /> Toggle on each press</label>
          <label class="radio"><input type="radio" name="mode" value={true} bind:group={draft.momentary} /> Only while held</label>
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>Blocks when engaged</legend>
        <small>Disengaging puts each block in the opposite state.</small>
        <ul class="blocks">
          {#each switchable as slot (slot.sym)}
            {@const t = stateOf(slot.sym)}
            {@const v = t ? (t.on ? 'on' : 'off') : 'skip'}
            <li style:--c={groupColor(slot.group)}>
              <span class="block"><span class="dot" aria-hidden="true"></span>{slot.label}<small>{slot.shortName}</small></span>
              <span class="seg" role="radiogroup" aria-label={slot.label}>
                {#each [['skip', '–'], ['on', 'On'], ['off', 'Off']] as [value, text]}
                  <label class:checked={v === value}>
                    <input type="radio" name="t-{slot.sym}" {value} checked={v === value} onchange={() => setTarget(slot.sym, value as 'skip' | 'on' | 'off')} />
                    <span aria-label={value === 'skip' ? 'Leave alone' : undefined}>{text}</span>
                  </label>
                {/each}
              </span>
            </li>
          {/each}
        </ul>
        {#if absent.length}
          <small>Also switches {absent.map((t) => `${t.sym} ${t.on ? 'on' : 'off'}`).join(', ')}, which this preset doesn't have.</small>
        {/if}
      </fieldset>

      <fieldset class="field">
        <legend>Knobs</legend>
        <small>Set to “On” while engaged and back to “Off” otherwise, like a GX-100 assign's max and min.</small>
        {#if draft.knobs.length}
          <ul class="knobs">
            {#each draft.knobs as k, i (k.sym + k.param)}
              {@const c = knobControl(amp.chain, k.sym, k.param)}
              <li class:missing={!c} style:--c={groupColor(amp.chain.find((s) => s.sym === k.sym)?.group ?? 'fixed')}>
                <span class="block"><span class="dot" aria-hidden="true"></span>{labelOf(k.sym)}<small>{c?.label ?? `${k.param} (not on this model)`}</small></span>
                <span class="range">
                  <input type="number" step="any" aria-label="{labelOf(k.sym)} {c?.label ?? k.param} off" value={show(c, k.off)} onchange={(e) => setKnob(i, 'off', e.currentTarget.value)} />
                  <span aria-hidden="true">→</span>
                  <input type="number" step="any" aria-label="{labelOf(k.sym)} {c?.label ?? k.param} on" value={show(c, k.on)} onchange={(e) => setKnob(i, 'on', e.currentTarget.value)} />
                  <button type="button" class="small" aria-label="Remove {c?.label ?? k.param}" onclick={() => draft?.knobs.splice(i, 1)}>×</button>
                </span>
              </li>
            {/each}
          </ul>
          <small>Off → On, as the editor shows them{draft.knobs.some((k) => { const c = knobControl(amp.chain, k.sym, k.param); return c && displayScale(c) !== 1; }) ? ' (0–10 for most knobs)' : ''}.</small>
        {/if}
        <select class="add-knob" aria-label="Add a knob" onchange={addKnob}>
          <option value="">Add a knob…</option>
          {#each knobChoices as { slot, controls: cs } (slot.sym)}
            {#if cs.length}
              <optgroup label="{slot.label} · {slot.shortName}">
                {#each cs as c (c.key)}
                  <option value="{slot.sym}|{c.sym}" disabled={draft.knobs.some((k) => k.sym === slot.sym && k.param === c.sym)}>{c.label}</option>
                {/each}
              </optgroup>
            {/if}
          {/each}
        </select>
      </fieldset>

      <fieldset class="field">
        <legend>MIDI pedal</legend>
        <div class="row">
          <button type="button" class="capture" class:listening={controls.learning} onclick={learnMidi} disabled={!controls.settings.midi}>
            {#if controls.learning}Move the pedal…{:else if draft.midi}CC {draft.midi.cc}{:else}None{/if}
          </button>
          {#if draft.midi && !controls.learning}
            <button type="button" class="small" onclick={() => draft && (draft.midi = null)}>Clear</button>
          {/if}
        </div>
        {#if draft.midi}
          <label class="radio"><input type="checkbox" bind:checked={draft.midi.expression} /> Expression pedal: knobs follow it from Off (heel) to On (toe)</label>
        {/if}
        <small>
          {controls.settings.midi
            ? 'Click, then press the footswitch or move the pedal. A latching footswitch works best with “Only while held”.'
            : 'Turn on MIDI pedals under Controls (amp menu) to use a MIDI foot controller.'}
        </small>
      </fieldset>

      <div class="buttons">
        {#if existing}<button type="button" class="danger" onclick={remove}>Delete</button>{/if}
        <span class="spacer"></span>
        <button type="button" onclick={() => (shortcuts.editing = null)}>Cancel</button>
        <button type="submit" class="primary" disabled={!valid}>Save</button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  form {
    display: grid;
    gap: 16px;
    padding: 20px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .field {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
  }
  legend { padding: 0; margin-bottom: 6px; }
  small { font-size: 12px; color: var(--muted); }
  small.error { color: var(--error); }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }
  input:not([type='radio']):not([type='checkbox']), select {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--text);
    cursor: pointer;
  }
  .radio input { accent-color: var(--accent); margin: 0; }
  .knobs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .knobs li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 10px;
  }
  .knobs li.missing { opacity: 0.6; }
  .range {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .range input {
    width: 72px;
    padding: 5px 8px !important;
  }
  .capture {
    min-width: 120px;
    text-align: left;
  }
  .capture.listening {
    border-color: var(--accent);
    color: var(--accent);
  }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 0 5px;
    font: 600 12px/18px var(--mono);
    text-align: center;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
  }
  .blocks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .blocks li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 3px 0;
  }
  .block {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-size: 14px;
    color: var(--text);
  }
  .block small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    align-self: center;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
  }
  .seg {
    flex: none;
    display: flex;
    border: 1px solid var(--line);
    border-radius: 7px;
    overflow: hidden;
  }
  .seg label {
    position: relative;
    min-width: 40px;
    padding: 3px 8px;
    font-size: 12px;
    text-align: center;
    color: var(--muted);
    cursor: pointer;
  }
  .seg label + label { border-left: 1px solid var(--line); }
  .seg input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .seg label.checked { color: var(--text); background: var(--panel-2); font-weight: 600; }
  .seg label.checked:nth-child(2) { background: color-mix(in srgb, var(--c) 25%, var(--panel-2)); }
  .seg label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .spacer { flex: 1; }
  button {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 14px;
    cursor: pointer;
  }
  button.small { font-size: 13px; padding: 4px 10px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .danger { color: var(--error); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
