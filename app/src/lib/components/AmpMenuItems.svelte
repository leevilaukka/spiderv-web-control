<script module lang="ts">
  import { amp } from '../amp.svelte';
  import { autoConnect } from '../autoconnect.svelte';

  export function disconnect() {
    if (!amp.demo && !amp.remoteCode) autoConnect.hold();
    amp.disconnect();
  }
</script>

<script lang="ts">
  // Everything that isn't editing or playing: the amp menu on wide screens,
  // the More tab on phones.
  import { controls } from '../controls.svelte';
  import { relayAvailable, remote } from '../remote.svelte';
  import { keepAwake } from '../keepawake.svelte';
  import { catalogStore } from '../catalog.svelte';
  import { exportSettings, importFile } from '../settings.svelte';
  import { SETTINGS_FILES, pickFile } from '../pickfile';
  import { ui } from '../ui.svelte';

  let { close = () => {}, withDisconnect = true }: { close?: () => void; withDisconnect?: boolean } = $props();

  const awake = $derived(
    !remote.settings.keepAwake ? 'Off: the phone may lock while you play'
      : keepAwake.state === 'lock' ? 'On'
        : keepAwake.state === 'waiting' ? 'Tap anywhere to start it'
          : keepAwake.secure ? 'On, as far as this browser allows' : 'On, as far as the browser allows over http (HTTPS works best)',
  );
  const busy = $derived(!!amp.importing || amp.saving);
</script>

<button class="item" role="menuitem" onclick={() => { close(); amp.refresh(); }}>
  Re-read tone
  <small>Fetch the current tone from the amp again</small>
</button>
<button class="item" role="menuitem" onclick={() => { close(); catalogStore.dialogOpen = true; }}>
  Model catalog…
  <small>{catalogStore.loaded ? `${catalogStore.models} models loaded` : 'Load model names and lists from the Spider Remote app'}</small>
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
{#if amp.hub && relayAvailable}
  <button class="item" role="menuitem" onclick={() => { close(); remote.dialogOpen = true; }}>
    Remote control from a phone…
    <small>{remote.settings.share ? (remote.online ? `Sharing, code ${remote.settings.code}` : 'Sharing is on') : 'Use a phone on the same Wi-Fi as a remote'}</small>
  </button>
{/if}
<button class="item" role="menuitem" disabled={busy} onclick={() => { close(); amp.backupPresets(); }}>
  Back up all presets
  <small>Download all {amp.presets.length} presets as one file</small>
</button>
<button class="item" role="menuitem" onclick={() => { close(); exportSettings(); }}>
  Export app settings
  <small>Shortcuts, channels, controls and assistant setup, without API keys</small>
</button>
<button class="item" role="menuitem" disabled={!!amp.importing} onclick={() => { close(); pickFile(SETTINGS_FILES, importFile); }}>
  Import app settings…
  <small>Replaces those kept in this browser; you can undo it</small>
</button>
<button class="item" role="menuitem" onclick={() => { close(); ui.consoleOpen = true; }}>
  Protocol console
  <small>Raw messages, for debugging ({amp.log.length})</small>
</button>
{#if withDisconnect}
  <button class="item sep" role="menuitem" onclick={() => { close(); disconnect(); }}>
    Disconnect
    <small>{amp.remoteCode ? 'Stop controlling the amp from here' : 'Close the tab to free the amp for other programs'}</small>
  </button>
{/if}
