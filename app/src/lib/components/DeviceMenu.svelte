<script lang="ts">
  import { amp } from '../amp.svelte';
  import Menu from './Menu.svelte';

  const short = $derived(amp.demo ? 'Demo amp' : amp.label.replace(/ MIDI \d+$/, ''));
</script>

<Menu label="Amp connection: {short}">
  {#snippet button()}
    <span class="dot" aria-hidden="true"></span>{short}
  {/snippet}
  {#snippet children(close)}
    <div class="meta">
      {amp.label}{amp.firmware ? ` · firmware ${amp.firmware}` : ''}
    </div>
    <button class="item" role="menuitem" onclick={() => { close(); amp.refresh(); }}>
      Re-read tone
      <small>Fetch the current tone from the amp again</small>
    </button>
    <button class="item" role="menuitem" onclick={() => { close(); amp.disconnect(); }}>
      Disconnect
      <small>Close the tab to free the amp for other programs</small>
    </button>
  {/snippet}
</Menu>

<style>
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--g-delay);
    box-shadow: 0 0 6px var(--g-delay);
  }
</style>
