<script lang="ts">
  import { amp } from '../amp.svelte';
  import { controls } from '../controls.svelte';
  import Menu from './Menu.svelte';
  import ControlsDialog from './ControlsDialog.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import { remote } from '../remote.svelte';
  import { keepAwake } from '../keepawake.svelte';

  const short = $derived(amp.demo ? 'Demo amp' : amp.label.replace(/ MIDI \d+$/, ''));
  const awake = $derived(
    !remote.settings.keepAwake ? 'Off: the phone may lock while you play'
      : keepAwake.state === 'lock' ? 'On'
        : keepAwake.state === 'waiting' ? 'Tap anywhere to start it'
          : keepAwake.secure ? 'On, as far as this browser allows' : 'On, as far as the browser allows over http (HTTPS works best)',
  );
  const phones = $derived(remote.online && remote.phones ? ` · ${remote.phones} ${remote.phones === 1 ? 'phone' : 'phones'}` : '');
</script>

<Menu label="Amp connection: {short}{amp.remoteCode ? ' (remote)' : phones}">
  {#snippet button()}
    <span class="dot" class:remote={!!amp.remoteCode} aria-hidden="true"></span>{short}{#if amp.remoteCode}<span class="via">via computer</span>{:else if phones}<span class="via">{phones}</span>{/if}
  {/snippet}
  {#snippet children(close)}
    <div class="meta">
      {amp.label}{amp.firmware ? ` · firmware ${amp.firmware}` : ''}
      {#if amp.remoteCode}<br />Remote control through a computer, code {amp.remoteCode}{/if}
    </div>
    <button class="item" role="menuitem" onclick={() => { close(); amp.refresh(); }}>
      Re-read tone
      <small>Fetch the current tone from the amp again</small>
    </button>
    <button class="item" role="menuitem" onclick={() => { close(); controls.dialogOpen = true; }}>
      Controls and MIDI pedals…
      <small>Channel switch key, foot controllers, expression pedals</small>
    </button>
    {#if amp.remoteCode}
      <button class="item" role="menuitemcheckbox" aria-checked={remote.settings.keepAwake} onclick={() => remote.update({ keepAwake: !remote.settings.keepAwake })}>
        Keep screen on {remote.settings.keepAwake ? '✓' : ''}
        <small>{awake}</small>
      </button>
    {/if}
    {#if amp.hub}
      <button class="item" role="menuitem" onclick={() => { close(); remote.dialogOpen = true; }}>
        Remote control from a phone…
        <small>{remote.settings.share ? (remote.online ? `Sharing, code ${remote.settings.code}` : 'Sharing is on') : 'Use a phone on the same Wi-Fi as a remote'}</small>
      </button>
    {/if}
    <button class="item" role="menuitem" onclick={() => { close(); amp.disconnect(); }}>
      Disconnect
      <small>{amp.remoteCode ? 'Stop controlling the amp from here' : 'Close the tab to free the amp for other programs'}</small>
    </button>
  {/snippet}
</Menu>

<ControlsDialog />
<ShareDialog />

<style>
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--g-delay);
    box-shadow: 0 0 6px var(--g-delay);
  }
  .dot.remote { background: var(--g-mod); box-shadow: 0 0 6px var(--g-mod); }
  .via { color: var(--muted); }
  /* The blue dot marks a remote on phones; the menu says the rest. */
  @media (max-width: 760px) { .via { display: none; } }
</style>
