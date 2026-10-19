<script lang="ts">
  // Channel A/B switch for the current preset, and its setup dialog.
  import { amp } from '../amp.svelte';
  import { controls } from '../controls.svelte';
  import { GROUPS } from '../tonedesign';
  import { GROUP_BLOCKS } from '../shortcuts';
  import { keyLabel } from '../keys.svelte';
  import { groupColor } from '../colors';

  let { variant = 'bar' }: { variant?: 'bar' | 'strip' | 'big' } = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let picked = $state<string[]>([]);

  const ch = $derived(amp.channels);
  const slotOf = (g: string) => amp.chain.find((s) => s.sym === GROUP_BLOCKS[g]);
  const groupsLabel = (gs: string[]) => gs.map((g) => GROUPS[g]?.label ?? g).join(', ');

  function openSetup() {
    picked = ch ? [...ch.groups] : ['amp', 'cab'];
    dialog?.showModal();
  }

  async function saveSetup(e: SubmitEvent) {
    e.preventDefault();
    dialog?.close();
    if (!picked.length) amp.setChannels(null);
    else if (ch) await amp.setChannelGroups(Object.keys(GROUPS).filter((g) => picked.includes(g)));
    else await amp.startChannels(Object.keys(GROUPS).filter((g) => picked.includes(g)));
  }

  function remove() {
    dialog?.close();
    amp.setChannels(null);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!ch || !controls.settings.channelKey || e.code !== controls.settings.channelKey) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if ((e.target as Element).closest?.('input, textarea, select, dialog, [contenteditable], [role="slider"]')) return;
    e.preventDefault();
    amp.switchChannel();
  }
</script>

<svelte:window {onkeydown} />

{#if ch}
  <div class="fsw ch {variant}">
    <button
      class="fsw-press ab"
      disabled={amp.switching}
      aria-label="Channel {ch.active}; switch to {ch.active === 'A' ? 'B' : 'A'}"
      aria-keyshortcuts={controls.settings.channelKey ? keyLabel(controls.settings.channelKey) : undefined}
      onclick={() => amp.switchChannel()}
    >
      <span class="letter" class:on={ch.active === 'A'}>A</span>
      <span class="letter" class:on={ch.active === 'B'}>B</span>
      {#if variant !== 'strip'}
        <span class="what">
          <span class="name">Channel {ch.active}</span>
          <span class="blocks">{groupsLabel(ch.groups)}</span>
        </span>
      {/if}
    </button>
    <button class="fsw-edit" aria-label="Edit channels" title="Edit channels" onclick={openSetup}>✎</button>
    {#if variant === 'bar' && controls.settings.channelKey}<kbd class="key" aria-hidden="true">{keyLabel(controls.settings.channelKey)}</kbd>{/if}
  </div>
{:else}
  <button class="add {variant}" onclick={openSetup} title="Two setups of the amp or blocks, like a GX-100's two amps">
    <span aria-hidden="true">+</span> Channels A/B
  </button>
{/if}

<dialog bind:this={dialog} aria-labelledby="channels-title">
  <form onsubmit={saveSetup}>
    <h2 id="channels-title">Channels A/B</h2>
    <p>
      Like a GX-100's two amps: the blocks you pick have two setups, A and B, each with its own model, knobs and on/off.
      The other blocks are shared. Switch channels, then edit the active one as usual; each remembers its settings.
      Save the preset to keep them.
    </p>
    <fieldset>
      <legend>Blocks in the channels</legend>
      <div class="groups">
        {#each Object.entries(GROUPS) as [g, def] (g)}
          {@const slot = slotOf(g)}
          {#if slot}
            <label style:--c={groupColor(slot.group)}>
              <input type="checkbox" value={g} bind:group={picked} />
              <span class="dot" aria-hidden="true"></span>{def.label}<small>{slot.shortName}</small>
            </label>
          {/if}
        {/each}
      </div>
    </fieldset>
    <p class="note">
      The Spider V has one amp and one chain, so the channels take turns rather than play together. Settings of the same
      model switch seamlessly; a different model is reloaded, which may be audible.
      {#if !controls.settings.channelKey}Set a key or MIDI pedal for switching under Controls in the amp menu.{/if}
    </p>
    <div class="buttons">
      {#if ch}<button type="button" class="danger" onclick={remove}>Remove channels</button>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={() => dialog?.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={!picked.length}>{ch ? 'Save' : 'Set up'}</button>
    </div>
  </form>
</dialog>

<style>
  .ch {
    width: 170px;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  }
  .ch.strip, .ch.big { width: auto; }
  .ab { gap: 8px; }
  .ab:disabled { cursor: progress; }
  .letter {
    flex: none;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    font: 700 13px/1 var(--mono);
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .letter.on {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .what {
    display: grid;
    min-width: 0;
    margin-left: 2px;
    line-height: 1.2;
  }
  .name { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .blocks {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .strip .letter { width: 24px; height: 24px; font-size: 12px; }
  .strip .ab { gap: 6px; padding: 0 4px 0 12px; }
  .big .letter { width: 32px; height: 32px; font-size: 15px; border-radius: 7px; }
  .big .name { font-size: 17px; font-weight: 700; }
  .key {
    position: absolute;
    right: 8px;
    bottom: 6px;
    padding: 0 4px;
    font: 600 10px/14px var(--mono);
    color: var(--muted);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    pointer-events: none;
  }
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
  .add.strip { order: 1; height: 48px; padding: 0 14px; }
  .add.big { height: auto; min-height: 64px; border-radius: 14px; }

  dialog {
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 14px;
  }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
  form { display: grid; gap: 14px; padding: 20px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; font-size: 13px; color: var(--muted); }
  fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px 14px;
  }
  .groups label {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 14px;
    cursor: pointer;
    min-width: 0;
  }
  .groups input { accent-color: var(--accent); margin: 0; align-self: center; }
  .groups small {
    font-size: 12px;
    color: var(--muted);
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
  .buttons { display: flex; gap: 8px; }
  .spacer { flex: 1; }
  form button {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 14px;
    cursor: pointer;
  }
  form button:disabled { opacity: 0.5; cursor: default; }
  .primary { background: var(--accent) !important; border-color: var(--accent) !important; color: #fff !important; font-weight: 600; }
  .danger { color: var(--error) !important; }
  form button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
