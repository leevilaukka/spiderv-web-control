<script lang="ts">
  // The ⋯ menu: the amp, app settings and tools.
  import { amp } from '../amp.svelte';
  import Menu from './Menu.svelte';
  import AmpMenuItems from './AmpMenuItems.svelte';
</script>

<Menu label="Amp and app options" title="More">
  {#snippet button()}<span aria-hidden="true">⋯</span>{/snippet}
  {#snippet children(close)}
    <div class="meta">
      {amp.demo ? 'Demo amp (simulated)' : amp.label}{amp.firmware ? ` · firmware ${amp.firmware}` : ''}
      {#if amp.remoteCode}<br />Remote control through a computer, code {amp.remoteCode}{/if}
    </div>
    <AmpMenuItems {close} />
  {/snippet}
</Menu>
